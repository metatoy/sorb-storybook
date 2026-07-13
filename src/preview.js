// Preview-side (in-iframe) entry. Runs inside the story iframe alongside the
// app + the SorbProvider that `sorb-demo/.storybook/preview.jsx` already mounts.
//
// Two jobs:
//   1. Broadcast the active story's joined bound rows + the resolved bundle to
//      the manager panel over the SB channel (the preset stamps the data onto
//      story parameters under `parameters.sorb`).
//   2. Provide the live-value badge hook: the manager renders a slot per cssVar;
//      here (where the SorbProvider lives) we can read `useToken(cssVar)` for the
//      value resolved in THIS build. We keep the wiring decoupled so the addon
//      never hard-imports `@sorb/leaf` (peer/optional) — the consumer's provider
//      already populates the CSS vars; we read them off `getComputedStyle`.

import { addons } from '@storybook/preview-api'
import { ADDON_ID, PARAM_KEY } from './constants.js'

const channel = addons.getChannel()

/**
 * Read the live resolved value of a CSS custom property from the document — the
 * value THIS build actually renders (post-SorbProvider). Decoupled from
 * `@sorb/leaf` so the addon carries no hard runtime dep on it.
 * @param {string} cssVar e.g. `--button-primary-bg-default`
 * @returns {string}
 */
export function liveValue(cssVar) {
  if (!cssVar || typeof document === 'undefined') return ''
  try {
    return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
  } catch (e) {
    return ''
  }
}

/**
 * Emit the current story's bound rows + the (story-independent) explorer bundle
 * to the manager over the channel. `__SORB_STORYBOOK__` is stamped into the
 * iframe by the preset's `previewHead`.
 * @param {string} [storyId]
 */
function emitSorbData(storyId) {
  try {
    const win = /** @type {any} */ (globalThis)
    const store = win.__SORB_STORYBOOK__ || {}
    const rows = (storyId && store.boundByStory && store.boundByStory[storyId]) || []
    channel.emit(`${ADDON_ID}/data`, { rows })
    channel.emit(`${ADDON_ID}/explorer`, {
      resolved: store.resolved || [],
      reverseIndex: store.reverseIndex || {},
    })
  } catch (e) {
    // never break a story render over panel plumbing
  }
}

// Forward the preset-stamped Sorb data to the manager. Two triggers:
//   1. `storyRendered` — the panel follows the active story (per-story rows).
//   2. `${ADDON_ID}/request` — a manager-side surface (esp. the Token Explorer
//      TAB, which only mounts when activated and so misses the render-time
//      broadcast) asks for the data on mount. We reply with the last story seen.
let lastStoryId
if (channel && typeof channel.on === 'function') {
  channel.on('storyRendered', (storyId) => {
    lastStoryId = storyId
    emitSorbData(storyId)
  })
  channel.on(`${ADDON_ID}/request`, () => emitSorbData(lastStoryId))
}

/**
 * Preview annotations export. The preset injects the precomputed bundle onto
 * `globalThis.__SORB_STORYBOOK__`; we also expose a decorator that mirrors the
 * active story's bound rows onto its own parameters for tooling that reads them.
 */
export const parameters = { [PARAM_KEY]: { ready: true } }

export default { parameters }
