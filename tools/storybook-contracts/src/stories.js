// Read one CSF (Component Story Format) file: the default-export meta and every named story.
import fs from 'node:fs';
import path from 'node:path';
import { parseSource, topLevelConsts, evalNode, unwrap, findProp } from './ast.js';

export function readStoriesFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parseSource(src, file);
  const consts = topLevelConsts(ast);
  const imports = new Map(); // local name -> module specifier
  let metaNode = null;
  const storyNodes = [];

  for (const stmt of ast.program.body) {
    if (stmt.type === 'ImportDeclaration') {
      for (const s of stmt.specifiers) imports.set(s.local.name, stmt.source.value);
    }
    if (stmt.type === 'ExportDefaultDeclaration') {
      let d = unwrap(stmt.declaration);
      if (d.type === 'Identifier') d = unwrap(consts.get(d.name)?.init);
      if (d?.type === 'ObjectExpression') metaNode = d;
    }
    if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration?.type === 'VariableDeclaration') {
      for (const d of stmt.declaration.declarations) {
        if (d.id.type === 'Identifier' && d.init) storyNodes.push({ name: d.id.name, node: d.init });
      }
    }
  }
  if (!metaNode) return null; // not a CSF file

  const meta = evalNode(metaNode, consts);
  const componentProp = findProp(metaNode, 'component');
  const componentName = componentProp?.value?.type === 'Identifier' ? componentProp.value.name : null;
  const componentSpec = componentName ? imports.get(componentName) : null;
  const componentFile = componentSpec?.startsWith('.') ? resolveModule(path.dirname(file), componentSpec) : null;

  const excluded = toArray(meta.excludeStories);
  const stories = [];
  for (const { name, node } of storyNodes) {
    if (excluded.includes(name) || /^__/.test(name)) continue;
    const n = unwrap(node);
    if (n.type !== 'ObjectExpression') continue; // CSF2 (Template.bind) stories are not read statically
    const story = evalNode(n, consts);
    stories.push({
      name,
      args: plain(story.args) || {},
      parameters: plain(story.parameters) || {},
      tags: toArray(story.tags),
      hasPlay: Boolean(findProp(n, 'play')),
    });
  }
  return {
    file, componentName, componentFile,
    title: typeof meta.title === 'string' ? meta.title : null,
    tags: toArray(meta.tags),
    argTypes: plain(meta.argTypes) || {},
    args: plain(meta.args) || {},
    parameters: plain(meta.parameters) || {},
    hasMetaPlay: Boolean(findProp(metaNode, 'play')),
    stories,
  };
}

const plain = v => (v && typeof v === 'object' && !v.__kind ? v : undefined);
const toArray = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : []);

function resolveModule(dir, spec) {
  const base = path.resolve(dir, spec);
  for (const c of [base, ...['.ts', '.tsx', '.js', '.jsx', '.mjs'].map(e => base + e), ...['index.ts', 'index.tsx', 'index.js'].map(f => path.join(base, f))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}
