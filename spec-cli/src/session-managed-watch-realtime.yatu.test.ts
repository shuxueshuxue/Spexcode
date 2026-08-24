import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { migrateJsonSessionRecords } from '@spexcode/session-application'
import { resolveDatabasePath } from '@spexcode/session-selflaunch'
import { runtimeRoot, sessionArtifactPath, sessionRecordPath, sessionStoreDir } from '@spexcode/spec-core'

import { configuredSessionApplication, resetConfiguredSessionApplicationForTest } from './session-application.js'
import { drainSession, markState } from './sessions.js'
import { stampRvSock } from './harness.js'

const parent = 'managed-watch-realtime-parent'
const child = 'managed-watch-realtime-child'

function seedRecord(home: string, id: string, parentId = ''): void {
  const dir = sessionStoreDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(sessionRecordPath(id), `${JSON.stringify({
    session_id: id, governed: true, worktree_path: process.cwd(), branch: 'main', node: 'watch', title: id,
    name: '', parent: parentId, status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(),
    harness: 'opencode', harness_session_id: '', runtime_start_token: '', stopped: false, archived: false,
    closed_at: '', cold_proof: '', adapter_recovery: '', launcher: 'opencode', launch_cmd: 'opencode', launch_owner: '',
  }, null, 2)}\n`)
  assert.ok(readFileSync(sessionRecordPath(id), 'utf8').includes(`"session_id": "${id}"`))
  void home
}

test('canonical managed watch wakes the real parent transport once per state commit', { timeout: 30_000, concurrency: false }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-managed-watch-realtime-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  let server: ReturnType<typeof createServer> | undefined
  try {
    seedRecord(home, parent)
    seedRecord(home, child, parent)
    const recordsRoot = join(runtimeRoot(), 'sessions')
    migrateJsonSessionRecords({ databasePath: resolveDatabasePath(), recordsRoot, locality: () => {} })

    const application = configuredSessionApplication()
    application.bindRuntime(parent, {
      namespace: 'spex-governed', runtimeKind: 'opencode', nativeSessionId: parent, nativeStartToken: 'start-1',
    })
    const socketPath = stampRvSock(parent)
    const received: string[] = []
    server = createServer(socket => {
      let buffer = ''
      socket.on('data', chunk => {
        buffer += chunk.toString()
        for (const line of buffer.split('\n').slice(0, -1)) {
          buffer = buffer.slice(line.length + 1)
          if (!line.trim()) continue
          const message = JSON.parse(line) as { type?: string; text?: string }
          if (message.type === 'reply') received.push(message.text ?? '')
          if (message.type === 'repaint') socket.write('{"type":"repaint-done"}\n')
        }
      })
    })
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(socketPath, resolve) })

    const waitForReceipt = async (count: number): Promise<void> => {
      const deadline = Date.now() + 5_000
      while (received.length < count) {
        if (Date.now() >= deadline) assert.fail(`timed out waiting for parent receipt ${count}; received=${received.length}`)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
    }

    // Migration may leave the relation's initial working snapshot pending; settle that pre-existing debt before
    // measuring the three commits under test, so a late initial delivery cannot be mistaken for a state batch.
    await drainSession(parent)
    await new Promise(resolve => setTimeout(resolve, 20))
    const initialReceipts = received.length
    const declarations = [
      ['awaiting', { proposal: 'merge', note: 'ready for review' }],
      ['error', { note: 'turn failed' }],
      ['asking', { note: 'needs a human answer' }],
    ] as const
    for (const [index, [status, options]] of declarations.entries()) {
      assert.equal(markState(status, { ...options, sessionId: child }), true)
      await waitForReceipt(initialReceipts + index + 1)
    }
    const delivered = received.slice(initialReceipts)
    assert.equal(delivered.length, declarations.length, 'each commit was received separately without another wake source')
    assert.match(delivered[0], /review/)
    assert.match(delivered[1], /error/)
    assert.match(delivered[2], /asking/)
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})

test('canonical lifecycle repairs a stale JSON snapshot without writing a second lifecycle fact', { concurrency: false }, () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-canonical-lifecycle-authority-'))
  const previousHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try {
    seedRecord(home, parent)
    seedRecord(home, child)
    const recordsRoot = join(runtimeRoot(), 'sessions')
    migrateJsonSessionRecords({ databasePath: resolveDatabasePath(), recordsRoot, locality: () => {} })
    const application = configuredSessionApplication()

    // This is the observed production failure: the legacy envelope still says active while the canonical
    // lifecycle says asking. A raw-file short circuit would return here and leave the board asking forever.
    application.transitionSession(child, { status: 'asking', note: 'canonical question' })
    assert.match(readFileSync(sessionRecordPath(child), 'utf8'), /"status": "active"/, 'fixture keeps the stale JSON snapshot')
    const before = application.events.read(child).length
    assert.equal(markState('active', { sessionId: child }), true)
    assert.equal(application.readState(child)?.status, 'active')
    assert.equal(application.readState(child)?.note, null)
    assert.equal(application.events.read(child).length, before + 1, 'the real transition is one canonical event')
    assert.match(readFileSync(sessionRecordPath(child), 'utf8'), /"status": "active"/, 'the envelope was not used as a writer')

    const stableEvents = application.events.read(child).length
    assert.equal(markState('active', { sessionId: child }), true)
    assert.equal(application.events.read(child).length, stableEvents, 'repeated hook events are semantic no-ops')
  } finally {
    resetConfiguredSessionApplicationForTest()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
  }
})
