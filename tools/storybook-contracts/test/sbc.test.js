import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveContract, findStoryFiles } from '../src/derive.js';
import { checkContract } from '../src/rules.js';
import { diffContracts, judgeBump } from '../src/diff.js';
import { loadTokens } from '../src/tokens.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const FIX = path.join(ROOT, 'fixtures');
const CLI = path.join(ROOT, 'bin/sbc.js');
const tokens = loadTokens([path.join(FIX, 'tokens/*.json')]).tokens;

const ngRoot = path.join(FIX, 'angular-button');
const ngStories = path.join(ngRoot, 'src/button/button.stories.ts');
const sbc = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function copyFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbc-'));
  fs.cpSync(ngRoot, path.join(dir, 'sb'), { recursive: true });
  return dir;
}
const edit = (file, from, to) => {
  const s = fs.readFileSync(file, 'utf8');
  assert.ok(s.includes(from), `fixture edit target not found: ${from}`);
  fs.writeFileSync(file, s.replace(from, to));
};

test('story discovery honours .storybook/main stories globs', () => {
  const files = findStoryFiles(ngRoot);
  assert.deepEqual(files.map(f => path.relative(ngRoot, f)), ['src/button/button.stories.ts']);
});

test('derives the Angular API from decorators and signal inputs', () => {
  const { contract } = deriveContract(ngStories, { root: ngRoot, tokens });
  const i = contract.api.inputs;
  assert.equal(contract.framework, 'angular');
  assert.equal(contract.selector, 'ds-button');
  assert.deepEqual(i.variant.values, ['primary', 'secondary', 'ghost']);
  assert.equal(i.variant.default, 'primary');
  assert.deepEqual(i.size.values, ['sm', 'md', 'lg']);   // signal input<'sm'|'md'|'lg'>('md')
  assert.equal(i.size.default, 'md');
  assert.equal(i.disabled.type, 'boolean');              // inferred from `= false`
  assert.equal(i.label.required, true);                  // @Input({ required: true })
  assert.equal(i.label.default, undefined);              // meta.args never become API defaults
  assert.ok(!('internal' in i));                         // private members are not API
  assert.deepEqual(Object.keys(contract.api.outputs), ['pressed']);
});

test('variants, states, accessibility and token bindings', () => {
  const { contract } = deriveContract(ngStories, { root: ngRoot, tokens });
  assert.deepEqual(contract.variants.variant.ghost, ['Ghost']);
  assert.deepEqual(contract.states.hover, ['Hover']);
  assert.deepEqual(contract.states.disabled, ['Disabled']);
  assert.deepEqual(contract.accessibility.behaviorTests, ['KeyboardActivates']);
  assert.equal(contract.accessibility.a11yTest, 'error');
  assert.deepEqual(contract.tokens.bindings['button.background.primary.hover'].chain,
    ['button.background.primary.hover', 'color.action.primary-hover', 'color.brand.600']);
  assert.equal(contract.tokens.bindings['button.background.primary.hover'].value, '#00489a');
});

test('a conforming component passes every rule', () => {
  const { contract, findings } = deriveContract(ngStories, { root: ngRoot, tokens });
  const results = checkContract(contract, { findings, tokens });
  assert.deepEqual(results.filter(r => r.level === 'error'), []);
});

test('a non-conforming component is invalidated, with the reasons', () => {
  const stories = path.join(FIX, 'react-tabs/Tabs.stories.tsx');
  const { contract, findings } = deriveContract(stories, { root: path.join(FIX, 'react-tabs') });
  const rules = new Set(checkContract(contract, { findings }).filter(r => r.level === 'error').map(r => r.rule));
  for (const r of ['api-enum-mismatch', 'api-undocumented', 'version-missing', 'variant-coverage', 'state-coverage', 'a11y-pattern', 'behavior-test']) {
    assert.ok(rules.has(r), `expected ${r}`);
  }
  // Tabs has no `disabled` input, so a disabled story is not demanded.
  assert.ok(!checkContract(contract, { findings }).some(r => r.message.includes('"disabled"')));
});

test('diff classifies changes and judges the version bump', () => {
  const { contract: base } = deriveContract(ngStories, { root: ngRoot, tokens });
  const next = structuredClone(base);
  next.api.inputs.variant.values = ['primary', 'secondary'];           // removed a value → major
  next.api.inputs.tone = { type: 'string', from: 'component' };         // optional add → minor
  const { required, changes } = diffContracts(base, next);
  assert.equal(required, 'major');
  assert.ok(changes.some(c => c.message.includes('dropped value "ghost"')));
  assert.equal(judgeBump('1.2.0', '1.3.0', 'major').ok, false);
  assert.equal(judgeBump('1.2.0', '1.3.0', 'major').rule, 'breaking-change');
  assert.equal(judgeBump('1.2.0', '2.0.0', 'major').ok, true);
  assert.equal(judgeBump('0.3.1', '0.4.0', 'major').ok, true);          // pre-1.0: minor bump carries breaks
  assert.equal(judgeBump('1.2.0', '1.2.0', 'minor').rule, 'version-not-bumped');
  assert.equal(judgeBump('1.2.0', '1.1.0', 'none').rule, 'version-regressed');
});

test('CLI check passes against its own baseline, then blocks a breaking change without a major bump', () => {
  const dir = copyFixture();
  const sb = path.join(dir, 'sb');
  const contracts = path.join(dir, 'contracts');
  const tok = path.join(FIX, 'tokens/*.json');

  let res = sbc('derive', sb, '--out', contracts, '--tokens', tok);
  assert.equal(res.status, 0, res.stderr);
  res = sbc('check', sb, '--contracts', contracts, '--tokens', tok);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  // Remove the ghost variant from the component (and its story) but keep version 1.2.0.
  const comp = path.join(sb, 'src/button/button.component.ts');
  const stories = path.join(sb, 'src/button/button.stories.ts');
  edit(comp, `'primary' | 'secondary' | 'ghost'`, `'primary' | 'secondary'`);
  edit(stories, `options: ['primary', 'secondary', 'ghost']`, `options: ['primary', 'secondary']`);
  edit(stories, `export const Ghost: Story = { args: { variant: 'ghost' } };\n`, '');
  res = sbc('check', sb, '--contracts', contracts, '--tokens', tok, '--json');
  assert.equal(res.status, 1);
  const out = JSON.parse(res.stdout);
  assert.ok(out.results.some(r => r.rule === 'breaking-change' && r.level === 'error'), res.stdout);

  // Bump to 2.0.0: the break is now declared, so check passes (with a stale-contract warning).
  edit(stories, `version: '1.2.0'`, `version: '2.0.0'`);
  res = sbc('check', sb, '--contracts', contracts, '--tokens', tok, '--json');
  assert.equal(res.status, 0, res.stdout);
  assert.ok(JSON.parse(res.stdout).results.some(r => r.rule === 'contract-stale'));
});

test('CLI validate rejects a hand-edited contract that breaks the schema', () => {
  const dir = copyFixture();
  const contracts = path.join(dir, 'contracts');
  sbc('derive', path.join(dir, 'sb'), '--out', contracts);
  const f = path.join(contracts, 'button.contract.json');
  const c = JSON.parse(fs.readFileSync(f, 'utf8'));
  c.version = 'one point two';
  c.api.inputs.variant.type = 'colour';
  fs.writeFileSync(f, JSON.stringify(c));
  const res = sbc('validate', contracts, '--json');
  assert.equal(res.status, 1);
  const schemaErrors = JSON.parse(res.stdout).results.filter(r => r.rule === 'schema');
  assert.ok(schemaErrors.length >= 2, res.stdout);
});
