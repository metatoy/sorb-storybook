// P1 — Bound Tokens data join (pure, unit-tested vs real sorb-demo data).
//
// The differentiator: stock Design-Token addons list *declared* tokens. This
// walks a story's CAPTURED layer tree and reports the tokens its component
// actually BINDS (`node.sorb.tokens`), joined to the resolved map for the live
// value + tier. No new capture, no new contract shape — a pure view over
// `.sorb/index.json` + `*.sorb.json` + `.sorb/resolved.json`.
//
// @typedef {import('@sorb/core').ResolvedToken} ResolvedToken
// @typedef {import('@sorb/core').LayerNode} LayerNode
// @typedef {import('@sorb/core').StoryIndex} StoryIndex
// @typedef {import('@sorb/core').SorbAnnotation} SorbAnnotation

/**
 * A captured artifact file: `{ stories: [{ id, name, component, root }] }`.
 * @typedef {Object} SorbArtifact
 * @property {Array<{ id: string, name?: string, component?: string, root: LayerNode }>} stories
 */

/**
 * One bound binding harvested from a story's layer tree.
 * @typedef {Object} BoundBinding
 * @property {string} role     The binding role, e.g. `fill` / `stroke` / `cornerRadius`.
 * @property {string} tokenId  The bound token id, e.g. `button.primary.bg.default`.
 * @property {string[]} [candidates]  Alternative token ids that matched the same value.
 */

/**
 * A fully joined panel row (binding ∪ resolved token).
 * @typedef {Object} BoundRow
 * @property {string} tokenId
 * @property {string} role
 * @property {string|null} cssVar
 * @property {string|number|null} value
 * @property {string|null} tier
 * @property {string|null} type
 * @property {string[]} [candidates]
 * @property {boolean} resolved  False when the tokenId isn't in the resolved map (stale binding).
 */

/**
 * Walk a LayerNode tree depth-first, collecting every `node.sorb.tokens`
 * (role → tokenId) plus any `node.sorb.candidates` (role → tokenId[]).
 *
 * Pure. Tolerant of missing `sorb`, missing `tokens`, and missing `children`.
 * Order is stable (depth-first, role-insertion order) so the panel renders
 * deterministically. A role that repeats deeper in the tree wins later but is
 * still emitted once per (node,role) — duplicates across nodes are kept because
 * different nodes legitimately bind the same role.
 *
 * @param {LayerNode|null|undefined} root
 * @returns {BoundBinding[]}
 */
export function collectBoundTokens(root) {
  /** @type {BoundBinding[]} */
  const out = []
  if (!root || typeof root !== 'object') return out

  /** @param {LayerNode} node */
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    const ann = node.sorb
    if (ann && ann.tokens && typeof ann.tokens === 'object') {
      const candidates = ann.candidates && typeof ann.candidates === 'object' ? ann.candidates : null
      for (const role of Object.keys(ann.tokens)) {
        const tokenId = ann.tokens[role]
        if (typeof tokenId !== 'string' || tokenId === '') continue
        /** @type {BoundBinding} */
        const binding = { role, tokenId }
        const cands = candidates ? candidates[role] : null
        if (Array.isArray(cands) && cands.length) binding.candidates = cands.slice()
        out.push(binding)
      }
    }
    const kids = node.children
    if (Array.isArray(kids)) {
      for (const k of kids) visit(k)
    }
  }

  visit(root)
  return out
}

/**
 * Join harvested bindings against the resolved map. A binding whose tokenId
 * isn't in the resolved map is still emitted (`resolved:false`, null fields) so
 * a stale/renamed binding surfaces in the panel rather than vanishing.
 *
 * @param {BoundBinding[]} bound
 * @param {ResolvedToken[]} resolved
 * @returns {BoundRow[]}
 */
export function joinResolved(bound, resolved) {
  const byId = indexResolved(resolved)
  return (bound || []).map((b) => {
    const r = byId.get(b.tokenId) || null
    /** @type {BoundRow} */
    const row = {
      tokenId: b.tokenId,
      role: b.role,
      cssVar: r ? r.cssVar : null,
      value: r ? r.value : null,
      tier: r ? r.tier : null,
      type: r ? r.type : null,
      resolved: !!r,
    }
    if (b.candidates && b.candidates.length) row.candidates = b.candidates.slice()
    return row
  })
}

/**
 * Build a `tokenId → ResolvedToken` lookup from the resolved map.
 * @param {ResolvedToken[]} resolved
 * @returns {Map<string, ResolvedToken>}
 */
export function indexResolved(resolved) {
  const m = new Map()
  for (const t of resolved || []) {
    if (t && typeof t.id === 'string') m.set(t.id, t)
  }
  return m
}

/**
 * Extract the captured story's root LayerNode from a loaded artifact, matching
 * by storyId when the artifact bundles multiple stories. Falls back to the sole
 * story when the id isn't found but exactly one story is present (single-story
 * artifacts, the common case).
 *
 * @param {SorbArtifact|null|undefined} artifact
 * @param {string} storyId
 * @returns {LayerNode|null}
 */
export function rootForStory(artifact, storyId) {
  if (!artifact || !Array.isArray(artifact.stories)) return null
  const stories = artifact.stories
  const match = stories.find((s) => s && s.id === storyId)
  if (match && match.root) return match.root
  if (stories.length === 1 && stories[0] && stories[0].root) return stories[0].root
  return null
}

/**
 * The panel's rows for a given storyId. Resolves the story → artifact path via
 * the index, loads the artifact (via the injected `loadArtifact` so the data
 * layer stays IO-free and testable), harvests bindings, joins resolved.
 *
 * Returns an EMPTY array for an unknown storyId or an uncaptured story (no
 * artifact / no bindings) — the panel renders an empty-state, never throws.
 *
 * @param {string} storyId
 * @param {StoryIndex} index                The parsed `.sorb/index.json`.
 * @param {(entry: { artifact?: string, importPath?: string }, storyId: string) => SorbArtifact|null} loadArtifact
 *        Injected loader: given the index entry, returns the parsed artifact (or null).
 * @param {ResolvedToken[]} resolved         The parsed `.sorb/resolved.json`.
 * @returns {BoundRow[]}
 */
export function boundRowsForStory(storyId, index, loadArtifact, resolved) {
  if (!storyId || !index || !index.stories) return []
  const entry = index.stories[storyId]
  if (!entry) return []
  let artifact = null
  try {
    artifact = loadArtifact(entry, storyId)
  } catch (e) {
    return []
  }
  const root = rootForStory(artifact, storyId)
  if (!root) return []
  const bound = collectBoundTokens(root)
  return joinResolved(bound, resolved)
}
