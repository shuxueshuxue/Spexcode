// The narrow data client for the multi-project gateway ([[projects-hub]]) — the ONE module that spells
// the LANDED hub contract ([[gateway-hub]] / [[gateway-auth]]):
//   GET  /projects                      → { adminGated, projects: [{ id, name, url, port, gated }] }
//   PUT|DELETE /projects/admin-password  set/clear the admin password (PUT answers with a fresh session)
//   PUT|DELETE /projects/:id/password    set/clear one project's password
//   POST /login · POST /p/:id/login      the credential posts (JSON {password}; success 302s, wrong 401)
// The registry is the machine's live backend records (a project appears by RUNNING `spex serve` in it),
// so there are no add/init/doctor/start verbs here — registration is the backend's own act, not a
// catalog write. Health is not a registry field either: the client probes each project's own
// `/p/:id/health` through the authorized proxy lane.
//
// Denial is read from the STATUS, exactly as the hub speaks it: 401 = credentials wanted ('admin-login'
// on the catalog, 'project-login' on a project api), 403 = the admin surface is locked (no admin
// password configured and the caller is not loopback). Every reader is tolerant: a non-JSON answer (a
// pre-hub server's SPA fallback for /projects) reads as { state: 'absent' } — the multi-project UI
// simply doesn't exist there — and unknown/missing fields default instead of throwing.

const jsonOf = async (res) => {
  if (!(res.headers.get('content-type') || '').includes('json')) return null
  return res.json().catch(() => null)
}

// one catalog row, whatever the server sent → the shape the UI renders.
export function normalizeProject(p) {
  if (!p || typeof p !== 'object') return null
  const id = p.id ?? p.projectId
  if (!id) return null
  return {
    id: String(id),
    name: p.name || String(id),
    url: p.url || '',
    port: p.port ?? null,
    gated: !!(p.gated ?? p.locked ?? p.hasPassword),
  }
}
export const normalizeProjects = (body) => {
  const list = Array.isArray(body) ? body : Array.isArray(body?.projects) ? body.projects : null
  return list ? list.map(normalizeProject).filter(Boolean) : null
}

// GET /projects → { state: 'ok', adminGated, projects } | { state: 'denied', reason } | { state: 'absent' }.
export async function loadProjects() {
  let res
  try { res = await fetch('/projects', { cache: 'no-store', headers: { Accept: 'application/json' } }) }
  catch { return { state: 'absent' } }
  if (res.status === 401) return { state: 'denied', reason: 'admin-login' }
  if (res.status === 403) return { state: 'denied', reason: 'locked' }
  if (!res.ok) return { state: 'absent' }
  const body = await jsonOf(res)
  const projects = normalizeProjects(body)
  return projects ? { state: 'ok', adminGated: !!body?.adminGated, projects } : { state: 'absent' }
}

// liveness of one project's backend, probed through the authorized /p/:id lane (the hub proxies /health
// to the loopback backend, which answers a bare 'ok'). Anything else — a 502 from a dead backend, a
// redirect to a login page, a timeout — reads 'unreachable'. Only the admin catalog calls this, so the
// probe rides the admin scope.
export async function probeProjectHealth(id, { timeoutMs = 2500 } = {}) {
  try {
    const res = await fetch(`/p/${encodeURIComponent(id)}/health`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok || res.redirected) return 'unreachable'
    return (await res.text()).trim() === 'ok' ? 'running' : 'unreachable'
  } catch { return 'unreachable' }
}

// password writes — PUT sets, DELETE clears, both admin-scoped, JSON {password} body on PUT.
async function passwordWrite(url, method, password) {
  let res
  try {
    res = await fetch(url, {
      method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      ...(method === 'PUT' ? { body: JSON.stringify({ password }) } : {}),
    })
  } catch { return { ok: false, error: 'network' } }
  const data = (await jsonOf(res)) || {}
  return { ok: res.ok && data.ok !== false, status: res.status, ...(data.error ? { error: data.error } : {}) }
}
export const setProjectPassword = (id, password) => passwordWrite(`/projects/${encodeURIComponent(id)}/password`, 'PUT', password)
export const clearProjectPassword = (id) => passwordWrite(`/projects/${encodeURIComponent(id)}/password`, 'DELETE')
// setting the admin password also rotates the caller's session cookie server-side (the loopback
// bootstrap stays signed in the moment the implicit access ends).
export const setAdminPassword = (password) => passwordWrite('/projects/admin-password', 'PUT', password)
export const clearAdminPassword = () => passwordWrite('/projects/admin-password', 'DELETE')

// the unified credential post ([[projects-hub]]'s CredentialGate): admin sign-in lands on /login, a
// project unlock on /p/:id/login — the hub's designed-login POST (JSON {password}; success mints the
// httpOnly scope cookie and 302s, a wrong password answers 401, an unconfigured admin gate 403s).
// fetch follows the success redirect to HTML, so "ok" is simply "not 4xx"; the caller re-runs its
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
  if (res.status === 401) return { ok: false, error: 'wrong-password' }
  if (res.status === 403) return { ok: false, error: 'locked' }
  return res.ok || res.redirected ? { ok: true } : { ok: false, error: `http-${res.status}` }
}
