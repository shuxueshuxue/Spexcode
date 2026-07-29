import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { test } from 'node:test'
import { createConnection } from 'node:net'
import {
  bindCodexGeneration,
  commitCodexGenerationRegistration,
  ensureCodexCurrentGeneration,
  legacyCodexGenerationEndpoint,
  prepareCodexGenerationClose,
  prepareCodexGenerationRegistration,
  readCodexGenerationLedger,
  reclaimDrainingCodexGeneration,
  resolveCodexGenerationForSession,
  type CodexGenerationEndpoint,
} from './codex-runtime-generations.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'
import { processStartToken } from './process-identity.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForSocket(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const connected = await new Promise<boolean>((resolve) => {
      const client = createConnection(path)
      client.once('connect', () => { client.destroy(); resolve(true) })
      client.once('error', () => resolve(false))
    })
    if (connected) return
    await sleep(20)
  }
  throw new Error(`socket did not become live: ${path}`)
}

async function startEndpoint(endpoint: CodexGenerationEndpoint): Promise<void> {
  await spawnDetachedRuntime({
    cwd: dirname(endpoint.pidFile),
    logFile: endpoint.logFile,
    pidFile: endpoint.pidFile,
    receiptFile: endpoint.receiptFile,
    command: process.execPath,
    args: ['-e', 'require("node:net").createServer().listen(process.argv[1])', endpoint.socketPath],
    env: process.env,
  })
  await waitForSocket(endpoint.socketPath)
}

test('detached-v3 switch preserves a populated legacy generation while new traffic binds current', { concurrency: false }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-codex-generation-rotation-'))
  const legacy = legacyCodexGenerationEndpoint(root)
  const governed = Array.from({ length: 13 }, (_, n) => `governed-${n}`)
  const unowned = Array.from({ length: 9 }, (_, n) => `unowned-${n}`)
  try {
    mkdirSync(join(root, 'sessions'), { recursive: true })
    for (const id of governed) {
      const session = join(root, 'sessions', id)
      mkdirSync(session)
      writeFileSync(join(session, 'session.json'), `${JSON.stringify({
        session_id: id, governed: true, harness: 'codex', harness_session_id: `thread-${id}`,
      })}\n`)
    }
    await startEndpoint(legacy)

    let starts = 0
    const current = await ensureCodexCurrentGeneration(root, async (endpoint) => {
      starts++
      await startEndpoint(endpoint)
    })
    const ledger = readCodexGenerationLedger(root)
    assert.equal(starts, 1)
    assert.equal(ledger.current, current.id)
    assert.equal(ledger.generations[legacy.id]?.state, 'draining')
    assert.equal(ledger.generations[current.id]?.state, 'current')
    assert.equal(Object.keys(ledger.bindings).length, governed.length)
    assert.equal(resolveCodexGenerationForSession(root, governed[0]!, `thread-${governed[0]}`)?.id, legacy.id)

    bindCodexGeneration(root, 'new-governed', 'thread-new-governed', current.id)
    assert.equal(resolveCodexGenerationForSession(root, 'new-governed', 'thread-new-governed')?.id, current.id)
    const recoveredRegistration = 'registration-recovered'
    const recoveredThread = 'thread-registration-recovered'
    mkdirSync(join(root, 'sessions', recoveredRegistration))
    writeFileSync(join(root, 'sessions', recoveredRegistration, 'session.json'), `${JSON.stringify({
      session_id: recoveredRegistration, governed: true, harness: 'codex', harness_session_id: recoveredThread,
    })}\n`)
    prepareCodexGenerationRegistration(root, recoveredRegistration, recoveredThread, current.id)
    assert.equal(resolveCodexGenerationForSession(root, recoveredRegistration, recoveredThread)?.id, current.id,
      'a crash after session.json but before the binding commit recovers its exact route')
    commitCodexGenerationRegistration(root, recoveredRegistration, recoveredThread, current.id)
    assert.equal(readCodexGenerationLedger(root).bindings[recoveredRegistration]?.phase, undefined)
    prepareCodexGenerationClose(root, recoveredRegistration, recoveredThread)
    assert.equal(resolveCodexGenerationForSession(root, recoveredRegistration, recoveredThread)?.id, current.id,
      'a close transaction keeps routing the exact thread until its durable record is removed')
    assert.equal((await ensureCodexCurrentGeneration(root, async () => { starts++ })).id, current.id)
    assert.equal(starts, 1, 'restart/retry reads the published current generation instead of spawning another root')

    // Simulate a coordinator crash after the endpoint came up but before it atomically published current.
    // A later process must publish this exact proven endpoint, not wait forever or create a second root.
    const pendingPath = join(root, 'codex-app-server-generations.json')
    const pending = JSON.parse(readFileSync(pendingPath, 'utf8'))
    pending.current = null
    pending.pending = current.id
    pending.generations[current.id].state = 'starting'
    pending.generations[current.id].reservation = { pid: 999_999_999, startToken: 'dead-coordinator' }
    pending.revision++
    writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`)
    const strandedLock = join(root, 'codex-app-server-generations.lock')
    mkdirSync(strandedLock)
    writeFileSync(join(strandedLock, 'owner.json'), '{"pid":999999999,"startToken":"dead-coordinator"}\n')
    assert.equal((await ensureCodexCurrentGeneration(root, async () => { starts++ })).id, current.id)
    assert.equal(starts, 1, 'restart recovers a dead coordinator lock and publishes the one proven pending endpoint')
    assert.equal(readCodexGenerationLedger(root).pending, null)
    mkdirSync(strandedLock)
    await sleep(550)
    assert.equal((await ensureCodexCurrentGeneration(root, async () => { starts++ })).id, current.id)
    assert.equal(starts, 1, 'a crash between mkdir and owner publication is also recoverable')

    const protectedResult = await reclaimDrainingCodexGeneration(root, legacy.id, async () => ({
      healthy: true,
      referenceIds: [...unowned, `thread-${governed[0]}`],
      peerCount: 81,
    }))
    assert.equal(protectedResult.reclaimed, false)
    assert.match(protectedResult.reason, /loaded references|peers|binding/)
    assert.ok(processStartToken(Number(requirePid(legacy.pidFile))), 'protected legacy process stays alive')

    const legacyReceipt = readFileSync(legacy.receiptFile, 'utf8')
    writeFileSync(legacy.receiptFile, 'ambiguous replacement receipt\n')
    const ambiguous = await reclaimDrainingCodexGeneration(root, legacy.id, async () => ({ healthy: true, referenceIds: [], peerCount: 0 }))
    assert.equal(ambiguous.reclaimed, false)
    assert.match(ambiguous.reason, /identity is unproven/)
    assert.ok(processStartToken(Number(requirePid(legacy.pidFile))), 'an ambiguous legacy identity keeps the old root alive')
    assert.ok(processStartToken(Number(requirePid(current.pidFile))), 'an ambiguous legacy identity never harms current traffic')

    writeFileSync(legacy.receiptFile, legacyReceipt)
    prepareCodexGenerationRegistration(root, 'crashed-before-record', 'thread-crashed-before-record', legacy.id)
    assert.equal(resolveCodexGenerationForSession(root, 'crashed-before-record', 'thread-crashed-before-record'), null,
      'a crash before session.json does not manufacture a route from a pending registration')
    bindCodexGeneration(root, 'crashed-after-record-removal', 'thread-crashed-after-record-removal', legacy.id)
    prepareCodexGenerationClose(root, 'crashed-after-record-removal', 'thread-crashed-after-record-removal')
    assert.equal(resolveCodexGenerationForSession(root, 'crashed-after-record-removal', 'thread-crashed-after-record-removal'), null,
      'a close crash after record removal does not retain a routable ghost binding')
    for (const id of governed) bindCodexGeneration(root, id, `thread-${id}`, null)
    const reclaimed = await reclaimDrainingCodexGeneration(root, legacy.id, async () => ({ healthy: true, referenceIds: [], peerCount: 0 }))
    assert.equal(reclaimed.reclaimed, true, 'unrecorded registration and close transactions cannot pin a drained root forever')
  } finally {
    for (const endpoint of Object.values(readCodexGenerationLedger(root).generations).map((generation) => generation.endpoint)) {
      const pid = Number(requirePid(endpoint.pidFile, '0'))
      if (pid > 0 && processStartToken(pid)) {
        try { process.kill(pid, 'SIGTERM') } catch { /* reclaimed or already gone */ }
      }
    }
    rmSync(root, { recursive: true, force: true })
  }
})

function requirePid(path: string, fallback?: string): string {
  try { return readFileSync(path, 'utf8').trim() || (fallback ?? '') }
  catch { return fallback ?? '' }
}
