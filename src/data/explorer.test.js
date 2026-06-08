// P2 acceptance — filter + reverse index, verified against REAL sorb-demo data.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  filterResolved,
  buildReverseIndex,
  usedBy,
  entriesFromIndex,
} from './explorer.js'

const DEMO = '/Volumes/SanDisk/workspace/metatoy/sorb-demo'
const SORB = join(DEMO, '.sorb')
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const haveDemo = existsSync(join(SORB, 'index.json'))
const index = haveDemo ? readJson(join(SORB, 'index.json')) : null
const resolved = haveDemo ? readJson(join(SORB, 'resolved.json')) : []
const loadArtifact = (entry) => readJson(join(DEMO, entry.artifact))

const STORY = 'components-button--primary'

test('filterResolved: tier component returns only component tokens', { skip: !haveDemo }, () => {
  const rows = filterResolved(resolved, { tier: 'component' })
  assert.ok(rows.length > 0)
  assert.ok(rows.every((t) => t.tier === 'component'))
  // primitives excluded
  assert.ok(!rows.some((t) => t.tier === 'primitive'))
})

test('filterResolved: type filter', { skip: !haveDemo }, () => {
  const dims = filterResolved(resolved, { type: 'dimension' })
  assert.ok(dims.length > 0)
  assert.ok(dims.every((t) => t.type === 'dimension'))
})

test('filterResolved: q substring matches id, cssVar, or value (case-insensitive)', () => {
  const data = [
    { id: 'color.blue.500', cssVar: '--color-blue-500', value: '#0f65ef', tier: 'primitive', type: 'color' },
    { id: 'color.red.500', cssVar: '--color-red-500', value: '#ef0f0f', tier: 'primitive', type: 'color' },
  ]
  assert.equal(filterResolved(data, { q: 'blue' }).length, 1)
  assert.equal(filterResolved(data, { q: '--color-red' }).length, 1)
  assert.equal(filterResolved(data, { q: '#0F65EF' }).length, 1) // case-insensitive value
  assert.equal(filterResolved(data, { q: 'color' }).length, 2)
  assert.equal(filterResolved(data, {}).length, 2)
})

test('filterResolved: combined tier + type + q', () => {
  const data = [
    { id: 'button.radius', cssVar: '--button-radius', value: '4px', tier: 'component', type: 'dimension' },
    { id: 'button.primary.bg.default', cssVar: '--button-primary-bg-default', value: '#0f65ef', tier: 'component', type: 'color' },
    { id: 'spacing.sm', cssVar: '--spacing-sm', value: '8px', tier: 'semantic', type: 'dimension' },
  ]
  const r = filterResolved(data, { tier: 'component', type: 'dimension', q: 'radius' })
  assert.equal(r.length, 1)
  assert.equal(r[0].id, 'button.radius')
})

test('buildReverseIndex + usedBy map a token to its binding stories', () => {
  const entries = [
    {
      storyId: 's-a',
      artifact: { stories: [{ id: 's-a', root: { sorb: { tokens: { fill: 'tok.x', stroke: 'tok.y' } } } }] },
    },
    {
      storyId: 's-b',
      artifact: { stories: [{ id: 's-b', root: { sorb: { tokens: { fill: 'tok.x' } } } }] },
    },
  ]
  const ix = buildReverseIndex(entries)
  assert.deepEqual(usedBy('tok.x', ix), ['s-a', 's-b'])
  assert.deepEqual(usedBy('tok.y', ix), ['s-a'])
  assert.deepEqual(usedBy('tok.absent', ix), [])
})

test('[real data] reverse index maps button.primary.bg.default → Button/Primary', { skip: !haveDemo }, () => {
  const entries = entriesFromIndex(index, loadArtifact)
  const ix = buildReverseIndex(entries)
  assert.deepEqual(usedBy('button.primary.bg.default', ix), [STORY])
  assert.deepEqual(usedBy('button.radius', ix), [STORY])
  assert.deepEqual(usedBy('button.primary.text.default', ix), [STORY])
  assert.deepEqual(usedBy('button.primary.border.default', ix), [STORY])
})

test('entriesFromIndex tolerates a null index', () => {
  assert.deepEqual(entriesFromIndex(null, () => null), [])
})
