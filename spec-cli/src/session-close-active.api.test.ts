import { fixtureTempDir } from '../test/fixtures/temp-dir.js'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { codexAppServerPid, codexAppServerReceipt, codexAppServerSock } from './codex-harness.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'
import { initializeFreshSessionApplication } from './session-application.js'
import { processStartToken } from '@spexcode/spec-core'

const here = dirname(fileURLToPath(import.meta.url))

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    once(child, 'exit').then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

async function stopDetachedOwner(owner: ReturnType<typeof spawnDetachedRuntime> | null): Promise<void> {
  if (!owner || processStartToken(owner.pid) !== owner.startToken) return
  try { process.kill(owner.pid, 'SIGTERM') } catch { /* already exited */ }
  for (let i = 0; i < 50 && processStartToken(owner.pid) === owner.startToken; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}



async function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'cli.ts'), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const [code] = await once(child, 'exit') as [number | null]
  return { code, stdout, stderr }
}

// `cwd` is the worktree the thread was started in: the real app-server records it on every row, and the cold
// proof reads the target's own rows through it ([[codex-runtime]]).
type CodexFixtureThread = { id: string; cwd: string; presence: 'unknown' | 'idle' | 'active'; archived: boolean; loaded: boolean; parentThreadId?: string }

// The real server keeps a rollout for every thread and moves it into `archived_sessions/` on archive; the cold
// proof witnesses a member the listing does not return through that file ([[codex-runtime]]), so the fixture
// keeps the same shape.
function codexRpcFixture(threads: Map<string, CodexFixtureThread>, options: { falseEmptyCwd: boolean; archiveRollout?: (threadId: string) => void }): net.Server {
  return net.createServer((socket) => {
    let buffer = Buffer.alloc(0)
    let upgraded = false
    const send = (value: unknown) => {
      const payload = Buffer.from(JSON.stringify(value))
      const header = payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff])
      socket.write(Buffer.concat([header, payload]))
    }
    const status = (presence: CodexFixtureThread['presence']) => ({ type: presence === 'unknown' ? 'notLoaded' : presence })
    // Filters apply as the real server applies them. This fixture's trees are one level deep, so the ancestor
    // closure and the direct children of a thread are the same rows.
    const list = (params: { archived?: boolean; ancestorThreadId?: string; parentThreadId?: string; cwd?: string } = {}) => options.falseEmptyCwd && params.cwd
      ? []
      : [...threads.values()]
      .filter((thread) => thread.archived === (params.archived === true))
      .filter((thread) => !params.ancestorThreadId || thread.parentThreadId === params.ancestorThreadId)
      .filter((thread) => !params.parentThreadId || thread.parentThreadId === params.parentThreadId)
      .filter((thread) => !params.cwd || thread.cwd === params.cwd)
      .map((thread) => ({ id: thread.id, cwd: thread.cwd, ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}), status: status(thread.presence) }))
    const handle = (message: { id?: number; method?: string; params?: { archived?: boolean; ancestorThreadId?: string; parentThreadId?: string; cwd?: string; threadId?: string } }) => {
      if (message.method === 'initialize') return send({ id: message.id, result: {} })
      if (message.method === 'initialized') return
      if (message.method === 'thread/loaded/list') return send({ id: message.id, result: { data: [...threads.values()].filter((thread) => thread.loaded).map((thread) => ({ id: thread.id })), nextCursor: null } })
      if (message.method === 'thread/turns/list') return send({ id: message.id, result: { data: [], nextCursor: null } })
      if (message.method === 'thread/list') return send({ id: message.id, result: { data: list(message.params), nextCursor: null } })
      if (message.method === 'thread/archive') {
        const thread = threads.get(message.params?.threadId || '')
        if (!thread) return send({ id: message.id, error: { message: 'unknown fixture thread' } })
        thread.archived = true
        thread.loaded = false
        options.archiveRollout?.(thread.id)
        return send({ id: message.id, result: {} })
      }
      return send({ id: message.id, error: { message: `unexpected RPC ${message.method}` } })
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
}

test('close refuses active native turns and missing evidence while retaining records', { timeout: 30_000 }, async () => {
  const fixture = fixtureTempDir('spex-codex-rollout-close-')
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const codexHome = join(fixture, 'codex-home')
  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  const sessions = join(runtime, 'sessions')
  const socketDir = join(fixture, 'sockets')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const bin = join(fixture, 'bin')
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  const previousDatabasePath = process.env.SPEX_SESSION_DATABASE_PATH
  process.env.SPEXCODE_CODEX_SOCKET_DIR = socketDir
  process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  const threads = new Map<string, CodexFixtureThread>()
  const rolloutDir = join(codexHome, 'sessions', '2026', '08', '13')
  const archivedRollouts = join(codexHome, 'archived_sessions')
  const rolloutFile = (threadId: string) => `rollout-2026-08-13-${threadId}.jsonl`
  // A rollout as the real server writes it: a session_meta header binding the thread's cwd (and parent for a
  // spawned child), then the terminal record of its settled turn.
  const writeRollout = (thread: CodexFixtureThread) => {
    mkdirSync(rolloutDir, { recursive: true })
    const header = { type: 'session_meta', payload: { id: thread.id, cwd: thread.cwd, ...(thread.parentThreadId ? { parent_thread_id: thread.parentThreadId } : {}) } }
    writeFileSync(join(rolloutDir, rolloutFile(thread.id)), `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } })}\n`)
  }
  const options = {
    falseEmptyCwd: false,
    archiveRollout: (threadId: string) => {
      const from = join(rolloutDir, rolloutFile(threadId))
      if (!existsSync(from)) return
      mkdirSync(archivedRollouts, { recursive: true })
      renameSync(from, join(archivedRollouts, rolloutFile(threadId)))
    },
  }
  const server = codexRpcFixture(threads, options)
  let owner: ReturnType<typeof spawnDetachedRuntime> | null = null
  let backend: ChildProcess | null = null
  try {
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({ harnesses: ['codex'] }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'archive@example.test')
    git(project, 'config', 'user.name', 'Archive Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'tmux'), 0o755)
    const socket = codexAppServerSock(runtime)
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve) })
    owner = spawnDetachedRuntime({
      cwd: runtime,
      logFile: join(runtime, 'codex-owner.log'),
      pidFile: codexAppServerPid(runtime),
      receiptFile: codexAppServerReceipt(runtime),
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
    })
    const application = initializeFreshSessionApplication()
    const worktreeOf = new Map<string, string>()
    const writeRecord = (id: string, threadId: string) => {
      const dir = join(sessions, id)
      const worktree = join(fixture, `${id}-worktree`)
      const branch = `node/${id}`
      git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'runtime.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: worktree, branch,
        title: '', name: '', parent: '', status: 'awaiting', proposal: '', merges: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: threadId,
        stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
      }, null, 2) + '\n')
      application.createSession({ sessionId: id, status: 'awaiting', proposal: 'nothing' })
      worktreeOf.set(id, worktree)
      return join(dir, 'runtime.json')
    }
    const settledId = 'rollout-settled-close'
    const settledThread = 'rollout-settled-thread'
    const settledRecord = writeRecord(settledId, settledThread)
    threads.set(settledThread, { id: settledThread, cwd: worktreeOf.get(settledId)!, presence: 'unknown', archived: false, loaded: true })
    const activeId = 'rollout-active-close'
    const activeThread = 'rollout-active-thread'
    const activeChild = 'rollout-active-child'
    const activeRecord = writeRecord(activeId, activeThread)
    threads.set(activeThread, { id: activeThread, cwd: worktreeOf.get(activeId)!, presence: 'idle', archived: false, loaded: true })
    threads.set(activeChild, { id: activeChild, cwd: worktreeOf.get(activeId)!, presence: 'active', archived: false, loaded: true, parentThreadId: activeThread })
    const falseEmptyId = 'false-empty-cwd-close'
    const falseEmptyThread = 'false-empty-cwd-thread'
    const falseEmptyChild = 'false-empty-cwd-child'
    const falseEmptyRecord = writeRecord(falseEmptyId, falseEmptyThread)
    threads.set(falseEmptyThread, { id: falseEmptyThread, cwd: worktreeOf.get(falseEmptyId)!, presence: 'idle', archived: false, loaded: true })
    threads.set(falseEmptyChild, { id: falseEmptyChild, cwd: worktreeOf.get(falseEmptyId)!, presence: 'idle', archived: false, loaded: true, parentThreadId: falseEmptyThread })
    // the cwd listing answers empty, so both members are witnessed through their rollouts
    writeRollout(threads.get(falseEmptyThread)!)
    writeRollout(threads.get(falseEmptyChild)!)
    const missingId = 'rollout-missing-close'
    const missingThread = 'rollout-missing-thread'
    const missingRecord = writeRecord(missingId, missingThread)
    threads.set(missingThread, { id: missingThread, cwd: worktreeOf.get(missingId)!, presence: 'unknown', archived: false, loaded: true })
    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_CODEX_SOCKET_DIR: socketDir,
      CODEX_HOME: codexHome,
      SPEXCODE_TMUX: `spex-codex-rollout-close-${port}`,
    }
    delete env.SPEXCODE_API_URL
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
      cwd: project,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), `backend health\n${log}`)

    const rollout = join(rolloutDir, rolloutFile(settledThread))
    mkdirSync(dirname(rollout), { recursive: true })
    writeFileSync(rollout, `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } })}\n`)
    const settled = await runCli(['session', 'close', settledId, '--api', base], project, env)
    assert.equal(settled.code, 0, `${settled.stdout}\n${settled.stderr}`)
    assert.equal(existsSync(settledRecord), true, 'soft close retains the public record after a terminal rollout tail')

    options.falseEmptyCwd = true
    const falseEmpty = await runCli(['session', 'close', falseEmptyId, '--api', base], project, env)
    options.falseEmptyCwd = false
    assert.equal(falseEmpty.code, 0, `${falseEmpty.stdout}\n${falseEmpty.stderr}`)
    assert.equal(JSON.parse(readFileSync(falseEmptyRecord, 'utf8')).archived, true, 'the real close publishes its retained archived record')
    assert.equal(existsSync(worktreeOf.get(falseEmptyId)!), false, 'the real close removes the worktree after native cold proof')
    assert.equal(threads.get(falseEmptyThread)?.archived, true)
    assert.equal(threads.get(falseEmptyChild)?.archived, true)

    const activeBefore = readFileSync(activeRecord, 'utf8')
    const active = await runCli(['session', 'close', activeId, '--api', base], project, env)
    assert.notEqual(active.code, 0)
    assert.match(`${active.stdout}\n${active.stderr}`, new RegExp(`Codex subtree member ${activeChild} has an active turn`))
    assert.equal(existsSync(activeRecord), true, 'a live native active turn keeps the exact old refusal and record')
    assert.equal(readFileSync(activeRecord, 'utf8'), activeBefore, 'active-turn refusal does not rewrite the record')
    assert.equal(existsSync(join(fixture, `${activeId}-worktree`)), true, 'active-turn refusal keeps the worktree')
    assert.match(spawnSync('git', ['show-ref', '--verify', `refs/heads/node/${activeId}`], { cwd: project, encoding: 'utf8' }).stdout,
      new RegExp(`refs/heads/node/${activeId}`), 'active-turn refusal keeps the branch')
    assert.notEqual(spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/spex-archive/${activeId}`], { cwd: project }).status, 0,
      'active-turn refusal publishes no archive ref')

    const missing = await runCli(['session', 'close', missingId, '--api', base], project, env)
    assert.notEqual(missing.code, 0)
    assert.match(`${missing.stdout}\n${missing.stderr}`, /live Codex client/)
    assert.match(`${missing.stdout}\n${missing.stderr}`, /rollout is missing/)
    assert.equal(existsSync(missingRecord), true, 'unknown live state without a terminal rollout remains a refusal')
  } finally {
    await stopChild(backend)
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await stopDetachedOwner(owner)
    if (previousSocketDir === undefined) delete process.env.SPEXCODE_CODEX_SOCKET_DIR
    else process.env.SPEXCODE_CODEX_SOCKET_DIR = previousSocketDir
    if (previousDatabasePath === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabasePath
    rmSync(fixture, { recursive: true, force: true })
  }
})
