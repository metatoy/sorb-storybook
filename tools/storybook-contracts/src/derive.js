// Turn a Storybook project into one contract per component.
import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { readStoriesFile } from './stories.js';
import { readComponent } from './component.js';
import { tokensUnder, resolve } from './tokens.js';
import { parseSource, topLevelConsts, evalNode, unwrap, isPlaceholder } from './ast.js';

export const CONTRACT_SCHEMA = 'https://sorbcloud.com/schema/component-contract/0.1.json';
const PSEUDO = ['hover', 'focus', 'focusVisible', 'focusWithin', 'active', 'visited', 'target'];

// Find story files: honour .storybook/main.* `stories` globs when present, else a sane default.
export function findStoryFiles(root, override) {
  const ignore = ['**/node_modules/**', '**/dist/**', '**/storybook-static/**'];
  if (override) return fg.sync(override, { cwd: root, absolute: true, ignore });
  const mainFile = ['ts', 'js', 'mjs', 'cjs'].map(e => path.join(root, '.storybook', `main.${e}`)).find(f => fs.existsSync(f));
  if (mainFile) {
    const ast = parseSource(fs.readFileSync(mainFile, 'utf8'), mainFile);
    const consts = topLevelConsts(ast);
    let cfg;
    for (const s of ast.program.body) {
      if (s.type === 'ExportDefaultDeclaration') cfg = evalNode(s.declaration, consts);
      if (s.type === 'ExpressionStatement' && s.expression.type === 'AssignmentExpression') cfg = evalNode(s.expression.right, consts); // module.exports =
    }
    const entries = Array.isArray(cfg?.stories) ? cfg.stories : [];
    const globs = entries.flatMap(e => {
      if (typeof e === 'string') return [e];
      if (e && typeof e.directory === 'string') return [path.posix.join(e.directory, e.files || '**/*.@(mdx|stories.@(js|jsx|mjs|ts|tsx))')];
      return [];
    }).filter(g => !g.endsWith('.mdx'));
    if (globs.length) {
      const base = path.dirname(mainFile);
      return [...new Set(globs.flatMap(g => fg.sync(g, { cwd: base, absolute: true, ignore })))].filter(f => /\.stories\.[cm]?[jt]sx?$/.test(f)).sort();
    }
  }
  return fg.sync('**/*.stories.@(ts|tsx|js|jsx|mjs)', { cwd: root, absolute: true, ignore }).sort();
}

export function deriveContract(storiesFile, { root = process.cwd(), tokens = null } = {}) {
  const sb = readStoriesFile(storiesFile);
  if (!sb) return null;
  const findings = [];
  const note = (rule, message) => findings.push({ rule, message });

  const P = sb.parameters;
  const C = isObj(P.contract) ? P.contract : {};
  const pick = (k, ...alts) => [C[k], ...alts.map(a => C[a]), P[k], ...alts.map(a => P[a])].find(v => v !== undefined);

  const comp = sb.componentFile ? readComponent(sb.componentFile, sb.componentName) : null;
  if (!sb.componentFile) note('component-source', `could not resolve the component source for ${sb.componentName || '(no meta.component)'}; API comes from argTypes only`);

  // ---- API surface: code is the truth, argTypes are the documentation ----
  const inputs = {}, outputs = {};
  for (const [name, def] of Object.entries(comp?.inputs || {})) inputs[name] = { ...def, from: 'component' };
  for (const [name] of Object.entries(comp?.outputs || {})) outputs[name] = { type: 'event', from: 'component' };

  for (const [name, at] of Object.entries(sb.argTypes)) {
    if (!isObj(at)) continue;
    const isAction = typeof at.action === 'string' || at.action === true || isEventLike(name, at);
    if (isAction) {
      if (outputs[name]) outputs[name].from = 'both';
      else if (comp) note('api-undocumented', `argTypes declares event "${name}" but the component has no such output`), outputs[name] = { type: 'event', from: 'argTypes' };
      else outputs[name] = { type: 'event', from: 'argTypes' };
      continue;
    }
    const options = Array.isArray(at.options) ? at.options.filter(v => typeof v === 'string' || typeof v === 'number') : null;
    const control = typeof at.control === 'string' ? at.control : at.control?.type;
    if (inputs[name]) {
      inputs[name].from = 'both';
      if (options && inputs[name].type === 'enum' && !sameSet(options, inputs[name].values)) {
        note('api-enum-mismatch', `"${name}": argTypes options [${options}] differ from the component's type [${inputs[name].values}]`);
      }
      continue;
    }
    if (comp && !(sb.componentName && name === 'children')) note('api-undocumented', `argTypes documents input "${name}" but the component has no such input`);
    inputs[name] = {
      type: options ? 'enum' : control === 'boolean' ? 'boolean' : control === 'number' || control === 'range' ? 'number' : control === 'text' ? 'string' : 'unknown',
      ...(options ? { values: options } : {}),
      from: 'argTypes',
    };
  }
  // Note: meta.args are story defaults, not component defaults, so they never set api defaults
  // (otherwise editing a story would look like a breaking API change).

  // ---- stories: effective args, pseudo states, behaviour tests ----
  const stories = sb.stories.map(s => {
    const args = staticOnly({ ...sb.args, ...s.args });
    const pseudoParams = isObj(s.parameters.pseudo) ? s.parameters.pseudo : {};
    const pseudo = PSEUDO.filter(p => pseudoParams[p] === true || (Array.isArray(pseudoParams[p]) && pseudoParams[p].length));
    return { name: s.name, args, ...(pseudo.length ? { pseudo } : {}), behaviorTest: s.hasPlay || sb.hasMetaPlay };
  });

  const variants = {};
  for (const [name, def] of Object.entries(inputs)) {
    if (def.type !== 'enum' || !def.values) continue;
    variants[name] = Object.fromEntries(def.values.map(v => [String(v), stories.filter(s => (s.args[name] ?? def.default) === v).map(s => s.name)]));
  }
  const states = {};
  for (const p of PSEUDO) {
    const hits = stories.filter(s => s.pseudo?.includes(p)).map(s => s.name);
    if (hits.length) states[p] = hits;
  }
  for (const [name, def] of Object.entries(inputs)) {
    if (def.type === 'boolean') states[name] = stories.filter(s => (s.args[name] ?? def.default) === true).map(s => s.name);
  }

  // ---- accessibility ----
  const pattern = str(pick('ariaPattern', 'pattern'));
  const a11yParam = isObj(P.a11y) ? P.a11y : {};
  const a11yTest = ['error', 'todo', 'off'].includes(a11yParam.test) ? a11yParam.test : a11yParam.disable === true ? 'off' : 'unspecified';
  const requirements = Array.isArray(pick('a11yRequirements', 'requirements')) ? pick('a11yRequirements', 'requirements').filter(x => typeof x === 'string') : undefined;

  // ---- tokens ----
  const rawNs = pick('tokens');
  const namespace = typeof rawNs === 'string' ? rawNs.replace(/\.\*$/, '') : null;
  const bindings = {};
  if (namespace && tokens) {
    for (const p of tokensUnder(tokens, namespace)) {
      const r = resolve(tokens, p);
      bindings[p] = { chain: r.chain, ...(r.error ? {} : { value: r.value }), type: tokens.get(p)?.type ?? null };
      if (r.error) note('tokens-unresolved', `${p}: ${r.error}`);
    }
  }

  const version = str(pick('version'));
  if (!version) note('version-missing', 'no parameters.contract.version; recorded as 0.0.0');
  const status = ['draft', 'stable', 'deprecated'].includes(pick('status')) ? pick('status') : 'unspecified';
  const design = typeof P.design === 'string' ? P.design : str(P.design?.url) ?? (Array.isArray(P.design) ? str(P.design[0]?.url) : null);

  const id = str(C.id) || kebab((sb.title || '').split('/').pop() || (sb.componentName || 'component').replace(/Component$/, ''));
  const contract = {
    $schema: CONTRACT_SCHEMA,
    contractVersion: '0.1',
    id,
    title: sb.title,
    version: version || '0.0.0',
    status,
    framework: comp?.framework || 'unknown',
    selector: comp?.selector ?? null,
    api: { inputs: sortKeys(inputs), outputs: sortKeys(outputs) },
    variants,
    states: sortKeys(states),
    stories,
    accessibility: {
      interactive: Object.keys(outputs).length > 0 || Boolean(pattern),
      pattern: pattern ?? null,
      a11yTest,
      behaviorTests: stories.filter(s => s.behaviorTest).map(s => s.name),
      ...(requirements ? { requirements } : {}),
    },
    tokens: { namespace, bindings },
    design: design ?? null,
    source: { stories: rel(root, storiesFile), component: sb.componentFile ? rel(root, sb.componentFile) : null },
  };
  return { contract, findings };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v) && !isPlaceholder(v);
const isStatic = v => v !== undefined && !isPlaceholder(v) && !(v && typeof v === 'object' && Object.values(v).some(isPlaceholder));
const staticOnly = o => Object.fromEntries(Object.entries(o).filter(([, v]) => isStatic(v)));
const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null);
const sameSet = (a, b = []) => a.length === b.length && a.every(x => b.includes(x));
const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
const kebab = s => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'component';
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');
const isEventLike = (name, at) => /^on[A-Z]/.test(name) && (at.action !== undefined || at.table?.category === 'events');
