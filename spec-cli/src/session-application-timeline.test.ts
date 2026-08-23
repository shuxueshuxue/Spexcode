import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { openProjectSessionApplication } from '@spexcode/session-application'

import { readTimeline } from './session-timeline.js'
import { configuredSessionApplication, resetConfiguredSessionApplicationForTest } from './session-application.js'
import { rvSock, stampRvSock } from './harness.js'
import { sendText } from './sessions.js'
import { sessionRecordPath, sessionStoreDir } from '@spexcode/spec-core'

test('cutover timeline projection reads conversation events from the application database', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cutover-timeline-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: 'conversation' })
  app.enqueueConversationMessage('conversation', {
    kind: 'session.prompt.v1',
    body: Buffer.from('transport bytes'),
    senderSessionId: null,
  }, { text: 'visible prompt', from: null, replyVia: 'note' })

  try {
    const timeline = readTimeline('conversation')
    assert.ok(timeline)
    assert.deepEqual(timeline.events.map(event => event.kind), ['status', 'sent'])
    assert.deepEqual(timeline.events[1], {
      ts: timeline.events[1]?.ts,
      kind: 'sent',
      mid: timeline.events[1]?.kind === 'sent' ? timeline.events[1].mid : '',
      text: 'visible prompt',
      from: null,
      replyVia: 'note',
    })
    assert.equal(existsSync(join(home, 'sessions', 'conversation', 'timeline.ndjson')), false)
  } finally {
    app.close()
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})

test('a migrated legacy Claude session still receives a prompt without a synthetic runtime binding', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cutover-legacy-dispatch-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  const id = 'legacy-claude-session'
  const received: string[] = []
  const server = createServer(socket => socket.on('data', chunk => received.push(String(chunk))))
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), JSON.stringify({
    session_id: id, governed: true, worktree_path: process.cwd(), branch: 'main', node: null,
    title: 'legacy', name: null, parent: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: 1, harness: 'claude', harness_session_id: '', stopped: false, archived: false,
    cold_proof: '', adapter_recovery: '', launcher: null, launch_cmd: null, launch_owner: '',
  }, null, 2) + '\n')
  const app = configuredSessionApplication()
  app.createSession({ sessionId: id, status: 'active' })
  stampRvSock(id)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(rvSock(id), resolve) })
  try {
    const result = await sendText(id, 'legacy delivery marker')
    assert.deepEqual(result, { ok: true })
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.match(received.join(''), /legacy delivery marker/)
    assert.deepEqual(app.protocol.listPending(id), [])
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    app.close()
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})
