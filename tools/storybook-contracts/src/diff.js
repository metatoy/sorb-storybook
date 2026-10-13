// Compare a committed (baseline) contract with the freshly derived one and decide the minimum version bump.
import semver from 'semver';

const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

export function diffContracts(base, next) {
  const changes = [];
  const add = (level, message) => changes.push({ level, message });
  const bi = base.api?.inputs || {}, ni = next.api?.inputs || {};
  const bo = base.api?.outputs || {}, no = next.api?.outputs || {};

  for (const [name, b] of Object.entries(bi)) {
    const n = ni[name];
    if (!n) { add('major', `input "${name}" removed`); continue; }
    if (b.type !== n.type && n.type !== 'unknown' && b.type !== 'unknown') add('major', `input "${name}" type ${b.type} → ${n.type}`);
    if (!b.required && n.required) add('major', `input "${name}" became required`);
    if (b.required && !n.required) add('minor', `input "${name}" became optional`);
    if (b.type === 'enum' && n.type === 'enum') {
      for (const v of b.values || []) if (!(n.values || []).includes(v)) add('major', `input "${name}" dropped value "${v}"`);
      for (const v of n.values || []) if (!(b.values || []).includes(v)) add('minor', `input "${name}" added value "${v}"`);
    }
    if (JSON.stringify(b.default) !== JSON.stringify(n.default)) add('major', `input "${name}" default ${fmt(b.default)} → ${fmt(n.default)}`);
  }
  for (const [name, n] of Object.entries(ni)) {
    if (!bi[name]) add(n.required ? 'major' : 'minor', `input "${name}" added${n.required ? ' as required' : ''}`);
  }
  for (const name of Object.keys(bo)) if (!no[name]) add('major', `output "${name}" removed`);
  for (const name of Object.keys(no)) if (!bo[name]) add('minor', `output "${name}" added`);
  if ((base.selector || null) !== (next.selector || null) && base.selector) add('major', `selector ${base.selector} → ${next.selector}`);

  // Token bindings: consumers may override component tokens, so removing one breaks them.
  const bt = base.tokens?.bindings || {}, nt = next.tokens?.bindings || {};
  for (const k of Object.keys(bt)) if (!nt[k]) add('major', `token "${k}" removed`);
  for (const k of Object.keys(nt)) if (!bt[k]) add('minor', `token "${k}" added`);
  for (const k of Object.keys(nt)) {
    if (bt[k] && JSON.stringify(bt[k].value) !== JSON.stringify(nt[k].value)) add('patch', `token "${k}" value ${fmt(bt[k].value)} → ${fmt(nt[k].value)}`);
  }

  if ((base.accessibility?.pattern || null) !== (next.accessibility?.pattern || null)) add('minor', `ARIA pattern ${base.accessibility?.pattern} → ${next.accessibility?.pattern}`);
  if (base.status !== next.status) add(next.status === 'deprecated' ? 'minor' : 'patch', `status ${base.status} → ${next.status}`);

  const bs = new Set((base.stories || []).map(s => s.name)), ns = new Set((next.stories || []).map(s => s.name));
  for (const s of bs) if (!ns.has(s)) add('patch', `story "${s}" removed`);
  for (const s of ns) if (!bs.has(s)) add('patch', `story "${s}" added`);

  const required = changes.reduce((m, c) => (RANK[c.level] > RANK[m] ? c.level : m), 'none');
  return { changes, required };
}

// Did the author bump the version enough? Pre-1.0 follows the common semver convention:
// a breaking change bumps the minor (0.3.x → 0.4.0), anything else bumps the patch.
export function judgeBump(baseVersion, nextVersion, required) {
  const b = semver.coerce(baseVersion)?.version, n = semver.coerce(nextVersion)?.version;
  if (!b || !n) return { ok: false, rule: 'version-missing', message: `unparseable version (${baseVersion} → ${nextVersion})` };
  if (semver.lt(n, b)) return { ok: false, rule: 'version-regressed', message: `version went backwards ${b} → ${n}` };
  const actual = semver.eq(n, b) ? 'none' : bumpLevel(b, n);
  const needed = semver.major(b) === 0 ? ({ major: 'minor', minor: 'patch', patch: 'patch', none: 'none' })[required] : required;
  if (RANK[actual] >= RANK[needed]) return { ok: true, actual, needed };
  const rule = required === 'major' ? 'breaking-change' : 'version-not-bumped';
  return { ok: false, rule, actual, needed, message: `changes need at least a ${needed} bump (${b} → ${suggest(b, needed)}), but the version is ${n}` };
}

function bumpLevel(b, n) {
  if (semver.major(n) > semver.major(b)) return 'major';
  if (semver.minor(n) > semver.minor(b)) return 'minor';
  return 'patch';
}
const suggest = (b, lvl) => (lvl === 'none' ? b : semver.inc(b, lvl));
const fmt = v => (v === undefined ? 'unset' : JSON.stringify(v));
