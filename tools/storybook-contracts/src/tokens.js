// Load DTCG token files, flatten them to dotted paths, and resolve alias chains.
import fs from 'node:fs';
import fg from 'fast-glob';

export function loadTokens(globs) {
  const files = fg.sync(globs, { absolute: true });
  const tokens = new Map(); // path -> { value, type, file }
  for (const file of files) {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    flatten(json, [], undefined, file, tokens);
  }
  return { files, tokens };
}

function flatten(node, trail, inheritedType, file, out) {
  if (!node || typeof node !== 'object') return;
  const type = node.$type ?? inheritedType;
  if ('$value' in node) { out.set(trail.join('.'), { value: node.$value, type, file }); return; }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('$')) flatten(v, [...trail, k], type, file, out);
}

const ALIAS = /^\{([^}]+)\}$/;

// Follow `{a.b.c}` references to the final value. Returns { chain, value, error }.
export function resolve(tokens, path, seen = []) {
  const t = tokens.get(path);
  if (!t) return { chain: [...seen, path], error: `missing token "${path}"` };
  if (seen.includes(path)) return { chain: [...seen, path], error: `alias cycle at "${path}"` };
  const m = typeof t.value === 'string' && t.value.match(ALIAS);
  if (m) return resolve(tokens, m[1], [...seen, path]);
  return { chain: [...seen, path], value: t.value };
}

// Every token under a namespace like "button" or "button.background".
export function tokensUnder(tokens, ns) {
  const prefix = ns.replace(/\.\*$/, '');
  return [...tokens.keys()].filter(p => p === prefix || p.startsWith(prefix + '.')).sort();
}

export const isAlias = v => typeof v === 'string' && ALIAS.test(v);
