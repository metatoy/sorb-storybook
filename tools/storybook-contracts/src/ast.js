// Static helpers over a Babel AST. No code is ever executed: values are read from literals only.
import { parse } from '@babel/parser';

export function parseSource(code, filename = '') {
  const jsx = /\.(tsx|jsx)$/.test(filename);
  return parse(code, {
    sourceType: 'module',
    errorRecovery: true,
    plugins: ['typescript', 'decorators', ...(jsx ? ['jsx'] : [])],
  });
}

// Unwrap `x as const`, `x satisfies Meta<…>`, `<T>x`, `x!` and parentheses.
export function unwrap(node) {
  while (node && ['TSAsExpression', 'TSSatisfiesExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(node.type)) {
    node = node.expression;
  }
  return node;
}

// Top-level `const name = <init>` declarations (exported or not), for resolving identifiers.
export function topLevelConsts(ast) {
  const out = new Map();
  for (const stmt of ast.program.body) {
    const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt;
    if (decl?.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) out.set(d.id.name, d);
  }
  return out;
}

const FN = { __kind: 'function' };

// Evaluate a literal-ish expression to plain JSON. Anything dynamic becomes a tagged placeholder
// ({ __kind: 'function' | 'call' | 'ref' | 'expr' }) so callers can tell "set, but not static".
export function evalNode(node, consts = new Map(), depth = 0) {
  node = unwrap(node);
  if (!node || depth > 20) return undefined;
  switch (node.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value;
    case 'NullLiteral': return null;
    case 'TemplateLiteral':
      return node.expressions.length === 0 ? node.quasis.map(q => q.value.cooked).join('') : { __kind: 'expr' };
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument.type === 'NumericLiteral') return -node.argument.value;
      if (node.operator === '!' ) { const v = evalNode(node.argument, consts, depth + 1); return typeof v === 'boolean' ? !v : { __kind: 'expr' }; }
      return { __kind: 'expr' };
    case 'ArrayExpression':
      return node.elements.flatMap(e => {
        if (!e) return [];
        if (e.type === 'SpreadElement') { const v = evalNode(e.argument, consts, depth + 1); return Array.isArray(v) ? v : []; }
        return [evalNode(e, consts, depth + 1)];
      });
    case 'ObjectExpression': {
      const obj = {};
      for (const p of node.properties) {
        if (p.type === 'SpreadElement') {
          const v = evalNode(p.argument, consts, depth + 1);
          if (v && typeof v === 'object' && !Array.isArray(v) && !v.__kind) Object.assign(obj, v);
          continue;
        }
        const key = propKey(p);
        if (key == null) continue;
        obj[key] = p.type === 'ObjectMethod' ? FN : evalNode(p.value, consts, depth + 1);
      }
      return obj;
    }
    case 'Identifier': {
      if (node.name === 'undefined') return undefined;
      const d = consts.get(node.name);
      return d ? evalNode(d.init, consts, depth + 1) : { __kind: 'ref', name: node.name };
    }
    case 'ArrowFunctionExpression': case 'FunctionExpression': return FN;
    case 'CallExpression': return { __kind: 'call', callee: calleeName(node.callee) };
    case 'MemberExpression': return { __kind: 'ref', name: memberName(node) };
    default: return { __kind: 'expr' };
  }
}

export function propKey(p) {
  if (p.computed) return p.key.type === 'StringLiteral' ? p.key.value : null;
  if (p.key.type === 'Identifier') return p.key.name;
  if (p.key.type === 'StringLiteral' || p.key.type === 'NumericLiteral') return String(p.key.value);
  return null;
}

export function calleeName(c) {
  c = unwrap(c);
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression') return memberName(c);
  return '?';
}

export function memberName(m) {
  const obj = m.object.type === 'Identifier' ? m.object.name : m.object.type === 'MemberExpression' ? memberName(m.object) : '?';
  const prop = m.property.type === 'Identifier' ? m.property.name : m.property.value;
  return `${obj}.${prop}`;
}

// Find a property node (not its value) inside an ObjectExpression, e.g. to see whether `play` exists.
export function findProp(objNode, name) {
  objNode = unwrap(objNode);
  if (objNode?.type !== 'ObjectExpression') return null;
  return objNode.properties.find(p => p.type !== 'SpreadElement' && propKey(p) === name) || null;
}

// Render a TS type annotation into a contract type.
export function tsTypeToContract(t, src) {
  if (!t) return { type: 'unknown' };
  if (t.type === 'TSTypeAnnotation') t = t.typeAnnotation;
  if (t.type === 'TSParenthesizedType') return tsTypeToContract(t.typeAnnotation, src);
  if (t.type === 'TSUnionType') {
    const members = t.types.filter(m => !(m.type === 'TSUndefinedKeyword' || m.type === 'TSNullKeyword'));
    const lits = members.map(m => (m.type === 'TSLiteralType' ? m.literal.value : undefined));
    if (lits.length && lits.every(v => typeof v === 'string' || typeof v === 'number')) return { type: 'enum', values: lits };
    if (members.length === 1) return tsTypeToContract(members[0], src);
    return { type: 'union', text: slice(t, src) };
  }
  switch (t.type) {
    case 'TSStringKeyword': return { type: 'string' };
    case 'TSNumberKeyword': return { type: 'number' };
    case 'TSBooleanKeyword': return { type: 'boolean' };
    case 'TSFunctionType': return { type: 'function' };
    case 'TSLiteralType': return { type: 'enum', values: [t.literal.value] };
    case 'TSArrayType': return { type: 'array', text: slice(t, src) };
    default: return { type: 'object', text: slice(t, src) };
  }
}

const slice = (n, src) => (src && n.start != null ? src.slice(n.start, n.end).replace(/\s+/g, ' ') : undefined);

export function isPlaceholder(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && typeof v.__kind === 'string';
}
