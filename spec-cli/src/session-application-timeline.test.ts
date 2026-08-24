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
import { markHumanPromptActive, sendText } from './sessions.js'
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

test('human re-entry trusts canonical lifecycle when the legacy envelope is stale', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-human-reentry-canonical-state-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  const id = 'stale-envelope-reentry-session'
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), JSON.stringify({
    session_id: id, governed: true, worktree_path: process.cwd(), branch: 'node/stale-envelope', node: null,
    title: 'stale envelope', name: null, parent: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: 1, harness: 'codex', harness_session_id: 'thread-stale-envelope', stopped: false,
    archived: false, cold_proof: '', adapter_recovery: '', launcher: null, launch_cmd: null, launch_owner: '',
  }, null, 2) + '\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: id, status: 'asking', note: 'waiting for a human prompt' })
  try {
    assert.equal(markHumanPromptActive(id), true)
    assert.equal(app.readState(id)?.status, 'active')
    app.transitionSession(id, { status: 'awaiting', proposal: 'close', note: 'review the finished work' })
    assert.equal(markHumanPromptActive(id), true, 'a human prompt must reopen close-pending work')
    const reopened = app.readState(id)
    assert.equal(reopened?.status, 'active')
    assert.equal(reopened?.proposal, null)
    assert.equal(reopened?.note, null)
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
    assert.deepEqual(result, { ok: true, delivery: 'accepted' })
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

test('an unbound human prompt stays waiting without treating queue acceptance as activity', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-human-prompt-reentry-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  const id = 'asking-reentry-session'
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), JSON.stringify({
    session_id: id, governed: true, worktree_path: process.cwd(), branch: 'node/asking-reentry', node: null,
    title: 'asking', name: null, parent: null, status: 'asking', proposal: null, merges: 0, note: 'needs a reply',
    sortkey: null, createdAt: 1, harness: 'codex', harness_session_id: 'thread-asking-reentry', stopped: false,
    archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
  }, null, 2) + '\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: id, status: 'asking', note: 'needs a reply' })
  try {
    const human = await sendText(id, 'continue with the next step')
    assert.equal(human.ok, true)
    assert.equal(app.readState(id)?.status, 'asking', 'an unbound prompt must not claim the waiting session is working')

    app.transitionSession(id, { status: 'asking', proposal: null, note: 'needs a reply' })
    const agent = await sendText(id, 'handoff context', 'another-session')
    assert.equal(agent.ok, true)
    assert.equal(app.readState(id)?.status, 'asking', 'agent-to-agent delivery must not erase a human wait')
  } finally {
    app.close()
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})

test('a transport miss stays queued and a Command Box retry reuses the same canonical message', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cutover-queued-command-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  const id = 'queued-command-session'
  const deliveryId = 'command-delivery-key-1'
  let rejectTransport = true
  let received = ''
  const server = createServer(socket => {
    if (rejectTransport) {
      socket.destroy()
      return
    }
    socket.on('data', chunk => { received += String(chunk) })
  })
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), JSON.stringify({
    session_id: id, governed: true, worktree_path: process.cwd(), branch: 'main', node: null,
    title: 'queued', name: null, parent: null, status: 'asking', proposal: null, merges: 0, note: 'waiting for input',
    sortkey: null, createdAt: 1, harness: 'claude', harness_session_id: '', stopped: false, archived: false,
    cold_proof: '', adapter_recovery: '', launcher: null, launch_cmd: null, launch_owner: '',
  }, null, 2) + '\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: id, status: 'asking', note: 'waiting for input' })
  stampRvSock(id)
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(rvSock(id), resolve) })
  try {
    const first = await sendText(id, 'queued prompt', undefined, { deliveryKey: deliveryId })
    assert.deepEqual(first, { ok: true, delivery: 'queued', replayed: false })
    assert.equal(app.readState(id)?.status, 'asking', 'a queued prompt must not claim the session is working before handoff')
    assert.equal(app.protocol.listPending(id).length, 1, 'the accepted message remains owed after transport refusal')

    const replay = await sendText(id, 'queued prompt', undefined, { deliveryKey: deliveryId })
    assert.deepEqual(replay, { ok: true, delivery: 'queued', replayed: true })
    assert.equal(app.protocol.readMessages(id).filter(message => message.idempotencyKey === deliveryId).length, 1,
      'retry did not append a duplicate canonical message')

    rejectTransport = false
    const accepted = await sendText(id, 'queued prompt', undefined, { deliveryKey: deliveryId })
    assert.deepEqual(accepted, { ok: true, delivery: 'accepted', replayed: true })
    assert.equal(app.readState(id)?.status, 'active', 'a delivered prompt re-enters the waiting session as working')
    assert.equal(app.protocol.listPending(id).length, 0)
    assert.match(received, /queued prompt/)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    app.close()
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})

test('canonical acceptance stays successful when a runtime binding is not ready yet', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cutover-unbound-command-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const databasePath = join(home, 'sessions.sqlite')
  const id = 'unbound-command-session'
  mkdirSync(home, { recursive: true })
  writeFileSync(`${databasePath}.json-migration.json`, '{"version":1}\n')
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(sessionRecordPath(id), JSON.stringify({
    session_id: id, governed: true, worktree_path: process.cwd(), branch: 'main', node: null,
    title: 'unbound', name: null, parent: null, status: 'active', proposal: null, merges: 0, note: null,
    sortkey: null, createdAt: 1, harness: 'codex', harness_session_id: 'native-thread-not-bound', stopped: false, archived: false,
    cold_proof: '', adapter_recovery: '', launcher: null, launch_cmd: null, launch_owner: '',
  }, null, 2) + '\n')
  const app = openProjectSessionApplication({ databasePath, locality: () => {} })
  app.createSession({ sessionId: id, status: 'active' })
  try {
    const result = await sendText(id, 'queued until runtime binding')
    assert.deepEqual(result, { ok: true, delivery: 'queued' })
    assert.equal(app.protocol.listPending(id).length, 1, 'accepted bytes remain canonical debt until binding/resume')
  } finally {
    app.close()
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})
