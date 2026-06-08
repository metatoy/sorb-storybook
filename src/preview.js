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

// On every story render, forward the preset-stamped Sorb data to the manager.
if (channel && typeof channel.on === 'function') {
  // SB emits STORY_RENDERED with the storyId; we re-broadcast that story's
  // precomputed bundle (stamped on parameters.sorb by the preset).
  channel.on('storyRendered', (storyId) => {
    try {
      const win = /** @type {any} */ (globalThis)
      const store = win.__SORB_STORYBOOK__ || {}
      const bundle = store.boundByStory && store.boundByStory[storyId]
      channel.emit(`${ADDON_ID}/data`, { rows: bundle || [] })
      channel.emit(`${ADDON_ID}/explorer`, {
        resolved: store.resolved || [],
        reverseIndex: store.reverseIndex || {},
      })
    } catch (e) {
      // never break a story render over panel plumbing
    }
  })
}

/**
 * Preview annotations export. The preset injects the precomputed bundle onto
 * `globalThis.__SORB_STORYBOOK__`; we also expose a decorator that mirrors the
 * active story's bound rows onto its own parameters for tooling that reads them.
 */
export const parameters = { [PARAM_KEY]: { ready: true } }

export default { parameters }
