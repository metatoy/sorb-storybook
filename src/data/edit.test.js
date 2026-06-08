// P3 acceptance — gated edit contract: payload + Open-PR handoff shape +
// entitlement guard. No live bridge; the CONTRACT is what's verified. The edit
// surface NEVER writes source or main (asserted by the writesSource invariant).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canEdit,
  buildPreviewPayload,
  buildPreviewRequest,
  buildOpenPrHandoff,
  planEdit,
} from './edit.js'

const EDIT = {
  id: 'button.primary.bg.default',
  cssVar: '--button-primary-bg-default',
  newValue: '#abc123',
}

test('canEdit gates: free / missing = blocked, team / enterprise / explicit = allowed', () => {
  assert.equal(canEdit(null), false)
  assert.equal(canEdit({}), false)
  assert.equal(canEdit({ plan: 'free' }), false)
  assert.equal(canEdit({ plan: 'team' }), true)
  assert.equal(canEdit({ plan: 'enterprise' }), true)
  // explicit editEnabled wins over plan
  assert.equal(canEdit({ plan: 'team', editEnabled: false }), false)
  assert.equal(canEdit({ plan: 'free', editEnabled: true }), true)
})

test('buildPreviewPayload is the flat { cssVar: value } the bridge POST /preview expects', () => {
  assert.deepEqual(buildPreviewPayload(EDIT), { '--button-primary-bg-default': '#abc123' })
})

test('buildPreviewRequest targets POST /preview on the local bridge', () => {
  const req = buildPreviewRequest(EDIT)
  assert.equal(req.method, 'POST')
  assert.equal(req.path, '/preview')
  assert.equal(req.url, 'http://localhost:7777/preview')
  assert.deepEqual(req.body, { '--button-primary-bg-default': '#abc123' })
  // custom base honored
  assert.equal(buildPreviewRequest(EDIT, { base: 'http://host:8888' }).url, 'http://host:8888/preview')
})

test('buildOpenPrHandoff: correctly shaped + never writes source', () => {
  const h = buildOpenPrHandoff(EDIT, 'abc12345')
  assert.equal(h.kind, 'open-pr')
  assert.equal(h.previewId, 'abc12345')
  assert.equal(h.preview, '?preview=abc12345')
  assert.deepEqual(h.changes, [{ id: EDIT.id, cssVar: EDIT.cssVar, value: '#abc123' }])
  assert.equal(h.writesSource, false)
})

test('buildOpenPrHandoff requires a previewId', () => {
  assert.throws(() => buildOpenPrHandoff(EDIT, ''), /previewId/)
})

test('planEdit BLOCKS when not entitled — no request payload leaks', () => {
  const plan = planEdit(EDIT, { plan: 'free' })
  assert.equal(plan.allowed, false)
  assert.equal(plan.code, 'edit_gated')
  assert.ok(plan.reason)
  assert.ok(plan.upgradeUrl)
  assert.equal(plan.previewRequest, undefined)
  assert.equal(plan.handoff, undefined)
})

test('planEdit ALLOWS when entitled — previewRequest + handoff builder, still no source write', () => {
  const plan = planEdit(EDIT, { plan: 'team' })
  assert.equal(plan.allowed, true)
  assert.equal(plan.previewRequest.path, '/preview')
  const h = plan.handoff('xyz98765')
  assert.equal(h.writesSource, false)
  assert.equal(h.previewId, 'xyz98765')
})

test('edit input validation', () => {
  assert.throws(() => buildPreviewPayload({ id: '', cssVar: '--x', newValue: '1' }), /id is required/)
  assert.throws(() => buildPreviewPayload({ id: 'x', cssVar: '', newValue: '1' }), /cssVar is required/)
  assert.throws(() => buildPreviewPayload({ id: 'x', cssVar: '--x' }), /newValue is required/)
})
