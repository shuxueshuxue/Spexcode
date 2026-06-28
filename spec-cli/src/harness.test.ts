import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { codexAppServerSock, codexAppServerTurnMessages, codexHarness, codexLaunchCommand } from './harness.js'

test('codex app-server turn messages confirm the loaded thread then start a text turn', () => {
  const msgs = codexAppServerTurnMessages('thr_1', 'hello', '/repo')
  assert.equal(msgs[0].method, 'initialize')
  assert.deepEqual(msgs[1], { method: 'initialized', params: {} })
  assert.deepEqual(msgs[2], { id: 2, method: 'thread/loaded/list', params: {} })
  assert.deepEqual(msgs[3], {
    id: 3,
    method: 'turn/start',
    params: {
      threadId: 'thr_1',
      input: [{ type: 'text', text: 'hello', text_elements: [] }],
      cwd: '/repo',
    },
  })
})

test('codex launch command starts app-server and remote TUI on same socket', () => {
  const cmd = codexLaunchCommand('sess-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  assert.match(cmd, /flock 9/)
  assert.match(cmd, /codex app-server --listen unix:\/\/"\$sock"/)
  assert.match(cmd, /exec codex --yolo --remote unix:\/\/"\$sock" "\$@"/)
  assert.match(cmd, /codex-app-server\.sock/)
  assert.match(cmd, /codex-app-server\.lock/)
  assert.match(cmd, /\/tmp\/spex-project/)
})

test('codex liveness requires the captured native thread id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-live-'))
  writeFileSync(codexAppServerSock(dir), '')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: null }, true, dir), 'offline')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: 'codex-thread-1' }, true, dir), 'online')
})
