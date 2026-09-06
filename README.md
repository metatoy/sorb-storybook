# @sorb/storybook

Sorb Storybook addon — a per-story **Bound Tokens** panel + a **Token Explorer**
tab over *this running build's* resolved + bound token data. Roadmap §8.

Stock Storybook (and Design-Token addons) surface *declared* tokens read from
token files. Sorb shows the **resolved + bound** truth from the build: for each
story it lists the tokens its captured component actually binds
(`role · id · cssVar · resolved value · tier`), plus a reverse "used by" link
from each token to the stories that bind it — zero Figma round-trip.

> Status: **published to npm as `@sorb/storybook@0.1.0`** and wired into the
> `sorb-demo` reference consumer (`addons: ['@sorb/storybook']`).

## What it adds

- **Bound Tokens panel** (per story) — the tokens the selected story's captured
  component binds: a table `role · id · cssVar · value · tier`, a color swatch
  for color tokens, a candidates toggle (alternative token ids that matched the
  same value), and a live-value badge slot.
- **Token Explorer tab** — the full resolved map, filterable by `tier` / `type`
  / free-text `q` (matches id, cssVar, or value), each token linking to the
  stories that bind it (a reverse binding index built over every `*.sorb.json`).
- **Gated edit mode** *(paid, contract-wired)* — a value edit routes through the
  bridge `POST /preview` → Open-PR path (the same flow the Figma plugin Token
  View drives). It **never writes source or `main`**; it proposes a PR. Blocked
  unless entitled.

## Data source (no new capture)

Pure view over what `sorb-seed` already produces:

- `.sorb/resolved.json` — `ResolvedToken[]` `{id, cssVar, value, tier, type}`.
- `.sorb/index.json` — `StoryIndex` mapping `storyId → captured artifact`.
- `*.sorb.json` artifacts — the captured `LayerNode` tree; each node's
  `node.sorb.tokens` (role → bound token id) is the bound set.

Contract shapes import from [`@sorb/core`](https://github.com/metatoy/sorb-core).

## Install (consumer)

```js
// .storybook/main.js
export default {
  stories: ['../stories/**/*.stories.@(js|jsx)'],
  addons: ['@sorb/storybook'],
}
```

The addon reads `.sorb/` from disk at Storybook start, so it works with **no
bridge running**. (A `--bridge` live path that reflects `sorb dev` edits is a
later opt-in.)

## Build & test

```bash
corepack pnpm install
corepack pnpm build   # esbuild → dist/{preset,manager,preview}.js
corepack pnpm test    # node --test (data-join + reverse-index + edit contract)
```

JavaScript only (JSDoc typedefs, **no TypeScript**); built with **esbuild**, not
tsup. `react`, `react-dom`, and all `@storybook/*` are **peer deps** the
consumer provides (kept external). `dist/` is gitignored — source only.

### Viewing it live

`sorb-demo` is the reference consumer: it has the addon wired in
`.storybook/main.js` (`addons: ['@sorb/storybook']`) **and** the full Storybook 8
toolchain installed. To see the panel + tab live:

1. In `sorb-demo`: `pnpm install --ignore-workspace`.
2. Give it bound-token data to show: run `sorb-seed capture` (needs a chromium
   browser — `npx playwright install chromium`, one-time) so the `.sorb/` map +
   `*.sorb.json` artifacts exist.
3. `pnpm storybook` (runs `storybook dev -p 6006`) — the **Sorb** panel appears
   next to Controls; **Token Explorer** appears as a top tab.

Targets Storybook **7 and 8** (the `addons.register` / `addons.add` manager-api
is stable across both).
