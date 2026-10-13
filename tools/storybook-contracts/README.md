# sbc — Storybook component contracts

Point it at a Storybook and it derives one **contract** per component: the API surface, variants, states,
accessibility requirements, token bindings and version. It then **invalidates** contracts that don't conform
and **blocks breaking changes** that don't bump the major version.

No LLM and no code execution: stories and components are read with a parser, and only literal values are used.

```bash
pnpm install --ignore-workspace          # standalone package inside sorb-storybook/tools

node bin/sbc.js derive   <storybook-dir> --out contracts --tokens 'tokens/**/*.json'
node bin/sbc.js check    <storybook-dir> --contracts contracts --tokens 'tokens/**/*.json'   # CI gate, exit 1 on errors
node bin/sbc.js validate contracts                                                         # schema + rules, no Storybook needed
node bin/sbc.js schema                                                                     # print the JSON Schema
```

## Where each part of a contract comes from

| Contract field | Source |
|---|---|
| `api.inputs` / `api.outputs` | **The component source.** Angular: `@Input()` / `@Output()` (incl. `{ required: true }`, aliases) and signal APIs `input()`, `input.required()`, `model()`, `output()`. React: the props interface/type in the same file. String-literal unions become `enum` with `values`. `argTypes` are cross-checked against the code; each input records `from: component | argTypes | both` |
| `variants` | For every enum input, which stories show each value (story args merged over `meta.args`, falling back to the component default) |
| `states` | Stories using the pseudo-states addon (`parameters.pseudo: { hover: true }`) and stories where a boolean input is `true` |
| `accessibility` | `parameters.contract.ariaPattern`, `parameters.a11y.test`, and every story with a `play()` (behaviour tests) |
| `tokens` | `parameters.contract.tokens` names a component-token namespace (e.g. `button`); every DTCG token under it is resolved through its alias chain to a final value |
| `version`, `status` | `parameters.contract.version` (semver) and `.status` (`draft` · `stable` · `deprecated`) |
| `design` | `parameters.design` (addon-designs) |

The only things a story file has to add are in `parameters.contract`:

```ts
parameters: {
  contract: {
    version: '1.2.0',
    status: 'stable',
    ariaPattern: 'https://www.w3.org/WAI/ARIA/apg/patterns/button/',
    tokens: 'button',                 // DTCG namespace of this component's tokens
    // id: 'button',                  // optional; defaults to the title's last segment, kebab-cased
    // requirements: ['aria-busy while loading'],
  },
  a11y: { test: 'error' },
  design: { type: 'figma', url: '…' },
}
```

## Rules (an `error` invalidates the contract)

| Rule | Default | Fails when |
|---|---|---|
| `schema` | error | the contract doesn't match `schema/component-contract.schema.json` |
| `version-missing` | error | no `parameters.contract.version` |
| `api-undocumented` | error | `argTypes` documents an input or event the component doesn't have |
| `api-enum-mismatch` | error | `argTypes` options differ from the component's union type |
| `variant-coverage` | error | an enum value has no story |
| `state-coverage` | error | an interactive component lacks a story for each `requiredInteractiveStates` (default `hover`, `focusVisible`, and `disabled` if it has that input) |
| `a11y-pattern` | error | an interactive component names no ARIA pattern |
| `behavior-test` | error | an interactive component has no `play()` story |
| `tokens-missing` / `tokens-unresolved` | error | the namespace has no tokens, or an alias doesn't resolve |
| `breaking-change` | error | `check` finds a major change but the version wasn't bumped to match |
| `version-not-bumped` / `version-regressed` | error | changes with no bump, or a version that went backwards |
| `boolean-coverage`, `a11y-test-level`, `tokens-raw-value`, `tokens-namespace`, `status-unspecified`, `design-link`, `component-source` | warn | see messages |

"Interactive" = the component has outputs/events, or declares an ARIA pattern.
Override any level (`error` · `warn` · `off`) or the required states in `sbc.config.json` (picked up from the working directory, or `--config`):

```json
{ "requiredInteractiveStates": ["hover", "focusVisible", "active", "disabled"], "rules": { "design-link": "off" } }
```

## Versioning (so clients don't break)

`check` diffs each freshly derived contract against the committed one in `--contracts`:

| Change | Level |
|---|---|
| input/output removed · enum value removed · type changed · input became required · default changed · selector changed · component token removed · component removed | **major** |
| optional input/output added · enum value added · input became optional · component token added · ARIA pattern changed · deprecated | minor |
| token value changed · stories added/removed · status change | patch |

The declared version must rise by at least the required level. Before 1.0 the usual semver convention applies:
a breaking change needs a **minor** bump (0.3.x → 0.4.0).

## Workflow

1. `sbc derive` once and review the generated `contracts/*.contract.json` with design and engineering. Commit them.
2. Add `sbc check <storybook> --contracts contracts --tokens …` to CI. It fails on non-conforming components and on undeclared breaking changes.
3. When a change is intentional, bump `parameters.contract.version`, re-run `sbc derive`, and commit the updated contract in the same PR. `check` warns `contract-stale` until you do.

## Limits

- CSF3 object stories only; CSF2 `Template.bind({})` stories are skipped.
- Values must be literals (or `const`s in the same file). Anything computed is recorded as "set, not static" and ignored.
- React props are read from an interface/type in the component's own file; imported prop types aren't followed.
- Components imported from packages (e.g. `@mantine/core`) can't be read; the API then comes from `argTypes` alone.
- MDX docs and Figma aren't read. Pair with Code Connect for the Figma side.

`npm test` runs the suite against `fixtures/` (an Angular button that conforms, a React tabs component that doesn't).
