#!/usr/bin/env node
// sbc — Storybook component contracts.
//   sbc derive   <storybook-dir> [--out contracts] [--tokens 'tokens/**/*.json'] [--stories glob] [--config sbc.config.json]
//   sbc check    <storybook-dir> --contracts contracts [--tokens …] [--config …] [--json]
//   sbc validate <contracts-dir> [--tokens …] [--config …] [--json]
//   sbc schema
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findStoryFiles, deriveContract } from '../src/derive.js';
import { checkContract, loadConfig } from '../src/rules.js';
import { diffContracts, judgeBump } from '../src/diff.js';
import { loadTokens } from '../src/tokens.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [, , cmd, target, ...rest] = process.argv;
const opts = parseFlags(rest);

if (!cmd || cmd === '--help' || cmd === '-h') usage(0);
try {
  if (cmd === 'schema') { process.stdout.write(fs.readFileSync(path.join(HERE, '../schema/component-contract.schema.json'), 'utf8')); process.exit(0); }
  if (!target) usage(2);
  const root = path.resolve(target);
  const config = loadConfig(opts.config ? path.resolve(opts.config) : path.join(process.cwd(), 'sbc.config.json'));
  const tokens = opts.tokens ? loadTokens(opts.tokens.split(',')).tokens : null;
  if (opts.tokens && tokens.size === 0) fail(`no tokens matched ${opts.tokens}`);

  if (cmd === 'derive') {
    const outDir = path.resolve(opts.out || 'contracts');
    const derived = deriveAll(root, { tokens, stories: opts.stories });
    fs.mkdirSync(outDir, { recursive: true });
    const results = [];
    for (const { contract, findings } of derived) {
      fs.writeFileSync(path.join(outDir, `${contract.id}.contract.json`), JSON.stringify(contract, null, 2) + '\n');
      results.push(...checkContract(contract, { findings, tokens, config }));
    }
    (opts.json ? console.error : console.log)(`derived ${derived.length} contract(s) → ${path.relative(process.cwd(), outDir) || '.'}`);
    report(results, opts);
    process.exit(0); // derive never fails the build; `check` does
  }

  if (cmd === 'check') {
    if (!opts.contracts) fail('check needs --contracts <dir> (the committed baseline)');
    const baseDir = path.resolve(opts.contracts);
    const derived = deriveAll(root, { tokens, stories: opts.stories });
    const results = [];
    const seen = new Set();
    for (const { contract, findings } of derived) {
      seen.add(contract.id);
      results.push(...checkContract(contract, { findings, tokens, config }));
      const baseFile = path.join(baseDir, `${contract.id}.contract.json`);
      if (!fs.existsSync(baseFile)) { results.push(r(contract.id, 'new-contract', 'warn', 'no committed contract yet; run `sbc derive` and review it')); continue; }
      const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
      const { changes, required } = diffContracts(base, contract);
      for (const c of changes) results.push(r(contract.id, `change-${c.level}`, 'info', c.message));
      const verdict = judgeBump(base.version, contract.version, required);
      if (!verdict.ok) {
        const level = config.rules[verdict.rule] ?? 'error';
        if (level !== 'off') results.push(r(contract.id, verdict.rule, level, verdict.message));
      } else if (required !== 'none' && JSON.stringify(stripVolatile(base)) !== JSON.stringify(stripVolatile(contract))) {
        results.push(r(contract.id, 'contract-stale', 'warn', `committed contract is out of date (${required} change, version ${contract.version} is fine); re-run \`sbc derive\` and commit`));
      }
    }
    for (const f of fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : []) {
      const id = f.replace(/\.contract\.json$/, '');
      if (f.endsWith('.contract.json') && !seen.has(id)) results.push(r(id, 'component-removed', config.rules['breaking-change'] ?? 'error', 'contract exists but the component has no stories any more (removing a component is a breaking change)'));
    }
    const failed = report(results, opts);
    process.exit(failed ? 1 : 0);
  }

  if (cmd === 'validate') {
    const files = fs.readdirSync(root).filter(f => f.endsWith('.contract.json'));
    const results = [];
    for (const f of files) {
      const contract = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
      if (contract.version === '0.0.0') results.push(r(contract.id, 'version-missing', config.rules['version-missing'], 'version is 0.0.0 (never set)'));
      results.push(...checkContract(contract, { tokens, config }));
    }
    (opts.json ? console.error : console.log)(`validated ${files.length} contract(s)`);
    const failed = report(results, opts);
    process.exit(failed ? 1 : 0);
  }
  usage(2);
} catch (e) {
  fail(e.stack || e.message);
}

function deriveAll(root, { tokens, stories }) {
  const files = findStoryFiles(root, stories);
  if (!files.length) fail(`no *.stories.* files found under ${root}`);
  const out = [];
  const ids = new Map();
  for (const f of files) {
    const d = deriveContract(f, { root, tokens });
    if (!d) continue;
    if (ids.has(d.contract.id)) {
      d.findings.push({ rule: 'schema', message: `duplicate contract id "${d.contract.id}" (also from ${ids.get(d.contract.id)}); set parameters.contract.id` });
    }
    ids.set(d.contract.id, d.contract.source.stories);
    out.push(d);
  }
  return out;
}

function report(results, { json }) {
  const errors = results.filter(x => x.level === 'error');
  if (json) { console.log(JSON.stringify({ ok: errors.length === 0, results }, null, 2)); return errors.length > 0; }
  const byId = new Map();
  for (const x of results) (byId.get(x.id) || byId.set(x.id, []).get(x.id)).push(x);
  for (const [id, xs] of [...byId].sort()) {
    console.log(`\n${id}`);
    for (const x of xs.sort((a, b) => order(a.level) - order(b.level))) console.log(`  ${icon(x.level)} ${x.rule}: ${x.message}`);
  }
  const warns = results.filter(x => x.level === 'warn').length;
  console.log(`\n${errors.length ? '✗' : '✓'} ${errors.length} error(s), ${warns} warning(s)`);
  return errors.length > 0;
}

function parseFlags(args) {
  const o = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) o[k] = v;
    else if (args[i + 1] && !args[i + 1].startsWith('--')) o[k] = args[++i];
    else o[k] = true;
  }
  return o;
}

// Function declarations (not consts) so they're hoisted above the top-level command code.
function r(id, rule, level, message) { return { id, rule, level, message }; }
function order(l) { return ({ error: 0, warn: 1, info: 2 })[l] ?? 3; }
function icon(l) { return ({ error: '✗', warn: '!', info: '·' })[l] || '-'; }
function stripVolatile(c) { return { ...c, version: undefined, source: undefined }; }
function fail(msg) { console.error(`sbc: ${msg}`); process.exit(2); }
function usage(code) {
  console.log(`sbc — derive, validate and enforce component contracts from Storybook

  sbc derive   <storybook-dir> [--out contracts] [--tokens <glob,…>] [--stories <glob>] [--config <file>]
               write one <id>.contract.json per component and print conformance findings
  sbc check    <storybook-dir> --contracts <dir> [--tokens <glob,…>] [--config <file>] [--json]
               re-derive, apply the rules, diff against the committed contracts; exit 1 on any error
               (including a breaking API change without a major version bump)
  sbc validate <contracts-dir> [--tokens <glob,…>] [--config <file>] [--json]
               check committed contracts against the schema and rules, without the Storybook
  sbc schema   print the contract JSON Schema`);
  process.exit(code);
}
