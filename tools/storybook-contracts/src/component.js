// Read a component's public API straight from its source file.
// Angular: @Input()/@Output() decorators and signal APIs (input, input.required, model, output).
// React: the props type of the exported component (interface/type alias in the same file).
import fs from 'node:fs';
import { parseSource, evalNode, tsTypeToContract, calleeName, propKey, unwrap } from './ast.js';

export function readComponent(file, exportName) {
  if (!file) return null;
  const src = fs.readFileSync(file, 'utf8');
  const ast = parseSource(src, file);
  const classes = [];
  const typeDecls = new Map();
  const fnComponents = [];

  walkTop(ast, node => {
    if (node.type === 'ClassDeclaration') classes.push(node);
    if (node.type === 'TSInterfaceDeclaration') typeDecls.set(node.id.name, node.body.body);
    if (node.type === 'TSTypeAliasDeclaration' && node.typeAnnotation.type === 'TSTypeLiteral') typeDecls.set(node.id.name, node.typeAnnotation.members);
    if (node.type === 'FunctionDeclaration' && node.id) fnComponents.push({ name: node.id.name, params: node.params });
    if (node.type === 'VariableDeclaration') {
      for (const d of node.declarations) {
        const init = unwrap(d.init);
        if (d.id.type === 'Identifier' && (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression')) {
          fnComponents.push({ name: d.id.name, params: init.params, varType: d.id.typeAnnotation });
        }
      }
    }
  });

  const cls = classes.find(c => c.id?.name === exportName) || classes.find(c => (c.decorators || []).some(isComponentDecorator));
  if (cls) return { framework: 'angular', ...readAngularClass(cls, src) };

  const fn = fnComponents.find(f => f.name === exportName) || fnComponents[0];
  if (fn) return { framework: 'react', ...readReactProps(fn, typeDecls, src) };
  return null;
}

function walkTop(ast, visit) {
  for (const stmt of ast.program.body) {
    const d = stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportDefaultDeclaration' ? stmt.declaration : stmt;
    if (d) visit(d);
  }
}

const isComponentDecorator = d => ['Component', 'Directive'].includes(decoratorName(d));
function decoratorName(d) {
  const e = d.expression;
  return e.type === 'CallExpression' ? calleeName(e.callee) : e.type === 'Identifier' ? e.name : null;
}

function readAngularClass(cls, src) {
  const inputs = {}, outputs = {};
  let selector = null;
  const compDec = (cls.decorators || []).find(isComponentDecorator);
  if (compDec?.expression.type === 'CallExpression') {
    const cfg = evalNode(compDec.expression.arguments[0]);
    if (typeof cfg?.selector === 'string') selector = cfg.selector;
  }
  for (const m of cls.body.body) {
    if (m.type !== 'ClassProperty' && m.type !== 'ClassAccessorProperty' && m.type !== 'ClassMethod') continue;
    const name = m.key.type === 'Identifier' ? m.key.name : propKey(m);
    if (!name || m.accessibility === 'private' || m.accessibility === 'protected') continue;

    for (const d of m.decorators || []) {
      const dn = decoratorName(d);
      const opts = d.expression.type === 'CallExpression' ? evalNode(d.expression.arguments[0]) : undefined;
      if (dn === 'Input') {
        const alias = typeof opts === 'string' ? opts : opts?.alias;
        const t = m.type === 'ClassMethod' ? tsTypeToContract(m.params[0]?.typeAnnotation, src) : tsTypeToContract(m.typeAnnotation, src);
        const def = m.value ? evalNode(m.value) : undefined;
        // `@Input() disabled = false;` has no annotation: infer the type from the initializer.
        if (t.type === 'object' && !t.text && isStatic(def) && def !== null) Object.assign(t, { type: typeof def });
        if ((t.type === 'object' || t.type === 'unknown') && !m.typeAnnotation && isStatic(def) && def !== null && typeof def !== 'object') t.type = typeof def;
        inputs[alias || name] = clean({ ...t, default: isStatic(def) ? def : undefined, required: opts?.required === true || undefined });
      }
      if (dn === 'Output') outputs[(typeof opts === 'string' ? opts : null) || name] = { type: 'event' };
    }

    // Signal-based APIs: name = input<T>(default) | input.required<T>() | model<T>() | output<T>()
    const init = m.value && unwrap(m.value);
    if (init?.type === 'CallExpression') {
      const callee = calleeName(init.callee);
      const typeArg = init.typeParameters?.params?.[0] || init.typeArguments?.params?.[0];
      const t = typeArg ? tsTypeToContract(typeArg, src) : { type: 'unknown' };
      const optsArg = callee.endsWith('.required') ? init.arguments[0] : init.arguments[1];
      const alias = evalNode(optsArg)?.alias;
      if (callee === 'input' || callee === 'model') {
        const def = evalNode(init.arguments[0]);
        if (t.type === 'unknown' && isStatic(def) && def !== null) t.type = typeof def;
        inputs[alias || name] = clean({ ...t, default: isStatic(def) ? def : undefined, model: callee === 'model' || undefined });
        if (callee === 'model') outputs[`${alias || name}Change`] = { type: 'event' };
      }
      if (callee === 'input.required' || callee === 'model.required') inputs[alias || name] = clean({ ...t, required: true });
      if (callee === 'output') outputs[alias || name] = { type: 'event' };
    }
  }
  return { selector, inputs, outputs };
}

function readReactProps(fn, typeDecls, src) {
  const inputs = {}, outputs = {};
  const p = fn.params[0];
  let members = null;
  const ann = p?.typeAnnotation?.typeAnnotation;
  if (ann?.type === 'TSTypeReference' && ann.typeName.type === 'Identifier') members = typeDecls.get(ann.typeName.name);
  if (ann?.type === 'TSTypeLiteral') members = ann.members;
  const varAnn = fn.varType?.typeAnnotation; // const X: FC<Props> = …
  const fcArg = varAnn?.typeParameters?.params?.[0] || varAnn?.typeArguments?.params?.[0];
  if (!members && fcArg?.type === 'TSTypeReference') members = typeDecls.get(fcArg.typeName.name);

  const defaults = {};
  if (p?.type === 'ObjectPattern') {
    for (const prop of p.properties) {
      if (prop.type === 'ObjectProperty' && prop.value.type === 'AssignmentPattern') {
        const v = evalNode(prop.value.right);
        if (isStatic(v)) defaults[propKey(prop)] = v;
      }
    }
  }
  for (const mem of members || []) {
    if (mem.type !== 'TSPropertySignature') continue;
    const name = propKey(mem);
    const t = tsTypeToContract(mem.typeAnnotation, src);
    if (t.type === 'function' && /^on[A-Z]/.test(name)) { outputs[name] = { type: 'event' }; continue; }
    inputs[name] = clean({ ...t, default: defaults[name], required: !mem.optional || undefined });
  }
  return { selector: null, inputs, outputs };
}

const isStatic = v => v !== undefined && !(v && typeof v === 'object' && v.__kind);
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
