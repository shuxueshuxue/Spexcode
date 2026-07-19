import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProject, normalizeProjects, loadProjects, probeProjectHealth,
  setProjectPassword, clearProjectPassword, setAdminPassword, submitCredential,
  addProject, loadProjectConfig, saveProjectConfig, runProjectOp, initProject, doctorProject, startProjectBackend,
} from './projects.js'

// The narrow catalog client ([[projects-hub]]): these tests pin the client half of the LANDED hub
// contract ([[gateway-hub]] / [[host-gateway]]) — the catalog shape, the status-code denial reasons
// (401 admin-login / 403 locked), the PUT/DELETE password writes, the health probe's redirect
// blindness, the credential post's routing, and the management verbs (register / init / doctor /
// config source / start-backend) with their transcript passthrough. The HTTP layer is stubbed; the real gateway
// round-trip is the YATU rig.

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

test('normalizeProject carries the hub row (id/name/root/online/url/port/gated), defaults tolerant', () => {
  const p = normalizeProject({ id: '-home-me-repo', name: 'repo', root: '/home/me/repo', online: true, url: 'http://127.0.0.1:8787', port: 8787, gated: true })
  assert.deepEqual(p, { id: '-home-me-repo', name: 'repo', root: '/home/me/repo', online: true, url: 'http://127.0.0.1:8787', port: 8787, gated: true })
  assert.equal(normalizeProject({ id: 'x' }).name, 'x')
  assert.equal(normalizeProject({ id: 'x' }).gated, false)
  assert.equal(normalizeProject({ id: 'x' }).online, null)   // a hub without the host extension: unknown, not false
  assert.equal(normalizeProject({ id: 'x', online: false }).online, false)
  assert.equal(normalizeProject({ id: 'x' }).root, '')
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

test('addProject posts {root} to /projects and normalizes the returned row', async () => {
  const calls = []
  const impl = async (url, init) => { calls.push({ url, method: init?.method, body: init?.body }); return jsonRes(200, { id: 'r', projectId: 'r', root: '/home/me/r', name: 'r', online: false, url: null }) }
  const r = await withFetch(impl, () => addProject('/home/me/r'))
  assert.deepEqual(calls[0], { url: '/projects', method: 'POST', body: '{"root":"/home/me/r"}' })
  assert.equal(r.ok, true)
  assert.equal(r.project.id, 'r')
  assert.equal(r.project.online, false)
})

test('addProject surfaces the host refusal verbatim (400 not-a-repo), tolerates non-JSON and death', async () => {
  const notRepo = await withFetch(async () => jsonRes(400, { error: '/tmp/x is not a git repository — …' }), () => addProject('/tmp/x'))
  assert.equal(notRepo.ok, false)
  assert.match(notRepo.error, /not a git repository/)
  const spa = await withFetch(async () => htmlRes(200), () => addProject('/x'))
  assert.deepEqual(spa, { ok: false, error: 'unexpected answer' })
  const dead = await withFetch(async () => { throw new TypeError('fetch failed') }, () => addProject('/x'))
  assert.deepEqual(dead, { ok: false, error: 'network' })
})

test('project config loads and revision-guarded saves the raw source; ids encoded', async () => {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method, body: init?.body && JSON.parse(init.body) })
    return jsonRes(200, init?.method === 'PUT'
      ? { ok: true, content: '{"preset":"default"}\n', revision: 'rev-2' }
      : { content: '{}\n', revision: 'rev-1' })
  }
  const loaded = await withFetch(impl, () => loadProjectConfig('a b'))
  const saved = await withFetch(impl, () => saveProjectConfig('a b', '{"preset":"default"}', loaded.revision))
  assert.deepEqual(calls[0], { url: '/projects/a%20b/config', method: undefined, body: undefined })
  assert.deepEqual(calls[1], {
    url: '/projects/a%20b/config', method: 'PUT',
    body: { content: '{"preset":"default"}', revision: 'rev-1' },
  })
  assert.deepEqual(saved, { ok: true, content: '{"preset":"default"}\n', revision: 'rev-2' })
})

test('project config surfaces conflicts and rejects malformed server answers', async () => {
  const conflict = await withFetch(async () => jsonRes(409, { error: 'spexcode.json changed on disk — reload before saving' }),
    () => saveProjectConfig('a', '{}', 'old'))
  assert.equal(conflict.status, 409)
  assert.match(conflict.error, /changed on disk/)
  const malformed = await withFetch(async () => jsonRes(200, { content: '{}' }), () => loadProjectConfig('a'))
  assert.deepEqual(malformed, { ok: false, error: 'unexpected answer' })
})

test('initProject carries only the EXPLICIT harness choice in the body; preset lives in spexcode.json', async () => {
  const calls = []
  const impl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return jsonRes(200, { ok: true, code: 0, output: '✓ done' }) }
  await withFetch(impl, () => initProject('a b', 'claude,codex'))
  assert.equal(calls[0].url, '/projects/a%20b/init')
  assert.deepEqual(calls[0].body, { harness: 'claude,codex' })
})

test('runProjectOp: truth is the exit code + transcript — a 200 with a non-zero code is a FAILED run', async () => {
  const fail = await withFetch(async () => jsonRes(200, { ok: false, code: 1, output: 'spex init: --harness is required — …' }), () => doctorProject('a'))
  assert.equal(fail.ok, false)
  assert.equal(fail.code, 1)
  assert.match(fail.output, /--harness is required/)
  const pass = await withFetch(async () => jsonRes(200, { ok: true, code: 0, output: 'report' }), () => doctorProject('a'))
  assert.deepEqual(pass, { ok: true, code: 0, output: 'report' })
})

test('runProjectOp: 404 unknown project and denial statuses read as errors, non-JSON tolerated', async () => {
  const unknown = await withFetch(async () => jsonRes(404, { error: "unknown project 'x' — add it first (POST /projects)" }), () => runProjectOp('x', 'doctor'))
  assert.equal(unknown.ok, false)
  assert.equal(unknown.status, 404)
  assert.match(unknown.error, /add it first/)
  const denied = await withFetch(async () => htmlRes(401), () => runProjectOp('x', 'doctor'))
  assert.deepEqual(denied, { ok: false, status: 401, error: 'http-401' })
})

test('startProjectBackend: 200 online is success, 409 already-online is the desired state, 502 carries the reason', async () => {
  const calls = []
  const ok = await withFetch(async (url, init) => { calls.push({ url, method: init?.method }); return jsonRes(200, { ok: true, project: { id: 'a', online: true, url: 'http://127.0.0.1:4001' } }) }, () => startProjectBackend('a'))
  assert.deepEqual(calls[0], { url: '/projects/a/serve', method: 'POST' })
  assert.equal(ok.ok, true)
  assert.equal(ok.project.online, true)
  const already = await withFetch(async () => jsonRes(409, { error: 'backend already online at …', project: { id: 'a', online: true } }), () => startProjectBackend('a'))
  assert.equal(already.ok, true)
  assert.equal(already.already, true)
  const dead = await withFetch(async () => jsonRes(502, { error: 'backend for /r did not come online within 45s — see /log' }), () => startProjectBackend('a'))
  assert.equal(dead.ok, false)
  assert.match(dead.error, /did not come online/)
})
