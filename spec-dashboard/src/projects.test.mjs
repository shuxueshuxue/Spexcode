import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeProject, normalizeProjects, loadProjects, submitCredential } from './projects.js'

// The narrow catalog client ([[projects-hub]]): these tests pin the tolerant read side — what counts as a
// catalog, what counts as a gate, and what reads as "no multi-project surface here at all" — plus the
// credential post's routing. The HTTP layer is stubbed; the real gateway round-trip is the YATU scenario.

const jsonRes = (status, body, extra = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  redirected: false,
  headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
  json: async () => body,
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

const withFetch = async (impl, fn) => {
  const orig = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = orig }
}

test('normalizeProject defaults: name from path basename, unknown health, init true unless explicit false', () => {
  const p = normalizeProject({ id: 'x1', path: '/home/me/repos/gugu/' })
  assert.equal(p.name, 'gugu')
  assert.equal(p.health, 'unknown')
  assert.equal(p.initialized, true)
  assert.equal(p.locked, false)
  assert.equal(normalizeProject({ id: 'y', initialized: false }).initialized, false)
  assert.equal(normalizeProject({ id: 'y', hasPassword: true }).locked, true)
  assert.equal(normalizeProject({ path: '/no/id' }), null)
  assert.equal(normalizeProject('junk'), null)
})

test('normalizeProjects accepts a bare array or {projects}, rejects anything else', () => {
  assert.equal(normalizeProjects([{ id: 'a' }])[0].id, 'a')
  assert.equal(normalizeProjects({ projects: [{ id: 'b' }] })[0].id, 'b')
  assert.equal(normalizeProjects({ nope: 1 }), null)
  assert.equal(normalizeProjects('<!doctype html>'), null)
})

test('loadProjects: 200 JSON catalog → ok', async () => {
  const r = await withFetch(async () => jsonRes(200, { projects: [{ id: 'a', health: 'running' }] }), loadProjects)
  assert.equal(r.state, 'ok')
  assert.equal(r.projects[0].health, 'running')
})

test('loadProjects: 401 carries the gateway decision reason', async () => {
  const denied = await withFetch(async () => jsonRes(401, { error: 'auth', reason: 'admin-login' }), loadProjects)
  assert.deepEqual(denied, { state: 'denied', reason: 'admin-login' })
  const locked = await withFetch(async () => jsonRes(401, { error: 'auth', reason: 'locked' }), loadProjects)
  assert.deepEqual(locked, { state: 'denied', reason: 'locked' })
  const bare = await withFetch(async () => jsonRes(403, null), loadProjects)
  assert.deepEqual(bare, { state: 'denied', reason: 'admin-login' })
})

test('loadProjects: a pre-gateway SPA fallback (HTML 200) or a network failure reads as absent', async () => {
  const spa = await withFetch(async () => htmlRes(200), loadProjects)
  assert.deepEqual(spa, { state: 'absent' })
  const dead = await withFetch(async () => { throw new TypeError('fetch failed') }, loadProjects)
  assert.deepEqual(dead, { state: 'absent' })
  const notFound = await withFetch(async () => jsonRes(404, { error: 'no' }), loadProjects)
  assert.deepEqual(notFound, { state: 'absent' })
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

test('submitCredential: 401 is wrong-password, a redirected success is success', async () => {
  const bad = await withFetch(async () => jsonRes(401, null), () => submitCredential('admin', 'x'))
  assert.deepEqual(bad, { ok: false, error: 'wrong-password' })
  const redir = await withFetch(async () => ({ ...htmlRes(200), redirected: true }), () => submitCredential('admin', 'x'))
  assert.deepEqual(redir, { ok: true })
})
