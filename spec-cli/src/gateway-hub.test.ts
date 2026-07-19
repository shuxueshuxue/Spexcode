// gateway-hub security tests — the multi-project route contract driven over REAL HTTP ([[gateway-hub]]).
// A hub instance fronts two fake loopback "backends" (echo servers standing in for project supervisors);
// every boundary the contract promises is exercised as a visitor would hit it: implicit-loopback admin and
// the non-loopback lock, the admin bootstrap (first password set from loopback), the designed login flows,
// open-project passthrough, per-project confinement (a project session is worthless on the other project
// and on /projects), gen rotation, cookie stripping toward backends, hostile projectIds, non-loopback
// upstream records, and the gated WebSocket upgrade. Tests run as ONE sequential story sharing a store —
// the same lifecycle an operator walks.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHubGateway } from './gateway-hub.js'
import { authStorePath } from './gateway-auth.js'

let home = ''
let hubPort = 0
let hubWidePort = 0
const servers: http.Server[] = []
let adminCookie = ''   // captured as the story progresses
let projACookie = ''

function freePort(): Promise<number> {
  return new Promise((res) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) })
  })
}

// a stand-in project backend: echoes what it saw (so cookie-stripping is observable) and completes
// WebSocket-style upgrades reporting the Cookie header it received.
function fakeBackend(who: string, port: number): http.Server {
  const s = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ who, method: req.method, path: req.url, cookie: req.headers.cookie ?? null }))
  })
  s.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `x-seen-cookie: ${req.headers.cookie ?? 'none'}\r\n\r\n`)
    socket.end()
  })
  s.listen(port, '127.0.0.1')
  servers.push(s)
  return s
}

function registerProject(id: string, url: string): void {
  const dir = join(home, 'projects', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'backend.json'), JSON.stringify({ url, pid: process.pid }) + '\n')
}

const hub = (path: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${hubPort}${path}`, { redirect: 'manual', ...init })

const firstCookie = (res: Response): string => {
  const sc = res.headers.getSetCookie()
  assert.ok(sc.length > 0, 'expected a Set-Cookie')
  return sc[0].split(';')[0]
}

// a non-loopback IPv4 of this machine, if it has one — lets the suite prove the socket-address rule on a
// REAL remote-looking connection. Absent (CI without a NIC) → that one test skips.
const externalIPv4 = (): string | null => {
  for (const list of Object.values(networkInterfaces()))
    for (const i of list ?? []) if (!i.internal && i.family === 'IPv4') return i.address
  return null
}

before(async () => {
  home = mkdtempSync(join(tmpdir(), 'spex-hub-'))
  process.env.SPEXCODE_HOME = home
  const [pa, pb] = [await freePort(), await freePort()]
  fakeBackend('A', pa)
  fakeBackend('B', pb)
  registerProject('projA', `http://127.0.0.1:${pa}`)
  registerProject('projB', `http://127.0.0.1:${pb}`)
  registerProject('projEvil', 'http://93.184.216.34:80') // non-loopback record — must never be served
  hubPort = await freePort()
  servers.push(startHubGateway({ port: hubPort, host: '127.0.0.1' }))
  hubWidePort = await freePort()
  servers.push(startHubGateway({ port: hubWidePort, host: '0.0.0.0' })) // for the non-loopback tests only
  await new Promise((r) => setTimeout(r, 100))
})

after(() => { for (const s of servers) { s.closeAllConnections?.(); s.close() } })

test('an open project (no password) is served straight through — and gateway cookies never reach it', async () => {
  const res = await hub('/p/projA/api/thing?x=1', { headers: { cookie: `spex_admin_${hubPort}=forged; theme=dark` } })
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.who, 'A')
  assert.equal(body.path, '/api/thing?x=1', 'the /p/:id prefix is stripped, query preserved')
  assert.equal(body.cookie, 'theme=dark', 'spex_* cookies are stripped; foreign cookies pass')
})

test('no admin password: /projects is implicit from loopback, LOCKED from non-loopback (headers cannot spoof)', async (t) => {
  const res = await hub('/projects')
  assert.equal(res.status, 200)
  const body = await res.json() as any
  assert.equal(body.adminGated, false)
  assert.deepEqual(body.projects.map((p: any) => p.id), ['projA', 'projB'], 'the non-loopback upstream record is not listed')

  const ext = externalIPv4()
  if (!ext) return t.skip('no non-loopback IPv4 on this machine')
  const remote = await fetch(`http://${ext}:${hubWidePort}/projects`, { redirect: 'manual' })
  assert.equal(remote.status, 403, 'non-loopback /projects stays locked with no admin password')
  const spoofed = await fetch(`http://${ext}:${hubWidePort}/projects`, {
    redirect: 'manual', headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' },
  })
  assert.equal(spoofed.status, 403, 'the loopback decision reads the socket, never a header')
})

test('admin bootstrap: first password set from loopback mints a session; implicit access ends', async () => {
  const set = await hub('/projects/admin-password', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'root-pw' }),
  })
  assert.equal(set.status, 200)
  const raw = set.headers.getSetCookie()[0]
  assert.match(raw, /HttpOnly/, 'admin session cookie is HttpOnly')
  adminCookie = raw.split(';')[0]

  assert.equal((await hub('/projects')).status, 401, 'implicit loopback ends the moment an admin password exists')
  assert.equal((await hub('/projects', { headers: { cookie: adminCookie } })).status, 200)

  // the designed login: wrong password re-renders with the error; right password redirects with a cookie
  const wrong = await hub('/login', { method: 'POST', body: new URLSearchParams({ password: 'nope' }) })
  assert.equal(wrong.status, 401)
  assert.match(await wrong.text(), /Incorrect password/)
  const right = await hub('/login', { method: 'POST', body: new URLSearchParams({ password: 'root-pw' }) })
  assert.equal(right.status, 302)
  assert.equal(right.headers.get('location'), '/projects')
  adminCookie = firstCookie(right)
})

test('project gating: set → designed login → session confined to exactly that project', async () => {
  const set = await hub('/projects/projA/password', {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ password: 'a-pw' }),
  })
  assert.equal(set.status, 200)
  const list = await (await hub('/projects', { headers: { cookie: adminCookie } })).json() as any
  assert.equal(list.projects.find((p: any) => p.id === 'projA').gated, true)

  // unauthenticated: API paths answer 401 JSON; page paths redirect to the project login
  const api = await hub('/p/projA/api/graph')
  assert.equal(api.status, 401)
  assert.equal((await api.json() as any).login, '/p/projA/login')
  const page = await hub('/p/projA/')
  assert.equal(page.status, 302)
  assert.equal(page.headers.get('location'), '/p/projA/login')
  const login = await hub('/p/projA/login')
  assert.equal(login.status, 200)
  assert.match(await login.text(), /Project access/)

  const wrong = await hub('/p/projA/login', { method: 'POST', body: new URLSearchParams({ password: 'b-pw' }) })
  assert.equal(wrong.status, 401)
  const right = await hub('/p/projA/login', { method: 'POST', body: new URLSearchParams({ password: 'a-pw' }) })
  assert.equal(right.status, 302)
  assert.match(right.headers.getSetCookie()[0], /HttpOnly/)
  projACookie = firstCookie(right)
  const ok = await hub('/p/projA/api/graph', { headers: { cookie: projACookie } })
  assert.equal(ok.status, 200)
  assert.equal(((await ok.json()) as any).cookie, null, 'the project session cookie is stripped before the backend')

  // confinement: gate projB too, then try to cross with A's session
  await hub('/projects/projB/password', {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ password: 'b-pw' }),
  })
  assert.equal((await hub('/p/projB/api/graph', { headers: { cookie: projACookie } })).status, 401, "A's session is not B's")
  const tokenA = projACookie.split('=')[1]
  const relabeled = (await hub('/p/projB/api/graph', { headers: { cookie: `spex_proj_${hubPort}_${'0'.repeat(12)}=${tokenA}` } }))
  assert.equal(relabeled.status, 401, 'renaming the cookie changes nothing — the claim is validated')
  assert.equal((await hub('/projects', { headers: { cookie: projACookie } })).status, 401, 'a project session never manages')

  // admin reaches both projects; a tampered token reaches neither
  assert.equal((await hub('/p/projA/api/graph', { headers: { cookie: adminCookie } })).status, 200)
  assert.equal((await hub('/p/projB/api/graph', { headers: { cookie: adminCookie } })).status, 200)
  const tampered = projACookie.slice(0, -2) + (projACookie.endsWith('aa') ? 'ab' : 'aa')
  assert.equal((await hub('/p/projA/api/graph', { headers: { cookie: tampered } })).status, 401)
})

test('rotation and clearing: a re-set password kills old sessions; a cleared one opens the project', async () => {
  await hub('/projects/projA/password', {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ password: 'a-pw-2' }),
  })
  assert.equal((await hub('/p/projA/api/graph', { headers: { cookie: projACookie } })).status, 401, 'old session dead after password change')
  const del = await hub('/projects/projA/password', { method: 'DELETE', headers: { cookie: adminCookie } })
  assert.equal(del.status, 200)
  assert.equal((await hub('/p/projA/api/graph')).status, 200, 'cleared password → open project')
})

test('hostile projectIds: unknown, traversal-shaped, and non-loopback-upstream ids all 404 before any proxy', async () => {
  assert.equal((await hub('/p/nope/')).status, 404)
  assert.equal((await hub('/p/..%2F..%2Fetc/')).status, 404)
  // fetch() normalizes %2e%2e away client-side, so send the raw hostile path with http.request (curl --path-as-is territory)
  const rawStatus = (path: string) => new Promise<number>((resolve) => {
    http.get({ host: '127.0.0.1', port: hubPort, path }, (r) => { r.resume(); resolve(r.statusCode ?? 0) }).on('error', () => resolve(0))
  })
  assert.equal(await rawStatus('/p/%2e%2e/'), 404)
  assert.equal(await rawStatus('/p/%2e%2e/projA/backend.json'), 404)
  assert.equal((await hub('/p/projEvil/api/x')).status, 404, 'a backend record naming a non-loopback url is never proxied')
  const put = await hub('/projects/nope/password', {
    method: 'PUT', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ password: 'x' }),
  })
  assert.equal(put.status, 404)
})

test('store hygiene: verifiers live 0600 in the per-user store, plaintext never touches disk', async () => {
  assert.equal(statSync(authStorePath()).mode & 0o777, 0o600)
  const raw = readFileSync(authStorePath(), 'utf8')
  for (const pw of ['root-pw', 'a-pw', 'a-pw-2', 'b-pw']) assert.ok(!raw.includes(pw), `store must not contain '${pw}'`)
})

test('WebSocket upgrade: destroyed without a session on a gated project; piped (cookie-stripped) with one', async () => {
  const upgrade = (cookie?: string) => new Promise<string>((resolve) => {
    const s = net.connect(hubPort, '127.0.0.1', () => {
      s.write('GET /p/projB/api/sessions/x/socket HTTP/1.1\r\nHost: h\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' + (cookie ? `Cookie: ${cookie}; theme=dark\r\n` : '') + '\r\n')
    })
    let buf = ''
    s.on('data', (d) => { buf += d })
    s.on('close', () => resolve(buf))
    s.on('error', () => resolve(buf))
    setTimeout(() => { s.destroy(); resolve(buf) }, 1500)
  })
  const denied = await upgrade()
  assert.ok(!denied.includes('101'), 'no session → the socket is destroyed before any upstream contact')
  const granted = await upgrade(adminCookie)
  assert.match(granted, /101 Switching Protocols/)
  assert.match(granted, /x-seen-cookie: theme=dark/, 'the backend saw the visitor cookie but not the gateway session')
})
