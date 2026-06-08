// P3 — gated edit mode (contract wiring; NO source/main write, ever).
//
// The explorer is read-only in P1/P2. The paid edit tier reuses the EXACT path
// the Figma plugin Token View already drives: a value edit opens a *preview
// session* via the bridge `POST /preview` (body = a flat `{ [cssVar]: value }`
// token-set map → `{ id, url }`), then hands off to the Open-PR flow. Nothing
// auto-applies; no source file or `main` is ever written from here.
//
// This module constructs those payloads + enforces an entitlement guard. There
// is no live bridge in this repo, so the CONTRACT (payload shape + guard) is
// what's wired and unit-tested. The live transport (fetch to `sorb dev`) is the
// consumer's runtime concern.
//
// @typedef {import('@sorb/core').ResolvedToken} ResolvedToken

/**
 * @typedef {Object} EditRequest
 * @property {string} id        The token id being edited, e.g. `button.primary.bg.default`.
 * @property {string} cssVar    Its CSS custom property, e.g. `--button-primary-bg-default`.
 * @property {string|number} newValue  The proposed value.
 */

/**
 * @typedef {Object} Entitlement
 * @property {boolean} [editEnabled]  Explicit gate; when present it wins.
 * @property {'free'|'team'|'enterprise'} [plan]  Falls back to plan when editEnabled absent.
 */

/**
 * The paid gate for the edit surface. Mirrors the bridge's write-scope stance:
 * Free is read-only; edit (preview/PR) is a paid capability. An explicit
 * `editEnabled` boolean wins; otherwise any non-free plan unlocks it. Fails
 * CLOSED — a missing/empty entitlement is treated as not entitled.
 *
 * @param {Entitlement|null|undefined} ent
 * @returns {boolean}
 */
export function canEdit(ent) {
  if (!ent || typeof ent !== 'object') return false
  if (typeof ent.editEnabled === 'boolean') return ent.editEnabled
  return ent.plan === 'team' || ent.plan === 'enterprise'
}

/**
 * Build the `POST /preview` request body. The bridge expects a flat token-set
 * map keyed by CSS custom property (same shape the plugin POSTs). We send a
 * single-key overlay for the edited token; the running app applies it via
 * `?preview=<id>`.
 *
 * @param {EditRequest} edit
 * @returns {Object.<string, string|number>}
 */
export function buildPreviewPayload(edit) {
  assertEdit(edit)
  return { [edit.cssVar]: edit.newValue }
}

/**
 * Build the full preview request descriptor (method/path/body) for the bridge.
 * Keeping the method + path here means the consumer's transport is a thin
 * `fetch(base + req.path, { method, body })`.
 *
 * @param {EditRequest} edit
 * @param {{ base?: string }} [opts]  Bridge base URL (default the local dev bridge).
 * @returns {{ method: 'POST', path: '/preview', url: string, body: Object.<string, string|number> }}
 */
export function buildPreviewRequest(edit, opts) {
  const base = (opts && opts.base) || 'http://localhost:7777'
  const body = buildPreviewPayload(edit)
  return { method: 'POST', path: '/preview', url: `${base}/preview`, body }
}

/**
 * The Open-PR handoff shape, built from the edit + the preview id the bridge
 * returned. This is the descriptor the consumer relays into the SAME Open-PR
 * flow the plugin Token View uses (`github.js`): a token-set diff, anchored on a
 * preview session, that a human reviews and merges. It NEVER writes source or
 * `main` from here — it's a PR proposal.
 *
 * @param {EditRequest} edit
 * @param {string} previewId  The id returned by `POST /preview`.
 * @returns {{ kind: 'open-pr', previewId: string, preview: string, changes: Array<{ id: string, cssVar: string, value: string|number }>, writesSource: false }}
 */
export function buildOpenPrHandoff(edit, previewId) {
  assertEdit(edit)
  if (typeof previewId !== 'string' || previewId === '') {
    throw new Error('buildOpenPrHandoff: previewId (from POST /preview) is required')
  }
  return {
    kind: 'open-pr',
    previewId,
    preview: `?preview=${previewId}`,
    changes: [{ id: edit.id, cssVar: edit.cssVar, value: edit.newValue }],
    // Invariant, asserted by tests: the edit surface proposes a PR; it does not
    // write source or main.
    writesSource: false,
  }
}

/**
 * The full gated edit plan: guard → preview request → (caller POSTs) → Open-PR.
 * When not entitled, returns `{ allowed:false }` with an upgrade reason and NO
 * request payload (the surface stays read-only). When entitled, returns the
 * preview request + a `handoff(previewId)` builder for after the POST resolves.
 *
 * @param {EditRequest} edit
 * @param {Entitlement|null|undefined} ent
 * @param {{ base?: string }} [opts]
 * @returns {{ allowed: boolean, reason?: string, code?: string, upgradeUrl?: string, previewRequest?: ReturnType<typeof buildPreviewRequest>, handoff?: (previewId: string) => ReturnType<typeof buildOpenPrHandoff> }}
 */
export function planEdit(edit, ent, opts) {
  if (!canEdit(ent)) {
    return {
      allowed: false,
      code: 'edit_gated',
      reason: 'Editing tokens is a paid feature. Upgrade to open a preview + PR.',
      upgradeUrl: 'https://sorbcloud.com/pricing',
    }
  }
  assertEdit(edit)
  return {
    allowed: true,
    previewRequest: buildPreviewRequest(edit, opts),
    handoff: (previewId) => buildOpenPrHandoff(edit, previewId),
  }
}

/**
 * @param {EditRequest} edit
 * @returns {void}
 */
function assertEdit(edit) {
  if (!edit || typeof edit !== 'object') throw new Error('edit must be an object')
  if (typeof edit.id !== 'string' || edit.id === '') throw new Error('edit.id is required')
  if (typeof edit.cssVar !== 'string' || edit.cssVar === '') throw new Error('edit.cssVar is required')
  if (edit.newValue === undefined || edit.newValue === null || edit.newValue === '') {
    throw new Error('edit.newValue is required')
  }
}
