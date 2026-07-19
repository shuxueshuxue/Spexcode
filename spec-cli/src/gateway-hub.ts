// @@@ gateway hub - the multi-project face of [[public-mode]]: ONE gateway fronting every project backend
// this user runs. The backends stay loopback internal services (each `spex serve` records its endpoint in
// ~/.spexcode/projects/<enc>/backend.json — that record IS the hub's registry); the hub terminates the
// outside world, decides authorization ([[gateway-auth]] — the single mechanism, two signed scopes), and
// reverse-proxies into the matching loopback backend with the gateway's own cookies STRIPPED, so a backend
// never sees a credential.
//
// The route contract:
//   /login /logout                      admin session (the designed login page)
//   GET /projects                       admin: list the registry (+ gating state); with a host shell
//                                       mounted, an explicit text/html GET gets the Projects UI instead
//   PUT|DELETE /projects/admin-password admin: set/clear the admin password
//   PUT|DELETE /projects/:id/password   admin: set/clear one project's password
//   /p/:projectId/login|logout          project session for that project
//   ANY /p/:projectId/*  (+ WS upgrade) authorized → proxied, prefix-stripped, to that project's backend
// Authorization never trusts the cookie's name or Path — the token's projectId claim is validated against
// the :projectId in the URL on every request (see gateway-auth.ts).
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  adminCookieName, authorize, clearAdminPassword, clearProjectPassword, loadAuthStore, mintToken,
  projectCookieName, setAdminPassword, setProjectPassword, verifyPassword, type AuthStore,
} from './gateway-auth.js'
import { loginPage } from './login-page.js'
import { listenOrExit } from './listen.js'
import { installConnectionReaper } from './reaper.js'
import { spexcodeHome, encodeProject } from './layout.js'
import { readEndpointRecord } from './host.js'

export type HubProject = { id: string; name: string; url: string; port: number; gated: boolean }
// @@@ extension seam - the hub stays the ONE routing+authorization server; a host-level caller
// ([[host-gateway]]'s `spex dashboard`) plugs richer behavior in here instead of running a second
// gateway beside it. All three hooks are optional; bare startHubGateway behavior is unchanged.
export type HubExtensions = {
  // enriched GET /projects rows (reconciled online/offline entries + the durable catalog); the hub
  // still owns the envelope ({adminGated, projects}) and the admin gate in front of it.
  listProjects?: (store: AuthStore) => Promise<object[]> | object[]
  // extra ADMIN-scope routes under /projects/* (stream, registration, project operations) — called only
  // AFTER admin authorization, for /projects paths the hub itself doesn't handle. True = handled.
  adminRoute?: (req: http.IncomingMessage, res: http.ServerResponse, path: string) => Promise<boolean> | boolean
  // paths the hub would 404 (everything outside /projects, /p, /login) — the dashboard SPA shell +
  // assets. Unauthorized by design: the shell is code, not data; every data call it makes re-enters
  // the authorized routes.
  fallback?: (req: http.IncomingMessage, res: http.ServerResponse, path: string) => void
}
export type HubOpts = { port: number; host?: string; tls?: { cert: string; key: string } | null; label?: string; onBindFail?: () => void; extensions?: HubExtensions }

// ---- registry ---------------------------------------------------------------------------------------
// A project = a live backend record under ~/.spexcode/projects/<enc>/backend.json (written by supervise.ts
// at bind time). The <enc> dir name is the projectId. ONE record-read seam ([[host-gateway]]'s
// readEndpointRecord — the identity-carrying shape): a legacy or torn record is not routable, and a record
// sitting in a slot its own root does not encode to is not trusted. Only LOOPBACK upstream urls are
// honored — the hub proxies into this machine's trust boundary, never out to an arbitrary host a crafted
// record names.

function upstreamOf(id: string): { url: string; port: number } | null {
  const rec = readEndpointRecord(join(spexcodeHome(), 'projects', id, 'backend.json'))
  if (!rec || encodeProject(rec.root) !== id) return null
  let u: URL
  try { u = new URL(rec.url) } catch { return null }
  if (u.protocol !== 'http:' || (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')) {
    console.error(`[hub] ignoring project '${id}': backend url ${rec.url} is not a loopback http endpoint`)
    return null
  }
  const port = Number(u.port || 80)
  if (!Number.isInteger(port) || port <= 0) return null
  return { url: rec.url, port }
}

// a projectId arrives as ONE url path segment; reject anything that could re-shape the registry path.
function validProjectId(id: string): boolean {
  return id.length > 0 && id.length <= 256 && id !== '.' && id !== '..' &&
    !id.includes('/') && !id.includes('\\') && !id.includes('\0')
}

export function listHubProjects(store: AuthStore): HubProject[] {
  const dir = join(spexcodeHome(), 'projects')
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { /* no projects yet */ }
  const out: HubProject[] = []
  for (const id of entries) {
    const up = upstreamOf(id)
    if (!up) continue
    // cosmetic display name: the last path-ish segment of the encoded root
    const name = id.split('-').filter(Boolean).pop() ?? id
    out.push({ id, name, url: up.url, port: up.port, gated: !!store.projects[id] })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

// ---- helpers ----------------------------------------------------------------------------------------

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}
function redirect(res: http.ServerResponse, location: string, setCookie?: string): void {
  res.writeHead(302, { Location: location, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) })
  res.end()
}

function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (d) => { body += d; if (body.length > limit) { req.destroy(); resolve('') } })
    req.on('end', () => resolve(body))
    req.on('error', () => resolve(''))
  })
}

// the login POST accepts the designed page's form encoding or JSON (the future admin UI)
function passwordOf(req: http.IncomingMessage, body: string): string {
  try {
    return req.headers['content-type']?.includes('application/json')
      ? String(JSON.parse(body).password ?? '')
      : new URLSearchParams(body).get('password') ?? ''
  } catch { return '' }
}

// the gateway's own cookies never cross into a backend — a backend knows nothing about visitors, and a
// leaked gateway token in some backend log would be a credential spill. Everything else passes through.
function stripGatewayCookies(header: string | undefined): string {
  return (header ?? '').split(';').map((s) => s.trim())
    .filter((p) => p && !/^spex_(admin|proj|auth)_/i.test(p.slice(0, Math.max(p.indexOf('='), 0))))
    .join('; ')
}

function cookieAttrs(secure: boolean): string {
  return `; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`
}

// ---- the hub ----------------------------------------------------------------------------------------

export function startHubGateway(opts: HubOpts): http.Server {
  const secure = !!opts.tls
  const port = opts.port
  const ext = opts.extensions ?? {}
  const attrs = cookieAttrs(secure)
  const clearCookie = (name: string) => `${name}=; HttpOnly; Path=/; Max-Age=0`

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // the store is re-read per request: a password set/clear (this process or another) is live at once,
    // and there is no in-memory session state to invalidate.
    const store = loadAuthStore()
    const rawUrl = req.url || '/'
    const q = rawUrl.indexOf('?')
    const path = q >= 0 ? rawUrl.slice(0, q) : rawUrl
    const query = q >= 0 ? rawUrl.slice(q) : ''
    const remote = req.socket.remoteAddress
    const cookies = req.headers.cookie
    const adminz = () => authorize(store, { kind: 'admin' }, cookies, remote, port)

    // ---- admin surface ----
    if (path === '/') return redirect(res, '/projects')
    if (path === '/login') {
      if (!store.admin) return req.method === 'POST'
        ? sendJson(res, 403, { error: 'no admin password is configured — /projects is manageable from loopback only' })
        : redirect(res, '/projects')
      if (req.method === 'POST') {
        const pw = passwordOf(req, await readBody(req))
        if (verifyPassword(store.admin, pw)) return redirect(res, '/projects', `${adminCookieName(port)}=${mintToken(store, { s: 'admin' })}${attrs}`)
        return sendHtml(res, 401, loginPage(true))
      }
      return sendHtml(res, 200, loginPage(false))
    }
    if (path === '/logout') return redirect(res, '/login', clearCookie(adminCookieName(port)))

    if (path === '/projects' || path.startsWith('/projects/')) {
      // browser navigation (the `/` redirect lands here with Accept: text/html) wants the Projects UI,
      // not the catalog envelope. With a host shell mounted, an explicit text/html GET is served the SPA
      // shell — code, not data, same unauthorized-by-design posture as the fallback seam: every data call
      // the shell makes re-enters the JSON route below with its auth gate intact. API fetches
      // (application/json, */*, no Accept) keep the JSON catalog unchanged, as does the bare hub.
      if (path === '/projects' && req.method === 'GET' && ext.fallback && (req.headers.accept ?? '').includes('text/html')) {
        return ext.fallback(req, res, path)
      }
      const d = adminz()
      if (!d.ok) {
        return d.reason === 'locked'
          ? sendJson(res, 403, { error: 'admin surface is locked: no admin password is configured and this is not a loopback connection' })
          : sendJson(res, 401, { error: 'authentication required', login: '/login' })
      }
      if (path === '/projects' && req.method === 'GET') {
        return sendJson(res, 200, { adminGated: !!store.admin, projects: await (ext.listProjects ? ext.listProjects(store) : listHubProjects(store)) })
      }
      if (path === '/projects/admin-password') {
        if (req.method === 'PUT') {
          const pw = passwordOf(req, await readBody(req))
          if (!pw) return sendJson(res, 400, { error: 'body must be JSON {"password": "<non-empty>"}' })
          const next = setAdminPassword(pw)
          // the setter stays authenticated: implicit-loopback access ends the moment the password exists,
          // so hand them a session minted under the new verifier in the same response.
          res.setHeader('Set-Cookie', `${adminCookieName(port)}=${mintToken(next, { s: 'admin' })}${attrs}`)
          return sendJson(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') {
          clearAdminPassword()
          res.setHeader('Set-Cookie', clearCookie(adminCookieName(port)))
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 405, { error: 'PUT or DELETE' })
      }
      const m = path.match(/^\/projects\/([^/]+)\/password$/)
      if (m) {
        const id = decodeURIComponent(m[1])
        if (!validProjectId(id)) return sendJson(res, 404, { error: 'unknown project' })
        if (req.method === 'PUT') {
          if (!upstreamOf(id)) return sendJson(res, 404, { error: 'unknown project' })
          const pw = passwordOf(req, await readBody(req))
          if (!pw) return sendJson(res, 400, { error: 'body must be JSON {"password": "<non-empty>"}' })
          setProjectPassword(id, pw)
          return sendJson(res, 200, { ok: true })
        }
        if (req.method === 'DELETE') { // clearing works even for a retired registry entry — the cleanup path
          clearProjectPassword(id)
          return sendJson(res, 200, { ok: true })
        }
        return sendJson(res, 405, { error: 'PUT or DELETE' })
      }
      // host-level admin routes ([[host-gateway]]: /projects/stream, registration, project operations)
      // ride the SAME admin gate — the extension only ever sees an authorized request.
      if (ext.adminRoute && await ext.adminRoute(req, res, path)) return
      return sendJson(res, 404, { error: 'not found' })
    }

    // ---- project surface ----
    const pm = path.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (pm) {
      const id = decodeURIComponent(pm[1])
      if (!validProjectId(id)) return sendJson(res, 404, { error: 'unknown project' })
      const up = upstreamOf(id)
      if (!up) return sendJson(res, 404, { error: 'unknown project' })
      const sub = pm[2] || '/'
      const base = `/p/${encodeURIComponent(id)}`
      const gated = !!store.projects[id]
      if (sub === '/login') {
        if (!gated) return redirect(res, `${base}/`)
        if (req.method === 'POST') {
          const pw = passwordOf(req, await readBody(req))
          if (verifyPassword(store.projects[id], pw)) {
            return redirect(res, `${base}/`, `${projectCookieName(port, id)}=${mintToken(store, { s: 'project', p: id })}${attrs}`)
          }
          return sendHtml(res, 401, loginPage(true, { action: `${base}/login`, heading: 'Project access', sub: `Enter the password for this project.` }))
        }
        return sendHtml(res, 200, loginPage(false, { action: `${base}/login`, heading: 'Project access', sub: `Enter the password for this project.` }))
      }
      if (sub === '/logout') return redirect(res, `${base}/login`, clearCookie(projectCookieName(port, id)))
      const d = authorize(store, { kind: 'project', projectId: id }, cookies, remote, port)
      if (!d.ok) {
        if (sub.startsWith('/api')) return sendJson(res, 401, { error: 'authentication required', login: `${base}/login` })
        return redirect(res, `${base}/login`)
      }
      // browser navigation into the scoped page (`/p/<id>/`, any non-api sub) is content-negotiated
      // exactly like GET /projects: with a host fallback mounted, an explicit text/html GET serves the
      // SPA shell — the scoped address is directly shareable ([[projects-hub]]) and the shell's
      // root-absolute assets resolve outside /p onto the same fallback. Every api/SSE/health fetch
      // (json, */*, event-stream) and the WS upgrade keep proxying to the backend untouched.
      if (req.method === 'GET' && !sub.startsWith('/api') && ext.fallback && (req.headers.accept ?? '').includes('text/html')) {
        return ext.fallback(req, res, '/')
      }
      return proxyTo(req, res, up.port, sub + query)
    }

    // outside /projects and /p/: the dashboard shell + assets when a host extension serves them, 404 bare.
    if (ext.fallback) return ext.fallback(req, res, path)
    return sendJson(res, 404, { error: 'not found' })
  }

  // a handler throw answers 500 and never becomes an unhandled rejection — the hub owns a public port
  // and must keep serving (same posture as the supervisor's process guards).
  const safe = (req: http.IncomingMessage, res: http.ServerResponse) =>
    void handler(req, res).catch((e) => {
      console.error(`[hub] request failed: ${(e as Error).message}`)
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end('{"error":"internal error"}')
    })
  const server = secure
    ? https.createServer({ cert: opts.tls!.cert, key: opts.tls!.key }, safe)
    : http.createServer(safe)
  installConnectionReaper(server)

  // the terminal WebSocket rides an HTTP upgrade on a /p/:id path: same authorization, then a raw byte
  // pipe to that project's backend with the prefix stripped and the gateway cookies filtered out.
  server.on('upgrade', (req, socket, head) => {
    const store = loadAuthStore()
    const rawUrl = req.url || '/'
    const q = rawUrl.indexOf('?')
    const path = q >= 0 ? rawUrl.slice(0, q) : rawUrl
    const pm = path.match(/^\/p\/([^/]+)(\/.*)?$/)
    if (!pm) return socket.destroy()
    const id = decodeURIComponent(pm[1])
    if (!validProjectId(id)) return socket.destroy()
    const up = upstreamOf(id)
    if (!up) return socket.destroy()
    const d = authorize(store, { kind: 'project', projectId: id }, req.headers.cookie, req.socket.remoteAddress, port)
    if (!d.ok) return socket.destroy()
    const sub = (pm[2] || '/') + (q >= 0 ? rawUrl.slice(q) : '')
    const upstream = net.connect(up.port, '127.0.0.1', () => {
      upstream.write(`${req.method} ${sub} HTTP/1.1\r\n` + filteredRawHeaders(req))
      if (head && head.length) upstream.write(head)
      socket.pipe(upstream); upstream.pipe(socket)
    })
    const bail = () => { socket.destroy(); upstream.destroy() }
    socket.on('error', bail); upstream.on('error', bail)
    // pair the halves fully (the supervisor's rule): an http server's sockets are allowHalfOpen, so a bare
    // client FIN ('end') would otherwise leave a zombie socket the server can never close — an upgraded
    // stream never half-closes legitimately, so either half's FIN or close tears down both.
    socket.on('end', bail); upstream.on('end', bail)
    socket.once('close', () => upstream.destroy())
    upstream.once('close', () => socket.destroy())
  })

  const onListen = () => {
    const scheme = secure ? 'https' : 'http'
    console.log(`[hub] multi-project gateway on ${scheme}://${opts.host ?? '0.0.0.0'}:${port} — /projects + /p/:projectId/*`)
  }
  listenOrExit(server, port, { host: opts.host, label: opts.label ?? 'hub gateway', cleanup: opts.onBindFail, onListen })
  return server
}

// replay an upgrade's headers with the Cookie header rewritten to exclude the gateway's own cookies.
function filteredRawHeaders(req: http.IncomingMessage): string {
  let s = ''
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    if (name.toLowerCase() === 'cookie') {
      const kept = stripGatewayCookies(req.rawHeaders[i + 1])
      if (kept) s += `Cookie: ${kept}\r\n`
      continue
    }
    s += `${name}: ${req.rawHeaders[i + 1]}\r\n`
  }
  return s + '\r\n'
}

// reverse-proxy one authorized request to a project's loopback backend, prefix already stripped.
function proxyTo(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number, path: string): void {
  const headers: http.OutgoingHttpHeaders = { ...req.headers }
  const kept = stripGatewayCookies(req.headers.cookie)
  if (kept) headers.cookie = kept; else delete headers.cookie
  const up = http.request({ host: '127.0.0.1', port: upstreamPort, path, method: req.method, headers }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers)
    upRes.pipe(res)
  })
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('project backend unreachable') })
  req.pipe(up)
}
