// P1 acceptance — bound-token join verified against REAL sorb-demo/.sorb data.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  collectBoundTokens,
  joinResolved,
  indexResolved,
  rootForStory,
  boundRowsForStory,
} from './boundTokens.js'

const DEMO = '/Volumes/SanDisk/workspace/metatoy/sorb-demo'
const SORB = join(DEMO, '.sorb')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const haveDemo = existsSync(join(SORB, 'index.json'))

const index = haveDemo ? readJson(join(SORB, 'index.json')) : null
const resolved = haveDemo ? readJson(join(SORB, 'resolved.json')) : []
const loadArtifact = (entry) => readJson(join(DEMO, entry.artifact))

const STORY = 'components-button--primary'

test('collectBoundTokens walks the tree and harvests every node.sorb.tokens', () => {
  const root = {
    type: 'FRAME',
    sorb: { tokens: { fill: 'a.bg', stroke: 'a.border', cornerRadius: 'a.radius' } },
    children: [
      { type: 'TEXT', sorb: { tokens: { fill: 'a.text' } } },
      { type: 'FRAME', children: [{ type: 'TEXT', sorb: { tokens: { fill: 'deep.text' } } }] },
    ],
  }
  const bound = collectBoundTokens(root)
  const ids = bound.map((b) => b.tokenId)
  assert.deepEqual(ids, ['a.bg', 'a.border', 'a.radius', 'a.text', 'deep.text'])
  assert.deepEqual(bound[0], { role: 'fill', tokenId: 'a.bg' })
})

test('collectBoundTokens captures candidates when present', () => {
  const root = {
    type: 'FRAME',
    sorb: { tokens: { fill: 'x' }, candidates: { fill: ['x', 'y', 'z'] } },
  }
  const [b] = collectBoundTokens(root)
  assert.deepEqual(b.candidates, ['x', 'y', 'z'])
})

test('collectBoundTokens is tolerant of empty / malformed nodes', () => {
  assert.deepEqual(collectBoundTokens(null), [])
  assert.deepEqual(collectBoundTokens({}), [])
  assert.deepEqual(collectBoundTokens({ sorb: {} }), [])
  assert.deepEqual(collectBoundTokens({ sorb: { tokens: { fill: '' } } }), [])
})

test('joinResolved emits resolved:false for an unknown tokenId', () => {
  const rows = joinResolved([{ role: 'fill', tokenId: 'nope.token' }], [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].resolved, false)
  assert.equal(rows[0].cssVar, null)
  assert.equal(rows[0].value, null)
})

test('rootForStory matches by id and falls back to a sole story', () => {
  const art = { stories: [{ id: 's1', root: { type: 'A' } }] }
  assert.equal(rootForStory(art, 's1').type, 'A')
  // unknown id, single story → fallback
  assert.equal(rootForStory(art, 'other').type, 'A')
  // unknown id, multiple stories → null
  const multi = { stories: [{ id: 's1', root: {} }, { id: 's2', root: {} }] }
  assert.equal(rootForStory(multi, 'zzz'), null)
})

test('[real data] Button/Primary bound rows include the 4 expected bindings', { skip: !haveDemo }, () => {
  const rows = boundRowsForStory(STORY, index, loadArtifact, resolved)
  const byId = new Map(rows.map((r) => [r.tokenId, r]))

  // The four bindings from Button.sorb.json's node.sorb.tokens.
  for (const id of [
    'button.primary.bg.default',
    'button.primary.text.default',
    'button.primary.border.default',
    'button.radius',
  ]) {
    assert.ok(byId.has(id), `expected bound token ${id}`)
    assert.equal(byId.get(id).resolved, true)
    assert.equal(byId.get(id).tier, 'component')
  }

  // bg.default resolves to the real value + a cssVar + role fill.
  const bg = byId.get('button.primary.bg.default')
  assert.equal(String(bg.value).toLowerCase(), '#0f65ef')
  assert.equal(bg.cssVar, '--button-primary-bg-default')
  assert.equal(bg.role, 'fill')
  assert.equal(bg.type, 'color')

  // radius is a dimension.
  const radius = byId.get('button.radius')
  assert.equal(radius.value, '4px')
  assert.equal(radius.type, 'dimension')
  assert.equal(radius.role, 'cornerRadius')
})

test('[real data] uncaptured / unknown storyId → empty rows', { skip: !haveDemo }, () => {
  assert.deepEqual(boundRowsForStory('does-not--exist', index, loadArtifact, resolved), [])
  assert.deepEqual(boundRowsForStory('', index, loadArtifact, resolved), [])
})

test('indexResolved keys by token id', () => {
  const m = indexResolved([{ id: 'a' }, { id: 'b' }, { notId: 1 }])
  assert.equal(m.size, 2)
  assert.ok(m.has('a') && m.has('b'))
})
