import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { codexAppServerPid, codexAppServerReceipt, codexAppServerSock, listenerAt } from './harness.js'
import { spawnDetachedRuntime } from './runtime-ownership.js'
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

function processAlive(child: ChildProcess): boolean {
  if (!child.pid) return false
  try { process.kill(child.pid, 0); return true } catch { return false }
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [join(here, '..', 'bin', 'spex.mjs'), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
  child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const [code] = await once(child, 'exit') as [number | null]
  return { code, stdout, stderr }
}

type CodexFixtureThread = { id: string; presence: 'unknown' | 'idle' | 'active'; archived: boolean; loaded: boolean; parentThreadId?: string }

function codexRpcFixture(threads: Map<string, CodexFixtureThread>): net.Server {
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
    const list = (archived: boolean, ancestorThreadId?: unknown) => [...threads.values()]
      .filter((thread) => thread.archived === archived && (!ancestorThreadId || thread.parentThreadId === ancestorThreadId))
      .map((thread) => ({ id: thread.id, ...(thread.parentThreadId ? { parentThreadId: thread.parentThreadId } : {}), status: status(thread.presence) }))
    const handle = (message: { id?: number; method?: string; params?: { archived?: boolean; ancestorThreadId?: string; threadId?: string } }) => {
      if (message.method === 'initialize') return send({ id: message.id, result: {} })
      if (message.method === 'initialized') return
      if (message.method === 'thread/loaded/list') return send({ id: message.id, result: { data: [...threads.values()].filter((thread) => thread.loaded).map((thread) => ({ id: thread.id })), nextCursor: null } })
      if (message.method === 'thread/turns/list') return send({ id: message.id, result: { data: [], nextCursor: null } })
      if (message.method === 'thread/list') return send({ id: message.id, result: { data: list(message.params?.archived === true, message.params?.ancestorThreadId), nextCursor: null } })
      if (message.method === 'thread/archive') {
        const thread = threads.get(message.params?.threadId || '')
        if (!thread) return send({ id: message.id, error: { message: 'unknown fixture thread' } })
        thread.archived = true
        thread.loaded = false
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

test('CLI close settles an unknown Codex member from rollout without weakening active or missing-evidence refusals', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-codex-rollout-close-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const codexHome = join(fixture, 'codex-home')
  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  const sessions = join(runtime, 'sessions')
  const socketDir = join(fixture, 'sockets')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const bin = join(fixture, 'bin')
  const previousSocketDir = process.env.SPEXCODE_CODEX_SOCKET_DIR
  process.env.SPEXCODE_CODEX_SOCKET_DIR = socketDir
  const threads = new Map<string, CodexFixtureThread>()
  const server = codexRpcFixture(threads)
  let owner: ReturnType<typeof spawnDetachedRuntime> | null = null
  let backend: ChildProcess | null = null
  try {
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['codex'] }, null, 2) + '\n')
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
    const writeRecord = (id: string, threadId: string) => {
      const dir = join(sessions, id)
      const worktree = join(fixture, `${id}-worktree`)
      const branch = `node/${id}`
      git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: worktree, branch,
        node: 'archive', title: '', name: '', parent: '', status: 'awaiting', proposal: '', merges: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: threadId,
        stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
      }, null, 2) + '\n')
      return join(dir, 'session.json')
    }
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

    const settledId = 'rollout-settled-close'
    const settledThread = 'rollout-settled-thread'
    const settledRecord = writeRecord(settledId, settledThread)
    threads.set(settledThread, { id: settledThread, presence: 'unknown', archived: false, loaded: true })
    const rollout = join(codexHome, 'sessions', '2026', '08', '13', `rollout-2026-08-13-${settledThread}.jsonl`)
    mkdirSync(dirname(rollout), { recursive: true })
    writeFileSync(rollout, `${JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete' } })}\n`)
    const settled = await runCli(['session', 'close', settledId, '--api', base], project, env)
    assert.equal(settled.code, 0, `${settled.stdout}\n${settled.stderr}`)
    assert.equal(existsSync(settledRecord), false, 'a terminal rollout tail lets the actual close retire the vanished member')

    const activeId = 'rollout-active-close'
    const activeThread = 'rollout-active-thread'
    const activeChild = 'rollout-active-child'
    const activeRecord = writeRecord(activeId, activeThread)
    threads.set(activeThread, { id: activeThread, presence: 'idle', archived: false, loaded: true })
    threads.set(activeChild, { id: activeChild, presence: 'active', archived: false, loaded: true, parentThreadId: activeThread })
    const active = await runCli(['session', 'close', activeId, '--api', base], project, env)
    assert.notEqual(active.code, 0)
    assert.match(`${active.stdout}\n${active.stderr}`, new RegExp(`Codex subtree member ${activeChild} has an active turn`))
    assert.equal(existsSync(activeRecord), true, 'a live native active turn keeps the exact old refusal and record')

    const missingId = 'rollout-missing-close'
    const missingThread = 'rollout-missing-thread'
    const missingRecord = writeRecord(missingId, missingThread)
    threads.set(missingThread, { id: missingThread, presence: 'unknown', archived: false, loaded: true })
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
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('public HTTP and CLI cold close retire only receipt-proven PID reuse', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-public-cold-close-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const bin = join(fixture, 'bin')
  let backend: ChildProcess | null = null
  let unrelated: ChildProcess | null = null
  let owned: ChildProcess | null = null
  try {
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'archive@example.test')
    git(project, 'config', 'user.name', 'Archive Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    mkdirSync(bin)
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'tmux'), 0o755)

    const sessions = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    const closeLedger = join(home, 'projects', project.replace(/[/.]/g, '-'), 'session-close-ledger.ndjson')
    const writeColdRecord = (id: string, pid: number, startToken?: string) => {
      const dir = join(sessions, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'session.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: join(fixture, `${id}-absent`), branch: '',
        node: 'archive', title: '', name: '', parent: '', status: 'awaiting', proposal: '', merges: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
        stopped: true, archived: true, cold_proof: `cold-v1|claude|${id}|no-resident-ref`,
        adapter_recovery: '', launcher: 'claude', launch_cmd: 'claude', launch_owner: '',
      }, null, 2) + '\n')
      writeFileSync(join(dir, 'agent.pid'), `${pid}\n`)
      if (startToken) writeFileSync(join(dir, 'agent.identity.json'), `${JSON.stringify({
        version: 1, kind: 'session-leaf', sessionId: id, pid, startToken,
      })}\n`)
      return join(dir, 'session.json')
    }

    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: `spex-public-cold-close-${port}`,
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

    const forgedId = 'cold-close-forged-source-public'
    const forgedRecord = writeColdRecord(forgedId, 0)
    const forged = await fetch(`${base}/api/sessions/${forgedId}/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'session', id: 'a-real-looking-but-untrusted-session' } }),
    })
    assert.equal(forged.status, 409, 'the route rejects an authoritative-looking caller-supplied session id')
    assert.equal(existsSync(forgedRecord), true)
    assert.equal(existsSync(closeLedger), false, 'a forged source is rejected before any close audit is written')

    const reusedId = 'cold-close-reused-public'
    unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    assert.ok(unrelated.pid)
    await waitFor(() => !!processStartToken(unrelated!.pid!), 'unrelated PID start identity')
    const unrelatedStart = processStartToken(unrelated.pid)!
    const reusedRecord = writeColdRecord(reusedId, unrelated.pid, `retired-${unrelatedStart}`)
    const closed = await fetch(`${base}/api/sessions/${reusedId}/close`, { method: 'POST' })
    assert.equal(closed.status, 200)
    assert.deepEqual(await closed.json(), { ok: true })
    assert.equal(existsSync(reusedRecord), false)
    assert.equal(processAlive(unrelated), true, 'HTTP cold close never signals the unrelated PID')
    let closeEvents = readFileSync(closeLedger, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(closeEvents.length, 1)
    assert.equal(closeEvents[0]?.action, 'close-authorized')
    assert.deepEqual(closeEvents[0]?.source, { kind: 'user' }, 'an HTTP/dashboard close records no session claim')
    assert.equal(closeEvents[0]?.target?.id, reusedId)

    const cliId = 'cold-close-cli-public'
    const cliRecord = writeColdRecord(cliId, unrelated.pid, `retired-${unrelatedStart}`)
    const cliSuccess = spawnSync(process.execPath, [
      join(here, '..', 'bin', 'spex.mjs'), 'session', 'close', cliId, '--api', base,
    ], { cwd: project, env: { ...env, SPEXCODE_SESSION_ID: 'nonexistent-session-claim' }, encoding: 'utf8' })
    assert.equal(cliSuccess.status, 0, `${cliSuccess.stdout}\n${cliSuccess.stderr}`)
    assert.equal(existsSync(cliRecord), false)
    assert.equal(processAlive(unrelated), true, 'CLI cold close never signals the unrelated PID')
    closeEvents = readFileSync(closeLedger, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(closeEvents.length, 2)
    assert.deepEqual(closeEvents[1]?.source, { kind: 'unverified-session-claim', id: 'nonexistent-session-claim' },
      'a nonexistent CLI id remains an explicit unverified claim rather than trusted attribution')
    assert.equal(closeEvents[1]?.target?.id, cliId)

    const ownedId = 'cold-close-owned-public'
    owned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', ownedId], { stdio: 'ignore' })
    assert.ok(owned.pid)
    await waitFor(() => !!processStartToken(owned!.pid!), 'owned PID start identity')
    const ownedRecord = writeColdRecord(ownedId, owned.pid, processStartToken(owned.pid)!)
    const cli = spawnSync(process.execPath, [
      join(here, '..', 'bin', 'spex.mjs'), 'session', 'close', ownedId, '--api', base,
    ], { cwd: project, env, encoding: 'utf8' })
    assert.notEqual(cli.status, 0)
    assert.match(`${cli.stdout}\n${cli.stderr}`, /target leaf PID .* live or recycled/u)
    assert.equal(existsSync(ownedRecord), true)
    assert.equal(processAlive(owned), true, 'CLI refusal never signals the owned PID')
    assert.equal(readFileSync(closeLedger, 'utf8').trim().split('\n').length, closeEvents.length,
      'a refused live close does not create a terminal-close audit event')

  } finally {
    await stopChild(backend)
    await stopChild(unrelated)
    await stopChild(owned)
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('public close cold-retires a live owned runtime before deletion and refuses an unowned one', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-public-live-close-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const bin = join(fixture, 'bin')
  const tmuxServer = `spex-public-live-close-${process.pid}-${Date.now()}`
  const liveId = 'live-direct-close-public'
  const liveBranch = 'node/live-direct-close-public'
  const liveWorktree = join(fixture, 'live-worktree')
  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  const sessions = join(runtime, 'sessions')
  const liveDir = join(sessions, liveId)
  const liveRecord = join(liveDir, 'session.json')
  const livePidFile = join(liveDir, 'agent.pid')
  const liveSocket = join(fixture, 'live-rendezvous.sock')
  const deleteCapture = join(fixture, 'cold-before-delete.txt')
  const liveConfig = join(fixture, 'live-agent.json')
  const refusalId = 'live-close-unowned-public'
  const refusalBranch = 'node/live-close-unowned-public'
  const refusalWorktree = join(fixture, 'refusal-worktree')
  const refusalDir = join(sessions, refusalId)
  const refusalRecord = join(refusalDir, 'session.json')
  const refusalPidFile = join(refusalDir, 'agent.pid')
  const refusalSocket = join(fixture, 'refusal-rendezvous.sock')
  const refusalConfig = join(fixture, 'refusal-agent.json')
  const piId = 'live-pi-pinned-id'
  const piBranch = 'node/live-pi-pinned-id'
  const piWorktree = join(fixture, 'pi-worktree')
  const piRecord = join(sessions, piId, 'session.json')
  const piPidFile = join(sessions, piId, 'agent.pid')
  const piSocket = join(fixture, 'pi-rendezvous.sock')
  const piConfig = join(fixture, 'pi-agent.json')
  const piDeleteCapture = join(fixture, 'pi-cold-before-delete.txt')
  const opencodeId = 'live-opencode-captured-id'
  const opencodeNativeId = 'ses_captured_open_code'
  const opencodeBranch = 'node/live-opencode-captured-id'
  const opencodeWorktree = join(fixture, 'opencode-worktree')
  const opencodeRecord = join(sessions, opencodeId, 'session.json')
  const opencodePidFile = join(sessions, opencodeId, 'agent.pid')
  const opencodeSocket = join(fixture, 'opencode-rendezvous.sock')
  const opencodeConfig = join(fixture, 'opencode-agent.json')
  const opencodeDeleteCapture = join(fixture, 'opencode-cold-before-delete.txt')
  const codexId = 'live-codex-without-native-id'
  const codexBranch = 'node/live-codex-without-native-id'
  const codexWorktree = join(fixture, 'codex-worktree')
  const codexRecord = join(sessions, codexId, 'session.json')
  const codexPidFile = join(sessions, codexId, 'agent.pid')
  const codexConfig = join(fixture, 'codex-agent.json')
  const staleId = 'stale-unbound-residue'
  const staleBranch = 'node/stale-unbound-residue'
  const staleWorktree = join(fixture, 'stale-worktree')
  const staleRecord = join(sessions, staleId, 'session.json')
  const stalePidFile = join(sessions, staleId, 'agent.pid')
  let backend: ChildProcess | null = null
  const fixturePids: number[] = []
  try {
    mkdirSync(dirname(spec), { recursive: true })
    writeFileSync(spec, '---\ntitle: project\nstatus: active\n---\n# project\n\nFixture.\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'archive@example.test')
    git(project, 'config', 'user.name', 'Archive Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')
    mkdirSync(bin)
    writeFileSync(join(bin, 'git'), `#!/bin/sh
if [ "$1" = "-C" ] && [ "$3" = "worktree" ] && [ "$4" = "remove" ] && [ "$6" = "$LIVE_WORKTREE" ]; then
  grep -q '"archived": true' "$LIVE_RECORD" || exit 91
  grep -q '"cold_proof": "cold-v1|claude|live-direct-close-public|no-resident-ref"' "$LIVE_RECORD" || exit 92
  test ! -e "$LIVE_SOCKET" || exit 93
  test ! -e "$LIVE_PID_FILE" || exit 94
  test ! -e "$(dirname "$LIVE_PID_FILE")/agent.identity.json" || exit 90
  printf 'cold-retired-before-worktree-delete\\n' > "$LIVE_CAPTURE"
fi
if [ "$1" = "-C" ] && [ "$3" = "worktree" ] && [ "$4" = "remove" ] && [ "$6" = "$PI_WORKTREE" ]; then
  grep -q '"archived": true' "$PI_RECORD" || exit 95
  grep -q '"cold_proof": "cold-v1|pi|live-pi-pinned-id|no-resident-ref"' "$PI_RECORD" || exit 96
  test ! -e "$PI_SOCKET" || exit 97
  test ! -e "$PI_PID_FILE" || exit 98
  test ! -e "$(dirname "$PI_PID_FILE")/agent.identity.json" || exit 99
  printf 'cold-retired-before-worktree-delete\\n' > "$PI_CAPTURE"
fi
if [ "$1" = "-C" ] && [ "$3" = "worktree" ] && [ "$4" = "remove" ] && [ "$6" = "$OPENCODE_WORKTREE" ]; then
  grep -q '"archived": true' "$OPENCODE_RECORD" || exit 81
  grep -q '"cold_proof": "cold-v1|opencode|live-opencode-captured-id|thread:ses_captured_open_code"' "$OPENCODE_RECORD" || exit 82
  test ! -e "$OPENCODE_SOCKET" || exit 83
  test ! -e "$OPENCODE_PID_FILE" || exit 84
  test ! -e "$(dirname "$OPENCODE_PID_FILE")/agent.identity.json" || exit 85
  printf 'cold-retired-before-worktree-delete\\n' > "$OPENCODE_CAPTURE"
fi
exec /usr/bin/git "$@"
`)
    chmodSync(join(bin, 'git'), 0o755)
    const agentScript = join(fixture, 'rendezvous-agent.cjs')
    writeFileSync(agentScript, `const fs = require('node:fs')
const net = require('node:net')
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
fs.writeFileSync(config.pidFile, String(process.pid) + '\\n')
if (config.processTitle) process.title = config.processTitle
if (config.socket) {
  try { fs.unlinkSync(config.socket) } catch {}
  net.createServer((socket) => socket.end()).listen(config.socket)
}
setInterval(() => {}, 1000)
`)

    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH || ''}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: tmuxServer,
      LIVE_WORKTREE: liveWorktree,
      LIVE_RECORD: liveRecord,
      LIVE_PID_FILE: livePidFile,
      LIVE_SOCKET: liveSocket,
      LIVE_CAPTURE: deleteCapture,
      PI_WORKTREE: piWorktree,
      PI_RECORD: piRecord,
      PI_PID_FILE: piPidFile,
      PI_SOCKET: piSocket,
      PI_CAPTURE: piDeleteCapture,
      OPENCODE_WORKTREE: opencodeWorktree,
      OPENCODE_RECORD: opencodeRecord,
      OPENCODE_PID_FILE: opencodePidFile,
      OPENCODE_SOCKET: opencodeSocket,
      OPENCODE_CAPTURE: opencodeDeleteCapture,
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

    const writeSessionRecord = (id: string, worktree: string, branch: string, socket: string | null, harness = 'claude', status = 'idle', nativeId = '') => {
      const dir = join(sessions, id)
      mkdirSync(dir, { recursive: true })
      if (socket) writeFileSync(join(dir, 'rv.path'), `${socket}\n`)
      writeFileSync(join(dir, 'session.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: worktree, branch,
        node: 'archive', title: '', name: '', parent: '', status, proposal: status === 'awaiting' ? 'close' : '', merges: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness, harness_session_id: nativeId,
        stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: harness, launch_cmd: harness, launch_owner: '',
      }, null, 2) + '\n')
    }
    const startLiveAgent = async (id: string, worktree: string, branch: string, socket: string | null, pidFile: string, config: string, ownerArg: string, harness = 'claude', status = 'idle', processTitle?: string, nativeId = '') => {
      git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
      writeSessionRecord(id, worktree, branch, socket, harness, status, nativeId)
      writeFileSync(config, JSON.stringify({ pidFile, socket, processTitle }) + '\n')
      const started = spawnSync('/usr/bin/tmux', [
        '-L', tmuxServer, 'new-session', '-d', '-s', id,
        '/bin/bash', '-c', '"$1" "$2" "$3" & wait', 'spex-fixture', process.execPath, agentScript, config, ownerArg,
      ], { encoding: 'utf8' })
      assert.equal(started.status, 0, started.stderr)
      await waitFor(() => existsSync(pidFile) && Number.isInteger(Number(readFileSync(pidFile, 'utf8').trim())) && (!socket || existsSync(socket)), `agent ${id} startup`)
      const pid = Number(readFileSync(pidFile, 'utf8').trim())
      fixturePids.push(pid)
      await waitFor(async () => {
        const rows = await fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as Array<{ id: string; liveness: string }>
        return rows.some((row) => row.id === id && row.liveness === 'online')
      }, `online API projection for ${id}`)
      return pid
    }

    // A: the exact pane remains live, but agent.pid points outside its process closure. Neither process is ours to infer.
    const refusalPanePid = await startLiveAgent(refusalId, refusalWorktree, refusalBranch, refusalSocket, refusalPidFile, refusalConfig, refusalId)
    const outside = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    assert.ok(outside.pid)
    fixturePids.push(outside.pid)
    await waitFor(() => pidAlive(outside.pid!), 'outside refusal process startup')
    writeFileSync(refusalPidFile, `${outside.pid}\n`)
    const refusalRecordBefore = readFileSync(refusalRecord)
    const refusalHeadBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: refusalWorktree, encoding: 'utf8' }).stdout
    const refused = await fetch(`${base}/api/sessions/${refusalId}/close`, { method: 'POST' })
    assert.equal(refused.status, 409)
    assert.match(JSON.stringify(await refused.json()), /not in exact target pane/u)
    assert.deepEqual(readFileSync(refusalRecord), refusalRecordBefore)
    assert.equal(existsSync(refusalRecord), true)
    assert.equal(existsSync(refusalWorktree), true)
    assert.equal(gitBranchExists(project, refusalBranch), true)
    assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: refusalWorktree, encoding: 'utf8' }).stdout, refusalHeadBefore)
    assert.equal(pidAlive(refusalPanePid), true, 'the exact pane worker is untouched')
    assert.equal(pidAlive(outside.pid), true, 'the closure-external registered PID is untouched')
    assert.equal(readFileSync(refusalPidFile, 'utf8'), `${outside.pid}\n`)
    assert.equal(existsSync(join(refusalDir, 'agent.identity.json')), false, 'failed ancestry never mints authority')
    assert.equal(existsSync(refusalSocket), true)
    assert.equal(existsSync(join(runtime, 'session-close-ledger.ndjson')), false, 'refusal emits no terminal-close audit event')

    // B: the field-observed error/online Claude shape still owns its pinned native id and takes normal cold close.
    const livePid = await startLiveAgent(liveId, liveWorktree, liveBranch, liveSocket, livePidFile, liveConfig, liveId, 'claude', 'error')
    const closed = await fetch(`${base}/api/sessions/${liveId}/close`, { method: 'POST' })
    assert.equal(closed.status, 200)
    assert.deepEqual(await closed.json(), { ok: true })
    assert.equal(readFileSync(deleteCapture, 'utf8'), 'cold-retired-before-worktree-delete\n')
    assert.equal(pidAlive(livePid), false, 'the exact live leaf is gone before terminal deletion')
    assert.equal(existsSync(liveSocket), false, 'the exact rendezvous transport is gone before terminal deletion')
    assert.equal(existsSync(liveRecord), false)
    assert.equal(existsSync(liveWorktree), false)
    assert.equal(gitBranchExists(project, liveBranch), false)
    const closeEvents = readFileSync(join(runtime, 'session-close-ledger.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(closeEvents.length, 1)
    assert.equal(closeEvents[0]?.target?.id, liveId)
    assert.deepEqual(closeEvents[0]?.source, { kind: 'user' })

    // C: Pi pins the same native id, but rewrites argv to plain `pi`; exact pane ancestry owns its leaf.
    const piPid = await startLiveAgent(piId, piWorktree, piBranch, piSocket, piPidFile, piConfig, piId, 'pi', 'awaiting', 'pi')
    const piClosed = await fetch(`${base}/api/sessions/${piId}/close`, { method: 'POST' })
    assert.equal(piClosed.status, 200)
    assert.deepEqual(await piClosed.json(), { ok: true })
    assert.equal(readFileSync(piDeleteCapture, 'utf8'), 'cold-retired-before-worktree-delete\n')
    assert.equal(pidAlive(piPid), false)
    assert.equal(existsSync(piSocket), false)
    assert.equal(existsSync(piRecord), false)
    assert.equal(existsSync(piWorktree), false)
    assert.equal(gitBranchExists(project, piBranch), false)
    const postPiEvents = readFileSync(join(runtime, 'session-close-ledger.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(postPiEvents.map((event) => event.target?.id), [liveId, piId])

    // D: captured OpenCode takes the same receipt path even after its argv loses both record and native ids.
    const opencodePid = await startLiveAgent(
      opencodeId, opencodeWorktree, opencodeBranch, opencodeSocket, opencodePidFile, opencodeConfig,
      'not-an-owner-id', 'opencode', 'awaiting', 'opencode --auto --prompt', opencodeNativeId,
    )
    const opencodeClosed = await fetch(`${base}/api/sessions/${opencodeId}/close`, { method: 'POST' })
    assert.equal(opencodeClosed.status, 200)
    assert.deepEqual(await opencodeClosed.json(), { ok: true })
    assert.equal(readFileSync(opencodeDeleteCapture, 'utf8'), 'cold-retired-before-worktree-delete\n')
    assert.equal(pidAlive(opencodePid), false)
    assert.equal(existsSync(opencodeSocket), false)
    assert.equal(existsSync(opencodeRecord), false)
    assert.equal(existsSync(opencodeWorktree), false)
    assert.equal(gitBranchExists(project, opencodeBranch), false)
    const successfulEvents = readFileSync(join(runtime, 'session-close-ledger.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(successfulEvents.map((event) => event.target?.id), [liveId, piId, opencodeId])

    // E: Codex cannot derive an exact native thread from the governed id. A live local worker keeps every witness intact.
    const codexPid = await startLiveAgent(codexId, codexWorktree, codexBranch, null, codexPidFile, codexConfig, codexId, 'codex', 'active', 'codex')
    const codexRecordBefore = readFileSync(codexRecord)
    const codexHeadBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: codexWorktree, encoding: 'utf8' }).stdout
    const codexRefused = await fetch(`${base}/api/sessions/${codexId}/close`, { method: 'POST' })
    assert.equal(codexRefused.status, 409)
    assert.match(JSON.stringify(await codexRefused.json()), /adapter still reports a live worker/u)
    assert.deepEqual(readFileSync(codexRecord), codexRecordBefore)
    assert.equal(existsSync(codexWorktree), true)
    assert.equal(gitBranchExists(project, codexBranch), true)
    assert.equal(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: codexWorktree, encoding: 'utf8' }).stdout, codexHeadBefore)
    assert.equal(pidAlive(codexPid), true)
    assert.equal(readFileSync(join(runtime, 'session-close-ledger.ndjson'), 'utf8').trim().split('\n').length, successfulEvents.length)

    // F: even a cold-looking unbound residue stays protective when its leaf artifact cannot establish absence.
    git(project, 'worktree', 'add', '-q', '-b', staleBranch, staleWorktree, 'main')
    writeSessionRecord(staleId, staleWorktree, staleBranch, null, 'codex', 'error')
    writeFileSync(stalePidFile, 'not-a-pid\n')
    const staleRecordBefore = readFileSync(staleRecord)
    const staleRefused = await fetch(`${base}/api/sessions/${staleId}/close`, { method: 'POST' })
    assert.equal(staleRefused.status, 409)
    assert.match(JSON.stringify(await staleRefused.json()), /leaf PID artifact is malformed/u)
    assert.deepEqual(readFileSync(staleRecord), staleRecordBefore)
    assert.equal(readFileSync(stalePidFile, 'utf8'), 'not-a-pid\n')
    assert.equal(existsSync(staleWorktree), true)
    assert.equal(gitBranchExists(project, staleBranch), true)
    assert.equal(readFileSync(join(runtime, 'session-close-ledger.ndjson'), 'utf8').trim().split('\n').length, successfulEvents.length)
  } finally {
    await stopChild(backend)
    spawnSync('/usr/bin/tmux', ['-L', tmuxServer, 'kill-server'], { stdio: 'ignore' })
    for (const pid of fixturePids) if (pidAlive(pid)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* already exited */ }
    }
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('session-owned headless adapters retire stopped cold homes without replaying control', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-headless-cold-retire-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const runtime = join(home, 'projects', project.replace(/[/.]/g, '-'))
  const sessions = join(runtime, 'sessions')
  const tmuxServer = `spex-headless-cold-${process.pid}`
  let backend: ChildProcess | null = null
  let liveListener: net.Server | null = null
  try {
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude-headless', 'opencode-headless', 'pi-headless'] }, null, 2) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'headless-cold@example.test')
    git(project, 'config', 'user.name', 'Headless Cold Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')

    const writeStopped = (id: string, harness: 'claude-headless' | 'opencode-headless' | 'pi-headless') => {
      const dir = join(sessions, id)
      const worktree = join(fixture, `${id}-worktree`)
      const branch = `node/${id}`
      git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'rv.path'), `${join(fixture, `${id}.sock`)}\n`)
      writeFileSync(join(dir, 'session.json'), JSON.stringify({
        session_id: id, governed: true, worktree_path: worktree, branch,
        node: '', title: '', name: '', parent: '', status: 'idle', proposal: '', merges: 0,
        note: '', sortkey: '', createdAt: Date.now(), harness,
        harness_session_id: harness === 'opencode-headless' ? `ses_${id}` : id,
        stopped: true, archived: false, cold_proof: '', adapter_recovery: '',
        launcher: harness, launch_cmd: harness, launch_owner: '',
      }, null, 2) + '\n')
      return { id, dir, record: join(dir, 'session.json'), worktree, branch }
    }

    const suffix = String(process.pid)
    const claude = writeStopped(`cold-claude-${suffix}`, 'claude-headless')
    const opencode = writeStopped(`cold-opencode-${suffix}`, 'opencode-headless')
    const pi = writeStopped(`cold-pi-${suffix}`, 'pi-headless')
    const live = writeStopped(`live-home-${suffix}`, 'opencode-headless')
    const unknown = writeStopped(`unknown-leaf-${suffix}`, 'pi-headless')
    const listening = writeStopped(`live-listener-${suffix}`, 'opencode-headless')
    writeFileSync(join(unknown.dir, 'agent.pid'), 'not-a-pid\n')
    const started = spawnSync('/usr/bin/tmux', [
      '-L', tmuxServer, 'new-session', '-d', '-s', live.id,
      '/bin/sh', '-c', 'while :; do sleep 60; done',
    ], { encoding: 'utf8' })
    assert.equal(started.status, 0, started.stderr)
    const listenerPath = readFileSync(join(listening.dir, 'rv.path'), 'utf8').trim()
    liveListener = net.createServer((socket) => socket.end())
    await new Promise<void>((resolve, reject) => {
      liveListener!.once('error', reject)
      liveListener!.listen(listenerPath, resolve)
    })
    assert.equal(await listenerAt(listenerPath), 'live')

    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: tmuxServer,
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

    const [claudeClose, opencodeClose, piArchive] = await Promise.all([
      fetch(`${base}/api/sessions/${claude.id}/close`, { method: 'POST' }),
      fetch(`${base}/api/sessions/${opencode.id}/close`, { method: 'POST' }),
      fetch(`${base}/api/sessions/${pi.id}/archive`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }),
      }),
    ])
    assert.deepEqual(
      [claudeClose.status, opencodeClose.status, piArchive.status],
      [200, 200, 200],
      'stopped session-home adapters prove physical cold state without a second native interrupt or leaf teardown',
    )
    assert.equal(existsSync(claude.record), false)
    assert.equal(existsSync(opencode.record), false)
    assert.equal(existsSync(pi.record), true, 'archive retains the cold Pi record')
    const archivedPi = JSON.parse(readFileSync(pi.record, 'utf8'))
    assert.equal(archivedPi.archived, true)
    assert.equal(archivedPi.stopped, true)
    assert.match(archivedPi.cold_proof, /^cold-v1\|pi-headless\|/)
    const piClose = await fetch(`${base}/api/sessions/${pi.id}/close`, { method: 'POST' })
    assert.equal(piClose.status, 200)
    assert.equal(existsSync(pi.record), false)

    for (const target of [live, unknown, listening]) {
      const before = readFileSync(target.record)
      const response = await fetch(`${base}/api/sessions/${target.id}/close`, { method: 'POST' })
      assert.equal(response.status, 409)
      assert.deepEqual(readFileSync(target.record), before, `${target.id} refusal has zero record mutation`)
      assert.equal(existsSync(target.worktree), true)
      assert.equal(gitBranchExists(project, target.branch), true)
    }
    const paneStillLive = spawnSync('/usr/bin/tmux', ['-L', tmuxServer, 'has-session', '-t', live.id])
    assert.equal(paneStillLive.status, 0, 'a reappeared exact home is not killed from stopped metadata alone')
    assert.equal(readFileSync(join(unknown.dir, 'agent.pid'), 'utf8'), 'not-a-pid\n')
    assert.equal(await listenerAt(listenerPath), 'live', 'a live adapter listener is not removed from stopped metadata alone')

    const closeEvents = readFileSync(join(runtime, 'session-close-ledger.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(closeEvents.map((event) => event.target?.id).sort(), [claude.id, opencode.id, pi.id].sort())
  } finally {
    await stopChild(backend)
    if (liveListener?.listening) await new Promise<void>((resolve) => liveListener!.close(() => resolve()))
    spawnSync('/usr/bin/tmux', ['-L', tmuxServer, 'kill-server'], { stdio: 'ignore' })
    rmSync(fixture, { recursive: true, force: true })
  }
})

function gitBranchExists(cwd: string, branch: string): boolean {
  return spawnSync('git', ['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}`], { cwd, encoding: 'utf8' }).stdout.trim() === branch
}
