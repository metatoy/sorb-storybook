// Preset glue — computeSorbBundle reads real sorb-demo/.sorb and precomputes the
// per-story bound rows + reverse index + resolved map the UI consumes.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { computeSorbBundle, managerEntries, previewAnnotations } from './preset.js'
import { loadSorbData } from './loadSorb.js'

const DEMO = '/Volumes/SanDisk/workspace/metatoy/sorb-demo'
const haveDemo = existsSync(join(DEMO, '.sorb', 'index.json'))
const STORY = 'components-button--primary'

test('managerEntries / previewAnnotations append our bundles', () => {
  const m = managerEntries(['existing'])
  assert.equal(m[0], 'existing')
  assert.ok(m[1].endsWith('manager.js'))
  const p = previewAnnotations([])
  assert.ok(p[0].endsWith('preview.js'))
})

test('loadSorbData resolves index + resolved + artifact loader', { skip: !haveDemo }, () => {
  const data = loadSorbData(DEMO)
  assert.ok(data.index && data.index.stories[STORY])
  assert.ok(data.resolved.length > 0)
  const art = data.loadArtifact(data.index.stories[STORY], STORY)
  assert.ok(art && Array.isArray(art.stories))
})

test('loadSorbData returns empties when .sorb absent', () => {
  const data = loadSorbData('/tmp/definitely-no-sorb-here-xyz')
  assert.equal(data.index, null)
  assert.deepEqual(data.resolved, [])
  assert.equal(data.loadArtifact({ artifact: 'x' }), null)
})

test('[real data] computeSorbBundle precomputes rows + reverse index', { skip: !haveDemo }, () => {
  const bundle = computeSorbBundle(DEMO)
  assert.equal(bundle.hasData, true)
  assert.ok(bundle.resolved.length > 0)
  const rows = bundle.boundByStory[STORY]
  assert.ok(rows && rows.some((r) => r.tokenId === 'button.primary.bg.default'))
  assert.deepEqual(bundle.reverseIndex['button.primary.bg.default'], [STORY])
})
