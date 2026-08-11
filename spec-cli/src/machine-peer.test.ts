import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { encodeProject, runtimeRoot } from '@spexcode/spec-core'
import { clientSendThroughPeer } from './client.js'
import { MachinePeerGateway, listMachinePeers, peerRpc, peerStorePath, readPeerMachineId } from './machine-peer.js'

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
    gateway.start()
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
    received.push({ path: req.url, body: JSON.parse(Buffer.concat(parts).toString('utf8')) })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true }))
  })
  const gateway = new MachinePeerGateway()
  try {
    const backendPort = await listen(backend)
    endpoint(project(home, 'one'), `http://127.0.0.1:${backendPort}`)
    gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 31001, remoteOutboundPort: 31002 })
    assert.equal(accepted.ok, true)
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    const response = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'hello', from: `peer:${SOURCE}:${SOURCE}` }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(received, [{
      path: `/api/sessions/${SESSION}/input`, body: { kind: 'text', text: 'hello', from: `peer:${SOURCE}:${SOURCE}` },
    }])

    const claimed = await fetch(`http://127.0.0.1:${peer.inboundPort}/api/sessions/${SESSION}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'claim', from: '../../not-a-session' }),
    })
    assert.equal(claimed.status, 200)
    assert.deepEqual(received[1], {
      path: `/api/sessions/${SESSION}/input`, body: { kind: 'text', text: 'claim', from: `peer:${SOURCE}` },
    })

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

test('a known peer makes client send use its forward and missing peers fail before local fallback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-send-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const gateway = new MachinePeerGateway()
  let forward: ReturnType<typeof createServer> | null = null
  try {
    gateway.start()
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
    gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', remoteInboundPort: 33001, remoteOutboundPort: 33002 })
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    const received: unknown[] = []
    forward = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      received.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      res.setHeader('content-type', 'application/json')
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
    assert.deepEqual(received, [{
      path: `/api/sessions/${SESSION}/input`, body: { kind: 'text', text: 'from cli' },
    }])
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
