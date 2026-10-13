// Conformance rules. A contract that breaks an "error" rule is invalid.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import Ajv from 'ajv/dist/2020.js';
import { isAlias } from './tokens.js';

const require = createRequire(import.meta.url);
const schema = require('../schema/component-contract.schema.json');
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);
const PSEUDO_STATES = ['hover', 'focus', 'focusVisible', 'focusWithin', 'active', 'visited', 'target'];

export const DEFAULT_CONFIG = {
  // States an interactive component must show in a story (Storybook pseudo-states addon names, or boolean inputs).
  requiredInteractiveStates: ['hover', 'focusVisible', 'disabled'],
  rules: {
    'schema': 'error',
    'version-missing': 'error',
    'status-unspecified': 'warn',
    'variant-coverage': 'error',
    'state-coverage': 'error',
    'boolean-coverage': 'warn',
    'a11y-pattern': 'error',
    'a11y-test-level': 'warn',
    'behavior-test': 'error',
    'api-undocumented': 'error',
    'api-enum-mismatch': 'error',
    'component-source': 'warn',
    'tokens-namespace': 'warn',
    'tokens-missing': 'error',
    'tokens-unresolved': 'error',
    'tokens-raw-value': 'warn',
    'design-link': 'warn',
    'breaking-change': 'error',
    'version-not-bumped': 'error',
    'version-regressed': 'error',
  },
};

export function loadConfig(file) {
  if (!file || !fs.existsSync(file)) return DEFAULT_CONFIG;
  const user = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { ...DEFAULT_CONFIG, ...user, rules: { ...DEFAULT_CONFIG.rules, ...(user.rules || {}) } };
}

// `findings` = notes raised while deriving (they become rule results too).
export function checkContract(contract, { findings = [], tokens = null, config = DEFAULT_CONFIG } = {}) {
  const out = [];
  const add = (rule, message) => { const level = config.rules[rule] ?? 'error'; if (level !== 'off') out.push({ id: contract.id, rule, level, message }); };

  if (!validateSchema(contract)) for (const e of validateSchema.errors) add('schema', `${e.instancePath || '/'} ${e.message}`);
  for (const f of findings) add(f.rule, f.message);

  if (contract.status === 'unspecified') add('status-unspecified', 'no parameters.contract.status (draft | stable | deprecated)');
  if (!contract.design) add('design-link', 'no design link (parameters.design)');

  // Variants: every enum value needs a story. Inputs that exist only in argTypes (when the component
  // source is known) are already reported as api-undocumented, so they're skipped here.
  const codeKnown = Object.values(contract.api?.inputs || {}).some(d => d.from !== 'argTypes');
  for (const [input, values] of Object.entries(contract.variants || {})) {
    if (codeKnown && contract.api.inputs[input]?.from === 'argTypes') continue;
    for (const [value, stories] of Object.entries(values)) if (!stories.length) add('variant-coverage', `${input}="${value}" has no story`);
  }
  // Booleans: each should be shown true somewhere.
  for (const [name, def] of Object.entries(contract.api?.inputs || {})) {
    if (def.type === 'boolean' && !(contract.states?.[name] || []).length) add('boolean-coverage', `boolean input "${name}" is never shown true`);
  }

  const a = contract.accessibility || {};
  if (a.interactive) {
    for (const s of config.requiredInteractiveStates) {
      // Pseudo states (hover, focusVisible, …) always apply; a boolean state like "disabled" only
      // applies when the component actually has that input.
      if (!PSEUDO_STATES.includes(s) && !contract.api?.inputs?.[s]) continue;
      if (!(contract.states?.[s] || []).length) add('state-coverage', `interactive component has no "${s}" story`);
    }
    if (!a.pattern) add('a11y-pattern', 'interactive component declares no ARIA pattern (parameters.contract.ariaPattern)');
    if (a.a11yTest !== 'error') add('a11y-test-level', `a11y addon level is "${a.a11yTest}"; set parameters.a11y.test = 'error' so violations fail`);
    if (!(a.behaviorTests || []).length) add('behavior-test', 'interactive component has no story with a play() behaviour test');
  }

  const t = contract.tokens || {};
  if (!t.namespace) add('tokens-namespace', 'no component token namespace (parameters.contract.tokens)');
  else if (tokens) {
    const keys = Object.keys(t.bindings || {});
    if (!keys.length) add('tokens-missing', `no tokens under "${t.namespace}" in the token files`);
    for (const k of keys) {
      const raw = tokens.get(k)?.value;
      if (raw !== undefined && !isAlias(raw)) add('tokens-raw-value', `${k} is a raw value; component tokens should alias semantic tokens`);
    }
  }
  return out;
}
