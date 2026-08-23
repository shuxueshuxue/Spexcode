import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { encodeProject, runtimeRoot } from '@spexcode/spec-core'
import { clientSendThroughPeer } from './client.js'
import { MachinePeerGateway, listMachinePeers, peerRpc, peerSocketPath, peerStorePath, readPeerMachineId } from './machine-peer.js'

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')

async function listen(server: ReturnType<typeof createServer>, port = 0): Promise<number> {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(child, 'close') as [number | null]
  return { code, stdout, stderr }
}

async function control(request: Parameters<typeof peerRpc>[0]) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { return await peerRpc(request) } catch { await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
  return await peerRpc(request)
}

async function orphanUnixSocket(path: string): Promise<void> {
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import { createServer } from 'node:net'; const server = createServer(); server.listen(${JSON.stringify(path)}, () => process.stdout.write('ready'));`],
  { stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    await once(child.stdout, 'data')
  } finally {
    child.kill('SIGKILL')
    await once(child, 'exit').catch(() => {})
  }
}

test('a stale peer socket is removed before the gateway binds', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-stale-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const path = peerSocketPath()
  mkdirSync(dirname(path), { recursive: true })
  await orphanUnixSocket(path)
  assert.equal(existsSync(path), true, 'the killed owner leaves an orphaned Unix socket')
  const gateway = new MachinePeerGateway()
  try {
    await gateway.start()
    assert.equal(existsSync(path), true, 'the fresh gateway owns the recreated socket')
    assert.deepEqual(await peerRpc({ op: 'list' }), { ok: true, peers: [] })
  } finally {
    await gateway.close()
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a live peer socket still rejects a second gateway', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-live-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const first = new MachinePeerGateway()
  const second = new MachinePeerGateway()
  try {
    await first.start()
    await assert.rejects(second.start(), /machine peer service already owns .*another `spex dashboard` may be running/)
    await second.close()
    assert.equal(existsSync(peerSocketPath()), true, 'a failed second start must not remove the first gateway socket')
  } finally {
    await second.close()
    await first.close()
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

function project(home: string, id: string, session = SESSION, worktreePath = ''): string {
  const root = join(home, 'projects', id)
  mkdirSync(join(root, 'sessions', session), { recursive: true })
  writeFileSync(join(root, 'sessions', session, 'session.json'), `${JSON.stringify(worktreePath ? { worktree_path: worktreePath } : {})}\n`)
  return root
}

function endpoint(root: string, url: string, projectRoot = '/fixture/project'): void {
  writeFileSync(join(root, 'backend.json'), `${JSON.stringify({
    version: 2, url, pid: process.pid, instanceId: 'fixture-instance', root: projectRoot,
    identity: { title: 'fixture', icon: 'spexcode' }, startedAt: new Date().toISOString(),
  })}\n`)
}

test('a common-dir session routes to the endpoint published for its linked worktree', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-worktree-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const received: string[] = []
  const backend = createServer((req, res) => {
    received.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  const gateway = new MachinePeerGateway()
  try {
    const backendPort = await listen(backend)
    const sessionProject = basename(runtimeRoot(pkgRoot))
    project(home, sessionProject, SESSION, pkgRoot)
    const endpointProject = join(home, 'projects', encodeProject(pkgRoot))
    mkdirSync(endpointProject, { recursive: true })
    endpoint(endpointProject, `http://127.0.0.1:${backendPort}`, pkgRoot)
    await gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 31011, remoteOutboundPort: 31012 })
    assert.ok(accepted.ok && accepted.peer)
    const response = await fetch(`http://127.0.0.1:${accepted.peer.inboundPort}/api/sessions/${SESSION}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'linked worktree' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, [`/api/sessions/${SESSION}/input`])
  } finally {
    await gateway.close()
    await close(backend)
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a peer ingress derives one local project then uses its ordinary session input endpoint', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const received: unknown[] = []
  const backend = createServer(async (req, res) => {
    const parts: Buffer[] = []
    for await (const chunk of req) parts.push(Buffer.from(chunk))
    const raw = Buffer.concat(parts).toString('utf8')
    received.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(req.method === 'GET' ? { id: SESSION, title: 'remote detail' } : { ok: true }))
  })
  const gateway = new MachinePeerGateway()
  try {
    const backendPort = await listen(backend)
    endpoint(project(home, 'one'), `http://127.0.0.1:${backendPort}`)
    await gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 31001, remoteOutboundPort: 31002 })
    assert.equal(accepted.ok, true)
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    const response = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'hello', from: `peer:${SOURCE}:${SOURCE}` }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, [{
      method: 'POST', path: `/api/sessions/${SESSION}/input`, body: { kind: 'text', text: 'hello', from: `peer:${SOURCE}:${SOURCE}` },
    }])

    const claimed = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'claim', from: '../../not-a-session' }),
    })
    assert.equal(claimed.status, 200)
    assert.deepEqual(received[1], {
      method: 'POST', path: `/api/sessions/${SESSION}/input`, body: { kind: 'text', text: 'claim', from: `peer:${SOURCE}` },
    })

    const shown = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}`)
    assert.equal(shown.status, 200)
    assert.deepEqual(await shown.json(), { id: SESSION, title: 'remote detail' })
    const closed = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/close`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: { kind: 'unverified-session-claim', id: SOURCE } }),
    })
    assert.equal(closed.status, 200)
    assert.deepEqual(received.slice(2), [
      { method: 'GET', path: `/api/sessions/${SESSION}`, body: null },
      { method: 'POST', path: `/api/sessions/${SESSION}/close`, body: { source: { kind: 'user' } } },
    ])

    const rejected = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/stop`, { method: 'POST' })
    assert.equal(rejected.status, 404, 'the peer ingress is an allowlist, never a generic backend proxy')
    assert.equal(received.length, 4)

    const missing = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/cccccccc-cccc-4ccc-8ccc-cccccccccccc/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'missing' }),
    })
    assert.equal(missing.status, 404)

    project(home, 'two')
    const ambiguous = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'ambiguous' }),
    })
    assert.equal(ambiguous.status, 409)
    assert.equal(listMachinePeers().length, 1, 'session/project mutations never delete a machine peer')
    const machineId = readPeerMachineId()
    assert.equal(readPeerMachineId(), machineId, 'machine peer identity is stable in the private peer store')
    assert.equal(statSync(peerStorePath()).mode & 0o777, 0o600, 'peer identity and reachability hints stay private')
    rmSync(join(home, 'projects', 'one', 'sessions', SESSION), { recursive: true, force: true })
    rmSync(join(home, 'projects', 'two', 'sessions', SESSION), { recursive: true, force: true })
    assert.equal(listMachinePeers().length, 1, 'removing closed-session state cannot tear down a machine peer')
  } finally {
    await gateway.close()
    await close(backend)
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a peer anchor lists and creates through one derived project without opening a query or parent escape hatch', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-project-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const received: unknown[] = []
  const backend = createServer(async (req, res) => {
    const parts: Buffer[] = []
    for await (const chunk of req) parts.push(Buffer.from(chunk))
    const raw = Buffer.concat(parts).toString('utf8')
    received.push({ method: req.method, path: req.url, key: req.headers['idempotency-key'] ?? null, body: raw ? JSON.parse(raw) : null })
    res.setHeader('content-type', 'application/json')
    if (req.method === 'GET') { res.end(JSON.stringify([{ id: SESSION, title: 'remote board' }])); return }
    res.end(JSON.stringify({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parent: null, title: 'remote new' }))
  })
  const gateway = new MachinePeerGateway()
  try {
    const backendPort = await listen(backend)
    endpoint(project(home, 'one'), `http://127.0.0.1:${backendPort}`)
    await gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 31021, remoteOutboundPort: 31022 })
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer

    const listed = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/project/sessions`)
    assert.equal(listed.status, 200)
    assert.deepEqual(await listed.json(), [{ id: SESSION, title: 'remote board' }])

    const created = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/project/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'create there', launcher: 'fixture', requestKey: 'peer-create-1' }),
    })
    assert.equal(created.status, 200)
    assert.deepEqual(await created.json(), { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parent: null, title: 'remote new' })
    assert.deepEqual(received, [
      { method: 'GET', path: '/api/sessions', key: null, body: null },
      { method: 'POST', path: '/api/sessions', key: 'peer-create-1', body: { prompt: 'create there', launcher: 'fixture' } },
    ])

    const parent = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/project/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'wrong parent', parent: SOURCE, requestKey: 'peer-create-2' }),
    })
    assert.equal(parent.status, 400)
    assert.match((await parent.json() as { error: string }).error, /parent/)
    const archived = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/project/sessions?all=1`)
    assert.equal(archived.status, 404)
    assert.equal(received.length, 2, 'rejected peer paths never reach the backend')
  } finally {
    await gateway.close()
    await close(backend)
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a known peer makes client send use its forward and missing peers fail before local fallback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-send-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const gateway = new MachinePeerGateway()
  let forward: ReturnType<typeof createServer> | null = null
  try {
    await gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 32001, remoteOutboundPort: 32002 })
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    const received: unknown[] = []
    forward = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      received.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      res.setHeader('content-type', 'application/json')
      if (req.url?.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc')) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'no local project owns that session' }))
        return
      }
      res.end(JSON.stringify({ ok: true }))
    })
    await listen(forward, peer.outboundPort)
    assert.deepEqual(await clientSendThroughPeer('peer-fixture', SESSION, 'through tunnel', `peer:${SOURCE}:${SOURCE}`), { ok: true })
    assert.deepEqual(received, [{
      path: `/api/sessions/${SESSION}/input`, body: { kind: 'text', text: 'through tunnel', from: `peer:${SOURCE}:${SOURCE}` },
    }])
    assert.deepEqual(await clientSendThroughPeer('peer-fixture', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'missing'), {
      ok: false, error: 'no local project owns that session',
    })
    await assert.rejects(() => clientSendThroughPeer('absent-peer', SESSION, 'nope'), /no communication tunnel/)
  } finally {
    await gateway.close()
    if (forward) await close(forward)
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('the peer and session CLI surfaces use the gateway-owned peer forward', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-cli-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const gateway = new MachinePeerGateway()
  let forward: ReturnType<typeof createServer> | null = null
  try {
    await gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 33001, remoteOutboundPort: 33002 })
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    const received: unknown[] = []
    forward = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      received.push({ method: req.method, path: req.url, key: req.headers['idempotency-key'] ?? null, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      if (req.url === `/api/sessions/${SESSION}/project/sessions` && req.method === 'GET') {
        res.end(JSON.stringify([{ id: SESSION, title: 'remote board', status: 'working' }]))
        return
      }
      if (req.url === `/api/sessions/${SESSION}/project/sessions` && req.method === 'POST') {
        res.end(JSON.stringify({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parent: null, title: 'peer launched' }))
        return
      }
      if (req.method === 'GET') { res.end(JSON.stringify({ id: SESSION, title: 'remote detail' })); return }
      res.end(JSON.stringify({ ok: true }))
    })
    await listen(forward, peer.outboundPort)
    const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '' }
    for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
    const listed = await runCli(['peer', 'ls', '--json'], env)
    assert.equal(listed.code, 0, listed.stderr)
    assert.equal(JSON.parse(listed.stdout)[0].sshAddress, 'peer-fixture')
    const sent = await runCli(['session', 'send', '--ssh', 'peer-fixture', SESSION, 'from cli'], env)
    assert.equal(sent.code, 0, sent.stderr)
    assert.equal(sent.stdout, 'sent\n')
    const shown = await runCli(['session', 'show', '--ssh', 'peer-fixture', SESSION, '--json'], env)
    assert.equal(shown.code, 0, shown.stderr)
    assert.deepEqual(JSON.parse(shown.stdout), { id: SESSION, title: 'remote detail' })
    const remoteList = await runCli(['session', 'ls', '--ssh', 'peer-fixture', SESSION, '--json'], env)
    assert.equal(remoteList.code, 0, remoteList.stderr)
    assert.deepEqual(JSON.parse(remoteList.stdout), [{ id: SESSION, title: 'remote board', status: 'working' }])
    const remoteNew = await runCli(['session', 'new', '--ssh', 'peer-fixture', SESSION, 'peer task'], { ...env, SPEXCODE_SESSION_ID: SOURCE })
    assert.equal(remoteNew.code, 0, remoteNew.stderr)
    assert.deepEqual(JSON.parse(remoteNew.stdout), { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parent: null, title: 'peer launched' })
    assert.match(remoteNew.stderr, /launched remote session/)
    assert.match(remoteNew.stderr, /no managed watch crosses this machine peer/)
    const closed = await runCli(['session', 'close', '--ssh', 'peer-fixture', SESSION], env)
    assert.equal(closed.code, 0, closed.stderr)
    assert.equal(closed.stdout, `closed ${SESSION}\n`)
    assert.deepEqual(received.slice(0, 3), [
      { method: 'POST', path: `/api/sessions/${SESSION}/input`, key: null, body: { kind: 'text', text: 'from cli' } },
      { method: 'GET', path: `/api/sessions/${SESSION}`, key: null, body: null },
      { method: 'GET', path: `/api/sessions/${SESSION}/project/sessions`, key: null, body: null },
    ])
    const create = received[3] as { method: string; path: string; key: string | null; body: { prompt: string; requestKey: string } }
    assert.equal(create.method, 'POST')
    assert.equal(create.path, `/api/sessions/${SESSION}/project/sessions`)
    assert.equal(create.key, null)
    assert.match(create.body.prompt, /^peer task\n\n— from session bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb on machine [0-9a-f-]{36}\. To reply: spex session send --ssh peer-fixture bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb "<your reply>"$/)
    assert.match(create.body.requestKey, /^[0-9a-f-]{36}$/)
    assert.deepEqual(received[4], { method: 'POST', path: `/api/sessions/${SESSION}/close`, key: null, body: { source: { kind: 'user' } } })
    const short = await runCli(['session', 'show', '--ssh', 'peer-fixture', SESSION.slice(0, 8)], env)
    assert.equal(short.code, 2)
    assert.match(short.stderr, /--ssh requires a full session id/)
    const capture = await runCli(['session', 'show', '--ssh', 'peer-fixture', SESSION, '--capture'], env)
    assert.equal(capture.code, 2)
    assert.match(capture.stderr, /--capture cannot cross a machine peer/)
    const archive = await runCli(['session', 'ls', '--ssh', 'peer-fixture', SESSION, '--all'], env)
    assert.equal(archive.code, 2)
    assert.match(archive.stderr, /--all is unavailable through a machine peer/)
    const missingTunnel = await runCli(['session', 'new', '--ssh', 'absent-peer', SESSION, 'never local'], env)
    assert.equal(missingTunnel.code, 1)
    assert.match(missingTunnel.stderr, /no communication tunnel/)
    assert.equal(received.length, 5, 'a missing peer cannot fall back to a local session create')
    const absent = await runCli(['peer', 'disconnect', 'absent-peer'], env)
    assert.equal(absent.code, 1)
    assert.match(absent.stderr, /no communication tunnel/)
  } finally {
    await gateway.close()
    if (forward) await close(forward)
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})
