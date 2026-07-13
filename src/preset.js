// Node-side Storybook preset. Runs in the builder process at SB start.
//
// Responsibilities:
//   1. Register the manager + preview entries so SB loads our UI.
//   2. Read `.sorb/` from disk ONCE and inject the resolved map + a per-story
//      bound-rows lookup into the preview via `previewAnnotations`/globals, so
//      the panel can render without a bridge.
//
// Storybook's preset contract: export named hook functions. `managerEntries`
// and `previewAnnotations` are honored by SB 7 and 8. We keep the node read
// pure by delegating to `loadSorb.js` + the pure data layer.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSorbData } from './loadSorb.js'
import { boundRowsForStory } from './data/boundTokens.js'
import { entriesFromIndex, buildReverseIndex } from './data/explorer.js'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Add our manager-side bundle (the Sorb panel + explorer tab).
 * @param {string[]} entry
 * @returns {string[]}
 */
export function managerEntries(entry = []) {
  return [...entry, join(here, 'manager.js')]
}

/**
 * Add our preview-side bundle (in-iframe hooks).
 * @param {string[]} entry
 * @returns {string[]}
 */
export function previewAnnotations(entry = []) {
  return [...entry, join(here, 'preview.js')]
}

/**
 * Inject the loaded `.sorb/` data into the preview as a global the manager can
 * read over the channel. We precompute the bound rows per story + the resolved
 * map + the reverse index here (node) so the browser side stays a thin render.
 *
 * SB calls `previewHead`/`previewBody`/`env`-style hooks; the portable way to
 * pass data is `globals` via `previewAnnotations` config. We expose the data on
 * `process` for the builder and let the preview entry re-broadcast it. To keep
 * the preset self-contained + testable, the heavy lifting is `computeSorbBundle`.
 */
export function env(config = {}) {
  return config
}

/**
 * Inject the precomputed `.sorb/` bundle into the preview iframe as a global the
 * in-iframe preview entry (`preview.js`) reads on every `storyRendered` and
 * re-broadcasts to the manager panel + explorer over the SB channel.
 *
 * This is the portable SB 7/8 way to hand node-read disk data to the browser
 * side: stamp a `<script>` into the iframe <head>. Without it the panel has no
 * data source and renders empty. Runs in the builder (node) process, so
 * `computeSorbBundle` can read `.sorb/` off disk.
 *
 * @param {string} [head]
 * @returns {string}
 */
export function previewHead(head = '') {
  try {
    const bundle = computeSorbBundle()
    // Escape `<` so an embedded `</script>` (or `<!--`) can't break out of the tag.
    const json = JSON.stringify(bundle).replace(/</g, '\\u003c')
    return `${head}\n<script>window.__SORB_STORYBOOK__ = ${json};</script>`
  } catch (e) {
    return head
  }
}

/**
 * Precompute everything the UI needs from `.sorb/`: the resolved map, a
 * `storyId → boundRows` map, and the reverse `tokenId → storyId[]` index.
 * Exposed (and unit-testable) independently of SB's hook plumbing.
 *
 * @param {string} [projectRoot]
 * @returns {{ resolved: import('@sorb/core').ResolvedToken[], boundByStory: Record<string, import('./data/boundTokens.js').BoundRow[]>, reverseIndex: Record<string, string[]>, hasData: boolean }}
 */
export function computeSorbBundle(projectRoot) {
  const { index, resolved, loadArtifact } = loadSorbData(projectRoot)
  /** @type {Record<string, import('./data/boundTokens.js').BoundRow[]>} */
  const boundByStory = {}
  if (index && index.stories) {
    for (const storyId of Object.keys(index.stories)) {
      boundByStory[storyId] = boundRowsForStory(storyId, index, loadArtifact, resolved)
    }
  }
  const entries = entriesFromIndex(index, loadArtifact)
  const reverse = buildReverseIndex(entries)
  /** @type {Record<string, string[]>} */
  const reverseIndex = {}
  for (const [k, v] of reverse) reverseIndex[k] = v
  return {
    resolved,
    boundByStory,
    reverseIndex,
    hasData: !!index || resolved.length > 0,
  }
}
