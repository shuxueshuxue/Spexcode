import test from 'node:test'
import assert from 'node:assert/strict'
import { displayStatusForProposal, liveness, launcherCmd, type LiveSnap } from './sessions.js'
import type { SessRec } from './session-record.js'

// Pins the session-stability contract the mass-restore incident violated:
//  - a PROBE FAILURE (tmux timed out under load) → `unknown`, NEVER a false `offline` (board honesty, tooth 1, [[state]]).
//  - claude online requires a live LISTENER on its rendezvous socket (the `sockets` set), not a stale file (tooth 2, [[state]]).
//  - resume replays the PINNED launcher command, never a since-changed ambient default (tooth 4, [[launcher-select]]).

const rec = (over: Partial<SessRec> = {}): SessRec => ({
  session: 'sess-live-1', governed: true, worktreePath: '/wt/x', branch: 'node/x-1',
  title: null, name: null, parent: null, status: 'active', proposal: null, merges: 0, note: null,
  sortKey: null, createdAt: 1, harness: 'claude', harnessSessionId: null, runtimeStartToken: null, stopped: false, archived: false, closedAt: null,
  launcher: null, launchCmd: null, launchOwner: null,
  ...over,
})
const snap = (over: Partial<LiveSnap> = {}): LiveSnap => ({ probeFailed: false, windows: new Map(), titles: new Map(), sockets: new Set(), unproven: new Set(), ...over })

test('awaiting proposals use one canonical display projection', () => {
  assert.equal(displayStatusForProposal('merge'), 'review')
  assert.equal(displayStatusForProposal('nothing'), 'done')
  assert.equal(displayStatusForProposal('close'), 'close-pending')
  assert.equal(displayStatusForProposal(null), 'done')
  assert.equal(displayStatusForProposal(undefined), 'done')
})

test('probe FAILURE reads unknown, never a false offline (board honesty under load)', () => {
  const r = rec()
  // the probe timed out — even with an empty windows/sockets set we must NOT declare the session dead.
  assert.equal(liveness(r, snap({ probeFailed: true })), 'unknown')
  // a genuinely-empty successful probe (tmux up, no windows) IS authoritative → offline (past boot grace).
  assert.equal(liveness(r, snap({ probeFailed: false })), 'offline')
})

test('claude-headless liveness follows its exact session home', () => {
  const headless = rec({ harness: 'claude-headless' })
  const withHome = new Map([[headless.session, { pidAlive: true }]])
  assert.equal(liveness(headless, snap({ windows: withHome })), 'online')
  assert.equal(liveness(headless, snap({ windows: new Map([[headless.session, {}]]) })), 'offline',
    'a surviving tmux shell is not the headless controller')
  assert.equal(liveness(headless, snap()), 'offline')
  assert.equal(liveness(headless, snap({ probeFailed: true })), 'unknown')
  assert.equal(liveness({ ...headless, stopped: true }, snap({ windows: withHome, probeFailed: true })), 'offline')
})

test('opencode-headless liveness follows its exact session home', () => {
  const headless = rec({ harness: 'opencode-headless' })
  const withHome = new Map([[headless.session, { pidAlive: true }]])
  assert.equal(liveness(headless, snap({ windows: withHome })), 'online')
  assert.equal(liveness(headless, snap()), 'offline')
  assert.equal(liveness(headless, snap({ probeFailed: true })), 'unknown')
  assert.equal(liveness({ ...headless, stopped: true }, snap({ windows: withHome, probeFailed: true })), 'offline')
})

test('codex-headless liveness requires an exact shared-runtime generation proof', () => {
  const headless = rec({ harness: 'codex-headless' })
  assert.equal(liveness(headless, snap()), 'offline', 'a stale record without a detached-runtime proof is offline')
  assert.equal(liveness(headless, snap({ probeFailed: true })), 'unknown', 'a failed tmux probe remains inconclusive even without runtime proof')
  assert.equal(liveness({ ...headless, stopped: true }, snap({ probeFailed: true })), 'offline')
})

test('pi-headless liveness follows its exact session home until an explicit stop', () => {
  const headless = rec({ harness: 'pi-headless' })
  const withHome = new Map([[headless.session, { pidAlive: true }]])
  assert.equal(liveness(headless, snap({ windows: withHome })), 'online')
  assert.equal(liveness(headless, snap()), 'offline')
  assert.equal(liveness(headless, snap({ probeFailed: true })), 'unknown')
  assert.equal(liveness({ ...headless, stopped: true }, snap({ windows: withHome, probeFailed: true })), 'offline')
})

test('claude online requires a live listener, not just a tmux window (listener-verify)', () => {
  const id = 'sess-live-1'
  const withWindow = new Map([[id, {}]])
  // window up AND a live listener in the sockets set → online
  assert.equal(liveness(rec(), snap({ windows: withWindow, sockets: new Set([id]) })), 'online')
  // window up but NO listener (a stale socket file, or claude died) → offline within seconds
  assert.equal(liveness(rec(), snap({ windows: withWindow, sockets: new Set() })), 'offline')
  // no window at all → offline regardless of a lingering socket
  assert.equal(liveness(rec(), snap({ windows: new Map(), sockets: new Set([id]) })), 'offline')
})

test('an UNPROVEN listener probe reads unknown, never a false offline (issue #40 — wedged/thrashed, not dead)', () => {
  const id = 'sess-live-1'
  const withWindow = new Map([[id, {}]])
  // window up, listener probe could not conclude (timeout under load / EAGAIN off a full backlog) → unknown:
  // the agent may be alive-but-busy, and a supervisor acting on a false offline would kill a live worker.
  assert.equal(liveness(rec(), snap({ windows: withWindow, unproven: new Set([id]) })), 'unknown')
  // but a PROVEN-dead listener (refused/absent — not in either set) still reads offline as before.
  assert.equal(liveness(rec(), snap({ windows: withWindow })), 'offline')
})

test('resume replays the PINNED launcher command, immune to a since-changed default (resume-launcher-pin)', () => {
  // the pinned resolved command wins — a backend now running under a DIFFERENT configured default cannot change
  // which launcher (and config dir) a resume replays. This is the seam resumeSession/drain read at every (re)launch.
  assert.equal(launcherCmd(rec({ launchCmd: 'reclaude --original-config-dir', launcher: null })), 'reclaude --original-config-dir')
  // an old record with neither a pin nor a name has nothing to replay → undefined (best-effort ambient default).
  assert.equal(launcherCmd(rec({ launchCmd: null, launcher: null })), undefined)
})
