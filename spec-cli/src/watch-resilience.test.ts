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
// probe's fetch fails with a connection error. `spex session wait` must RETRY, not exit — later probes observe a
// working→review edge and the wait resolves to THAT edge (path carried), not to the transient backend-down error.
test('spex session wait: a transient connection failure is retried, then the observed edge is returned', async () => {
  let call = 0
  const source = async () => {
    call++
    if (call === 1) throw new BackendError('no backend reachable at http://x — (fetch failed)')  // no HTTP status → unreachable
    if (call === 2) return [mk(ID, 'working')]
    return [mk(ID, 'review')]
  }
  const r = await waitFor(source)
  assert.deepEqual(r, { reached: 'review', path: ['working', 'review'] })
  assert.ok(call >= 3, 'it must have polled again after the connection failure')
})

// EDGE-TRIGGERED, not level-triggered: an ALREADY-actionable arrival state must not resolve the wait — the
// old instant return on a standing `review` level is exactly what made "wait for the dispatched merge to
// land" impossible. The wait holds through the actionable arrival, sees the status pressed back to working
// (the merge agent's activity), and resolves only on the working→close-pending edge, whole path carried.
test('spex session wait: an already-actionable arrival does not resolve; the next non-actionable→actionable edge does', async () => {
  let call = 0
  const source = async () => {
    call++
    if (call <= 2) return [mk(ID, 'review')]
    if (call <= 4) return [mk(ID, 'working')]
    return [mk(ID, 'close-pending')]
  }
  const r = await waitFor(source)
  assert.deepEqual(r, { reached: 'close-pending', path: ['review', 'working', 'close-pending'] })
})

// an actionable→actionable hop is NOT an edge either — the contract is the rise OUT of non-actionable. A
// target that only ever shows actionable states runs out the clock and reports the honest observed path.
test('spex session wait: actionable→actionable transitions never resolve — timeout carries the observed path', async () => {
  let call = 0
  const source = async () => {
    call++
    return [mk(ID, call <= 2 ? 'review' : 'done')]
  }
  const r = await waitFor(source)
  assert.deepEqual(r, { timedOut: true, path: ['review', 'done'] })
})

// the arrival state is narrated the moment the first successful poll lands (previous === null), and every
// later observation carries the status it moved from — the caller's stderr narration hangs off this hook.
test('spex session wait: onObserved narrates the arrival state first, then each transition', async () => {
  let call = 0
  const source = async () => {
    call++
    return [mk(ID, call === 1 ? 'working' : 'review')]
  }
  const seen: Array<[string, string | null]> = []
  const r = await watchSessions(() => {}, {
    source, selectors: [ID], intervalMs: 10,
    until: { timeoutMs: 1000, onObserved: (st, was) => seen.push([st, was]) },
  })
  assert.deepEqual(r, { reached: 'review', path: ['working', 'review'] })
  assert.deepEqual(seen, [['working', null], ['review', 'working']])
})

// a connection error that never recovers must eventually fail — but only after the WHOLE timeout is spent,
// reported as backend-down of kind 'unreachable' (the honest, TRANSPORT-scoped cause — what the CLI surfaces
// as the distinct `backend-unreachable` outcome, issue #40), never a false "no actionable status" timeout.
test('spex session wait: a backend that stays unreachable fails as backend-down/unreachable at the deadline, not a false timeout', async () => {
  const source = async (): Promise<Session[]> => { throw new BackendError('no backend reachable at http://x — (fetch failed)') }
  const r = await waitFor(source)
  assert.ok('backendDown' in r, `expected backendDown, got ${JSON.stringify(r)}`)
  assert.equal(r.kind, 'unreachable')
})

// a REACHABLE-but-erroring backend (HTTP non-2xx → BackendError WITH a status) is a real terminal condition:
// a bounded wait fails loud immediately, it does not retry the whole timeout window. Its kind is 'http' —
// still a transport-layer verdict, distinct from every session state.
test('spex session wait: an HTTP backend error fails loud immediately, without retrying', async () => {
  let call = 0
  const source = async (): Promise<Session[]> => { call++; throw new BackendError('backend error 500 listing sessions', 500) }
  const r = await waitFor(source)
  assert.ok('backendDown' in r, `expected backendDown, got ${JSON.stringify(r)}`)
  assert.equal(r.kind, 'http')
  assert.equal(call, 1, 'an HTTP error must NOT be retried — it exits on the first probe')
})
