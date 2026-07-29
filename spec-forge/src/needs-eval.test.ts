import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isNeedsEval, resolveEvalPending, NEEDS_EVAL } from './needs-eval.js'
import type { ForgeIssue, ForgePR } from './port.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, '__fixtures__/github-forge.json'), 'utf8')) as {
  issues: ForgeIssue[]; prs: ForgePR[]
}
const NODE_IDS = ['sessions', 'dashboard-issues', 'links', 'forge-cache', 'port', 'needs-eval']

test('isNeedsEval: a label or a bare body line flags; a trailing-content line or no mark does not', () => {
  const base: ForgeIssue = { number: 0, title: 't', url: 'u', state: 'open', body: '', labels: [], author: 'a', createdAt: 't', comments: [] }
  assert.equal(isNeedsEval({ ...base, labels: ['bug', NEEDS_EVAL] }), true)    // label
  assert.equal(isNeedsEval({ ...base, labels: ['Needs-Eval'] }), true)          // label, case-insensitive
  assert.equal(isNeedsEval({ ...base, body: 'context\nneeds-eval\n' }), true)   // bare body line
  assert.equal(isNeedsEval({ ...base, body: '  NEEDS-EVAL:  ' }), true)         // indented, optional colon, ci
  assert.equal(isNeedsEval({ ...base, body: 'needs-eval: spec-forge' }), false) // trailing content ⇒ not a flag
  assert.equal(isNeedsEval({ ...base, body: 'Spec: links', labels: ['bug'] }), false) // no mark at all
})

test('resolveEvalPending: flagged OPEN issues invert to node → pending, via marker and transitively', () => {
  const pending = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS)
  assert.deepEqual(pending.map((n) => n.node), ['dashboard-issues', 'port', 'sessions']) // sorted by id
  const byNode = new Map(pending.map((n) => [n.node, n.pending]))
  assert.deepEqual(byNode.get('sessions')!.map((i) => [i.number, i.via]), [[1, 'marker']])
  assert.deepEqual(byNode.get('dashboard-issues')!.map((i) => [i.number, i.via]), [[2, 'marker']])
  assert.deepEqual(byNode.get('port')!.map((i) => [i.number, i.via]), [[6, 'pr']])
})

test('resolveEvalPending: a CLOSED flagged issue is no longer owed an eval', () => {
  const pending = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS)
  assert.equal(pending.find((n) => n.node === 'forge-cache'), undefined)
})

test('resolveEvalPending: an UNFLAGGED marker-linked issue is not pending', () => {
  const pending = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS)
  assert.equal(pending.find((n) => n.node === 'links'), undefined)
})

test('resolveEvalPending: a flag that resolves to NO node links nothing (no invented node)', () => {
  const all = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS).flatMap((n) => n.pending.map((i) => i.number))
  assert.equal(all.includes(5), false)
})

test('resolveEvalPending: no flagged issues → empty', () => {
  const unflagged = fixture.issues.map((i) => ({
    ...i,
    body: i.body.replace(/needs-eval/gi, 'x'),
    labels: i.labels.filter((l) => l.toLowerCase() !== NEEDS_EVAL),
  }))
  assert.deepEqual(resolveEvalPending(unflagged, fixture.prs, NODE_IDS), [])
})
