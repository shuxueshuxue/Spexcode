import { test } from 'node:test'
import assert from 'node:assert/strict'

import { watchSessions, type Session, type WatchOutcome } from './sessions.js'
import { BackendError } from './client.js'

// minimal Session builder — watchSessions keys off id + status (and selectors match on id/node/branch); the
// rest are inert defaults so a row reads realistically without dragging in tmux/git.
function mk(id: string, status: Session['status']): Session {
  return {
    id, node: null, branch: null, label: id, headline: id, raw: { name: null, title: null },
    path: `/wt/${id}`, parent: null, harness: 'claude', launcher: null,
    lifecycle: 'active', proposal: null, merges: 0, status, liveness: 'online', note: null,
    prompt: null, promptPreview: null, created: 0, activity: null, sortKey: null,
  }
}
const ID = 'wwww1111-1111-1111-1111-111111111111'

// a bounded wait: fast interval, so the (floored-to-1s) deadline is never the thing we're measuring.
function waitFor(source: () => Promise<Session[]>): Promise<WatchOutcome> {
  return watchSessions(() => {}, { source, selectors: [ID], intervalMs: 10, until: { timeoutMs: 1000 } })
}

// THE regression: the backend hot-reloads (supervisor reboots the child on a sibling merge) so the first
// probe's fetch fails with a connection error. `spex wait` must RETRY, not exit — a later probe returns an
// actionable status and the wait resolves to THAT status, not to the transient backend-down error.
test('spex wait: a transient connection failure is retried, then the actionable status is returned', async () => {
  let call = 0
  const source = async () => {
    call++
    if (call === 1) throw new BackendError('no backend reachable at http://x — (fetch failed)')  // no HTTP status → unreachable
    return [mk(ID, 'review')]
  }
  const r = await waitFor(source)
  assert.deepEqual(r, { reached: 'review' })
  assert.ok(call >= 2, 'it must have polled again after the connection failure')
})

// a connection error that never recovers must eventually fail — but only after the WHOLE timeout is spent,
// reported as backend-down of kind 'unreachable' (the honest, TRANSPORT-scoped cause — what the CLI surfaces
// as the distinct `backend-unreachable` outcome, issue #40), never a false "no actionable status" timeout.
test('spex wait: a backend that stays unreachable fails as backend-down/unreachable at the deadline, not a false timeout', async () => {
  const source = async (): Promise<Session[]> => { throw new BackendError('no backend reachable at http://x — (fetch failed)') }
  const r = await waitFor(source)
  assert.ok('backendDown' in r, `expected backendDown, got ${JSON.stringify(r)}`)
  assert.equal(r.kind, 'unreachable')
})

// a REACHABLE-but-erroring backend (HTTP non-2xx → BackendError WITH a status) is a real terminal condition:
// a bounded wait fails loud immediately, it does not retry the whole timeout window. Its kind is 'http' —
// still a transport-layer verdict, distinct from every session state.
test('spex wait: an HTTP backend error fails loud immediately, without retrying', async () => {
  let call = 0
  const source = async (): Promise<Session[]> => { call++; throw new BackendError('backend error 500 listing sessions', 500) }
  const r = await waitFor(source)
  assert.ok('backendDown' in r, `expected backendDown, got ${JSON.stringify(r)}`)
  assert.equal(r.kind, 'http')
  assert.equal(call, 1, 'an HTTP error must NOT be retried — it exits on the first probe')
})
