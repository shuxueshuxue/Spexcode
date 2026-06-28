import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { activeTurnIdFromThread, codexAppServerSock, codexHandshakeMessages, codexInjectMessage, codexHarness, codexLaunchCommand } from './harness.js'

test('codex handshake initializes, confirms the loaded thread, then reads it to decide steer-vs-start', () => {
  const msgs = codexHandshakeMessages('thr_1')
  assert.equal(msgs[0].method, 'initialize')
  assert.deepEqual(msgs[1], { method: 'initialized', params: {} })
  assert.deepEqual(msgs[2], { id: 2, method: 'thread/loaded/list', params: {} })
  assert.deepEqual(msgs[3], { id: 3, method: 'thread/read', params: { threadId: 'thr_1', includeTurns: true } })
})

test('codex inject STARTS a fresh turn when the thread is idle (no active turn id)', () => {
  assert.deepEqual(codexInjectMessage('thr_1', 'hello', '/repo', null), {
    id: 4,
    method: 'turn/start',
    params: { threadId: 'thr_1', input: [{ type: 'text', text: 'hello', text_elements: [] }], cwd: '/repo' },
  })
})

test('codex inject STEERS the live turn mid-turn when one is in progress', () => {
  assert.deepEqual(codexInjectMessage('thr_1', 'hello', '/repo', 'turn_9'), {
    id: 4,
    method: 'turn/steer',
    params: { threadId: 'thr_1', input: [{ type: 'text', text: 'hello', text_elements: [] }], expectedTurnId: 'turn_9' },
  })
})

test('codex inject can retry a lost steer as a turn/start with id 5', () => {
  assert.equal(codexInjectMessage('thr_1', 'hi', undefined, null, 5).id, 5)
  assert.equal(codexInjectMessage('thr_1', 'hi', undefined, null, 5).method, 'turn/start')
})

test('activeTurnIdFromThread finds the inProgress turn, else null', () => {
  assert.equal(activeTurnIdFromThread({ thread: { turns: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'inProgress' }] } }), 't2')
  assert.equal(activeTurnIdFromThread({ thread: { turns: [{ id: 't1', status: 'completed' }] } }), null)
  assert.equal(activeTurnIdFromThread({ thread: { turns: [] } }), null)
  assert.equal(activeTurnIdFromThread({}), null)
})

test('codex launch command starts app-server then resumes the backend-owned thread on the same socket', () => {
  const cmd = codexLaunchCommand('sess-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  assert.match(cmd, /flock 9/)
  assert.match(cmd, /codex app-server --listen unix:\/\/"\$sock"/)
  // design C: the BACKEND owns the thread — codex-launch does thread/start { cwd } + first turn, prints the id,
  // and the visible TUI resumes THAT thread on the same project socket.
  assert.match(cmd, /codex-launch "\$sock" "\$PWD" "\$@"/)
  assert.match(cmd, /exec codex --yolo --remote unix:\/\/"\$sock" resume "\$tid"/)
  assert.match(cmd, /codex-app-server\.sock/)
  assert.match(cmd, /codex-app-server\.lock/)
  assert.match(cmd, /\/tmp\/spex-project/)
})

test('codex liveness tracks the per-project app-server socket + tmux, not the thread id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-live-'))
  // no socket yet → offline regardless of the stored thread id
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, true, dir), 'offline')
  writeFileSync(codexAppServerSock(dir), '')
  // socket present + tmux up → online (the thread id is owned by the backend, not the liveness signal)
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: null }, true, dir), 'online')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, true, dir), 'online')
  // tmux down → offline even with the socket present
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, false, dir), 'offline')
})
