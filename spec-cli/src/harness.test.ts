import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { platform, tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { execFileSync } from 'node:child_process'
import { activeTurnIdFromThread, codexAppServerSock, codexAppServerPid, codexAppServerReceipt, codexSharedRuntimeProbe, codexBinary, codexHandshakeMessages, codexInjectMessage, codexLoadedReferenceIds, codexThreadList, codexTurn, codexTurnFailureObserver, CODEX_THREAD_SOURCE_KINDS, codexHarness, claudeHarness, opencodeHarness, piHarness, claudeHeadlessHarness, codexHeadlessHarness, opencodeHeadlessHarness, piHeadlessHarness, codexLaunchCommand, sessionIdentityEnvVars, codexStartThreadParams, paneTreeRunsCodex, codexRolloutExists, writeManagedBlock, removeManagedBlock, launcherList, dashboardLauncherList, resolveLauncher, defaultLauncher, launcherDefault, writeCodexTrust, rendezvousListening, rvSock, legacyRvSock, scopedRvSock, stampRvSock, deliverViaRendezvous } from './harness.js'
import { shQuote } from './sh.js'
import { runtimeRoot } from './layout.js'
import { processStartToken, verifyDetachedRuntime, writeDetachedRuntimeReceipt } from './process-identity.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'

const NO_RPC_RESPONSE = Symbol('NO_RPC_RESPONSE')
const codexRpcFixture = (handler: (message: any, send: (value: unknown) => void) => unknown, lifecycle: {
  initialize?: (message: any, send: (value: unknown) => void) => unknown
  initialized?: (message: any, send: (value: unknown) => void) => unknown
} = {}) => createServer((socket) => {
  let buffer = Buffer.alloc(0)
  let upgraded = false
  const send = (value: unknown) => {
    const payload = Buffer.from(JSON.stringify(value))
    const header = payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
    socket.write(Buffer.concat([header, payload]))
  }
  const handle = (message: any) => {
    if (message.method === 'initialize') {
      if (lifecycle.initialize) return lifecycle.initialize(message, send)
      return send({ id: message.id, result: {} })
    }
    if (message.method === 'initialized') return lifecycle.initialized?.(message, send)
    try {
      const result = handler(message, send)
      if (result === NO_RPC_RESPONSE) return
      if (result instanceof Promise) {
        result.then((value) => send({ id: message.id, result: value ?? {} }))
          .catch((error) => send({ id: message.id, error: { message: error instanceof Error ? error.message : String(error) } }))
      } else send({ id: message.id, result: result ?? {} })
    }
    catch (error) { send({ id: message.id, error: { message: error instanceof Error ? error.message : String(error) } }) }
  }
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    if (!upgraded) {
      const split = buffer.indexOf('\r\n\r\n')
      if (split < 0) return
      socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
      upgraded = true
      buffer = buffer.slice(split + 4)
    }
    while (buffer.length >= 2) {
      const masked = (buffer[1] & 0x80) !== 0
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10 }
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
      const maskOffset = offset
      const dataOffset = offset + (masked ? 4 : 0)
      if (buffer.length < dataOffset + length) return
      let payload = buffer.slice(dataOffset, dataOffset + length)
      if (masked) {
        const mask = buffer.slice(maskOffset, maskOffset + 4)
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      }
      buffer = buffer.slice(dataOffset + length)
      handle(JSON.parse(payload.toString('utf8')))
    }
  })
})

test('Codex turn observer reports only failed native completions with the native timestamp', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-turn-observer-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const root = runtimeRoot()
  const threadId = 'observer-thread'
  const server = codexRpcFixture((message, send) => {
    if (message.method !== 'thread/resume') throw new Error(`unexpected RPC ${message.method}`)
    setTimeout(() => {
      send({ method: 'turn/completed', params: { threadId, turn: { id: 'done', status: 'completed', completedAt: 100 } } })
      send({ method: 'turn/completed', params: { threadId, turn: { id: 'stopped', status: 'interrupted', completedAt: 101 } } })
      send({ method: 'turn/completed', params: { threadId, turn: { id: 'failed', status: 'failed', completedAt: 102, error: { message: 'context window exceeded' } } } })
    }, 10)
    return { thread: { status: { type: 'active' } } }
  })
  const socket = codexAppServerSock(root)
  mkdirSync(dirname(socket), { recursive: true })
  let observer: ReturnType<typeof codexTurnFailureObserver> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    const failures: unknown[] = []
    let resolveFailure!: (value: unknown) => void
    const failure = new Promise<unknown>((resolve) => { resolveFailure = resolve })
    observer = codexTurnFailureObserver({ session: 'observer-session', harnessSessionId: threadId, runtimeDir: root }, (value) => {
      failures.push(value)
      resolveFailure(value)
    })
    assert.deepEqual(await Promise.race([
      failure,
      new Promise((_, reject) => setTimeout(() => reject(new Error('turn failure was not observed')), 1_000)),
    ]), { message: 'context window exceeded', completedAt: 102 })
    assert.equal(failures.length, 1, 'completed and interrupted outcomes are controls, not errors')
  } finally {
    observer?.close()
    await observer?.closed
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex turn observer reconciles a pre-existing systemError after subscription', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-turn-reconcile-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const root = runtimeRoot()
  const threadId = 'system-error-thread'
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/resume') return {
      thread: { status: { type: 'systemError' } },
      initialTurnsPage: { data: [{ id: 'old-turn', status: 'completed', completedAt: 203 }], nextCursor: null },
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const socket = codexAppServerSock(root)
  mkdirSync(dirname(socket), { recursive: true })
  let observer: ReturnType<typeof codexTurnFailureObserver> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    let resolveFailure!: (value: unknown) => void
    const failure = new Promise<unknown>((resolve) => { resolveFailure = resolve })
    observer = codexTurnFailureObserver({ session: 'reconcile-session', harnessSessionId: threadId, runtimeDir: root }, resolveFailure)
    assert.deepEqual(await Promise.race([
      failure,
      new Promise((_, reject) => setTimeout(() => reject(new Error('systemError was not reconciled')), 1_000)),
    ]), {
      message: 'Codex thread entered systemError before the turn observer subscribed',
      completedAt: 203,
    })
  } finally {
    observer?.close()
    await observer?.closed
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex turn observer drops restart reconciliation when a new turn starts', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-turn-reconcile-race-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const root = runtimeRoot()
  const threadId = 'system-error-race-thread'
  const server = codexRpcFixture((message, send) => {
    if (message.method !== 'thread/resume') throw new Error(`unexpected RPC ${message.method}`)
    setTimeout(() => send({ method: 'turn/started', params: { threadId, turn: { id: 'new-turn', status: 'inProgress' } } }), 10)
    return {
      thread: { status: { type: 'systemError' } },
      initialTurnsPage: { data: [{ id: 'old-turn', status: 'completed', completedAt: 303 }], nextCursor: null },
    }
  })
  const socket = codexAppServerSock(root)
  mkdirSync(dirname(socket), { recursive: true })
  let observer: ReturnType<typeof codexTurnFailureObserver> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    const failures: unknown[] = []
    observer = codexTurnFailureObserver({ session: 'reconcile-race-session', harnessSessionId: threadId, runtimeDir: root }, (value) => failures.push(value))
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.deepEqual(failures, [], 'the new native turn supersedes the historical systemError snapshot')
  } finally {
    observer?.close()
    await observer?.closed
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

const startCodexOwner = (root: string) => spawnDetachedRuntime({
  cwd: root,
  logFile: join(root, 'codex-owner.log'),
  pidFile: codexAppServerPid(root),
  receiptFile: codexAppServerReceipt(root),
  command: process.execPath,
  args: ['-e', 'setInterval(() => {}, 1000)'],
})

const stopCodexOwner = async (owner: ReturnType<typeof startCodexOwner> | null) => {
  if (!owner || processStartToken(owner.pid) !== owner.startToken) return
  try { process.kill(owner.pid, 'SIGTERM') } catch {}
  for (let i = 0; i < 50 && processStartToken(owner.pid) === owner.startToken; i++) await new Promise((resolve) => setTimeout(resolve, 20))
}

const writeCodexReadinessRecord = (root: string, sessionId: string, threadId: string) => {
  const dir = join(root, 'sessions', sessionId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify({
    session_id: sessionId,
    governed: true,
    worktree_path: root,
    branch: 'main',
    node: 'codex-headless',
    title: null,
    name: null,
    status: 'idle',
    proposal: null,
    merges: 0,
    note: null,
    sortkey: null,
    createdAt: Date.now(),
    harness: 'codex-headless',
    harness_session_id: threadId,
    stopped: true,
    archived: false,
  }, null, 2)}\n`)
}

test('codex-headless launch fence joins unique governed ownership and rejects unload or generation replacement', { timeout: 10_000 }, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-headless-readiness-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const root = runtimeRoot()
  mkdirSync(root, { recursive: true })
  const target = 'readiness-thread'
  const currentId = 'readiness-current'
  writeCodexReadinessRecord(root, currentId, target)
  let loaded = true
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: loaded ? [{ id: target }] : [], nextCursor: null }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    owner = startCodexOwner(root)
    const current = () => ({
      session: currentId,
      governed: true,
      harnessSessionId: target,
      stopped: false,
      archived: false,
      runtimeDir: root,
    })

    const initial = await codexHeadlessHarness.launchReady!(current, Date.now() + 2_000)
    assert.ok(initial)
    const socketStat = statSync(socket)
    assert.deepEqual(initial.proof.generation, {
      identity: {
        pid: owner.pid,
        startToken: owner.startToken,
        receiptVersion: 4,
        processGroupId: owner.pid,
        ...(platform() === 'linux' ? { linuxSessionId: owner.pid } : {}),
      },
      socket: { path: socket, dev: socketStat.dev, ino: socketStat.ino },
    })
    assert.deepEqual(initial.proof.target, {
      sessionId: currentId,
      threadId: target,
      ownerSessionId: currentId,
      ownerCount: 1,
      ownerState: 'governed',
      referenceState: 'loaded',
      protectsControlPlane: true,
    })
    assert.equal(await initial.validate(current), true)

    rmSync(join(root, 'sessions', currentId), { recursive: true, force: true })
    writeCodexReadinessRecord(root, 'readiness-reassigned', target)
    assert.equal(await initial.validate(current), false, 'another governed owner cannot inherit the current session fence')
    rmSync(join(root, 'sessions', 'readiness-reassigned'), { recursive: true, force: true })
    writeCodexReadinessRecord(root, currentId, target)

    writeCodexReadinessRecord(root, 'readiness-duplicate', target)
    const duplicateStarted = Date.now()
    assert.equal(await codexHeadlessHarness.launchReady!(current, duplicateStarted + 250), null,
      'two governed records claiming one loaded thread never form readiness')
    assert.ok(Date.now() - duplicateStarted >= 180, 'duplicate ownership follows the real bounded poll path')
    rmSync(join(root, 'sessions', 'readiness-duplicate'), { recursive: true, force: true })

    const beforeUnload = await codexHeadlessHarness.launchReady!(current, Date.now() + 2_000)
    assert.ok(beforeUnload)
    loaded = false
    assert.equal(await beforeUnload.validate(current), false, 'target unload invalidates the same readiness fence')

    loaded = true
    const beforeRestart = await codexHeadlessHarness.launchReady!(current, Date.now() + 2_000)
    assert.ok(beforeRestart)
    await stopCodexOwner(owner)
    owner = startCodexOwner(root)
    assert.equal(await beforeRestart.validate(current), false, 'replacement generation cannot reuse the old readiness fence')

    loaded = false
    const timeoutStarted = Date.now()
    assert.equal(await codexHeadlessHarness.launchReady!(current, timeoutStarted + 250), null)
    assert.ok(Date.now() - timeoutStarted >= 180, 'unloaded target times out through the actual adapter loop')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

const runReplacementArchiveCase = async (response: 'success' | 'error') => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), `spex-codex-replacement-${response}-`))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = `replacement-${response}-target`
  const root = runtimeRoot()
  let archived = false
  let archiveCalls = 0
  let unarchiveCalls = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: archived ? [] : [{ id: target }], nextCursor: null }
    if (message.method === 'thread/read') return { thread: { turns: [] } }
    if (message.method === 'thread/archive') {
      archiveCalls++
      archived = true
      writeFileSync(codexAppServerReceipt(root), `replacement generation ${response}\n`)
      if (response === 'error') throw new Error('archive response lost after commit')
      return {}
    }
    if (message.method === 'thread/unarchive') { unarchiveCalls++; archived = false; return {} }
    if (message.method === 'thread/list') {
      const data = message.params.ancestorThreadId ? [] : message.params.archived === archived ? [{ id: target }] : []
      return { data, nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    const result = await codexHarness.coldRuntime?.({ session: `replacement-${response}-session`, harnessSessionId: target })
    return { result, archiveCalls, unarchiveCalls, archived }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
}

test('Codex corrupt-record quarantine archives only an exact orphan native thread', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-orphan-quarantine-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const root = runtimeRoot()
  const target = 'orphan-native-thread'
  const corruptId = 'corrupt-record-owner'
  let archived = false
  let loaded = true
  let descendant = false
  let archiveCalls = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: loaded ? [{ id: target }] : [], nextCursor: null }
    if (message.method === 'thread/read') return { thread: { turns: [] } }
    if (message.method === 'thread/archive') { archiveCalls++; archived = true; loaded = false; return {} }
    if (message.method === 'thread/list') {
      if (message.params.ancestorThreadId) return { data: descendant && !message.params.archived ? [{ id: 'native-child', parentThreadId: target }] : [], nextCursor: null }
      const active = !archived && message.params.archived === false
      return { data: active ? [{ id: target }, ...(descendant ? [{ id: 'native-child', parentThreadId: target }] : [])] : message.params.archived === archived ? [{ id: target }] : [], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(join(root, 'sessions', corruptId), { recursive: true })
    writeFileSync(join(root, 'sessions', corruptId, 'session.json'), '{ unreadable incident bytes')
    owner = startCodexOwner(root)

    const quarantined = await codexHarness.quarantineOrphanThread?.(target, { excludingSessionId: corruptId })
    assert.equal(quarantined?.ok, true)
    if (!quarantined?.ok) throw new Error('orphan quarantine did not return an adapter proof')
    assert.deepEqual(quarantined.audit, { adapter: 'codex', threadId: target, action: 'archived' })
    assert.equal(archiveCalls, 1, 'only the exact unowned target receives thread/archive')
    assert.equal(loaded, false, 'post-mutation census leaves the target unloaded')

    archived = false; loaded = true
    mkdirSync(join(root, 'sessions', 'readable-owner'), { recursive: true })
    writeFileSync(join(root, 'sessions', 'readable-owner', 'session.json'), JSON.stringify({
      session_id: 'readable-owner', governed: true, harness: 'codex', harness_session_id: target,
    }))
    const owned = await codexHarness.quarantineOrphanThread?.(target, { excludingSessionId: corruptId })
    assert.equal(owned?.ok, false)
    if (owned && !owned.ok) assert.match(owned.reason, /governed owner/)
    assert.equal(archiveCalls, 1, 'a readable owner refuses before any archive RPC')

    rmSync(join(root, 'sessions', 'readable-owner'), { recursive: true, force: true })
    descendant = true
    const child = await codexHarness.quarantineOrphanThread?.(target, { excludingSessionId: corruptId })
    assert.equal(child?.ok, false)
    if (child && !child.ok) assert.match(child.reason, /descendants/)
    assert.equal(archiveCalls, 1, 'a descendant-bearing target refuses before any archive RPC')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive ignores a non-returning unrelated read when the exact target is unloaded and descendant-free', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-target-scoped-archive-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'unloaded-archive-target'
  let archived = false
  let unrelatedReads = 0
  let archiveCalls = 0
  let unarchiveCalls = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: [{ id: 'slow-unrelated-sibling' }], nextCursor: null }
    if (message.method === 'thread/read') { unrelatedReads++; return NO_RPC_RESPONSE }
    if (message.method === 'thread/archive') { archiveCalls++; archived = true; return {} }
    if (message.method === 'thread/unarchive') { unarchiveCalls++; archived = false; return {} }
    if (message.method === 'thread/list') {
      const data = message.params.ancestorThreadId ? [] : message.params.archived === archived ? [{ id: target }] : []
      return { data, nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    assert.deepEqual(await codexHarness.coldRuntime?.({ session: 'target-scoped-session', harnessSessionId: target }), { ok: true })
    const [activeFinal, archivedFinal] = await Promise.all([
      codexThreadList(socket, { archived: false, sourceKinds: [] }),
      codexThreadList(socket, { archived: true, sourceKinds: [] }),
    ])
    assert.equal(archiveCalls, 1, 'success requires exactly one native archive commit')
    assert.equal(unarchiveCalls, 0, 'the successful path does not compensate')
    assert.deepEqual(activeFinal, { ok: true, ids: [] })
    assert.deepEqual(archivedFinal, { ok: true, ids: [target] })
    assert.equal(unrelatedReads, 0, 'mutation guard never waits on or reads the unrelated sibling')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive refuses a shared generation swap during exact target guard before mutation', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-generation-fence-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'generation-fence-target'
  let archived = false
  let swapped = false
  let archiveCalls = 0
  const root = runtimeRoot()
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: archived ? [] : [{ id: target }], nextCursor: null }
    if (message.method === 'thread/read') {
      if (!swapped) {
        swapped = true
        writeFileSync(codexAppServerReceipt(root), `swapped fixture ${process.pid}\n`)
      }
      return { thread: { status: { type: 'idle' }, turns: [] } }
    }
    if (message.method === 'thread/archive') { archiveCalls++; archived = true; return {} }
    if (message.method === 'thread/unarchive') { archived = false; return {} }
    if (message.method === 'thread/list') {
      const data = message.params.ancestorThreadId ? [] : message.params.archived === archived ? [{ id: target }] : []
      return { data, nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    const result = await codexHarness.coldRuntime?.({ session: 'generation-fence-session', harnessSessionId: target })
    assert.equal(result?.ok, false)
    if (result && !result.ok) assert.match(result.reason, /generation changed during subtree turn census/)
    assert.equal(archiveCalls, 0, 'a generation swap never reaches thread/archive')
    assert.equal(archived, false)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive never compensates a successful commit on a replacement shared generation', async () => {
  const { result, archiveCalls, unarchiveCalls, archived } = await runReplacementArchiveCase('success')
  assert.equal(result?.ok, false)
  if (result && !result.ok) assert.match(result.reason, /generation changed/)
  assert.equal(archiveCalls, 1)
  assert.equal(unarchiveCalls, 0, 'replacement generation receives no thread/unarchive')
  assert.equal(archived, true, 'commit state remains unknown rather than mutating the replacement generation')
})

test('Codex archive never compensates a commit-unknown RPC error on a replacement shared generation', async () => {
  const { result, archiveCalls, unarchiveCalls, archived } = await runReplacementArchiveCase('error')
  assert.equal(result?.ok, false)
  if (result && !result.ok) assert.match(result.reason, /generation changed/)
  assert.equal(archiveCalls, 1)
  assert.equal(unarchiveCalls, 0, 'RPC reconciliation cannot authorize thread/unarchive on a replacement generation')
  assert.equal(archived, true)
})

test('Codex archive refuses an unknown exact loaded target and an unowned archived native descendant', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-target-guard-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'guarded-archive-target'
  let targetUnknown = true
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: [{ id: target }, { id: 'unrelated-sibling' }], nextCursor: null }
    if (message.method === 'thread/read') {
      if (message.params.threadId === target) throw new Error('exact target read unavailable')
      return { thread: { turns: [] } }
    }
    if (message.method === 'thread/list') {
      if (message.params.ancestorThreadId) return { data: !targetUnknown && message.params.archived
        ? [{ id: 'archived-native-child', parentThreadId: target }] : [], nextCursor: null }
      return { data: message.params.archived ? [] : [{ id: target }], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    const unknown = await codexHarness.coldPreflight?.({ session: 'guarded-session', harnessSessionId: target })
    assert.equal(unknown?.ok, false)
    if (unknown && !unknown.ok) assert.match(unknown.reason, /target read unavailable|turn state is unknown/)
    targetUnknown = false
    const descendant = await codexHarness.coldPreflight?.({ session: 'guarded-session', harnessSessionId: target })
    assert.equal(descendant?.ok, false)
    if (descendant && !descendant.ok) assert.match(descendant.reason, /archived-native-child.*absent from both.*unowned/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive cold-tears down the exact active and archived transitive descendant closure', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-owned-subtree-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'owned-subtree-target'
  const activeChild = 'owned-active-child'
  const grandchild = 'owned-active-grandchild'
  const archivedChild = 'owned-archived-child'
  const sibling = 'unrelated-loaded-sibling'
  const parent = new Map([
    [activeChild, target],
    [grandchild, activeChild],
    [archivedChild, target],
  ])
  const collection = new Map<string, 'active' | 'archived'>([
    [target, 'active'],
    [activeChild, 'active'],
    [grandchild, 'active'],
    [archivedChild, 'archived'],
  ])
  const loaded = new Set([target, activeChild, grandchild, sibling])
  const histories = new Map([...collection].map(([id]) => [id, `history:${id}`]))
  const mutations: string[] = []
  const threadReads: string[] = []
  const isDescendant = (id: string, ancestor: string) => {
    for (let next = parent.get(id); next; next = parent.get(next)) if (next === ancestor) return true
    return false
  }
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: [...loaded].map((id) => ({ id })), nextCursor: null }
    if (message.method === 'thread/read') {
      threadReads.push(message.params.threadId)
      if (message.params.threadId === sibling) throw new Error('unrelated sibling must never be read')
      return { thread: { status: { type: 'idle' }, turns: [{ id: histories.get(message.params.threadId), status: 'completed' }] } }
    }
    if (message.method === 'thread/archive') {
      const id = message.params.threadId
      mutations.push(`archive:${id}`)
      collection.set(id, 'archived')
      loaded.delete(id)
      return {}
    }
    if (message.method === 'thread/unarchive') {
      const id = message.params.threadId
      mutations.push(`unarchive:${id}`)
      collection.set(id, 'active')
      return {}
    }
    if (message.method === 'thread/list') {
      const state = message.params.archived ? 'archived' : 'active'
      const ids = [...collection].filter(([id, value]) => value === state &&
        (!message.params.ancestorThreadId || isDescendant(id, message.params.ancestorThreadId)))
        .map(([id]) => ({ id, parentThreadId: parent.get(id) ?? null }))
      return { data: ids, nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)

    const rec = { session: 'owned-subtree-session', harnessSessionId: target }
    const preflight = await codexHarness.coldPreflight?.(rec)
    assert.equal(preflight?.ok, true)
    if (!preflight?.ok) throw new Error('owned subtree fixture did not obtain its adapter receipt')
    assert.deepEqual(await codexHarness.coldRuntime?.(rec, preflight.receipt), { ok: true })
    assert.deepEqual(new Set(threadReads), new Set([target, activeChild, grandchild]),
      'only loaded members of the exact target subtree are read')
    assert.deepEqual(mutations, [
      `archive:${grandchild}`,
      `archive:${activeChild}`,
      `archive:${target}`,
    ], 'each initially-active descendant is archived once before the parent; an already-archived child is not mutated')
    assert.deepEqual([...collection].filter(([, state]) => state !== 'archived'), [])
    assert.deepEqual([...loaded], [sibling], 'the complete target subtree is unloaded while the unrelated sibling survives')
    assert.deepEqual([...histories], [
      [target, `history:${target}`],
      [activeChild, `history:${activeChild}`],
      [grandchild, `history:${grandchild}`],
      [archivedChild, `history:${archivedChild}`],
    ], 'cold archive preserves every native conversation history')
    assert.deepEqual(await codexHarness.coldRetirementPreflight?.({ session: 'owned-subtree-session', harnessSessionId: target }),
      { ok: true, alreadyCold: true })
    assert.deepEqual(await codexHarness.restoreRuntime?.(rec, preflight.receipt), { ok: true },
      'post-cold publication compensation accepts only the original adapter receipt')
    assert.deepEqual(mutations, [
      `archive:${grandchild}`,
      `archive:${activeChild}`,
      `archive:${target}`,
      `unarchive:${target}`,
      `unarchive:${activeChild}`,
      `unarchive:${grandchild}`,
    ])
    assert.deepEqual([...collection], [
      [target, 'active'],
      [activeChild, 'active'],
      [grandchild, 'active'],
      [archivedChild, 'archived'],
    ], 'outer compensation restores all and only the subtree members that were active before archive')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive rejects duplicate, unowned, reassigned, and late subtree members with bounded compensation', async (t) => {
  const runCase = async (mode: 'duplicate' | 'unowned' | 'reassigned' | 'late-before') => {
    const previousHome = process.env.SPEXCODE_HOME
    const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
    const home = mkdtempSync(join(tmpdir(), `spex-codex-subtree-${mode}-`))
    process.env.SPEXCODE_HOME = home
    process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
    const target = `${mode}-target`
    const child = `${mode}-child`
    const late = `${mode}-late-child`
    const collection = new Map<string, 'active' | 'archived'>([[target, 'active'], [child, 'active']])
    const loaded = new Set([target, child])
    const mutations: string[] = []
    let reassigned = false
    const server = codexRpcFixture((message) => {
      if (message.method === 'thread/loaded/list') return { data: [...loaded].map((id) => ({ id })), nextCursor: null }
      if (message.method === 'thread/read') return { thread: { status: { type: 'idle' }, turns: [] } }
      if (message.method === 'thread/archive') {
        const id = message.params.threadId
        mutations.push(`archive:${id}`)
        collection.set(id, 'archived')
        loaded.delete(id)
        if (mode === 'reassigned' && id === target) reassigned = true
        return {}
      }
      if (message.method === 'thread/unarchive') {
        const id = message.params.threadId
        mutations.push(`unarchive:${id}`)
        collection.set(id, 'active')
        return {}
      }
      if (message.method === 'thread/list') {
        const archived = !!message.params.archived
        if (message.params.ancestorThreadId) {
          if (mode === 'duplicate') return { data: [{ id: child, parentThreadId: target }], nextCursor: null }
          if (mode === 'reassigned' && reassigned) return { data: [], nextCursor: null }
          return { data: archived ? [] : [
            { id: child, parentThreadId: target },
            ...(mode === 'late-before' && reassigned ? [{ id: late, parentThreadId: target }] : []),
          ], nextCursor: null }
        }
        const data = [...collection]
          .filter(([id, state]) => (state === 'archived') === archived && !(mode === 'unowned' && id === child))
          .map(([id]) => ({ id }))
        return { data, nextCursor: null }
      }
      throw new Error(`unexpected RPC ${message.method}`)
    })
    const root = runtimeRoot()
    const socket = codexAppServerSock(root)
    let owner: ReturnType<typeof startCodexOwner> | null = null
    try {
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
      mkdirSync(root, { recursive: true })
      owner = startCodexOwner(root)
      let result
      if (mode === 'late-before') {
        const preflight = await codexHarness.coldPreflight?.({ session: `${mode}-session`, harnessSessionId: target })
        assert.equal(preflight?.ok, true)
        if (!preflight?.ok) throw new Error('late-before fixture did not obtain its adapter receipt')
        collection.set(late, 'active')
        loaded.add(late)
        reassigned = true
        result = await codexHarness.coldRuntime?.({ session: `${mode}-session`, harnessSessionId: target }, preflight.receipt)
      } else {
        result = await codexHarness.coldRuntime?.({ session: `${mode}-session`, harnessSessionId: target })
      }
      assert.equal(result?.ok, false)
      if (result && !result.ok) assert.match(result.reason, mode === 'duplicate'
        ? /both.*active.*archived|duplicate/i
        : mode === 'unowned' ? /absent from both|unowned/i : /changed|reassigned|closure/i)
      assert.deepEqual(mutations, mode === 'reassigned'
        ? [`archive:${child}`, `archive:${target}`, `unarchive:${target}`, `unarchive:${child}`]
        : [], `${mode} refuses before mutation or compensates every initially-active commit`)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await stopCodexOwner(owner)
      if (previousHome === undefined) delete process.env.SPEXCODE_HOME
      else process.env.SPEXCODE_HOME = previousHome
      if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
      else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
      rmSync(home, { recursive: true, force: true })
    }
  }
  for (const mode of ['duplicate', 'unowned', 'reassigned', 'late-before'] as const) await t.test(mode, () => runCase(mode))
})

test('shQuote preserves a single quote through a POSIX shell', () => {
  const input = "alpha'beta"
  const encoded = shQuote(input)
  assert.equal(encoded, `'alpha'\\''beta'`)
  assert.equal(execFileSync('/bin/sh', ['-c', `printf %s ${encoded}`], { encoding: 'utf8' }), input)
})

test('launchEnv keeps rendezvous bootstrap knowledge in the owning adapters', () => {
  const id = 'env-session'
  const rendezvous = ['CLAUDE_BG_BACKEND=daemon', `CLAUDE_BG_RENDEZVOUS_SOCK=${rvSock(id)}`]
  for (const harness of [claudeHarness, piHarness, opencodeHarness, piHeadlessHarness, opencodeHeadlessHarness]) {
    assert.deepEqual(harness.launchEnv(id), rendezvous, harness.id)
  }
  for (const harness of [claudeHeadlessHarness, codexHarness, codexHeadlessHarness]) {
    assert.deepEqual(harness.launchEnv(id), [], harness.id)
  }
})

test('codex handshake initializes, confirms the loaded thread, then reads it to decide steer-vs-start', () => {
  const msgs = codexHandshakeMessages('thr_1')
  assert.equal(msgs[0].method, 'initialize')
  assert.deepEqual(msgs[1], { method: 'initialized', params: {} })
  assert.deepEqual(msgs[2], { id: 2, method: 'thread/loaded/list', params: {} })
  assert.deepEqual(msgs[3], { id: 3, method: 'thread/read', params: { threadId: 'thr_1', includeTurns: true } })
})

test('codex lightweight residency census performs initialize then paginated loaded/list without thread reads', async () => {
  const socketPath = join(tmpdir(), `spexcode-loaded-census-${process.pid}-${Date.now()}.sock`)
  const loadedRequests: any[] = []
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0)
    let upgraded = false
    const send = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value))
      const header = payload.length < 126 ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
      socket.write(Buffer.concat([header, payload]))
    }
    const handle = (message: any) => {
      if (message.method === 'initialize') send({ id: message.id, result: {} })
      else if (message.method === 'initialized') return
      else if (message.method === 'thread/loaded/list') {
        loadedRequests.push(message)
        send({ id: message.id, result: loadedRequests.length === 1
          ? { data: [{ id: 'page-one' }], nextCursor: 'p2' }
          : { data: [{ id: 'thread-a' }], nextCursor: null } })
      }
      else assert.fail(`unexpected RPC ${message.method}`)
    }
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!upgraded) {
        const split = buffer.indexOf('\r\n\r\n')
        if (split < 0) return
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
        upgraded = true
        buffer = buffer.slice(split + 4)
      }
      while (buffer.length >= 2) {
        const masked = (buffer[1] & 0x80) !== 0
        let length = buffer[1] & 0x7f
        let offset = 2
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
        const maskOffset = offset
        const dataOffset = offset + (masked ? 4 : 0)
        if (buffer.length < dataOffset + length) return
        let payload = buffer.slice(dataOffset, dataOffset + length)
        if (masked) { const mask = buffer.slice(maskOffset, maskOffset + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4] }
        buffer = buffer.slice(dataOffset + length)
        handle(JSON.parse(payload.toString('utf8')))
      }
    })
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => resolve()) })
    const result = await codexLoadedReferenceIds(socketPath)
    assert.deepEqual(result, { ok: true, referenceIds: ['page-one', 'thread-a'] })
    assert.equal(loadedRequests.length, 2)
    assert.equal(loadedRequests[1].params.cursor, 'p2')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(socketPath, { force: true })
  }
})

test('codex native descendant census includes subAgent sources and follows every thread/list page', async () => {
  const socketPath = join(tmpdir(), `spexcode-thread-list-${process.pid}-${Date.now()}.sock`)
  const requests: any[] = []
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0); let upgraded = false
    const send = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value)); const header = payload.length < 126
        ? Buffer.from([0x81, payload.length]) : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
      socket.write(Buffer.concat([header, payload]))
    }
    const handle = (message: any) => {
      if (message.method === 'initialize') send({ id: message.id, result: {} })
      else if (message.method === 'initialized') return
      else if (message.method === 'thread/list') {
        requests.push(message)
        send({ id: message.id, result: requests.length === 1
          ? { data: [], nextCursor: 'p2' }
          : { data: [{ id: 'unowned-subagent-descendant', parentThreadId: 'target-thread' }], nextCursor: null } })
      } else assert.fail(`unexpected RPC ${message.method}`)
    }
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      if (!upgraded) {
        const split = buffer.indexOf('\r\n\r\n'); if (split < 0) return
        socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n')
        upgraded = true; buffer = buffer.slice(split + 4)
      }
      while (buffer.length >= 2) {
        const masked = (buffer[1] & 0x80) !== 0; let length = buffer[1] & 0x7f; let offset = 2
        if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
        const maskOffset = offset; const dataOffset = offset + (masked ? 4 : 0)
        if (buffer.length < dataOffset + length) return
        let payload = buffer.slice(dataOffset, dataOffset + length)
        if (masked) { const mask = buffer.slice(maskOffset, maskOffset + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4] }
        buffer = buffer.slice(dataOffset + length); handle(JSON.parse(payload.toString('utf8')))
      }
    })
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, () => resolve()) })
    const result = await codexThreadList(socketPath, { ancestorThreadId: 'target-thread', archived: false, sourceKinds: [] })
    assert.deepEqual(result, { ok: true, ids: ['unowned-subagent-descendant'] })
    assert.equal(requests.length, 2)
    assert.equal(requests[1].params.cursor, 'p2')
    assert.deepEqual(requests[0].params.sourceKinds, CODEX_THREAD_SOURCE_KINDS)
    assert.equal(requests[0].params.useStateDbOnly, true)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(socketPath, { force: true })
  }
})

test('Codex cold retirement proves only target collections and never thread/reads an unrelated loaded sibling', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-cold-retirement-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'cold-target'
  let threadReads = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: [{ id: 'unrelated-loaded-sibling' }], nextCursor: null }
    if (message.method === 'thread/read') { threadReads++; return { thread: { status: { type: 'idle' }, turns: [] } } }
    if (message.method === 'thread/list') {
      if (message.params.ancestorThreadId) return { data: [], nextCursor: null }
      return { data: message.params.archived ? [{ id: target }] : [], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    assert.deepEqual(await codexHarness.coldRetirementPreflight?.({ session: 'cold-session', harnessSessionId: target }), { ok: true, alreadyCold: true })
    assert.equal(threadReads, 0, 'cold retirement does not wait on or read the unrelated loaded sibling')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex cold retirement rejects missing or non-detached shared owner identity', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-cold-retirement-identity-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'cold-identity-target'
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: [], nextCursor: null }
    if (message.method === 'thread/list') {
      if (message.params.ancestorThreadId) return { data: [], nextCursor: null }
      return { data: message.params.archived ? [{ id: target }] : [], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    writeFileSync(codexAppServerPid(root), `${process.pid}\n`)
    const missing = await codexHarness.coldRetirementPreflight?.({ session: 'cold-identity-session', harnessSessionId: target })
    assert.equal(missing?.ok, false)
    if (missing && !missing.ok) assert.match(missing.reason, /generation is unproven/)

    const start = processStartToken(process.pid)!
    writeFileSync(codexAppServerReceipt(root), `${JSON.stringify({
      version: 4,
      kind: 'spexcode-detached-runtime',
      pid: process.pid,
      startToken: start,
      processGroupId: process.pid,
      ...(platform() === 'linux' ? { linuxSessionId: process.pid } : {}),
    })}\n`)
    const nonDetached = await codexHarness.coldRetirementPreflight?.({ session: 'cold-identity-session', harnessSessionId: target })
    assert.equal(nonDetached?.ok, false)
    if (nonDetached && !nonDetached.ok) assert.match(nonDetached.reason, /detached.*identity|generation is unproven/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex cold retirement rejects a generation swap after target guard while collection lists are pending', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-cold-retirement-generation-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'cold-generation-target'
  const pendingLists: Array<{ archived: boolean; resolve: (value: unknown) => void }> = []
  let targetProofResponses = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') {
      targetProofResponses++
      return { data: [], nextCursor: null }
    }
    if (message.method === 'thread/list' && message.params.ancestorThreadId) {
      targetProofResponses++
      return { data: [], nextCursor: null }
    }
    if (message.method === 'thread/list') return new Promise((resolve) => {
      pendingLists.push({ archived: !!message.params.archived, resolve })
    })
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    const retirement = codexHarness.coldRetirementPreflight?.({ session: 'cold-generation-session', harnessSessionId: target })
    for (let i = 0; i < 100 && (targetProofResponses < 3 || pendingLists.length < 2); i++) await new Promise((resolve) => setTimeout(resolve, 5))
    assert.equal(targetProofResponses, 3, 'loaded-ID and both target descendant responses completed first')
    assert.equal(pendingLists.length, 2, 'active and archived collection responses remain pending')
    await new Promise((resolve) => setTimeout(resolve, 20))
    writeFileSync(codexAppServerReceipt(root), 'replacement generation while collections pending\n')
    for (const pending of pendingLists) pending.resolve({ data: pending.archived ? [{ id: target }] : [], nextCursor: null })
    const result = await retirement
    assert.equal(result?.ok, false)
    if (result && !result.ok) assert.match(result.reason, /generation changed during cold retirement guard/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive uses the fresh inProgress turn, not stale thread status, as its mutation guard', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-archive-turn-race-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'archive-turn-race-target'
  let targetTurn = 'inProgress'
  let archived = false
  const mutations: string[] = []
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: archived ? [{ id: 'unrelated-loaded-sibling' }] : [{ id: target }, { id: 'unrelated-loaded-sibling' }], nextCursor: null }
    if (message.method === 'thread/read') return message.params.threadId === target
      ? { thread: { status: { type: 'active' }, turns: [{ id: 'target-turn', status: targetTurn }] } }
      : { thread: { status: { type: 'idle' }, turns: [] } }
    if (message.method === 'thread/archive') { archived = true; mutations.push('archive'); return {} }
    if (message.method === 'thread/unarchive') { archived = false; mutations.push('unarchive'); return {} }
    if (message.method === 'thread/list') {
      if (message.params.ancestorThreadId) return { data: [], nextCursor: null }
      return { data: message.params.archived === archived ? [{ id: target }] : [], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)

    const active = await codexHarness.coldRuntime?.({ session: 'archive-turn-race-session', harnessSessionId: target })
    assert.equal(active?.ok, false)
    if (active && !active.ok) assert.match(active.reason, /has an active turn/)
    assert.deepEqual(mutations, [], 'a fresh inProgress target turn refuses before the archive mutation')

    targetTurn = 'completed'
    assert.deepEqual(await codexHarness.coldRuntime?.({ session: 'archive-turn-race-session', harnessSessionId: target }), { ok: true })
    assert.deepEqual(mutations, ['archive'], 'a complete idle turn census archives even while top-level thread status remains active')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('Codex archive re-censuses native descendants after mutation and compensates a late child', async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const home = mkdtempSync(join(tmpdir(), 'spex-codex-late-descendant-'))
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(home, 'sockets')
  const target = 'archive-race-target'
  let archived = false
  let lateCreated = false
  const mutations: string[] = []
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: [
      ...(archived ? [] : [{ id: target }]),
      ...(lateCreated ? [{ id: 'late-native-descendant' }] : []),
      { id: 'unrelated-loaded-sibling' },
    ], nextCursor: null }
    if (message.method === 'thread/read') return { thread: { status: { type: 'idle' }, turns: [] } }
    if (message.method === 'thread/archive') { archived = true; lateCreated = true; mutations.push('archive'); return {} }
    if (message.method === 'thread/unarchive') { archived = false; mutations.push('unarchive'); return {} }
    if (message.method === 'thread/list') {
      if (message.params.ancestorThreadId) return {
        data: lateCreated && !message.params.archived ? [{ id: 'late-native-descendant', parentThreadId: target }] : [], nextCursor: null,
      }
      return { data: [
        ...(message.params.archived === archived ? [{ id: target }] : []),
        ...(lateCreated && !message.params.archived ? [{ id: 'late-native-descendant' }] : []),
      ], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  const root = runtimeRoot()
  const socket = codexAppServerSock(root)
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    mkdirSync(root, { recursive: true })
    owner = startCodexOwner(root)
    const result = await codexHarness.coldRuntime?.({ session: 'archive-race-session', harnessSessionId: target })
    assert.equal(result?.ok, false)
    if (result && !result.ok) assert.match(result.reason, /descendant closure changed.*late-native-descendant/)
    assert.deepEqual(mutations, ['archive', 'unarchive'], 'late descendant causes fail-loud compensation before cold success')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(home, { recursive: true, force: true })
  }
})

test('codex shared probe treats dead PID plus stale socket files as a healthy empty root', async () => {
  const dir = mkdtempSync(join(tmpdir(), `spex-codex-stale-root-${process.pid}-`))
  const socketDir = join(dir, 'socket-dir')
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  process.env.SPEXCODE_CODEX_SOCKET_DIR = socketDir
  try {
    const socket = codexAppServerSock(dir)
    writeFileSync(codexAppServerPid(dir), '999999999\n')
    writeFileSync(codexAppServerReceipt(dir), 'detached-v3 999999999 dead 999999999 999999999\n')
    writeFileSync(socket, 'stale socket path, no listener\n')
    assert.deepEqual(await codexSharedRuntimeProbe(dir), { healthy: true, references: [] })
  } finally {
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(dir, { recursive: true, force: true })
  }
})

test('codex resource probe rejects a missing, wrong, or replaced detached receipt generation', async () => {
  const dir = mkdtempSync(join(tmpdir(), `spex-codex-resource-generation-${process.pid}-`))
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(dir, 'sockets')
  const socket = codexAppServerSock(dir)
  let replaceDuringProbe = false
  let rpcCalls = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') {
      rpcCalls++
      if (replaceDuringProbe) writeFileSync(codexAppServerReceipt(dir), '{"version":999}\n')
      return { data: [], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    owner = startCodexOwner(dir)

    rmSync(codexAppServerReceipt(dir), { force: true })
    const missing = await codexSharedRuntimeProbe(dir)
    assert.equal(missing.healthy, false)
    assert.match(missing.error || '', /detached receipt\/socket generation is not proven/)
    assert.equal(rpcCalls, 0, 'missing receipt refuses before reading native references')

    writeDetachedRuntimeReceipt(owner.pid, codexAppServerReceipt(dir))
    const wrong = JSON.parse(readFileSync(codexAppServerReceipt(dir), 'utf8'))
    wrong.processGroupId = owner.pid + 1
    writeFileSync(codexAppServerReceipt(dir), `${JSON.stringify(wrong)}\n`)
    const mismatched = await codexSharedRuntimeProbe(dir)
    assert.equal(mismatched.healthy, false)
    assert.equal(rpcCalls, 0, 'wrong receipt refuses before reading native references')

    writeDetachedRuntimeReceipt(owner.pid, codexAppServerReceipt(dir))
    replaceDuringProbe = true
    const replaced = await codexSharedRuntimeProbe(dir)
    assert.equal(replaced.healthy, false)
    assert.match(replaced.error || '', /generation changed during ownership probe/)
    assert.equal(rpcCalls, 1)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Codex mutation guard promotes an exact v3 scope before target close proof', { skip: platform() !== 'linux' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), `spex-codex-legacy-receipt-${process.pid}-`))
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(dir, 'sockets')
  const socket = codexAppServerSock(dir)
  let rpcCalls = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list' || message.method === 'thread/list') {
      rpcCalls++
      return { data: [], nextCursor: null }
    }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  let owner: ReturnType<typeof startCodexOwner> | null = null
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    owner = startCodexOwner(dir)
    const prior = JSON.parse(readFileSync(codexAppServerReceipt(dir), 'utf8'))
    rmSync(codexAppServerReceipt(dir), { force: true })
    writeFileSync(join(dir, 'codex-app-server.scope'),
      `detached-v3 ${prior.pid} ${prior.startToken} ${prior.processGroupId} ${prior.linuxSessionId}\n`)

    const reading = await codexSharedRuntimeProbe(dir)
    assert.equal(reading.healthy, false, 'reads expose the unproven generation without repairing it')
    assert.equal(rpcCalls, 0, 'a read does not touch the legacy app-server or mint a receipt')

    const sharedRuntimes = codexHarness.sharedRuntimes
    if (!sharedRuntimes) throw new Error('Codex exposes its shared runtime descriptor')
    const mutationGuard = sharedRuntimes(dir)[0]?.mutationGuard
    if (!mutationGuard) throw new Error('Codex exposes its target mutation guard')
    const guard = await mutationGuard('retired-target-thread')
    assert.deepEqual(guard, { healthy: true, referenceIds: [], targetTurnPresence: 'none', descendantIds: [] })
    if (!owner) throw new Error('Codex test owner started')
    assert.equal(verifyDetachedRuntime(owner.pid, codexAppServerReceipt(dir)).ok, true)
    assert.equal(rpcCalls, 3, 'the close guard makes its normal loaded and descendant reads after migration')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopCodexOwner(owner)
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    rmSync(dir, { recursive: true, force: true })
  }
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
  assert.equal((codexInjectMessage('thr_1', 'hi', undefined, 'turn_9', 4, 'delivery-7').params as { clientUserMessageId?: string }).clientUserMessageId, 'delivery-7')
})

test('Codex delivery waits for initialize, accepts a delayed turn response, and carries one native delivery marker', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-delivery-'))
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const previousConfirmMs = process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(dir, 'sockets')
  process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS = '1000'
  const socket = codexAppServerSock(dir)
  mkdirSync(dirname(socket), { recursive: true })
  let initializeAcknowledged = false
  const calls: string[] = []
  let marker: string | null = null
  const server = codexRpcFixture((message) => {
    calls.push(message.method)
    if (message.method === 'thread/loaded/list') return { data: ['thread-1'] }
    if (message.method === 'thread/read') return { thread: { turns: [] } }
    if (message.method === 'turn/start') {
      marker = message.params.clientUserMessageId
      return new Promise((resolve) => setTimeout(() => resolve({ turn: { id: 'turn-1' } }), 60))
    }
    throw new Error(`unexpected RPC ${message.method}`)
  }, {
    initialize: (message, send) => setTimeout(() => {
      initializeAcknowledged = true
      send({ id: message.id, result: {} })
    }, 30),
    initialized: () => assert.equal(initializeAcknowledged, true, 'initialized must follow initialize acknowledgement'),
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    const result = await codexTurn(socket, 'thread-1', 'delayed prompt', '/worktree', 'delivery-marker-1')
    assert.deepEqual(result, { ok: true, outcome: 'accepted' })
    assert.deepEqual(calls, ['thread/loaded/list', 'thread/read', 'turn/start'])
    assert.equal(marker, 'delivery-marker-1')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    if (previousConfirmMs === undefined) delete process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS
    else process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS = previousConfirmMs
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Codex delivery reports a post-write transport silence as commit-unknown and does not replay it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-delivery-unknown-'))
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const previousConfirmMs = process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS
  process.env.SPEXCODE_CODEX_SOCKET_DIR = join(dir, 'sockets')
  process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS = '100'
  const socket = codexAppServerSock(dir)
  mkdirSync(dirname(socket), { recursive: true })
  let starts = 0
  const server = codexRpcFixture((message) => {
    if (message.method === 'thread/loaded/list') return { data: ['thread-1'] }
    if (message.method === 'thread/read') return { thread: { turns: [] } }
    if (message.method === 'turn/start') { starts++; return NO_RPC_RESPONSE }
    throw new Error(`unexpected RPC ${message.method}`)
  })
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, () => resolve()) })
    const result = await codexTurn(socket, 'thread-1', 'maybe committed', '/worktree', 'delivery-marker-2')
    assert.equal(result.ok, false)
    assert.equal(result.outcome, 'commit-unknown')
    assert.match(result.error || '', /did not confirm/)
    assert.equal(starts, 1, 'an unconfirmed request must never be replayed by the adapter')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    if (previousConfirmMs === undefined) delete process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS
    else process.env.SPEXCODE_CODEX_TURN_CONFIRM_MS = previousConfirmMs
    rmSync(dir, { recursive: true, force: true })
  }
})

test('activeTurnIdFromThread finds the inProgress turn, else null', () => {
  assert.equal(activeTurnIdFromThread({ thread: { turns: [{ id: 't1', status: 'completed' }, { id: 't2', status: 'inProgress' }] } }), 't2')
  assert.equal(activeTurnIdFromThread({ thread: { turns: [{ id: 't1', status: 'completed' }] } }), null)
  assert.equal(activeTurnIdFromThread({ thread: { turns: [] } }), null)
  assert.equal(activeTurnIdFromThread({}), null)
})

test('codex launch command starts app-server then resumes the backend-owned thread on the same socket', () => {
  process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST = '0'   // pin the no-flag baseline (the real --help probe is machine-dependent)
  try {
  const cmd = codexLaunchCommand('sess-1', 'codex --yolo', 'codex', '/tmp/spex-project')
  // POSIX-portable mkdir mutex, NOT flock (absent on macOS): the check-and-start is serialized on `mkdir "$lock.d"`
  // and there is no flock / fd-9 gymnastics left on the daemon spawn.
  assert.match(cmd, /mkdir "\$lockd"/)
  assert.doesNotMatch(cmd, /flock/)
  assert.doesNotMatch(cmd, /9>&-/)
  assert.match(cmd, /internal shared-runtime-spawn [^\n]* codex app-server --listen "unix:\/\/\$sock"/)
  // the shared per-project daemon runs in the STABLE runtime dir "$dir", NOT the transient worktree — else a
  // later worktree deletion dead-cwds the daemon and every future thread's config load fails with ENOENT.
  assert.match(cmd, /unset [^\n]*; [^\n]*internal shared-runtime-spawn "\$dir" "\$log" "\$pid" "\$receipt" [^\n]*app-server --listen "unix:\/\/\$sock"/)
  // ...and it carries NO session identity: it is started by whichever session launched first, serves every
  // later thread, and outlives them all — so an inherited SPEXCODE_SESSION_ID / adapter sessionEnvVar in its
  // env is a stale lie every consumer downstream reads as the acting session (github#76).
  for (const v of sessionIdentityEnvVars()) assert.match(cmd, new RegExp(`unset [^\\n]*\\b${v}\\b[^\\n]*internal shared-runtime-spawn`))
  assert.ok(sessionIdentityEnvVars().includes('SPEXCODE_SESSION_ID'))
  assert.ok(sessionIdentityEnvVars().includes('CODEX_THREAD_ID'))
  assert.doesNotMatch(cmd, /\bnohup\b/)
  // design C: the BACKEND owns the thread — codex-launch does thread/start { cwd } + first turn, prints the id,
  // and the visible TUI resumes THAT thread on the same project socket.
  assert.match(cmd, /internal codex-launch "\$sock" "\$PWD" "\$@"/)
  assert.match(cmd, /exec codex --yolo [^\n]*--remote unix:\/\/"\$sock" resume "\$tid"/)
  // the app-server socket lives on a SHORT sun_path-safe path (spexcode-cx-<hash>.sock off tmpdir), NOT the old
  // `<runtimeDir>/codex-app-server.sock` that blew past macOS's ~104-byte sun_path cap on a deep project path.
  assert.match(cmd, /spexcode-cx-[0-9a-f]+\.sock/)
  assert.doesNotMatch(cmd, /codex-app-server\.sock/)
  // pid/log/lock (no sun_path limit) still live under the runtime dir; self-heal drops the orphaned pre-fix lock FILE.
  assert.match(cmd, /codex-app-server\.lock/)
  assert.match(cmd, /rm -f "\$lock"/)
  assert.match(cmd, /\/tmp\/spex-project/)
  // resume mode: a `--resume <tid>` tail (resumeSession's resumeArg) takes the OWNED thread id DIRECTLY — it must NOT
  // run codex-launch (which would mint a NEW thread and fire the tail as a first-turn prompt — the resume bug).
  assert.match(cmd, /if \[ "\$1" = "--resume" \]; then/)
  assert.match(cmd, /tid=\$2/)
  // codex-launch only prints an id once its rollout is resume-ready; a fail-loud (non-zero / empty) must ABORT,
  // never `resume ""` — so the codex-launch call propagates failure and an empty tid is guarded before resume.
  assert.match(cmd, /internal codex-launch "\$sock" "\$PWD" "\$@"\)/)
  assert.match(cmd, /__spex_rc=\$\?\n  \[ "\$__spex_rc" -eq 0 \] \|\| exit 1/)
  assert.match(cmd, /\[ -n "\$tid" \] \|\| \{ echo .* exit 1; \}/)
  } finally { delete process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST }
})

test('codex launch puts --dangerously-bypass-hook-trust on the RESUME TUI, not on the (inert) app-server invocation', () => {
  // codex >=0.142 requires per-thread hook trust to run hooks; the bypass flag runs our own vetted hooks WITHOUT
  // the fragile pinned hash. But the flag only reaches a thread's trust as a per-request `config` override — codex's
  // `--remote resume` client forwards it into thread/start+thread/resume config, so it belongs on the resume TUI.
  // On the `codex app-server` invocation the app-server NEVER reads it for a thread (it was inert there — the bug),
  // so the launch does NOT put it on the app-server; the backend-owned thread carries bypass via codexStartThread.
  process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST = '1'
  try {
    const cmd = codexLaunchCommand('s', 'codex --yolo', 'codex', '/tmp/spex-project')
    assert.match(cmd, /exec codex --yolo --dangerously-bypass-hook-trust [^\n]*--remote/)  // on the resume TUI (forwarded to thread config)
    assert.match(cmd, /(?:^|\s)codex app-server --listen/m)                          // app-server carries NO bypass flag
    assert.doesNotMatch(cmd, /--dangerously-bypass-hook-trust app-server/)           // never on the inert app-server invocation
  } finally { delete process.env.SPEXCODE_CODEX_BYPASS_HOOK_TRUST }
})

test('codex launch EXPORTS the launcher cmd so codex-launch probes the SAME codex (not a fallback bare `codex`)', () => {
  // Regression: on a multi-codex box (old Homebrew `codex` on PATH beside the launcher's newer one), codex-launch's
  // bypass-trust gate resolved `SPEXCODE_CODEX_CMD || 'codex'` — which the launch never set — so it probed the WRONG
  // (old, flag-less) binary, decided "no bypass support", dropped the thread/start bypass, and NO hooks fired. The
  // launch already holds the real launcher cmd; it must pin it into the env the codex-launch child inherits.
  const cmd = codexLaunchCommand('s', '/opt/nvm/v22/bin/codex --yolo', undefined, '/tmp/spex-project')
  // (the export sits inside the outer `bash -lc '…'`, so its own quotes are shell-escaped as '\'' — match loosely)
  assert.match(cmd, /export SPEXCODE_CODEX_CMD=\S*\/opt\/nvm\/v22\/bin\/codex --yolo/)
  // and the export precedes the codex-launch call in the same script, so the child inherits it
  assert.ok(cmd.indexOf('export SPEXCODE_CODEX_CMD') < cmd.indexOf('internal codex-launch "$sock"'))
})

test('codexRolloutExists finds a thread by id only once its rollout file lands on disk', () => {
  const home = mkdtempSync(join(tmpdir(), 'cx-home-'))
  const day = join(home, '2026', '07', '03')
  mkdirSync(day, { recursive: true })
  const tid = '019f2784-0794-78e0-91e9-785b6719c4a6'
  // thread/start alone writes NO rollout (verified live) → resume-not-ready until the first turn materializes it
  assert.equal(codexRolloutExists(tid, join(home, 'sessions')), false)   // sessions dir empty
  mkdirSync(join(home, 'sessions', '2026', '07', '03'), { recursive: true })
  writeFileSync(join(home, 'sessions', '2026', '07', '03', `rollout-2026-07-03T03-26-32-${tid}.jsonl`), '{}\n')
  assert.equal(codexRolloutExists(tid, join(home, 'sessions')), true)
  assert.equal(codexRolloutExists('nonexistent-thread', join(home, 'sessions')), false)
})

test('codexRolloutExists is immune to future-dated junk day-dirs above the real rollout', () => {
  // live failure shape: a test planted 2099/12/{29,30,31} in the real CODEX_HOME; those sort above every real
  // day-dir, and a newest-3 cap made the scan miss ALL real rollouts — every codex launch died "no rollout".
  const home = mkdtempSync(join(tmpdir(), 'cx-home-'))
  const tid = '019f70f2-6182-7a32-ac76-c85910c90fe2'
  for (const d of ['29', '30', '31']) mkdirSync(join(home, 'sessions', '2099', '12', d), { recursive: true })
  writeFileSync(join(home, 'sessions', '2099', '12', '29', 'rollout-2099-12-29-junk-e2e-1.jsonl'), '{}\n')
  mkdirSync(join(home, 'sessions', '2026', '07', '18'), { recursive: true })
  writeFileSync(join(home, 'sessions', '2026', '07', '18', `rollout-2026-07-18T00-39-20-${tid}.jsonl`), '{}\n')
  assert.equal(codexRolloutExists(tid, join(home, 'sessions')), true)
})

test('codex app-server runs the SAME install as the launcher/resume (version parity across the one socket)', () => {
  // The app-server binary is DERIVED from codexCmd's binary (its first shell token), not a bare `codex` off
  // PATH: on a multi-install host a bare `codex` app-server can be a DIFFERENT version than the launcher's
  // `--remote … resume`, and that skew breaks the thread/start→resume handoff. codexBinary strips args.
  assert.equal(codexBinary('codex --yolo'), 'codex')
  assert.equal(codexBinary('/opt/foo/codex --yolo'), '/opt/foo/codex')
  assert.equal(codexBinary('  /abs/codex  '), '/abs/codex')
  // With no explicit serverCmd, the app-server line uses the launcher's OWN binary — never bare `codex`.
  const derived = codexLaunchCommand('s', '/opt/foo/codex --yolo', undefined, '/tmp/spex-project')
  assert.match(derived, /internal shared-runtime-spawn [^\n]* \/opt\/foo\/codex app-server --listen "unix:\/\/\$sock"/)
  assert.match(derived, /exec \/opt\/foo\/codex --yolo [^\n]*--remote unix:\/\/"\$sock" resume "\$tid"/)
  // the app-server token and the resume token are the SAME install — no bare `codex app-server`.
  assert.doesNotMatch(derived, /(?:^|\s)codex app-server/m)
  // SPEXCODE_CODEX_SERVER_CMD remains the explicit escape hatch (highest precedence, overrides the derivation).
  const prevEnv = process.env.SPEXCODE_CODEX_SERVER_CMD
  try {
    process.env.SPEXCODE_CODEX_SERVER_CMD = '/custom/codex-server'
    const overridden = codexLaunchCommand('s', '/opt/foo/codex --yolo', undefined, '/tmp/spex-project')
    assert.match(overridden, /internal shared-runtime-spawn [^\n]* \/custom\/codex-server app-server --listen "unix:\/\/\$sock"/)
    // resume still tracks the launcher binary — the override targets ONLY the app-server.
    assert.match(overridden, /exec \/opt\/foo\/codex --yolo [^\n]*--remote/)
  } finally {
    if (prevEnv === undefined) delete process.env.SPEXCODE_CODEX_SERVER_CMD
    else process.env.SPEXCODE_CODEX_SERVER_CMD = prevEnv
  }
})

test('codex app-server socket path is short (sun_path-safe), stable per project, and identical across seams', () => {
  // A realistically DEEP macOS project path — its encodeProject flattening is exactly what blew past the cap.
  const deep = '/Users/lexicalmathical/Codebase/gugu-bloome-acp/some/nested/worktree/checkout'
  const sock = codexAppServerSock(deep)
  // well under macOS's ~104-byte sun_path ceiling (leave real headroom for a long per-user $TMPDIR).
  assert.ok(sock.length < 104, `sock path ${sock.length} chars must stay under 104 (got ${sock})`)
  assert.match(sock, /spexcode-cx-[0-9a-f]{16}\.sock$/)
  // the default base is an OWNED per-uid subdir of tmpdir, NEVER bare tmpdir — codex EPERMs binding a unix
  // socket directly in the shared sticky /tmp on a hardened host (fs.protected_regular=2), so the bare-tmpdir
  // default failed every codex launch out of the box (github#30). The derivation guarantees the dir exists.
  const base = dirname(sock)
  assert.notEqual(base, tmpdir(), 'sock must not sit directly in bare tmpdir')
  assert.equal(base, join(tmpdir(), `spexcode-cx-${process.getuid?.() ?? 0}`))
  assert.ok(statSync(base).isDirectory())
  if (process.getuid) assert.equal(statSync(base).mode & 0o777, 0o700)
  // STABLE per project: same identity → same sock (so launch, liveness, and delivery agree without coordination).
  assert.equal(codexAppServerSock(deep), sock)
  // DISTINCT per project: a different identity → a different sock (one app-server per project, no cross-talk).
  assert.notEqual(codexAppServerSock(deep + '/other'), sock)
  // the launch script embeds EXACTLY the sock that liveness/delivery compute for the same project identity.
  assert.ok(codexLaunchCommand('s', 'codex --yolo', 'codex', deep).includes(sock))
  // SPEXCODE_CODEX_SOCKET_DIR relocates the socket base while keeping the per-project hashed filename.
  const prev = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const override = mkdtempSync(join(tmpdir(), 'cx-base-'))
  try {
    process.env.SPEXCODE_CODEX_SOCKET_DIR = override
    assert.equal(codexAppServerSock(deep), join(override, `spexcode-cx-${sock.match(/spexcode-cx-([0-9a-f]{16})/)![1]}.sock`))
  } finally {
    if (prev === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = prev
    rmSync(override, { recursive: true, force: true })
  }
})

test('codex resumeArg is a --resume marker for the owned thread, empty when none captured', () => {
  // the tail resumeSession() hands launch(): a captured thread id → `--resume <id>` (the launch script resumes that
  // thread directly, the SAME conversation); none → empty (relaunch a fresh thread). It is NOT `resume <id>`,
  // which the launch script would feed to codex-launch as a literal first-turn prompt.
  assert.equal(codexHarness.resumeArg({ session: 's1', harnessSessionId: 'th_abc' }), '--resume th_abc')
  assert.equal(codexHarness.resumeArg({ session: 's1', harnessSessionId: null }), '')
})

test('launchCmd cmd override wins over the ambient default (claude + codex) — the launcher-select seam', () => {
  // a session's persisted launcher command overrides the env→config→default resolution, so resume keeps the
  // same auth. claude returns the base command verbatim; codex embeds it as the TUI command in its launch script.
  assert.equal(claudeHarness.launchCmd('id', undefined, '/opt/reclaude --dangerously-skip-permissions'), '/opt/reclaude --dangerously-skip-permissions')
  const codexCmd = codexHarness.launchCmd('id', '/tmp/spex-proj', 'codex-glm --yolo')
  assert.match(codexCmd, /exec codex-glm --yolo [^\n]*--remote/)
})

test('launcherList + resolveLauncher read the named profiles from spexcode.json, fail loud on an unknown name', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-launchers-'))
  // claude/codex are ORDINARY safe seeded entries (as `spex init` plants them), NOT env-derived built-ins — alongside
  // two custom profiles. harness defaults to claude when omitted; cmd is carried through verbatim.
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({
    sessions: { launchers: {
      claude: { harness: 'claude', cmd: 'claude' },
      codex: { harness: 'codex', cmd: 'codex' },
      reclaude: { cmd: 'reclaude --dangerously-skip-permissions' },
      'claude-glm': { harness: 'claude', cmd: 'claude-glm --dangerously-skip-permissions' },
    } },
  }))
  // Name-sorted, exactly the config's real launchers — no ghost duplicates or derived execution variants.
  assert.deepEqual(launcherList(root), [
    { name: 'claude', harness: 'claude', cmd: 'claude', headless: false },
    { name: 'claude-glm', harness: 'claude', cmd: 'claude-glm --dangerously-skip-permissions', headless: false },
    { name: 'codex', harness: 'codex', cmd: 'codex', headless: false },
    { name: 'reclaude', harness: 'claude', cmd: 'reclaude --dangerously-skip-permissions', headless: false },
  ])
  assert.deepEqual(dashboardLauncherList(root), launcherList(root), 'the four interactive harnesses stay dashboard-visible')
  assert.deepEqual(
    [claudeHarness, codexHarness, opencodeHarness, piHarness].map((h) => h.headless),
    [false, false, false, false],
    'every existing adapter declares the capability explicitly',
  )
  assert.equal(resolveLauncher('claude-glm', root).cmd, 'claude-glm --dangerously-skip-permissions')
  assert.equal(resolveLauncher('codex', root).harness, 'codex')
  assert.throws(() => resolveLauncher('nope', root), /unknown launcher 'nope'/)
})

test('no built-in ghosts: an unseeded config lists NO launchers, and claude/codex are not implicitly resolvable', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-nolaunchers-'))
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ sessions: { maxActive: 4 } }))
  // with no seeded launchers there is nothing to list — the old env-derived built-in claude/codex are gone.
  assert.deepEqual(launcherList(root), [])
  // and `claude`/`codex` are just names like any other: unconfigured → fail loud, never a silent built-in.
  assert.throws(() => resolveLauncher('claude', root), /unknown launcher 'claude'/)
  assert.throws(() => resolveLauncher('codex', root), /unknown launcher 'codex'/)
  assert.throws(() => defaultLauncher(root), /sessions\.defaultLauncher is required/)
  assert.deepEqual(launcherDefault(root), {
    default: null,
    error: 'sessions.defaultLauncher is required for a launch without --launcher; set it in spexcode.json or spexcode.local.json (for example {"sessions":{"defaultLauncher":"claude"}})',
  })
  // seed a claude launcher + name it the default (the shape `spex init` plants) → resolves.
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ sessions: { maxActive: 4, launchers: { claude: { harness: 'claude', cmd: 'claude' } }, defaultLauncher: 'claude' } }))
  assert.equal(defaultLauncher(root), 'claude')
  assert.deepEqual(launcherDefault(root), { default: 'claude', error: null })
})

test('removeManagedBlock strips ONLY the sentinel block, preserving the user bytes', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-mb-'))
  const f = join(proj, 'CLAUDE.md')
  writeFileSync(f, 'my own notes\n\n<!-- spexcode:start -->\nGENERATED CONTRACT\n<!-- spexcode:end -->\n\nmore of my notes\n')
  removeManagedBlock(f, ['<!-- ', ' -->'], true)
  const out = readFileSync(f, 'utf8')
  assert.ok(out.includes('my own notes') && out.includes('more of my notes'))
  assert.ok(!out.includes('spexcode:start') && !out.includes('GENERATED CONTRACT'))
  // a file that carried ONLY the block is deleted when deleteIfEmpty (it was wholly ours).
  const g = join(proj, 'AGENTS.md')
  writeFileSync(g, '<!-- spexcode:start -->\nx\n<!-- spexcode:end -->\n')
  removeManagedBlock(g, ['<!-- ', ' -->'], true)
  assert.ok(!existsSync(g))
})

test('managed-block write→remove is a BYTE-FAITHFUL round-trip (preserves the user\'s own whitespace) — the private⇄default cancel-out invariant', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-mb-rt-'))
  const f = join(proj, '.gitignore')
  // user content carrying an INTERNAL blank-line run — the exact shape a global `\n{3,}→\n\n` collapse mangled
  const G = 'node_modules/\nartifacts/\n\n\n# section two\ndist/\n'
  writeFileSync(f, G)
  writeManagedBlock(f, 'a.sock\nb.json', ['# ', ''])
  assert.ok(readFileSync(f, 'utf8').includes('# spexcode:start'), 'block was written')
  removeManagedBlock(f, ['# ', ''], false)
  assert.equal(readFileSync(f, 'utf8'), G, 'remove must restore the user file BYTE-for-byte (incl the \\n\\n\\n run)')
  // idempotent: writing the same block twice yields one block, identical bytes
  writeManagedBlock(f, 'a.sock\nb.json', ['# ', ''])
  const once = readFileSync(f, 'utf8')
  writeManagedBlock(f, 'a.sock\nb.json', ['# ', ''])
  assert.equal(readFileSync(f, 'utf8'), once, 'writeManagedBlock is idempotent')
})

test('claude clean SURGICALLY removes only spexcode artifacts, sparing user prose + sibling files', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-clean-'))
  // contract file: user prose + our managed block
  const claudeMd = join(proj, 'CLAUDE.md')
  writeFileSync(claudeMd, 'USER PROSE\n\n<!-- spexcode:start -->\ncontract\n<!-- spexcode:end -->\n')
  // our generated shim (carries the dispatch.sh marker) and a user's UNRELATED settings file elsewhere
  mkdirSync(join(proj, '.claude'), { recursive: true })
  const shim = join(proj, '.claude', 'settings.json')
  writeFileSync(shim, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'bash /pkg/hooks/dispatch.sh claude Stop' }] }] } }))
  // a spexcode skill + a USER skill in the same dir; a spexcode agent + a USER agent
  mkdirSync(join(proj, '.claude', 'skills', 'sample-agent'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'skills', 'sample-agent', 'SKILL.md'), 'generated')
  mkdirSync(join(proj, '.claude', 'skills', 'my-skill'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'skills', 'my-skill', 'SKILL.md'), 'mine')
  mkdirSync(join(proj, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(proj, '.claude', 'agents', 'sample-agent.md'), 'generated')
  writeFileSync(join(proj, '.claude', 'agents', 'mine.md'), 'mine')

  claudeHarness.clean(proj, { skills: ['sample-agent'], agents: ['sample-agent'] })

  const md = readFileSync(claudeMd, 'utf8')
  assert.ok(md.includes('USER PROSE') && !md.includes('spexcode:start'))         // prose kept, block gone
  assert.ok(!existsSync(shim))                                                   // our shim deleted
  assert.ok(!existsSync(join(proj, '.claude', 'skills', 'sample-agent')))          // our skill pruned
  assert.ok(existsSync(join(proj, '.claude', 'skills', 'my-skill')))             // user skill spared
  assert.ok(!existsSync(join(proj, '.claude', 'agents', 'sample-agent.md')))       // our agent pruned
  assert.ok(existsSync(join(proj, '.claude', 'agents', 'mine.md')))              // user agent spared
})

test('clean leaves a foreign (non-spexcode) shim file untouched', () => {
  const proj = mkdtempSync(join(tmpdir(), 'spex-clean2-'))
  mkdirSync(join(proj, '.claude'), { recursive: true })
  const shim = join(proj, '.claude', 'settings.json')
  writeFileSync(shim, JSON.stringify({ permissions: { allow: ['Bash'] } }))     // user's own, no dispatch marker
  claudeHarness.clean(proj, { skills: [], agents: [] })
  assert.ok(existsSync(shim))
})

test('codex liveness walks the pane descendant tree, NOT the foreground name or the shared sock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-codex-live-'))
  const rec = { session: 'spex-1', harnessSessionId: 'codex-thread-1' }
  // FIELD-CONFIRMED shapes (Linux + macmini, codex 0.142.5). HEALTHY: the pane's FOREGROUND command is `bash`
  // (the launch.sh wrapper) for the TUI's whole life — the codex processes live BELOW it:
  //   pane bash(100) → bash -lc(101) → node/codex-cli(102) → vendored codex(103).
  // FAILED: launch.sh's bounded retries exhausted, the wrapper exited, the pane sits at the bare shell —
  // NOTHING below the pane pid — while the SHARED per-project app-server socket stays bound.
  writeFileSync(codexAppServerSock(dir), '')   // the sock is present in BOTH shapes — it must not decide
  const healthy = new Map([
    [100, { ppid: 1, comm: 'bash' }], [101, { ppid: 100, comm: 'bash' }],
    [102, { ppid: 101, comm: 'node' }], [103, { ppid: 102, comm: 'codex' }],
  ])
  const failed = new Map([[100, { ppid: 1, comm: 'bash' }], [999, { ppid: 1, comm: 'codex' }]])   // an UNRELATED codex elsewhere on the box must not count
  assert.equal(codexHarness.liveness(rec, true, dir, { panePid: 100, procs: healthy }), 'online')
  assert.equal(codexHarness.liveness({ session: 'spex-1', harnessSessionId: null }, true, dir, { panePid: 100, procs: healthy }), 'online')
  assert.equal(codexHarness.liveness(rec, true, dir, { panePid: 100, procs: failed }), 'offline')  // bare shell → offline despite the sock
  // tmux down → offline even when a stale snapshot still shows the tree
  assert.equal(codexHarness.liveness(rec, false, dir, { panePid: 100, procs: healthy }), 'offline')
  // probe unavailable (tmux/ps couldn't report) → not-live
  assert.equal(codexHarness.liveness(rec, true, dir, undefined), 'offline')
  assert.equal(codexHarness.liveness(rec, true, dir, { panePid: 100 }), 'offline')
  assert.equal(codexHarness.liveness(rec, true, dir, { procs: healthy }), 'offline')
})

test('codex liveness PRIMARY path: the registered agent.pid verdict wins over the ps tree-walk', () => {
  const rec = { session: 'spex-1', harnessSessionId: 'codex-thread-1' }
  // a codex session with a registered agent.pid: `pidAlive` IS the truth — no ps scan, and it OVERRIDES the
  // pane tree. Even a healthy-looking tree reads offline when the registered pid is dead, and a bare-shell tree
  // reads online when the registered pid is alive (the tree is not consulted at all on the pid path).
  const healthy = new Map([[100, { ppid: 1, comm: 'bash' }], [101, { ppid: 100, comm: 'codex' }]])
  const bareShell = new Map([[100, { ppid: 1, comm: 'bash' }]])
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, pidAlive: true, procs: bareShell }), 'online')
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, pidAlive: false, procs: healthy }), 'offline')
  // tmux down → offline regardless of a live registered pid.
  assert.equal(codexHarness.liveness(rec, false, undefined, { pidAlive: true }), 'offline')
  // pidAlive UNDEFINED (a pre-registration session, no agent.pid) → LEGACY tree-walk fallback still decides.
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, procs: healthy }), 'online')
  assert.equal(codexHarness.liveness(rec, true, undefined, { panePid: 100, procs: bareShell }), 'offline')
})

test('claude liveness verifies a LISTENER, not the socket file — tmux up AND socketLive gates online', () => {
  const rec = { session: 'spex-c', harnessSessionId: null }
  // tooth 2: online iff the window is up AND a live listener answered the connect probe (socketLive). A stale
  // socket FILE left by a crashed claude is NOT enough — the caller connect-probes and passes socketLive=false.
  assert.equal(claudeHarness.liveness(rec, true, undefined, undefined, true), 'online')    // window + live listener → online
  assert.equal(claudeHarness.liveness(rec, true, undefined, undefined, false), 'offline')  // window up but NO listener (stale sock / dead claude) → offline
  assert.equal(claudeHarness.liveness(rec, false, undefined, undefined, true), 'offline')  // no window → offline regardless
  assert.equal(claudeHarness.liveness(rec, true, undefined, undefined, undefined), 'offline') // socketLive unknown/absent → not live
})

test('baseCmd resolves the launcher command the pin freezes: the named-launcher cmd wins, else the bare default', () => {
  // A session's pinned launcher cmd is what baseCmd freezes; there is NO env/config-field resolution anymore
  // (launchers are ordinary named config). Plain fallbacks only backstop a truly-old record with no pin.
  assert.equal(claudeHarness.baseCmd('reclaude --pinned'), 'reclaude --pinned')
  assert.equal(claudeHarness.baseCmd(undefined), 'claude')
  assert.equal(codexHarness.baseCmd('codex-glm --yolo'), 'codex-glm --yolo')
  assert.equal(codexHarness.baseCmd(undefined), 'codex')
  assert.equal(opencodeHarness.baseCmd(undefined), 'opencode')
  assert.equal(piHarness.baseCmd(undefined), 'pi')
})

test('rendezvousListening: tri-state — live listener, proven-dead stale file/absent path, unproven timeout', async () => {
  const id = `unit-rv-${process.pid}-${Date.now()}`
  // absent path → 'dead', fast (ENOENT — proven: nothing ever listened here)
  assert.equal(await rendezvousListening(id, 500), 'dead')
  // a real listener on the id's rvSock → 'live'
  const srv = createServer(() => {})
  await new Promise<void>((res) => srv.listen(rvSock(id), () => res()))
  try {
    assert.equal(await rendezvousListening(id, 500), 'live')
    // a TIMEOUT is UNPROVEN, never dead (issue #40): block the prober's own event loop past the probe budget,
    // so the expired timer fires before the pending connect event — the exact thrashed-backend condition that
    // read every live worker as offline. The listener here is LIVE the whole time.
    const p = rendezvousListening(id, 50)
    const until = Date.now() + 150
    while (Date.now() < until) { /* block the loop past the 50ms probe budget */ }
    assert.equal(await p, 'unproven')
  } finally {
    await new Promise<void>((res) => srv.close(() => res()))
  }
  // after close the socket FILE lingers but nothing listens → 'dead' (the exact stale-file case: ECONNREFUSED)
  if (existsSync(rvSock(id))) assert.equal(await rendezvousListening(id, 500), 'dead')
})

test('a rendezvous path is a launch-time FACT: stamped per runtime, legacy for whatever launched before it', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-rv-stamp-'))
  const prev = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try {
    const id = `unit-stamp-${process.pid}-${Date.now()}`
    // nothing stamped → the UNSCOPED path a pre-stamp launch really bound. A running agent must never be
    // re-addressed by a formula it never heard of; that is what keeps the change from stranding the fleet.
    assert.equal(rvSock(id), legacyRvSock(id))
    // launch records the path THIS runtime hands the agent, and every later reader gets exactly that one
    const stamped = stampRvSock(id)
    assert.equal(rvSock(id), stamped)
    assert.notEqual(stamped, legacyRvSock(id))
    // the same id in ANOTHER runtime is a DIFFERENT socket: two worlds (a fixture, a copied record) hold one
    // id all the time — they must never share one transport, which is what let a foreign teardown reach in.
    assert.notEqual(scopedRvSock(id, '/runtime/a'), scopedRvSock(id, '/runtime/b'))
    assert.ok(stamped.length < 104, `sun_path-safe on macOS too (${stamped.length})`)
  } finally {
    if (prev === undefined) delete process.env.SPEXCODE_HOME; else process.env.SPEXCODE_HOME = prev
    rmSync(home, { recursive: true, force: true })
  }
})

test('cleanupRuntime sweeps a transport it PROVED dead, and never one still answering', async () => {
  // (a) the ordinary teardown: the agent is killed and does NOT unlink its own path, so the file lingers with
  // nothing behind it. THAT residue is ours — close must leave zero socket behind (the acceptance matrix's
  // close row).
  const dead = `unit-cleanup-dead-${process.pid}-${Date.now()}`
  writeFileSync(rvSock(dead), '')                  // a path nothing listens on → connect ECONNREFUSED = proven dead
  await claudeHarness.cleanupRuntime({ session: dead })
  assert.equal(existsSync(rvSock(dead)), false, 'a proven-dead socket is swept')

  // (b) the FOREIGN teardown: the same id names a LIVE agent (an isolated instance — its own SPEXCODE_HOME and
  // SPEXCODE_TMUX — closing an id that is running here; its kill-session misses because tmux IS namespaced,
  // while this unlink would land because the socket path is not). Unlinking strands that agent permanently:
  // still bound, unreachable by any connect, undeliverable, and reading `offline` to every prober.
  const live = `unit-cleanup-live-${process.pid}-${Date.now()}`
  const srv = createServer(() => {})
  await new Promise<void>((res) => srv.listen(rvSock(live), () => res()))
  try {
    await claudeHarness.cleanupRuntime({ session: live })
    assert.ok(existsSync(rvSock(live)), 'a socket with a live listener is not ours to unlink')
    assert.equal(await rendezvousListening(live, 500), 'live', 'and the agent behind it stays reachable')
  } finally {
    await new Promise<void>((res) => srv.close(() => res()))
    rmSync(rvSock(live), { force: true })
  }
})

test('paneTreeRunsCodex: codex-ish descendants read live; a bare/unrelated tree does not', () => {
  const base = new Map([[10, { ppid: 1, comm: 'bash' }]])
  // any codex spelling — the plain binary, a vendored name, or the CLI's node runtime — anywhere below the pane
  for (const comm of ['codex', 'codex-x86_64-unknown-linux-musl', 'node']) {
    const procs = new Map([...base, [11, { ppid: 10, comm: 'bash' }], [12, { ppid: 11, comm }]])
    assert.equal(paneTreeRunsCodex({ panePid: 10, procs }), true, comm)
  }
  // macOS ps may report comm as a full path — match on the basename
  const macish = new Map([...base, [11, { ppid: 10, comm: '/usr/local/bin/node' }]])
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: macish }), true)
  // the pane pid ITSELF being codex-named must not be needed — but a bare shell with non-codex children is dead
  const deadish = new Map([...base, [11, { ppid: 10, comm: 'sleep' }]])
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: deadish }), false)
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: base }), false)          // nothing below the pane
  assert.equal(paneTreeRunsCodex(undefined), false)
  assert.equal(paneTreeRunsCodex({ panePid: 10, procs: new Map() }), false)
})

// [[harness-adapter]] — the UNCONDITIONAL codex trust write must be duplicate-SAFE: codex refuses to load a
// config.toml with a duplicate key, so a pre-existing bare `[projects."<proj>"]` (codex auto-writes one on an
// interactive trust) or an old-format sentinel block MUST be stripped before we write, else we append a second
// key and take codex fully offline (the public-vps outage). Also idempotent, and it leaves OTHER projects alone.
test('writeCodexTrust strips ALL prior trust for the project (bare + old-format) → no duplicate key, idempotent, other projects untouched', () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-cxhome-'))
  const proj = '/tmp/spex-proj-x'
  const hooksJson = `${proj}/.codex/hooks.json`
  const orig = { ...process.env }
  process.env.CODEX_HOME = home
  try {
    // a config that ALREADY carries: another project's trust (keep), a BARE codex-auto trust for OUR project
    // (the killer), an OLD-format sentinel block for OUR project, and a stray hooks.state for our hooksJson.
    writeFileSync(join(home, 'config.toml'),
      `model = "gpt-5.5"\n\n` +
      `[projects."/other/keep"]\ntrust_level = "trusted"\n\n` +
      `[projects."${proj}"]\ntrust_level = "trusted"\n\n` +
      `# spexcode:trust:${proj} (OLD FORMAT)\n[hooks.state."${hooksJson}:stop:0:0"]\ntrusted_hash = "sha256:stale"\n\n` +
      `[hooks.state."/other/keep/.codex/hooks.json:stop:0:0"]\ntrusted_hash = "sha256:keepme"\n`)

    const cmdFor = (e: string) => `spex dispatch ${e}`
    writeCodexTrust(proj, ['SessionStart', 'Stop'], cmdFor)
    let cfg = readFileSync(join(home, 'config.toml'), 'utf8')

    const projKeys = (s: string, p: string) => (s.match(new RegExp(`^\\[projects\\."${p.replace(/[/.]/g, '\\$&')}"\\]$`, 'gm')) || []).length
    assert.equal(projKeys(cfg, proj), 1, 'exactly ONE [projects."<proj>"] — no duplicate key')
    assert.equal(projKeys(cfg, '/other/keep'), 1, "other project's trust preserved")
    assert.ok(cfg.includes('trusted_hash = "sha256:keepme"'), "other project's hooks.state preserved")
    assert.ok(!cfg.includes('sha256:stale'), 'stale hooks.state for our hooksJson removed')
    assert.ok(cfg.includes(`# spexcode:trust:${proj} (managed — do not edit)`), 'our current sentinel present')
    // per-hook hash count for our hooksJson: exactly the 2 events we wrote (no dup, no leftover)
    assert.equal((cfg.match(new RegExp(`\\[hooks\\.state\\."${hooksJson.replace(/[/.]/g, '\\$&')}:`, 'g')) || []).length, 2, 'exactly our 2 hooks.state entries')

    // idempotent: a second write does not grow the config or add a duplicate
    writeCodexTrust(proj, ['SessionStart', 'Stop'], cmdFor)
    const cfg2 = readFileSync(join(home, 'config.toml'), 'utf8')
    assert.equal(projKeys(cfg2, proj), 1, 're-write keeps exactly ONE project key (idempotent)')
    assert.equal(cfg2, cfg, 're-write is byte-identical (idempotent)')
  } finally {
    process.env = orig
  }
})

// A fake rendezvous daemon replicating the REAL one's load-bearing semantics (extracted from the claude
// binary): ONE connection at a time — a new connect destroys the previous socket, discarding its unparsed
// buffer — and a synchronous line loop that answers `repaint` with `repaint-done` (the in-order parse barrier
// deliver leans on). `kickFirst` simulates a liveness probe landing in the write→parse window: the first
// delivery connection is destroyed with its chunk unread.
function fakeRvDaemon(id: string, opts: { kickFirst?: boolean; silent?: boolean; reject?: boolean } = {}) {
  const replies: string[] = []
  let conns = 0
  let prev: import('node:net').Socket | undefined
  const srv = createServer((c) => {
    conns++
    prev?.destroy()
    prev = c
    c.on('error', () => {})
    if (opts.kickFirst && conns === 1) { setTimeout(() => c.destroy(), 20); return }
    if (opts.silent) return
    let buf = ''
    c.on('data', (d) => {
      buf += d.toString('utf8')
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        const m = JSON.parse(line) as { type?: string; text?: string }
        if (opts.reject) { c.write('{"type":"reply-rejected"}\n'); continue }
        if (m.type === 'reply') replies.push(m.text ?? '')
        if (m.type === 'repaint') c.write('{"type":"repaint-done"}\n')
      }
    })
  })
  return {
    replies,
    connCount: () => conns,
    listen: () => new Promise<void>((res) => srv.listen(rvSock(id), () => res())),
    // destroy the lingering last connection first: a silent daemon never reads, so its server-side socket
    // outlives the client's destroy and srv.close() would wait on it forever.
    close: () => new Promise<void>((res) => { prev?.destroy(); srv.close(() => res()) }),
  }
}

test('deliverViaRendezvous: repaint-done confirms the parse — ok, one reply, one connection', async () => {
  const id = `unit-rvd-ok-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id)
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'hello 多行\nsecond line')
    assert.equal(r.ok, true)
    assert.deepEqual(d.replies, ['hello 多行\nsecond line'])
    assert.equal(d.connCount(), 1)
  } finally { await d.close() }
})

test('deliverViaRendezvous: a kicked connection (probe race) is a PROVEN whole-chunk loss — resends, lands exactly once', async () => {
  const id = `unit-rvd-kick-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id, { kickFirst: true })
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'survives the kick')
    assert.equal(r.ok, true, JSON.stringify(r))
    // the whole point: the prompt lands EXACTLY once — the retry cannot duplicate because the kick proved
    // the atomic chunk was never parsed (the old optimistic write returned ok:true here and the prompt vanished)
    assert.deepEqual(d.replies, ['survives the kick'])
    assert.ok(d.connCount() >= 2, `expected a resend, got ${d.connCount()} connection(s)`)
  } finally { await d.close() }
})

test('deliverViaRendezvous: a silent-but-open daemon is BUSY, not lost — wall expiry reports optimistic ok, no retry storm', async () => {
  const id = `unit-rvd-wall-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id, { silent: true })
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'busy claude', 250)
    assert.equal(r.ok, true)
    assert.equal(d.connCount(), 1, 'wall expiry is ok, never a kick retry')
  } finally { await d.close() }
})

test('deliverViaRendezvous: reply-rejected fails LOUD and is not retried', async () => {
  const id = `unit-rvd-rej-${process.pid}-${Date.now()}`
  const d = fakeRvDaemon(id, { reject: true })
  await d.listen()
  try {
    const r = await deliverViaRendezvous(id, 'gated')
    assert.equal(r.ok, false)
    assert.match(r.error ?? '', /rejected/)
    assert.equal(d.connCount(), 1)
  } finally { await d.close() }
})

test('deliverViaRendezvous: no socket at all fails loud before any connect', async () => {
  const r = await deliverViaRendezvous(`unit-rvd-none-${process.pid}-${Date.now()}`, 'nobody home')
  assert.equal(r.ok, false)
  assert.match(r.error ?? '', /no rendezvous control socket/)
})

test('claude deliveryBlockedBy: the sessions panel refuses with the recovery named; a composer pane passes', () => {
  const guard = claudeHarness.deliveryBlockedBy
  assert.ok(guard, 'claude carries the pane guard')
  // the panel's two signatures — the new-session composer placeholder, and the footer hint PAIR
  assert.match(guard('Needs input\n❯ describe a task for a new session\n') ?? '', /sessions panel/)
  assert.match(guard('⏵⏵ bypass permissions · enter to return · space to reply · ctrl+x to delete') ?? '', /press Enter/)
  // a normal composer (even mentioning agents in the footer) is NOT the panel
  assert.equal(guard('❯ draft text here\n  -- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'), null)
  // a footer hint ALONE (one string, not the pair) is not enough to refuse
  assert.equal(guard('some prose that says enter to return somewhere'), null)
})

test('a codex thread is created carrying its session identity, and the visible TUI re-establishes it', () => {
  // A codex tool shell is a child of the SHARED app-server, so it can inherit no session id — and must not,
  // that leak was github#76. codex's own `shell_environment_policy.set` gives the thread its identity instead,
  // through the ONE channel that reaches a thread: thread/start's config override map (verified live — the
  // thread's shell reports exactly the injected record id, with nothing of the launcher's env).
  const params = codexStartThreadParams('/wt', true, { SPEXCODE_SESSION_ID: 'rec-42' }) as {
    cwd: string; config: { bypass_hook_trust: boolean; shell_environment_policy: { set: Record<string, string> } }
  }
  assert.equal(params.cwd, '/wt')
  assert.equal(params.config.bypass_hook_trust, true)
  assert.deepEqual(params.config.shell_environment_policy.set, { SPEXCODE_SESSION_ID: 'rec-42' })
  // no identity to inject → no policy key at all (an override map we do not need is one we do not send)
  assert.deepEqual(codexStartThreadParams('/wt', false), { cwd: '/wt' })
  // the TUI is the other entry point that creates a context for this session — same rule, same knob
  const cmd = codexLaunchCommand('rec-42', 'codex --yolo', 'codex', '/tmp/spex-project')
  assert.match(cmd, /-c '\\''shell_environment_policy\.set\.SPEXCODE_SESSION_ID=rec-42'\\'' --remote unix:\/\/"\$sock" resume "\$tid"/)
})
