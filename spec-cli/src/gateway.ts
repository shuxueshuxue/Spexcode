import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { gzipSync, createGzip } from 'node:zlib'
import { join, normalize, extname } from 'node:path'
import { homedir } from 'node:os'
import { loginPage } from './login-page.js'
import { listenOrExit } from './listen.js'
import { installConnectionReaper } from './reaper.js'
import { postedSessionWeb, SessionWebError } from './session-web.js'
import { ensureDashboardArtifact } from './dashboard-assets.js'

export type PublicConfig = { password: string; tls: { cert: string; key: string } | null }
function argFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const argHas = (name: string) => process.argv.includes(`--${name}`)

export function resolvePublicConfig(repoRoot: string): PublicConfig | null {
  let fileCfg: any = {}
  // a MISSING .spec/spexcode.json is fine (defaults); a MALFORMED one fails LOUD — silently swallowing it would
  // serve the dashboard with the wrong public/TLS posture, the opposite of what the file says.
  try { fileCfg = JSON.parse(readFileSync(join(repoRoot, '.spec', 'spexcode.json'), 'utf8'))?.serve?.public ?? {} }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`.spec/spexcode.json is malformed (cannot resolve public-mode config): ${(e as Error).message}`) }
  const enabled = argHas('public') || process.env.SPEXCODE_PUBLIC === '1' || fileCfg?.enabled === true
  if (!enabled) return null

  // the gate is OPT-IN: a password (flag/env only — never .spec/spexcode.json) makes the login appear; WITHOUT one
  // the dashboard is served OPEN. That is loud-warned, not refused — open public access drives the agents, so
  // anyone who reaches the URL has them. The caller (you) chooses; we never silently gate or silently expose.
  const password = argFlag('password') ?? process.env.SPEXCODE_PASSWORD ?? ''
  if (!password) console.error('⚠ spex serve --public with NO password: the dashboard is OPEN — anyone who reaches it controls the agents. Add --password <pw> / SPEXCODE_PASSWORD to require a login.')

  // --http: knowingly drop TLS. Loud, because the password then crosses the wire in clear and secure-context
  // browser features (clipboard) break. Anything else resolves a cert; absent any source → self-signed.
  if (argHas('http') || fileCfg?.http === true) {
    console.error('⚠ spex serve --public --http: TLS is OFF. The password travels in CLEARTEXT and clipboard/secure-context features will not work. Use this only on a trusted path.')
    return { password, tls: null }
  }
  const certPath = argFlag('tls-cert') ?? process.env.SPEXCODE_TLS_CERT ?? fileCfg?.tls?.cert
  const keyPath = argFlag('tls-key') ?? process.env.SPEXCODE_TLS_KEY ?? fileCfg?.tls?.key
  if (certPath || keyPath) {
    if (!certPath || !keyPath) { console.error('spex serve --public: --tls-cert and --tls-key must be given together.'); process.exit(1) }
    for (const [label, p] of [['cert', certPath], ['key', keyPath]] as const) {
      if (!existsSync(p)) { console.error(`spex serve --public: TLS ${label} file not found: ${p} — fix the path, or omit both for a self-signed cert, or use --http.`); process.exit(1) }
    }
    return { password, tls: { cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8') } }
  }
  return { password, tls: selfSignedCert() }
}

// @@@ self-signed default - generated ONCE via openssl into ~/.spexcode/tls and reused, so a visitor accepts
// the cert only once (not on every restart). openssl is near-universal on Linux/macOS; if it is genuinely
// absent we FAIL LOUD with the three repair paths rather than silently dropping to plaintext. Web PKI will
// not issue a browser-trusted cert for a bare IP, so this cert is untrusted by construction — the visitor's
// one-time "proceed" is the price of needing no domain, not a bug.
function selfSignedCert(): { cert: string; key: string } {
  const dir = join(homedir(), '.spexcode', 'tls')
  const certFile = join(dir, 'self-signed.cert.pem'), keyFile = join(dir, 'self-signed.key.pem')
  if (!existsSync(certFile) || !existsSync(keyFile)) {
    if (spawnSync('openssl', ['version']).status !== 0) {
      console.error('spex serve --public: openssl not found, so a self-signed cert cannot be generated. Install openssl, OR pass --tls-cert/--tls-key with your own cert, OR use --http (no TLS).')
      process.exit(1)
    }
    mkdirSync(dir, { recursive: true })
    console.log('[gateway] generating a self-signed TLS cert (one-time) → ' + dir)
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile,
      '-days', '3650', '-subj', '/CN=spexcode', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  }
  return { cert: readFileSync(certFile, 'utf8'), key: readFileSync(keyFile, 'utf8') }
}

const COOKIE = 'spex_auth'
function authToken(password: string): string {
  const secret = createHmac('sha256', password).update('spexcode-public-gateway-v1').digest()
  return createHmac('sha256', secret).update('authed').digest('base64url')
}
function constEq(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}
function cookieOf(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}
function isAuthed(req: http.IncomingMessage, token: string, cookieName: string): boolean {
  const c = cookieOf(req.headers.cookie, cookieName)
  return c != null && constEq(c, token)
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' }

// Dashboard assets are resolved from their owning package, whether npm installed it or the workspace links it.
export function resolveDistDir(): string {
  return ensureDashboardArtifact('dist')
}

export type GatewayOpts = {
  publicPort: number
  upstreamPort: number
  password: string
  tls: { cert: string; key: string } | null
  distDir: string
  host?: string
  label?: string
  onBindFail?: () => void
  projectRoot?: string
  readyLines?: string[]
}

export function startGateway(opts: GatewayOpts): void {
  // gated ONLY when a password is set; otherwise the login layer doesn't exist and the dashboard is served open.
  const gated = !!opts.password
  const token = gated ? authToken(opts.password) : ''
  const secure = !!opts.tls
  // the auth cookie is HOST-scoped (RFC 6265 ignores the port), so two gateways on one IP would share a
  // single 'spex_auth' jar entry and clobber each other's login. Key the name by the public port — the
  // unique discriminator on a host, exactly what the user's two URLs differ by — so same-host instances
  // (e.g. :8787 and :8788) stay logged in concurrently and a logout clears only its own.
  const cookieName = `${COOKIE}_${opts.publicPort}`
  const setCookie = `${cookieName}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure ? '; Secure' : ''}`

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const url = (req.url || '/').split('?')[0]
    if (gated) {
      // login surface — the only routes reachable without a cookie. Absent entirely when ungated.
      if (url === '/login' && req.method === 'POST') return doLogin(req, res, opts.password, setCookie)
      if (url === '/login') return sendHtml(res, 200, loginPage())
      if (url === '/logout') { res.writeHead(302, { 'Set-Cookie': `${cookieName}=; Path=/; Max-Age=0`, Location: '/login' }); return res.end() }
      if (!isAuthed(req, token, cookieName)) {
        if (url.startsWith('/api')) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":"authentication required"}') }
        res.writeHead(302, { Location: '/login' }); return res.end()
      }
    }
    if (proxySessionWeb(req, res, req.url || '/', opts.projectRoot)) return
    if (url.startsWith('/api')) return proxyHttp(req, res, opts.upstreamPort)
    return serveStatic(req, res, opts.distDir, url)
  }

  const server = secure
    ? https.createServer({ cert: opts.tls!.cert, key: opts.tls!.key }, handler)
    : http.createServer(handler)
  installConnectionReaper(server)

  server.on('upgrade', (req, socket, head) => {
    if (gated && !isAuthed(req, token, cookieName)) { socket.destroy(); return }
    if (proxySessionWebUpgrade(req, socket, head, req.url || '/', opts.projectRoot)) return
    const up = net.connect(opts.upstreamPort, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + rawHeaders(req))
      if (head && head.length) up.write(head)
      socket.pipe(up); up.pipe(socket)
    })
    const bail = () => { socket.destroy(); up.destroy() }
    socket.on('error', bail); up.on('error', bail)
    // pair the halves fully (the supervisor's rule): an http server's sockets are allowHalfOpen, so a bare
    // client FIN ('end') would otherwise leave this side open forever — an upgraded stream never
    // half-closes legitimately, so either half's FIN or close tears down both.
    socket.on('end', bail); up.on('end', bail)
    socket.once('close', () => up.destroy())
    up.once('close', () => socket.destroy())
  })

  // `spex serve ui` passes an explicit host (loopback by default, --host to widen); `--public` passes
  // none → bind ALL interfaces (the original behaviour, IPv4+IPv6), so adding the local path never
  // narrows the public gateway's reach. The gate note keys on LOOPBACK, not on host-being-explicit:
  // an ungated loopback bind is normal, an ungated wide bind is announced — never silent.
  const isLoopback = opts.host === '127.0.0.1' || opts.host === 'localhost' || opts.host === '::1'
  const scheme = secure ? 'https' : 'http'
  const label = opts.label ?? 'public mode'
  const gate = isLoopback ? '' : ` — ${gated ? 'password-gated' : 'OPEN (no password)'}`
  const ready = (port: number) => {
    const lines = [...(opts.readyLines ?? []), `[gateway] ${label} on ${scheme}://${isLoopback ? 'localhost' : (opts.host ?? '0.0.0.0')}:${port}${gate}, proxying /api to :${opts.upstreamPort}`]
    if (!secure && !isLoopback && !opts.host) lines.push('[gateway] (TLS off — --http)')
    return lines
  }
  // a busy public port is a hard, loud, non-zero exit — the SAME contract as the supervisor's proxy
  // (see [[spec-cli]] / listen.ts), so `spex serve` and `spex serve ui` fail a port clash identically.
  listenOrExit(server, opts.publicPort, { host: opts.host, label: opts.label ?? 'gateway', cleanup: opts.onBindFail, ready })
}

// re-serialize an upgrade request's headers for replay against the upstream (exported for the host
// gateway's per-project WS pipe, which replays the same way).
export function rawHeaders(req: http.IncomingMessage): string {
  let s = ''
  for (let i = 0; i < req.rawHeaders.length; i += 2) s += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`
  return s + '\r\n'
}

function doLogin(req: http.IncomingMessage, res: http.ServerResponse, password: string, setCookie: string) {
  let body = ''
  req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy() })
  req.on('end', () => {
    let pw = ''
    try { pw = req.headers['content-type']?.includes('application/json') ? JSON.parse(body).password ?? '' : new URLSearchParams(body).get('password') ?? '' } catch { /* malformed */ }
    if (constEq(pw, password)) { res.writeHead(302, { 'Set-Cookie': setCookie, Location: '/' }); res.end() }
    else sendHtml(res, 401, loginPage(true))
  })
}

// @@@ gzip at the gateway - compression is TRANSPORT, so it lives here, once, for every deployment — the
// loopback upstream and the product semantics never know it exists. Text-ish payloads only; three
// structural exclusions, each load-bearing: an SSE stream must not sit in a zlib buffer (event latency),
// an already-encoded response is not re-encoded, and binary media (video/image evidence) gains nothing
// and would fight Range requests.
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/
const wantsGzip = (req: http.IncomingMessage) => /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))
// zlib's larger default table can be counterproductive for minified text: memLevel 5 both compresses it
// further and lowers each stream's working memory. One policy drives buffered and streamed gzip.
const GZIP_OPTIONS = { level: 9, memLevel: 5 } as const

function appendVary(current: string | string[] | undefined, token: string): string {
  const values = (Array.isArray(current) ? current : [current ?? ''])
    .flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  if (!values.some((value) => value === '*' || value.toLowerCase() === token.toLowerCase())) values.push(token)
  return values.join(', ')
}

// reverse-proxy an /api request to the loopback supervisor (which forwards to the live child) —
// stream-gzipping compressible bodies (measured: the board JSON rides down at under a third).
// `path` and `headers` optionally override routing inputs (the host gateway strips its /p/:projectId
// prefix and gateway cookies); transport ownership stays here once. Defaults pass the request through.
export function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number, path?: string, headers: http.OutgoingHttpHeaders = req.headers, unavailableMessage = 'upstream unreachable', upstreamHost = '127.0.0.1') {
  let upstreamResponse: http.IncomingMessage | null = null
  let transform: ReturnType<typeof createGzip> | null = null
  let settled = false

  const removeDownstreamListeners = () => {
    req.off('aborted', abortFromDownstream)
    req.off('error', abortFromDownstream)
    req.off('end', onRequestEnd)
    req.off('close', onRequestClose)
    res.off('error', abortFromDownstream)
    res.off('close', onResponseClose)
    res.off('finish', onResponseFinish)
  }
  const destroyUpstream = () => {
    req.unpipe(up)
    if (upstreamResponse && transform) {
      upstreamResponse.unpipe(transform)
      transform.unpipe(res)
      transform.destroy()
    } else if (upstreamResponse) {
      upstreamResponse.unpipe(res)
    }
    upstreamResponse?.destroy()
    up.destroy()
  }
  const settle = () => {
    if (settled) return
    settled = true
    removeDownstreamListeners()
  }
  const onResponseFinish = () => {
    if (settled) return
    if (req.complete) { settle(); return }
    // An upstream may reject a body before the client finishes sending it. The response is valid, but the
    // upload leg is over: sever it upstream and drain the downstream body so the flushed response and
    // keep-alive socket are not turned into a reset. Request abort ownership stays until end/close.
    req.unpipe(up)
    upstreamResponse?.destroy()
    up.socket?.destroy()
    up.destroy()
    if (!req.destroyed) req.resume()
  }
  const abortFromDownstream = () => {
    if (settled) return
    settled = true
    removeDownstreamListeners()
    destroyUpstream()
  }
  const onRequestClose = () => {
    if (!req.complete) abortFromDownstream()
    else if (res.writableFinished) settle()
  }
  const onRequestEnd = () => { if (res.writableFinished) settle() }
  const onResponseClose = () => {
    if (!res.writableFinished) abortFromDownstream()
  }
  const failFromUpstream = () => {
    if (settled) return
    settled = true
    removeDownstreamListeners()
    destroyUpstream()
    if (res.destroyed) return
    if (!res.headersSent) { res.writeHead(502); res.end(unavailableMessage) }
    else res.destroy()
  }

  const up = http.request({ host: upstreamHost, port: upstreamPort, path: path ?? req.url, method: req.method, headers }, (received) => {
    if (settled || res.destroyed) { received.destroy(); up.destroy(); return }
    upstreamResponse = received
    received.once('aborted', failFromUpstream)
    received.once('error', failFromUpstream)
    received.once('close', () => { if (!received.complete) failFromUpstream() })

    const type = String(received.headers['content-type'] || '')
    const eligible = !received.headers['content-encoding'] && COMPRESSIBLE.test(type) && !type.startsWith('text/event-stream')
    const responseHeaders: http.OutgoingHttpHeaders = eligible
      ? { ...received.headers, vary: appendVary(received.headers.vary, 'Accept-Encoding') }
      : received.headers
    if (!eligible || !wantsGzip(req)) {
      res.writeHead(received.statusCode || 502, responseHeaders)
      received.pipe(res)
      return
    }
    const headers = { ...responseHeaders, 'content-encoding': 'gzip' }
    delete headers['content-length']   // streamed; the encoded length isn't knowable up front
    res.writeHead(received.statusCode || 502, headers)
    transform = createGzip(GZIP_OPTIONS)
    transform.once('error', failFromUpstream)
    received.pipe(transform).pipe(res)
  })
  up.once('error', failFromUpstream)
  req.once('aborted', abortFromDownstream)
  req.once('error', abortFromDownstream)
  req.once('end', onRequestEnd)
  req.once('close', onRequestClose)
  res.once('error', abortFromDownstream)
  res.once('close', onResponseClose)
  res.once('finish', onResponseFinish)
  req.pipe(up)
}

type WebRoute = { sessionId: string; key: string; tail: string; query: string }

function webRoute(raw: string): WebRoute | null {
  const q = raw.indexOf('?')
  const path = q >= 0 ? raw.slice(0, q) : raw
  const match = path.match(/^\/web\/([^/]+)\/([A-Za-z0-9_-]+)(\/.*)?$/)
  if (!match) return null
  return { sessionId: decodeURIComponent(match[1]), key: match[2], tail: match[3] || '/', query: q >= 0 ? raw.slice(q) : '' }
}

function sessionWebTarget(route: WebRoute, projectRoot?: string): { port: number; host: string; connectHost: string; path: string } {
  const endpoint = postedSessionWeb(route.sessionId, route.key, projectRoot)
  const base = new URL('.', endpoint).pathname
  const path = route.tail === '/' ? endpoint.pathname : `${base}${route.tail.slice(1)}`
  return { port: Number(endpoint.port), host: endpoint.host, connectHost: endpoint.hostname.replace(/^\[|\]$/g, ''), path: `${path}${route.query}` }
}

function withoutGatewayCookies(cookie: string | undefined): string {
  return (cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part && !/^spex_(admin|proj|auth)_/i.test(part.slice(0, Math.max(part.indexOf('='), 0))))
    .join('; ')
}

function webHeaders(req: http.IncomingMessage, host: string): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host }
  const kept = withoutGatewayCookies(req.headers.cookie)
  if (kept) headers.cookie = kept; else delete headers.cookie
  return headers
}

function webRawHeaders(req: http.IncomingMessage, host: string): string {
  let out = ''
  let wroteHost = false
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i]
    const value = req.rawHeaders[i + 1]
    if (name.toLowerCase() === 'host') { out += `Host: ${host}\r\n`; wroteHost = true; continue }
    if (name.toLowerCase() === 'cookie') {
      const kept = withoutGatewayCookies(value)
      if (kept) out += `Cookie: ${kept}\r\n`
      continue
    }
    out += `${name}: ${value}\r\n`
  }
  return `${out}${wroteHost ? '' : `Host: ${host}\r\n`}\r\n`
}

function sessionWebFailure(res: http.ServerResponse, error: unknown): void {
  if (error instanceof SessionWebError) {
    res.writeHead(error.status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(error.message)
    return
  }
  console.error(`[web] route failed: ${error instanceof Error ? error.message : String(error)}`)
  res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end('web preview failed')
}

// A posted URL selects a loopback service; the gateway owns only the prefix and transport. It never opens
// an endpoint until a browser asks for this route, so each request observes the service's current bytes.
export function proxySessionWeb(req: http.IncomingMessage, res: http.ServerResponse, raw = req.url || '/', projectRoot?: string): boolean {
  const route = webRoute(raw)
  if (!route) return false
  try {
    const target = sessionWebTarget(route, projectRoot)
    proxyHttp(req, res, target.port, target.path, webHeaders(req, target.host), 'posted web service is unavailable', target.connectHost)
  } catch (error) { sessionWebFailure(res, error) }
  return true
}

export function proxySessionWebUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, raw = req.url || '/', projectRoot?: string): boolean {
  const route = webRoute(raw)
  if (!route) return false
  let target: { port: number; host: string; connectHost: string; path: string }
  try { target = sessionWebTarget(route, projectRoot) }
  catch { socket.destroy(); return true }
  const upstream = net.connect(target.port, target.connectHost, () => {
    upstream.write(`${req.method} ${target.path} HTTP/1.1\r\n` + webRawHeaders(req, target.host))
    if (head.length) upstream.write(head)
    socket.pipe(upstream); upstream.pipe(socket)
  })
  const bail = () => { socket.destroy(); upstream.destroy() }
  socket.on('error', bail); upstream.on('error', bail)
  socket.on('end', bail); upstream.on('end', bail)
  socket.once('close', () => upstream.destroy())
  upstream.once('close', () => socket.destroy())
  return true
}

// serve the built dashboard (vite dist). Unknown non-file paths fall back to index.html (SPA). Path
// traversal is blocked by normalising and confining to distDir. Compressible files ship gzipped, memoized
// per (path, mtime) — a dist file is immutable per build, so each is compressed once, not per request.
// Exported: the host gateway serves the same dist through the same function.
const gzMemo = new Map<string, { mtime: number; gz: Buffer }>()
export function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, distDir: string, urlPath: string) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  let file = join(distDir, rel)
  if (!file.startsWith(distDir)) file = join(distDir, 'index.html')
  if (urlPath === '/' || !existsSync(file)) {
    // @@@ missing-asset 404 - a missing extensioned path is a stale hashed chunk, not an SPA route: answer
    // 404, not HTML (which trips the module-MIME check), so the shell's reload recovery sees it ([[public-mode]]).
    if (urlPath !== '/' && extname(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    file = join(distDir, 'index.html')
  }
  if (!existsSync(file)) { res.writeHead(503); return res.end('dashboard build missing') }
  const type = MIME[extname(file)] || 'application/octet-stream'
  const cacheControl = /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'
  const raw = readFileSync(file)
  const compressible = COMPRESSIBLE.test(type)
  const headers: http.OutgoingHttpHeaders = { 'Content-Type': type, 'Cache-Control': cacheControl }
  if (compressible) headers.Vary = appendVary(undefined, 'Accept-Encoding')
  if (wantsGzip(req) && compressible) {
    const mtime = statSync(file).mtimeMs
    let hit = gzMemo.get(file)
    if (!hit || hit.mtime !== mtime) { hit = { mtime, gz: gzipSync(raw, GZIP_OPTIONS) }; gzMemo.set(file, hit) }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' })
    return res.end(hit.gz)
  }
  res.writeHead(200, headers)
  res.end(raw)
}

function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// @@@ serveDashboardLocal - the engine behind `spex serve ui`: the SAME gateway as public mode, bound to
// loopback by default with no TLS and no password — `--host` widens the bind to a chosen interface
// (LAN/tailnet viewing) while staying plain HTTP; the internet face remains `spex serve --public`.
// It serves the bundled dist and proxies /api + the terminal socket to a separately-run `spex serve`.
// This is the post-install replacement for the dogfood-only `npm run web` (a vite dev server an
// installed user has no source tree for). See [[packaging]].
export function serveDashboardLocal(opts: { port: number; apiPort: number; host?: string; projectRoot?: string }): void {
  const distDir = resolveDistDir()
  startGateway({
    host: opts.host ?? '127.0.0.1',
    publicPort: opts.port,
    upstreamPort: opts.apiPort,
    password: '',
    tls: null,
    distDir,
    label: 'dashboard',
    projectRoot: opts.projectRoot,
    readyLines: [`[dashboard] serving ${distDir}, /api → backend :${opts.apiPort}`],
  })
}
