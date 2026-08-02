import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startHubGateway } from './gateway-hub.js'
import { encodeProject } from './layout.js'
import { sessionStoreDir } from './layout.js'
import { sessionWebKey, sessionWebsPath } from './session-web.js'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
}

async function freePort(host = '127.0.0.1'): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, host, done) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()))
  return address.port
}

async function runCli(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): Promise<{ code: number | null; out: string; err: string }> {
  const child = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout?.on('data', (chunk) => { out += String(chunk) })
  child.stderr?.on('data', (chunk) => { err += String(chunk) })
  await new Promise<void>((done) => child.once('close', done))
  return { code: child.exitCode, out, err }
}

async function requestUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`)
    })
    let text = ''
    socket.on('data', (chunk) => { text += String(chunk) })
    socket.on('end', () => resolve(text))
    socket.on('error', reject)
  })
}

test('session web CLI records a live loopback URL and the host gateway authorizes HTTP and WebSocket at request time', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-session-web-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const id = 'web-session'
  const oldCwd = process.cwd()
  const oldHome = process.env.SPEXCODE_HOME
  let gateway: http.Server | null = null
  let service: http.Server | null = null
  let ipv6Service: http.Server | null = null
  try {
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    writeFileSync(join(project, 'README.md'), 'fixture\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'web@example.test')
    git(project, 'config', 'user.name', 'web')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')

    process.env.SPEXCODE_HOME = home
    process.chdir(project)
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(join(sessionStoreDir(id), 'session.json'), JSON.stringify({ session_id: id }) + '\n')

    let page = 'first page'
    let requests = 0
    let upgradePath = ''
    const servicePort = await freePort()
    service = http.createServer((req, res) => {
      requests++
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(`${page}:${req.url}`)
    })
    service.on('upgrade', (req, socket) => {
      upgradePath = req.url || ''
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nweb-ok')
      socket.end()
    })
    await new Promise<void>((done, fail) => { service!.once('error', fail); service!.listen(servicePort, '127.0.0.1', done) })

    const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_SESSION_ID: id }
    const postedUrl = `http://127.0.0.1:${servicePort}/base/`
    const add = await runCli(project, env, 'session', 'web', 'add', postedUrl)
    assert.deepEqual({ code: add.code, out: add.out.trim(), requests }, { code: 0, out: `posted ${postedUrl}`, requests: 0 })
    assert.deepEqual(JSON.parse(readFileSync(sessionWebsPath(id), 'utf8')), [postedUrl])
    const listed = await runCli(project, env, 'session', 'web', 'ls')
    assert.deepEqual({ code: listed.code, out: listed.out.trim() }, { code: 0, out: postedUrl })
    const invalid = await runCli(project, env, 'session', 'web', 'add', 'https://127.0.0.1:4443/')
    assert.equal(invalid.code, 1)
    assert.match(invalid.err, /web URL must be http/)

    const gatewayPort = await freePort()
    const projectId = encodeProject(project)
    const endpointDir = join(home, 'projects', projectId)
    mkdirSync(endpointDir, { recursive: true })
    writeFileSync(join(endpointDir, 'backend.json'), JSON.stringify({
      version: 2, url: 'http://127.0.0.1:1', pid: process.pid, instanceId: 'fixture', root: project,
      identity: { title: 'fixture', icon: 'spark' }, startedAt: 'fixture',
    }) + '\n')
    gateway = startHubGateway({ port: gatewayPort, host: '127.0.0.1' })
    await new Promise<void>((done) => gateway!.once('listening', done))

    const key = sessionWebKey(postedUrl)
    const prefix = `/p/${encodeURIComponent(projectId)}/web/${id}/${key}`
    const first = await fetch(`http://127.0.0.1:${gatewayPort}${prefix}/page?x=1`)
    assert.deepEqual({ status: first.status, body: await first.text() }, { status: 200, body: 'first page:/base/page?x=1' })
    page = 'second page'
    const second = await fetch(`http://127.0.0.1:${gatewayPort}${prefix}/page?x=1`)
    assert.deepEqual({ status: second.status, body: await second.text() }, { status: 200, body: 'second page:/base/page?x=1' })

    const ipv6Port = await freePort('::1')
    ipv6Service = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(`ipv6:${req.url}`)
    })
    await new Promise<void>((done, fail) => { ipv6Service!.once('error', fail); ipv6Service!.listen(ipv6Port, '::1', done) })
    const ipv6Url = `http://[::1]:${ipv6Port}/v6/`
    assert.deepEqual(await runCli(project, env, 'session', 'web', 'add', ipv6Url), { code: 0, out: `posted ${ipv6Url}\n`, err: '' })
    const ipv6 = await fetch(`http://127.0.0.1:${gatewayPort}/p/${encodeURIComponent(projectId)}/web/${id}/${sessionWebKey(ipv6Url)}/page`)
    assert.deepEqual({ status: ipv6.status, body: await ipv6.text() }, { status: 200, body: 'ipv6:/v6/page' })
    assert.deepEqual(await runCli(project, env, 'session', 'web', 'retract', ipv6Url), { code: 0, out: `retracted ${ipv6Url}\n`, err: '' })
    const forbidden = await fetch(`http://127.0.0.1:${gatewayPort}/p/${encodeURIComponent(projectId)}/web/${id}/not-posted/`)
    assert.deepEqual({ status: forbidden.status, body: await forbidden.text(), requests }, {
      status: 403, body: 'that web service was not posted by this session', requests: 2,
    })
    const upgraded = await requestUpgrade(gatewayPort, `${prefix}/socket?debug=1`)
    assert.match(upgraded, /^HTTP\/1\.1 101 Switching Protocols/m)
    assert.match(upgraded, /web-ok/)
    assert.equal(upgradePath, '/base/socket?debug=1')

    const deadPort = await freePort()
    const deadUrl = `http://127.0.0.1:${deadPort}/`
    assert.equal((await runCli(project, env, 'session', 'web', 'add', deadUrl)).code, 0)
    const unavailable = await fetch(`http://127.0.0.1:${gatewayPort}/p/${encodeURIComponent(projectId)}/web/${id}/${sessionWebKey(deadUrl)}/`)
    assert.deepEqual({ status: unavailable.status, body: await unavailable.text() }, { status: 502, body: 'posted web service is unavailable' })

    const retract = await runCli(project, env, 'session', 'web', 'retract', postedUrl)
    assert.deepEqual({ code: retract.code, out: retract.out.trim() }, { code: 0, out: `retracted ${postedUrl}` })
    assert.deepEqual(JSON.parse(readFileSync(sessionWebsPath(id), 'utf8')), [deadUrl])
  } finally {
    process.chdir(oldCwd)
    if (oldHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = oldHome
    await new Promise<void>((done) => gateway ? gateway.close(() => done()) : done())
    await new Promise<void>((done) => service ? service.close(() => done()) : done())
    await new Promise<void>((done) => ipv6Service ? ipv6Service.close(() => done()) : done())
    rmSync(fixture, { recursive: true, force: true })
  }
})
