import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isNeedsYatsuEval, resolveEvalPending, NEEDS_YATSU_EVAL } from './needs-yatsu-eval.js'
import type { ForgeIssue, ForgePR } from './port.js'

// the fixture is the github driver's OUTPUT for a sample repo (vendor-neutral ForgeIssue[]/ForgePR[] — what
// `gh issue/pr list` collapses to), so the resolver is exercised on real-shaped forge data with no network.
const here = fileURLToPath(new URL('.', import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, '__fixtures__/github-forge.json'), 'utf8')) as {
  issues: ForgeIssue[]; prs: ForgePR[]
}
const NODE_IDS = ['sessions', 'dashboard-issues', 'links', 'freshness', 'port', 'needs-yatsu-eval']

// ---- predicate ----

test('isNeedsYatsuEval: a label or a bare body line flags; a trailing-content line or no mark does not', () => {
  const base: ForgeIssue = { number: 0, title: 't', url: 'u', state: 'open', body: '', labels: [], author: 'a', createdAt: 't', comments: [] }
  assert.equal(isNeedsYatsuEval({ ...base, labels: ['bug', NEEDS_YATSU_EVAL] }), true)    // label
  assert.equal(isNeedsYatsuEval({ ...base, labels: ['Needs-Yatsu-Eval'] }), true)          // label, case-insensitive
  assert.equal(isNeedsYatsuEval({ ...base, body: 'context\nneeds-yatsu-eval\n' }), true)   // bare body line
  assert.equal(isNeedsYatsuEval({ ...base, body: '  NEEDS-YATSU-EVAL:  ' }), true)         // indented, optional colon, ci
  assert.equal(isNeedsYatsuEval({ ...base, body: 'needs-yatsu-eval: spec-forge' }), false) // trailing content ⇒ not a flag
  assert.equal(isNeedsYatsuEval({ ...base, body: 'Spec: links', labels: ['bug'] }), false) // no mark at all
})

// ---- resolver against the github driver fixture ----

test('resolveEvalPending: flagged OPEN issues invert to node → pending, via marker and transitively', () => {
  const pending = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS)
  assert.deepEqual(pending.map((n) => n.node), ['dashboard-issues', 'port', 'sessions']) // sorted by id
  const byNode = new Map(pending.map((n) => [n.node, n.pending]))
  // #1: a `Spec: sessions` marker + a bare needs-yatsu-eval body line → pending on sessions, via marker.
  assert.deepEqual(byNode.get('sessions')!.map((i) => [i.number, i.via]), [[1, 'marker']])
  // #2: a needs-yatsu-eval LABEL + `Spec: dashboard-issues` → via marker.
  assert.deepEqual(byNode.get('dashboard-issues')!.map((i) => [i.number, i.via]), [[2, 'marker']])
  // #6: no marker, flagged by label; the node is inherited from the open node/port PR that closes it → via pr.
  assert.deepEqual(byNode.get('port')!.map((i) => [i.number, i.via]), [[6, 'pr']])
})

test('resolveEvalPending: a CLOSED flagged issue is no longer owed an eval', () => {
  // #4 is flagged (Needs-Yatsu-Eval) and markers freshness, but it is closed → its A→B step already bracketed.
  const pending = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS)
  assert.equal(pending.find((n) => n.node === 'freshness'), undefined)
})

test('resolveEvalPending: an UNFLAGGED marker-linked issue is not pending', () => {
  // #3 markers `links` but is not flagged → links.ts links it, the eval list must not surface it.
  const pending = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS)
  assert.equal(pending.find((n) => n.node === 'links'), undefined)
})

test('resolveEvalPending: a flag that resolves to NO node links nothing (no invented node)', () => {
  // #5 is flagged but carries no marker and no closing PR → silently dropped, like a typo'd Spec: marker.
  const all = resolveEvalPending(fixture.issues, fixture.prs, NODE_IDS).flatMap((n) => n.pending.map((i) => i.number))
  assert.equal(all.includes(5), false)
})

test('resolveEvalPending: no flagged issues → empty', () => {
  const unflagged = fixture.issues.map((i) => ({
    ...i,
    body: i.body.replace(/needs-yatsu-eval/gi, 'x'),
    labels: i.labels.filter((l) => l.toLowerCase() !== NEEDS_YATSU_EVAL),
  }))
  assert.deepEqual(resolveEvalPending(unflagged, fixture.prs, NODE_IDS), [])
})
