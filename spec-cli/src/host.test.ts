// Integration tests for the host level ([[host-gateway]]): the instance-validated endpoint record, the
// reconciler's identity checks, the /p/:projectId/* proxy (HTTP path rewrite + WS pipe), the host
// project surface, and the real `spex serve` publish/remove loop.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  publishEndpoint, dropOwnEndpoint, endpointRecordPath, readCatalog, addKnownProject,
  reconcileProjects, reconcileNow, startHostGateway, type EndpointRecord,
} from './host.js'
import { encodeProject } from './layout.js'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))

const freshHome = (tag: string): string => {
  const home = mkdtempSync(join(tmpdir(), `spex-host-${tag}-`))
  process.env.SPEXCODE_HOME = home
  return home
}
const rec = (over: Partial<EndpointRecord> & { root: string; url: string }): EndpointRecord =>
  ({ pid: 12345, instanceId: 'inst-x', startedAt: new Date().toISOString(), ...over })

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number; url: string }> {
  return new Promise((res) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      res({ server, port, url: `http://127.0.0.1:${port}` })
    })
  })
}
// a fake project backend: answers /api/instance with the given identity and echoes any other /api path.
function fakeBackend(identity: { instanceId: string; root: string }) {
  const seen: string[] = []
  const made = listen((req, res) => {
    seen.push(req.url || '')
    if (req.url === '/api/instance') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(identity)); return }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ echoedPath: req.url }))
  })
  return made.then((m) => ({ ...m, seen }))
}
const getJson = (url: string): Promise<{ status: number; body: any }> =>
  fetch(url).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

test('publishEndpoint writes atomically; dropOwnEndpoint removes only its own record', () => {
  freshHome('record')
  const root = '/proj/alpha'
  publishEndpoint(rec({ root, url: 'http://127.0.0.1:1', instanceId: 'gen-1' }))
  const onDisk = JSON.parse(readFileSync(endpointRecordPath(root), 'utf8'))
  assert.equal(onDisk.instanceId, 'gen-1')
  assert.equal(onDisk.root, root)
  // a newer serve overwrites; the OLD generation's drop must not delete the new record
  publishEndpoint(rec({ root, url: 'http://127.0.0.1:2', instanceId: 'gen-2' }))
  dropOwnEndpoint('gen-1', root)
  assert.equal(JSON.parse(readFileSync(endpointRecordPath(root), 'utf8')).instanceId, 'gen-2')
  dropOwnEndpoint('gen-2', root)
  assert.equal(existsSync(endpointRecordPath(root)), false)
})

test('reconcile validates instance identity and unions with the durable catalog', async () => {
  const home = freshHome('reconcile')
  const rootOk = '/proj/ok', rootBad = '/proj/bad', rootDead = '/proj/dead', rootCatalog = '/proj/catalog-only'
  const ok = await fakeBackend({ instanceId: 'inst-ok', root: rootOk })
  const bad = await fakeBackend({ instanceId: 'DIFFERENT', root: rootBad })   // identity mismatch
  try {
    publishEndpoint(rec({ root: rootOk, url: ok.url, instanceId: 'inst-ok' }))
    publishEndpoint(rec({ root: rootBad, url: bad.url, instanceId: 'inst-bad' }))
    publishEndpoint(rec({ root: rootDead, url: 'http://127.0.0.1:1', instanceId: 'inst-dead' }))   // nothing listening
    // a record copied into a slot its root does not own is not trusted (no entry may come from it)
    const foreignSlot = join(home, 'projects', encodeProject('/proj/foreign'))
    mkdirSync(foreignSlot, { recursive: true })
    writeFileSync(join(foreignSlot, 'backend.json'), readFileSync(endpointRecordPath(rootOk)))
    // a legacy {url,pid} record (pre-identity) is ignored by the host
    const legacySlot = join(home, 'projects', encodeProject('/proj/legacy'))
    mkdirSync(legacySlot, { recursive: true })
    writeFileSync(join(legacySlot, 'backend.json'), JSON.stringify({ url: ok.url, pid: 1 }))
    writeFileSync(join(home, 'projects.json'), JSON.stringify({ projects: [{ root: rootCatalog, addedAt: 'x' }] }))

    const list = await reconcileProjects()
    const by = Object.fromEntries(list.map((p) => [p.root, p]))
    assert.equal(by[rootOk].online, true)
    assert.equal(by[rootOk].url, ok.url)
    assert.equal(by[rootOk].projectId, encodeProject(rootOk))
    assert.equal(by[rootBad].online, false, 'identity mismatch must read offline')
    assert.equal(by[rootBad].url, null)
    assert.equal(by[rootDead].online, false, 'dead url must read offline')
    assert.equal(by[rootCatalog].online, false, 'catalog-only project listed offline')
    assert.equal(by['/proj/foreign'], undefined, 'a mis-slotted record must yield nothing')
    assert.equal(by['/proj/legacy'], undefined, 'a legacy record must yield nothing')
    // auto-adoption: the validated live root became durable catalog knowledge
    assert.ok(readCatalog().some((e) => e.root === rootOk))
  } finally { ok.server.close(); bad.server.close() }
})

test('addKnownProject normalizes to the main checkout and requires a git repo', () => {
  freshHome('catalog')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  mkdirSync(join(repo, 'sub'))
  const root = addKnownProject(join(repo, 'sub'))   // a path INSIDE the repo lands on the repo root
  assert.equal(readFileSync(join(root, '.git', 'HEAD'), 'utf8').length > 0, true)
  assert.deepEqual(readCatalog().map((e) => e.root), [root])
  addKnownProject(repo)   // dedupe
  assert.equal(readCatalog().length, 1)
  const notRepo = mkdtempSync(join(tmpdir(), 'spex-host-norepo-'))
  assert.throws(() => addKnownProject(notRepo), /not a git repository/)
})

test('host gateway: project list + stream, /p/:projectId proxy rewrite, offline 502, static shell, WS pipe', async () => {
  const home = freshHome('gateway')
  const rootLive = '/proj/live-one'
  const backend = await fakeBackend({ instanceId: 'inst-live', root: rootLive })
  // the fake backend also answers a WS upgrade so the raw pipe can be proven end to end
  let upgradePath = ''
  backend.server.on('upgrade', (req, socket) => {
    upgradePath = req.url || ''
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello-from-backend')
  })
  publishEndpoint(rec({ root: rootLive, url: backend.url, instanceId: 'inst-live' }))
  writeFileSync(join(home, 'projects.json'), JSON.stringify({ projects: [{ root: '/proj/asleep', addedAt: 'x' }] }))
  const dist = mkdtempSync(join(tmpdir(), 'spex-host-dist-'))
  writeFileSync(join(dist, 'index.html'), '<html>shell</html>')

  const gwPort = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) }) })
  const gw = startHostGateway({ port: gwPort, host: '127.0.0.1', distDir: dist })
  await new Promise<void>((res) => gw.server.once('listening', () => res()))
  const base = `http://127.0.0.1:${gwPort}`
  const liveId = encodeProject(rootLive)
  try {
    // the validated live list, and the SSE stream's immediate snapshot
    const list = await getJson(`${base}/api/host/projects`)
    assert.equal(list.status, 200)
    const live = list.body.find((p: any) => p.projectId === liveId)
    assert.equal(live.online, true)
    assert.equal(list.body.find((p: any) => p.root === '/proj/asleep').online, false)
    const streamFirst = await new Promise<string>((res, rej) => {
      const req = http.get(`${base}/api/host/projects/stream`, (r) => {
        let buf = ''
        r.on('data', (d) => { buf += d; if (buf.includes('\n\n')) { req.destroy(); res(buf) } })
      })
      req.on('error', () => rej(new Error('stream failed before first event')))
      setTimeout(() => rej(new Error('no SSE event within 5s')), 5000).unref()
    })
    assert.match(streamFirst, /^data: \[/)
    assert.ok(streamFirst.includes(liveId))

    // proxy: the /p prefix is stripped — the backend must see the bare /api path, query intact
    const proxied = await getJson(`${base}/p/${liveId}/api/graph?x=1`)
    assert.equal(proxied.status, 200)
    assert.equal(proxied.body.echoedPath, '/api/graph?x=1')
    // routing is per-request path state: unknown project 404s, offline project 502s with the repair
    assert.equal((await getJson(`${base}/p/no-such/api/graph`)).status, 404)
    const asleep = await getJson(`${base}/p/${encodeProject('/proj/asleep')}/api/graph`)
    assert.equal(asleep.status, 502)
    assert.match(asleep.body.error, /no live backend/)
    // non-API project-scoped paths (and the root) serve the SPA shell
    for (const p of ['/', `/p/${liveId}/`, `/p/${liveId}/issues/3`]) {
      const r = await fetch(`${base}${p}`)
      assert.equal(r.status, 200)
      assert.match(await r.text(), /shell/)
    }

    // registration: a real git repo adds (offline), a non-repo refuses
    const repo = mkdtempSync(join(tmpdir(), 'spex-host-addrepo-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    const added = await fetch(`${base}/api/host/projects`, { method: 'POST', body: JSON.stringify({ root: repo }) })
    assert.equal(added.status, 200)
    assert.equal((await added.json()).online, false)
    const refused = await fetch(`${base}/api/host/projects`, { method: 'POST', body: JSON.stringify({ root: join(repo, 'nope') }) })
    assert.equal(refused.status, 400)

    // the WS upgrade raw-pipes to the project's backend with the same prefix strip
    const wsBytes = await new Promise<string>((res, rej) => {
      const sock = net.connect(gwPort, '127.0.0.1', () => {
        sock.write(`GET /p/${liveId}/api/sessions/s1/socket HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
      })
      let buf = ''
      sock.on('data', (d) => { buf += d; if (buf.includes('hello-from-backend')) { sock.destroy(); res(buf) } })
      sock.on('error', rej)
      setTimeout(() => { sock.destroy(); rej(new Error(`no WS bytes within 5s (got: ${buf.slice(0, 200)})`)) }, 5000).unref()
    })
    assert.match(wsBytes, /101 Switching Protocols/)
    assert.equal(upgradePath, '/api/sessions/s1/socket')
  } finally {
    await gw.close()
    backend.server.close()
  }
})

test('a real `spex serve` publishes a validated record and removes it on clean stop', async () => {
  const home = freshHome('serve-e2e')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-serve-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) }) })
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home }
  delete env.PORT; delete env.SPEXCODE_API_URL; delete env.SPEXCODE_SESSION_ID; delete env.SPEXCODE_INSTANCE_ID
  const child = spawn(process.execPath, [tsxBin(join(here, '..')), join(here, 'cli.ts'), 'serve', '--port', String(port)], { cwd: repo, env })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  try {
    // wait for the record — published only AFTER the public bind succeeds
    const file = endpointRecordPath(repo)
    const deadline = Date.now() + 90_000
    while (!existsSync(file)) {
      assert.ok(Date.now() < deadline, `no endpoint record within 90s; serve output:\n${out}`)
      await new Promise((r) => setTimeout(r, 300))
    }
    const record = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(record.url, `http://127.0.0.1:${port}`)
    assert.equal(record.root, repo)
    assert.equal(typeof record.instanceId, 'string')
    // the live backend answers the SAME identity the record claims → the reconciler lists it online
    const inst = await fetch(`${record.url}/api/instance`).then((r) => r.json()) as any
    assert.equal(inst.instanceId, record.instanceId)
    assert.equal(inst.root, repo)
    const entry = (await reconcileNow()).find((p) => p.root === repo)
    assert.equal(entry?.online, true)
    // clean stop removes ONLY its own record
    child.kill('SIGTERM')
    const gone = Date.now() + 20_000
    while (existsSync(file)) {
      assert.ok(Date.now() < gone, `record not removed on clean stop; serve output:\n${out}`)
      await new Promise((r) => setTimeout(r, 200))
    }
  } finally {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
  }
})
