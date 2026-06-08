// Node-side reader for the on-disk `.sorb/` data (preset path). Pure-ish: takes
// a directory + an injectable fs/readers so it stays testable; defaults to
// node:fs. Reads `index.json`, `resolved.json`, and each `*.sorb.json` artifact.
//
// The default read path (no bridge) matches the spec's stance: read `.sorb/`
// from disk at SB start so the explorer works with no `sorb dev` running.

import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute, dirname } from 'node:path'

/**
 * @typedef {Object} SorbData
 * @property {import('@sorb/core').StoryIndex|null} index
 * @property {import('@sorb/core').ResolvedToken[]} resolved
 * @property {(entry: { artifact?: string, importPath?: string }, storyId: string) => (import('./data/boundTokens.js').SorbArtifact|null)} loadArtifact
 * @property {string} sorbDir
 */

/**
 * Load the `.sorb/` data for a project.
 *
 * @param {string} [projectRoot]  Defaults to cwd. `.sorb/` is resolved under it.
 * @param {{ readJson?: (p: string) => any, exists?: (p: string) => boolean }} [io]
 * @returns {SorbData}
 */
export function loadSorbData(projectRoot, io) {
  const root = projectRoot || process.cwd()
  const sorbDir = join(root, '.sorb')
  const exists = (io && io.exists) || existsSync
  const readJson =
    (io && io.readJson) ||
    ((p) => JSON.parse(readFileSync(p, 'utf8')))

  /** @type {import('@sorb/core').StoryIndex|null} */
  let index = null
  /** @type {import('@sorb/core').ResolvedToken[]} */
  let resolved = []

  const indexPath = join(sorbDir, 'index.json')
  const resolvedPath = join(sorbDir, 'resolved.json')
  if (exists(indexPath)) {
    try {
      index = readJson(indexPath)
    } catch (e) {
      index = null
    }
  }
  if (exists(resolvedPath)) {
    try {
      const r = readJson(resolvedPath)
      resolved = Array.isArray(r) ? r : []
    } catch (e) {
      resolved = []
    }
  }

  /**
   * Resolve an index entry's artifact to an absolute path. Entries carry either
   * `artifact` (repo-relative, e.g. `.sorb/Button.sorb.json`) or `importPath`
   * (relative to `.sorb/`, e.g. `Button.sorb.json`).
   * @param {{ artifact?: string, importPath?: string }} entry
   * @returns {string|null}
   */
  const artifactPath = (entry) => {
    if (!entry) return null
    if (entry.artifact) {
      return isAbsolute(entry.artifact) ? entry.artifact : join(root, entry.artifact)
    }
    if (entry.importPath) {
      return isAbsolute(entry.importPath) ? entry.importPath : join(sorbDir, entry.importPath)
    }
    return null
  }

  const loadArtifact = (entry) => {
    const p = artifactPath(entry)
    if (!p || !exists(p)) return null
    try {
      return readJson(p)
    } catch (e) {
      return null
    }
  }

  return { index, resolved, loadArtifact, sorbDir }
}

export { dirname }
