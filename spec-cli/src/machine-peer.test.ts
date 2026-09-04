import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { PEER_CREDENTIAL_HEADER } from './gateway-auth.js'
import { clientSendThroughPeer } from './client.js'
import { newHostRecord, publishHostRecord } from './host-record.js'
import { MachinePeerGateway, listMachinePeers, peerRpc, peerStorePath, readPeerMachineId, splitSshOptions } from './machine-peer.js'

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

test('a known peer makes client send use its forward and missing peers fail before local fallback', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-send-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const gateway = new MachinePeerGateway()
  let forward: ReturnType<typeof createServer> | null = null
  try {
    gateway.start()
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', credential: 'far-cred', instanceId: 'far-inst' })
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    assert.ok(peer.gatewayPort, 'accepting publishes a local port for the leg the dialler will build back here')
    const received: unknown[] = []
    // the far machine's GATEWAY peer ingress, played by a loopback listener — which is exactly the shape the
    // `ssh -L` leg produces on this side of the tunnel
    forward = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      received.push({ path: req.url, credential: req.headers[PEER_CREDENTIAL_HEADER] ?? null, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      res.setHeader('content-type', 'application/json')
      if (req.url?.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc')) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'no local project owns that session' }))
        return
      }
      res.end(JSON.stringify({ ok: true }))
    })
    await listen(forward, peer.gatewayPort!)
    assert.deepEqual(await clientSendThroughPeer('peer-fixture', SESSION, 'through tunnel', `peer_${SOURCE}_${SOURCE}`), { ok: true })
    assert.deepEqual(received, [{
      // one ordinary gateway route, addressed by the session the caller already knows, carrying the credential
      // that far machine issued to this one — no per-peer listener and no private request grammar
      path: `/s/${SESSION}/api/sessions/${SESSION}/input`, credential: 'far-cred',
      body: { kind: 'text', text: 'through tunnel', from: `peer_${SOURCE}_${SOURCE}` },
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
    const accepted = await control({ op: 'accept', sourceMachineId: SOURCE, sshAddress: 'peer-fixture', credential: 'far-cred', instanceId: 'far-inst' })
    assert.ok(accepted.ok && accepted.peer)
    const peer = accepted.peer
    assert.ok(peer.gatewayPort)
    const received: unknown[] = []
    const board = `/s/${SESSION}/api/sessions`
    forward = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      received.push({ method: req.method, path: req.url, key: req.headers['idempotency-key'] ?? null, credential: req.headers[PEER_CREDENTIAL_HEADER] ?? null, body: raw ? JSON.parse(raw) : null })
      res.setHeader('content-type', 'application/json')
      if (req.url === board && req.method === 'GET') {
        res.end(JSON.stringify([{ id: SESSION, title: 'remote board', status: 'working' }]))
        return
      }
      if (req.url === board && req.method === 'POST') {
        res.end(JSON.stringify({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parent: null, title: 'peer launched' }))
        return
      }
      if (req.method === 'GET') { res.end(JSON.stringify({ id: SESSION, title: 'remote detail' })); return }
      res.end(JSON.stringify({ ok: true }))
    })
    await listen(forward, peer.gatewayPort!)
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
    // every verb is the ORDINARY route it would use locally, addressed by /s/<session> and carrying the leg
    // credential. `--ssh` is spelling over that address, not a second protocol.
    assert.deepEqual(received.slice(0, 3), [
      { method: 'POST', path: `/s/${SESSION}/api/sessions/${SESSION}/input`, key: null, credential: 'far-cred', body: { kind: 'text', text: 'from cli' } },
      { method: 'GET', path: `/s/${SESSION}/api/sessions/${SESSION}`, key: null, credential: 'far-cred', body: null },
      { method: 'GET', path: board, key: null, credential: 'far-cred', body: null },
    ])
    const create = received[3] as { method: string; path: string; key: string | null; body: { prompt: string; requestKey?: string } }
    assert.equal(create.method, 'POST')
    assert.equal(create.path, board)
    // the create's once-only key rides the ordinary Idempotency-Key header the backend already honors, rather
    // than a body field a private door used to translate
    assert.match(create.key ?? '', /^[0-9a-f-]{36}$/)
    assert.equal(create.body.requestKey, undefined)
    assert.match(create.body.prompt, /^peer task\n\n— from session bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb on machine [0-9a-f-]{36}\. To reply: spex session send --ssh peer-fixture bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb "<your reply>"$/)
    assert.deepEqual(received[4], { method: 'POST', path: `/s/${SESSION}/api/sessions/${SESSION}/close`, key: null, credential: 'far-cred', body: { source: { kind: 'user' } } })
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

test('the control socket claim is proven by a connect, not by the file', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-machine-peer-stale-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const first = new MachinePeerGateway()
  const second = new MachinePeerGateway()
  try {
    // a killed gateway leaves its path behind with nothing listening: a regular file at the socket path refuses
    // every connect exactly like a stale socket inode does
    mkdirSync(join(home, 'gateway'), { recursive: true })
    writeFileSync(join(home, 'gateway', 'peer.sock'), '')
    await first.start()
    const listed = await control({ op: 'list' })
    assert.ok(listed.ok, JSON.stringify(listed))
    // the path is now LIVE: a second gateway must refuse loudly and never unlink the owner's socket
    await assert.rejects(second.start(), /already owns .*peer\.sock — another `spex dashboard` is running/)
    assert.ok((await control({ op: 'list' })).ok)
  } finally {
    await first.close()
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('ordinary ssh options are parsed in ssh grammar, recorded on the peer, and replayed on every dial', async () => {
  // value-taking options swallow the token after them, so the address is whatever is left
  assert.deepEqual(splitSshOptions(['-F', '/tmp/ssh_config', 'macmini-tail']),
    { sshOptions: ['-F', '/tmp/ssh_config'], addresses: ['macmini-tail'] })
  // booleans, attached forms and repeats need no table; order is preserved verbatim
  assert.deepEqual(splitSshOptions(['-4', '-vvv', '-i/tmp/key', '-o', 'BatchMode=yes', '-p', '2222', 'host']),
    { sshOptions: ['-4', '-vvv', '-i/tmp/key', '-o', 'BatchMode=yes', '-p', '2222'], addresses: ['host'] })
  // `--` ends the options for an address that would otherwise read as one
  assert.deepEqual(splitSshOptions(['-F', '/tmp/cfg', '--', '-weird-host']),
    { sshOptions: ['-F', '/tmp/cfg'], addresses: ['-weird-host'] })
  assert.throws(() => splitSshOptions(['-F']), /ssh option -F needs a value/)

  const home = mkdtempSync(join(tmpdir(), 'spex-peer-ssh-options-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try {
    // a peer whose record predates the leg fields is legacy, not malformed: it loads and normalizes to
    // "no options, no leg" rather than failing every read of the store
    mkdirSync(join(home, 'gateway'), { recursive: true })
    writeFileSync(peerStorePath(), `${JSON.stringify({
      version: 2, machineId: SOURCE, peers: [{
        machineId: SESSION, sshAddress: 'legacy-peer', owner: true, state: 'connected',
        createdAt: new Date().toISOString(), lastOkAt: null, lastError: null,
      }],
    })}\n`)
    assert.deepEqual(listMachinePeers()[0].sshOptions, [], 'an absent field normalizes to no options')
    assert.equal(listMachinePeers()[0].gatewayPort, null)
    assert.equal(listMachinePeers()[0].remoteBackPort, null)

    // disconnect never re-states them; they belong to the peer recorded at connect
    const env = { ...process.env, SPEXCODE_HOME: home } as NodeJS.ProcessEnv
    const restated = await runCli(['peer', 'disconnect', '-F', '/tmp/cfg', 'legacy-peer'], env)
    assert.equal(restated.code, 2)
    assert.match(restated.stderr, /replayed from the peer recorded at connect/)
    const noAddress = await runCli(['peer', 'connect', '-F', '/tmp/cfg'], env)
    assert.equal(noAddress.code, 2)
    assert.match(noAddress.stderr, /usage: spex peer connect \[SSH-OPTION\.\.\.\] <SSH-ADDRESS>/)
  } finally {
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

// Every v1 peer records a forward pair aimed at a per-peer listener this gateway no longer runs. Carrying one
// forward would be a link that quietly forwards into nothing, so the store drops them and SAYS it did — one
// `spex peer connect` per machine is the whole recovery, and a peer link only ever lives while its ssh child does.
test('peer records written before the single door are dropped loudly, once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-peer-v1-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const said: string[] = []
  const realError = console.error
  console.error = (...args: unknown[]) => { said.push(args.join(' ')) }
  try {
    mkdirSync(join(home, 'gateway'), { recursive: true })
    writeFileSync(peerStorePath(), `${JSON.stringify({
      version: 1, machineId: SOURCE, peers: [
        { machineId: SESSION, sshAddress: 'old-peer', inboundPort: 1, outboundPort: 2, remoteInboundPort: 3, remoteOutboundPort: 4, owner: true, state: 'connected', createdAt: 'test', lastOkAt: null, lastError: null },
      ],
    })}\n`)
    assert.deepEqual(listMachinePeers(), [], 'a link into a listener that no longer exists is not carried forward')
    assert.equal(said.length, 1)
    assert.match(said[0], /dropped 1 peer link .*spex peer connect/)
    assert.equal(readPeerMachineId(), SOURCE, 'this machine keeps its own identity across the drop')
    listMachinePeers()
    assert.equal(said.length, 1, 'the store was rewritten, so the announcement is not repeated on every read')
  } finally {
    console.error = realError
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
})

test('a dial forwards the far gateway only when the far side publishes one, and a restart rebuilds that leg', async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-peer-gateway-leg-'))
  const bin = join(home, 'bin')
  mkdirSync(bin, { recursive: true })
  const log = join(home, 'ssh-argv.log')
  const reply = join(home, 'reply.json')
  // a dial is the invocation carrying -N; every other invocation is the remote peer-accept RPC, which answers
  // with whatever the far side is currently publishing
  writeFileSync(join(bin, 'ssh'), [
    '#!/bin/sh',
    `{ printf '%s\\t' "$@"; echo; } >> ${log}`,
    'for arg in "$@"; do if [ "$arg" = "-N" ]; then exec sleep 30; fi; done',
    `cat ${reply}`,
    '',
  ].join('\n'), { mode: 0o755 })
  const dials = (): string[][] => {
    let lines: string[] = []
    try { lines = readFileSync(log, 'utf8').split('\n').filter((line) => line.length > 0) } catch { /* not dialled yet */ }
    return lines.map((line) => line.split('\t')).filter((argv) => argv.includes('-N'))
  }
  const dialCount = async (want: number): Promise<string[][]> => {
    for (let attempt = 0; attempt < 200 && dials().length < want; attempt++) await new Promise((r) => setTimeout(r, 10))
    return dials()
  }
  const legs = (argv: string[], flag: '-L' | '-R' = '-L'): string[] => argv.filter((arg, index) => argv[index - 1] === flag)
  const publish = (gateway: { port: number; instanceId: string; credential?: string } | null, backPort = 41001) => writeFileSync(reply, `${JSON.stringify({
    ok: true, machineId: SESSION, backPort, ...(gateway ? { gateway } : {}),
  })}\n`)

  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  process.env.SPEXCODE_HOME = home
  process.env.PATH = `${bin}:${previousPath ?? ''}`
  const gateway = new MachinePeerGateway()
  try {
    await gateway.start()

    // a far side with no published host record leaves the leg absent rather than guessing a port. There is no
    // second, control-plane leg to fall back on any more: one door or none.
    publish(null)
    const bare = await control({ op: 'connect', sshAddress: 'gw-peer' })
    assert.ok(bare.ok && bare.peer)
    assert.equal(bare.peer.remoteGatewayPort, null)
    assert.equal(bare.peer.gatewayPort, null)
    assert.equal(bare.peer.remoteGatewayInstanceId, null)
    const first = await dialCount(1)
    assert.deepEqual(legs(first[0]), [], 'no gateway to reach, so the dial carries no forward at all')

    // a far side naming a port but issuing no credential publishes no INGRESS: the leg stays absent rather
    // than forwarding a port whose loopback trust it would launder
    publish({ port: 9443, instanceId: 'instance-a' })
    const uncredentialed = await control({ op: 'connect', sshAddress: 'gw-peer' })
    assert.ok(uncredentialed.ok && uncredentialed.peer)
    assert.equal(uncredentialed.peer.remoteGatewayPort, null)
    assert.equal(uncredentialed.peer.gatewayPort, null)
    assert.equal(uncredentialed.peer.remoteGatewayCredential, null)
    assert.equal(dials().length, 1, 'nothing to rebuild, so nothing redials')

    // once it publishes one, re-running connect adopts it and rebuilds the dial
    publish({ port: 9443, instanceId: 'instance-a', credential: 'cred-a' })
    const adopted = await control({ op: 'connect', sshAddress: 'gw-peer' })
    assert.ok(adopted.ok && adopted.peer)
    assert.equal(adopted.peer.remoteGatewayPort, 9443)
    assert.equal(adopted.peer.remoteGatewayInstanceId, 'instance-a')
    assert.equal(adopted.peer.remoteGatewayCredential, 'cred-a', 'the issued credential is recorded beside the leg')
    const forwarded = adopted.peer.gatewayPort
    assert.ok(forwarded && forwarded > 0, 'a local port is minted for the gateway leg')
    assert.equal(adopted.peer.state, 'connected')
    assert.equal(adopted.peer.lastError, null, 'the superseded dial does not report a failure over the live one')
    const second = await dialCount(2)
    assert.deepEqual(legs(second[1]), [`127.0.0.1:${forwarded}:127.0.0.1:9443`])
    assert.deepEqual(legs(second[1], '-R'), [], 'this machine publishes no ingress yet, so there is nothing to offer back')

    // the same instance is not a change, so the live tunnel is left alone
    const unchanged = await control({ op: 'connect', sshAddress: 'gw-peer' })
    assert.ok(unchanged.ok && unchanged.peer)
    assert.equal(unchanged.peer.gatewayPort, forwarded)
    assert.equal(dials().length, 2, 'an unchanged instance redials nothing')

    // a restarted far gateway is a new instance on a new port: the local port is kept, the far end is repointed
    publish({ port: 9444, instanceId: 'instance-b', credential: 'cred-b' })
    const restarted = await control({ op: 'connect', sshAddress: 'gw-peer' })
    assert.ok(restarted.ok && restarted.peer)
    assert.equal(restarted.peer.gatewayPort, forwarded, 'the forwarded local port is stable across a far restart')
    assert.equal(restarted.peer.remoteGatewayPort, 9444)
    assert.equal(restarted.peer.remoteGatewayInstanceId, 'instance-b')
    assert.equal(restarted.peer.remoteGatewayCredential, 'cred-b', 'a restart re-issues the credential with the leg')
    const third = await dialCount(3)
    assert.deepEqual(legs(third[2]), [`127.0.0.1:${forwarded}:127.0.0.1:9444`])
    assert.equal(listMachinePeers()[0].lastError, null)

    // once THIS machine publishes an ingress of its own, the same dial also builds the leg back: the accepting
    // side runs no ssh child, so the only way it can ever reach here is a port this dial publishes over there.
    publishHostRecord({ ...newHostRecord(`http://127.0.0.1:${forwarded}`), peerPort: 9555 })
    publish({ port: 9444, instanceId: 'instance-c', credential: 'cred-c' }, 41042)
    const paired = await control({ op: 'connect', sshAddress: 'gw-peer' })
    assert.ok(paired.ok && paired.peer)
    assert.equal(paired.peer.remoteBackPort, 41042, 'the far side named the port its own leg should arrive on')
    const fourth = await dialCount(4)
    assert.deepEqual(legs(fourth[3]), [`127.0.0.1:${forwarded}:127.0.0.1:9444`])
    assert.deepEqual(legs(fourth[3], '-R'), ['127.0.0.1:41042:127.0.0.1:9555'], 'the reverse leg lands on this gateway’s peer ingress, never on its console port')
  } finally {
    await gateway.close()
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    process.env.PATH = previousPath
    rmSync(home, { recursive: true, force: true })
  }
})
