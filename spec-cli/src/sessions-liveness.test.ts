import test from 'node:test'
import assert from 'node:assert/strict'
import { liveness, launcherCmd, type LiveSnap, type SessRec } from './sessions.js'

// Pins the session-stability contract the mass-restore incident violated:
//  - a PROBE FAILURE (tmux timed out under load) → `unknown`, NEVER a false `offline` (board honesty, tooth 1, [[state]]).
//  - claude online requires a live LISTENER on its rendezvous socket (the `sockets` set), not a stale file (tooth 2, [[state]]).
//  - resume replays the PINNED launcher command, never a since-changed ambient default (tooth 4, [[launcher-select]]).

const rec = (over: Partial<SessRec> = {}): SessRec => ({
  session: 'sess-live-1', governed: true, worktreePath: '/wt/x', branch: 'node/x-1', node: 'x',
  title: null, name: null, parent: null, status: 'active', proposal: null, merges: 0, note: null,
  sortKey: null, createdAt: 1, harness: 'claude', harnessSessionId: null, launcher: null, launchCmd: null,
  ...over,
})
const snap = (over: Partial<LiveSnap> = {}): LiveSnap => ({ probeFailed: false, windows: new Map(), sockets: new Set(), ...over })

test('probe FAILURE reads unknown, never a false offline (board honesty under load)', () => {
  const r = rec()
  // the probe timed out — even with an empty windows/sockets set we must NOT declare the session dead.
  assert.equal(liveness(r, snap({ probeFailed: true })), 'unknown')
  // a genuinely-empty successful probe (tmux up, no windows) IS authoritative → offline (past boot grace).
  assert.equal(liveness(r, snap({ probeFailed: false })), 'offline')
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

test('resume replays the PINNED launcher command, immune to a since-changed default (resume-launcher-pin)', () => {
  // the pinned resolved command wins — a backend now running under a DIFFERENT configured default cannot change
  // which launcher (and config dir) a resume replays. This is the seam reopen/drain read at every (re)launch.
  assert.equal(launcherCmd(rec({ launchCmd: 'reclaude --original-config-dir', launcher: null })), 'reclaude --original-config-dir')
  // an old record with neither a pin nor a name has nothing to replay → undefined (best-effort ambient default).
  assert.equal(launcherCmd(rec({ launchCmd: null, launcher: null })), undefined)
})
