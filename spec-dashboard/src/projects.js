// The narrow data client for the multi-project gateway contract ([[projects-hub]]) — the ONE module that
// spells the agreed HTTP surface: the root-scoped catalog `GET /projects` (admin scope), the management
// verbs under `/projects/:id/*`, and the two credential posts (`POST /login` for the admin scope,
// `POST /p/:id/login` for a project unlock — same JSON `{password}` body the existing single-project
// gateway login already accepts). Everything else in the app talks to `/p/:id/api/*` through the ordinary
// data layer; nothing outside this file names a catalog route, so a contract adjustment on the gateway
// side lands here and nowhere else.
//
// Every reader is deliberately tolerant: a non-JSON answer (a pre-gateway server's SPA fallback serving
// index.html for /projects, a vite dev server) reads as { state: 'absent' } — the multi-project UI simply
// doesn't exist there — and unknown/missing fields default instead of throwing. 401 surfaces the
// gateway's decision reason ('admin-login' | 'locked' | 'project-login') so the credential UI can pick
// its face.

const jsonOf = async (res) => {
  if (!(res.headers.get('content-type') || '').includes('json')) return null
  return res.json().catch(() => null)
}

// one catalog row, whatever the server sent → the shape the UI renders. `health` stays the server's word
// (running | stopped | unreachable expected, anything else rendered verbatim — never remapped here).
export function normalizeProject(p) {
  if (!p || typeof p !== 'object') return null
  const id = p.id ?? p.projectId
  if (!id) return null
  const path = p.path || ''
  return {
    id: String(id),
    name: p.name || (path ? path.split('/').filter(Boolean).pop() : String(id)),
    path,
    health: p.health || p.status || 'unknown',
    icon: p.icon || '',
    initialized: p.initialized !== false, // only an explicit false renders the Init affordance
    locked: !!(p.locked ?? p.hasPassword),
  }
}
export const normalizeProjects = (body) => {
  const list = Array.isArray(body) ? body : Array.isArray(body?.projects) ? body.projects : null
  return list ? list.map(normalizeProject).filter(Boolean) : null
}

// GET /projects → { state: 'ok', projects } | { state: 'denied', reason } | { state: 'absent' }.
// 'denied' means a gateway IS there and wants credentials (reason 'admin-login') or is locked with no
// admin verifier configured (reason 'locked'); 'absent' means no catalog surface exists at all.
export async function loadProjects() {
  let res
  try { res = await fetch('/projects', { cache: 'no-store', headers: { Accept: 'application/json' } }) }
  catch { return { state: 'absent' } }
  if (res.status === 401 || res.status === 403) {
    const body = await jsonOf(res)
    return { state: 'denied', reason: body?.reason === 'locked' ? 'locked' : 'admin-login' }
  }
  if (!res.ok) return { state: 'absent' }
  const projects = normalizeProjects(await jsonOf(res))
  return projects ? { state: 'ok', projects } : { state: 'absent' }
}

// management verbs — plain POSTs (never a retrying wrapper: a retried POST could double-register or
// double-launch). Each returns { ok, error?, ...body } with the server's JSON spread through.
async function post(url, body) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch { return { ok: false, error: 'network' } }
  const data = (await jsonOf(res)) || {}
  return { ok: res.ok && data.ok !== false, status: res.status, ...data }
}

const projectVerb = (id, verb) => `/projects/${encodeURIComponent(id)}${verb ? `/${verb}` : ''}`

// register a repository with the gateway; `harnesses` is the EXPLICIT harness choice ([[harness-adapter]])
// the init materializes for — the graphical twin of spexcode.json's required `harnesses` field.
export const addProject = (path, harnesses) => post('/projects', { path, harnesses })
export const initProject = (id, harnesses) => post(projectVerb(id, 'init'), { harnesses })
export const startProject = (id) => post(projectVerb(id, 'start'))
// doctor returns its human-readable report as { ok, output } — rendered verbatim, never parsed.
export const doctorProject = (id) => post(projectVerb(id, 'doctor'))
export const setProjectPassword = (id, password) => post(projectVerb(id, 'password'), { password })
export async function clearProjectPassword(id) {
  let res
  try { res = await fetch(projectVerb(id, 'password'), { method: 'DELETE', headers: { Accept: 'application/json' } }) }
  catch { return { ok: false, error: 'network' } }
  const data = (await jsonOf(res)) || {}
  return { ok: res.ok && data.ok !== false, ...data }
}

// the unified credential post ([[projects-hub]]'s CredentialGate): admin sign-in lands on /login, a
// project unlock on /p/:id/login — the same designed-login POST the gateway already speaks (JSON
// {password}; success mints the httpOnly scope cookie and answers a redirect/2xx, a wrong password 401).
// fetch follows the success redirect to HTML, so "ok" is simply "not 401/403"; the caller re-runs its
// denied loads and the fresh cookie does the rest.
export async function submitCredential(scope, password) {
  const url = scope === 'admin' ? '/login' : `/p/${encodeURIComponent(scope.projectId)}/login`
  let res
  try {
    res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
  } catch { return { ok: false, error: 'network' } }
  if (res.status === 401 || res.status === 403) return { ok: false, error: 'wrong-password' }
  return res.ok || res.redirected ? { ok: true } : { ok: false, error: `http-${res.status}` }
}
