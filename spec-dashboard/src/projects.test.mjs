import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProject, normalizeProjects, loadProjects, probeProjectHealth, setProjectPassword, clearProjectPassword, setAdminPassword, submitCredential } from './projects.js'

// The narrow catalog client ([[projects-hub]]): these tests pin the client half of the LANDED hub
// contract ([[gateway-hub]]) — the catalog shape, the status-code denial reasons (401 admin-login /
// 403 locked), the PUT/DELETE password writes, the health probe's redirect blindness, and the
// credential post's routing. The HTTP layer is stubbed; the real gateway round-trip is the YATU rig.

const jsonRes = (status, body, extra = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
  ...extra,
})
const htmlRes = (status, text = '<!doctype html>') => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
  json: async () => { throw new Error('not json') },
  text: async () => text,
})
const textRes = (status, text, extra = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  headers: { get: () => 'text/plain' },
  json: async () => { throw new Error('not json') },
  text: async () => text,
  ...extra,
})

const withFetch = async (impl, fn) => {
  const orig = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = orig }
}

test('normalizeProject carries the hub row (id/name/url/port/gated), defaults tolerant', () => {
  const p = normalizeProject({ id: '-home-me-repo', name: 'repo', url: 'http://127.0.0.1:8787', port: 8787, gated: true })
  assert.deepEqual(p, { id: '-home-me-repo', name: 'repo', url: 'http://127.0.0.1:8787', port: 8787, gated: true })
  assert.equal(normalizeProject({ id: 'x' }).name, 'x')
  assert.equal(normalizeProject({ id: 'x' }).gated, false)
  assert.equal(normalizeProject({ id: 'x', hasPassword: true }).gated, true) // older spelling tolerated
  assert.equal(normalizeProject({ url: 'http://x' }), null)                  // id required
  assert.equal(normalizeProject('junk'), null)
})

test('normalizeProjects accepts the hub envelope or a bare array, rejects anything else', () => {
  assert.equal(normalizeProjects({ adminGated: true, projects: [{ id: 'a' }] })[0].id, 'a')
  assert.equal(normalizeProjects([{ id: 'b' }])[0].id, 'b')
  assert.equal(normalizeProjects({ nope: 1 }), null)
  assert.equal(normalizeProjects('<!doctype html>'), null)
})

test('loadProjects: 200 hub envelope → ok with adminGated', async () => {
  const r = await withFetch(async () => jsonRes(200, { adminGated: false, projects: [{ id: 'a', gated: true }] }), loadProjects)
  assert.equal(r.state, 'ok')
  assert.equal(r.adminGated, false)
  assert.equal(r.projects[0].gated, true)
})

test('loadProjects: the denial reason is the STATUS — 401 admin-login, 403 locked', async () => {
  const denied = await withFetch(async () => jsonRes(401, { error: 'authentication required', login: '/login' }), loadProjects)
  assert.deepEqual(denied, { state: 'denied', reason: 'admin-login' })
  const locked = await withFetch(async () => jsonRes(403, { error: 'admin surface is locked: …' }), loadProjects)
  assert.deepEqual(locked, { state: 'denied', reason: 'locked' })
})

test('loadProjects: a pre-hub SPA fallback (HTML 200) or a network failure reads as absent', async () => {
  const spa = await withFetch(async () => htmlRes(200), loadProjects)
  assert.deepEqual(spa, { state: 'absent' })
  const dead = await withFetch(async () => { throw new TypeError('fetch failed') }, loadProjects)
  assert.deepEqual(dead, { state: 'absent' })
  const notFound = await withFetch(async () => jsonRes(404, { error: 'no' }), loadProjects)
  assert.deepEqual(notFound, { state: 'absent' })
})

test('password writes: PUT sets with a JSON body, DELETE clears; admin twin included; ids encoded', async () => {
  const calls = []
  const impl = async (url, init) => { calls.push({ url, method: init?.method, body: init?.body }); return jsonRes(200, { ok: true }) }
  await withFetch(impl, () => setProjectPassword('a b', 'pw'))
  await withFetch(impl, () => clearProjectPassword('a b'))
  await withFetch(impl, () => setAdminPassword('root-pw'))
  assert.deepEqual(calls[0], { url: '/projects/a%20b/password', method: 'PUT', body: '{"password":"pw"}' })
  assert.deepEqual(calls[1], { url: '/projects/a%20b/password', method: 'DELETE', body: undefined })
  assert.deepEqual(calls[2], { url: '/projects/admin-password', method: 'PUT', body: '{"password":"root-pw"}' })
})

test('probeProjectHealth: only a literal ok is running; 502, redirects-to-login, and death are unreachable', async () => {
  assert.equal(await withFetch(async () => textRes(200, 'ok\n'), () => probeProjectHealth('a')), 'running')
  assert.equal(await withFetch(async () => textRes(502, 'project backend unreachable'), () => probeProjectHealth('a')), 'unreachable')
  assert.equal(await withFetch(async () => htmlRes(200), () => probeProjectHealth('a')), 'unreachable') // login page HTML is not health
  assert.equal(await withFetch(async () => ({ ...textRes(200, 'ok'), redirected: true }), () => probeProjectHealth('a')), 'unreachable')
  assert.equal(await withFetch(async () => { throw new TypeError('dead') }, () => probeProjectHealth('a')), 'unreachable')
})

test('submitCredential routes admin → /login and a project unlock → /p/<id>/login (id encoded)', async () => {
  const calls = []
  const impl = async (url, init) => { calls.push({ url, body: init?.body }); return jsonRes(200, { ok: true }) }
  await withFetch(impl, () => submitCredential('admin', 'pw'))
  await withFetch(impl, () => submitCredential({ projectId: 'a b' }, 'pw'))
  assert.equal(calls[0].url, '/login')
  assert.equal(calls[1].url, '/p/a%20b/login')
  assert.equal(JSON.parse(calls[0].body).password, 'pw')
})

test('submitCredential: 401 wrong-password, 403 locked, a redirected success is success', async () => {
  const bad = await withFetch(async () => htmlRes(401), () => submitCredential('admin', 'x'))
  assert.deepEqual(bad, { ok: false, error: 'wrong-password' })
  const locked = await withFetch(async () => jsonRes(403, { error: 'no admin password is configured…' }), () => submitCredential('admin', 'x'))
  assert.deepEqual(locked, { ok: false, error: 'locked' })
  const redir = await withFetch(async () => ({ ...htmlRes(200), redirected: true }), () => submitCredential('admin', 'x'))
  assert.deepEqual(redir, { ok: true })
})
