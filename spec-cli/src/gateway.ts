// @@@ public gateway - the internet face of `spex serve --public`. The supervisor (supervise.ts) and its
// Hono child stay bound to 127.0.0.1; THIS is the only listener on 0.0.0.0. It terminates TLS, gates every
// request behind one password (a designed login → signed cookie), serves the built dashboard, and reverse-
// proxies /api + the terminal WebSocket to the loopback supervisor. Loopback is the trust boundary (local
// agents hit the supervisor directly, no password); the gateway is the boundary crossed from outside.
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { gzipSync, createGzip } from 'node:zlib'
import { join, normalize, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loginPage } from './login-page.js'
import { listenOrExit } from './listen.js'
import { installConnectionReaper } from './reaper.js'

// @@@ resolvePublicConfig - the cert/gate is a RESOLVED value, never hardcoded. Reads the same precedence
// chain the spec promises: flag > env > spexcode.json > self-signed default. Returns null when public mode
// is off (the supervisor then serves plain loopback, unchanged). process.argv carries the `spex serve …`
// flags since the supervisor runs in the same process as the CLI command.
export type PublicConfig = { password: string; tls: { cert: string; key: string } | null }
function argFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const argHas = (name: string) => process.argv.includes(`--${name}`)

export function resolvePublicConfig(repoRoot: string): PublicConfig | null {
  let fileCfg: any = {}
  // a MISSING spexcode.json is fine (defaults); a MALFORMED one fails LOUD — silently swallowing it would
  // serve the dashboard with the wrong public/TLS posture, the opposite of what the file says.
  try { fileCfg = JSON.parse(readFileSync(join(repoRoot, 'spexcode.json'), 'utf8'))?.serve?.public ?? {} }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`spexcode.json is malformed (cannot resolve public-mode config): ${(e as Error).message}`) }
  const enabled = argHas('public') || process.env.SPEXCODE_PUBLIC === '1' || fileCfg?.enabled === true
  if (!enabled) return null

  // the gate is OPT-IN: a password (flag/env only — never spexcode.json) makes the login appear; WITHOUT one
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

// @@@ cookie auth - the gate is a designed login, NOT the browser's Basic dialog. The auth cookie is a
// keyed HMAC of a constant under a secret DERIVED from the password, so it (a) survives a restart with no
// server-side session store and (b) reveals nothing about the password. Verified in constant time. The same
// cookie authorises /api and the WebSocket upgrade — the browser sends it on the same-origin handshake.
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

// @@@ resolveDistDir - where the built dashboard lives, bundled-or-monorepo. In an INSTALLED `spexcode`
// package the dist rides inside it (prepublish copies spec-dashboard's build to <pkg>/dashboard-dist);
// in the dogfood monorepo there is no bundled copy, so it falls back to the sibling spec-dashboard/dist.
// This is the one seam that lets the same gateway code serve from either layout (see [[packaging]]).
export function resolveDistDir(): string {
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url)) // gateway.ts is in src/ → .. = package root
  const bundled = join(pkgRoot, 'dashboard-dist')
  if (existsSync(join(bundled, 'index.html'))) return bundled
  return join(pkgRoot, '..', 'spec-dashboard', 'dist')
}

export type GatewayOpts = { publicPort: number; upstreamPort: number; password: string; tls: { cert: string; key: string } | null; distDir: string; host?: string; label?: string; onBindFail?: () => void }

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
    if (url.startsWith('/api')) return proxyHttp(req, res, opts.upstreamPort)
    return serveStatic(req, res, opts.distDir, url)
  }

  // server-side connection reaping ([[spec-cli]] / [[public-mode]]) - the internet-facing gateway is the
  // public server in public mode, so it carries the SAME reaping as the child. The `reap` HTTP timeouts are
  // kept (harmless) but are NOT the mechanism — MEASURED (eval server-reaps-abandoned-connections), Node's
  // headersTimeout/requestTimeout don't reap an INCOMPLETE request; the real reaper is the socket-level
  // `installConnectionReaper` (reaper.ts), applied below at every http server the serving path creates.
  // Idle keep-alive / slow-loris / never-completing request only; the gated WS upgrade (handled below) is an
  // active stream and exempt for its lifetime.
  const reap = { keepAliveTimeout: 10000, headersTimeout: 20000, requestTimeout: 60000, connectionsCheckingInterval: 10000 }
  const server = secure
    ? https.createServer({ cert: opts.tls!.cert, key: opts.tls!.key, ...reap }, handler)
    : http.createServer(reap, handler)
  installConnectionReaper(server)

  // @@@ WS gate - the terminal socket rides an HTTP upgrade. Gate it by the SAME cookie (the browser sends
  // it on the same-origin handshake), then raw-pipe to the loopback supervisor, replaying the buffered
  // upgrade request so the child completes the WebSocket handshake. Mirrors supervise.ts's byte pipe.
  server.on('upgrade', (req, socket, head) => {
    if (gated && !isAuthed(req, token, cookieName)) { socket.destroy(); return }
    const up = net.connect(opts.upstreamPort, '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + rawHeaders(req))
      if (head && head.length) up.write(head)
      socket.pipe(up); up.pipe(socket)
    })
    const bail = () => { socket.destroy(); up.destroy() }
    socket.on('error', bail); up.on('error', bail)
  })

  // `spex serve ui` passes an explicit host (loopback by default, --host to widen); `--public` passes
  // none → bind ALL interfaces (the original behaviour, IPv4+IPv6), so adding the local path never
  // narrows the public gateway's reach. The gate note keys on LOOPBACK, not on host-being-explicit:
  // an ungated loopback bind is normal, an ungated wide bind is announced — never silent.
  const isLoopback = opts.host === '127.0.0.1' || opts.host === 'localhost' || opts.host === '::1'
  const onListen = () => {
    const scheme = secure ? 'https' : 'http'
    const label = opts.label ?? 'public mode'
    const gate = isLoopback ? '' : ` — ${gated ? 'password-gated' : 'OPEN (no password)'}`
    console.log(`[gateway] ${label} on ${scheme}://${isLoopback ? 'localhost' : (opts.host ?? '0.0.0.0')}:${opts.publicPort}${gate}, proxying /api to :${opts.upstreamPort}`)
    if (!secure && !isLoopback && !opts.host) console.log('[gateway] (TLS off — --http)')
  }
  // a busy public port is a hard, loud, non-zero exit — the SAME contract as the supervisor's proxy
  // (see [[spec-cli]] / listen.ts), so `spex serve` and `spex serve ui` fail a port clash identically.
  listenOrExit(server, opts.publicPort, { host: opts.host, label: opts.label ?? 'gateway', cleanup: opts.onBindFail, onListen })
}

function rawHeaders(req: http.IncomingMessage): string {
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

// reverse-proxy an /api request to the loopback supervisor (which forwards to the live child) —
// stream-gzipping compressible bodies (measured: the board JSON rides down at under a third).
function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, upstreamPort: number) {
  const up = http.request({ host: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: req.headers }, (upRes) => {
    const type = String(upRes.headers['content-type'] || '')
    const skip = !wantsGzip(req) || upRes.headers['content-encoding'] || !COMPRESSIBLE.test(type) || type.startsWith('text/event-stream')
    if (skip) { res.writeHead(upRes.statusCode || 502, upRes.headers); upRes.pipe(res); return }
    const headers = { ...upRes.headers, 'content-encoding': 'gzip', vary: 'Accept-Encoding' }
    delete headers['content-length']   // streamed; the encoded length isn't knowable up front
    res.writeHead(upRes.statusCode || 502, headers)
    upRes.pipe(createGzip()).pipe(res)
  })
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('upstream unreachable') })
  req.pipe(up)
}

// serve the built dashboard (vite dist). Unknown non-file paths fall back to index.html (SPA). Path
// traversal is blocked by normalising and confining to distDir. Compressible files ship gzipped, memoized
// per (path, mtime) — a dist file is immutable per build, so each is compressed once, not per request.
const gzMemo = new Map<string, { mtime: number; gz: Buffer }>()
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, distDir: string, urlPath: string) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  let file = join(distDir, rel)
  if (!file.startsWith(distDir)) file = join(distDir, 'index.html')
  if (urlPath === '/' || !existsSync(file)) {
    // @@@ missing-asset 404 - only extensionless SPA routes fall back to index.html. A missing FILE
    // request (it has an extension) is a stale hashed chunk from a pre-rebuild page still open in some
    // browser: answering it with HTML trips the strict module-MIME check and hides the miss from the
    // client — 404 instead, so the shell's vite:preloadError recovery can see it and reload.
    if (urlPath !== '/' && extname(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found') }
    file = join(distDir, 'index.html')
  }
  if (!existsSync(file)) { res.writeHead(503); return res.end('dashboard build missing') }
  const type = MIME[extname(file)] || 'application/octet-stream'
  // @@@ cache-policy - hashed /assets/* are content-addressed (immutable per build) → cache hard; index.html
  // (and every SPA fallback to it) is no-cache → revalidated each load. Without that a browser holding a
  // pre-rebuild index.html keeps requesting dead chunk hashes and the stale-chunk reload ([[dashboard-shell]])
  // re-serves the SAME cached index, never reaching the fresh build — a lazy route (issues) 404s forever.
  const cacheControl = /[\\/]assets[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache'
  const raw = readFileSync(file)
  if (wantsGzip(req) && COMPRESSIBLE.test(type)) {
    const mtime = statSync(file).mtimeMs
    let hit = gzMemo.get(file)
    if (!hit || hit.mtime !== mtime) { hit = { mtime, gz: gzipSync(raw) }; gzMemo.set(file, hit) }
    res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Cache-Control': cacheControl })
    return res.end(hit.gz)
  }
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cacheControl })
  res.end(raw)
}

function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
}

// @@@ ensureDashboardBuilt - public mode serves a STATIC build, so the dist must exist. If it's missing we
// build it once (vite build) so "one command" holds; a build failure is loud, not a blank serve.
export function ensureDashboardBuilt(repoRoot: string, distDir: string): void {
  if (existsSync(join(distDir, 'index.html'))) return
  console.log('[gateway] dashboard build not found — building it once (vite build)…')
  const r = spawnSync('npm', ['run', 'build'], { cwd: join(repoRoot, 'spec-dashboard'), stdio: 'inherit' })
  if (r.status !== 0 || !existsSync(join(distDir, 'index.html'))) {
    console.error('[gateway] dashboard build failed. Build it manually: (cd spec-dashboard && npm run build), then retry.')
    process.exit(1)
  }
}

// @@@ serveDashboardLocal - the engine behind `spex serve ui`: the SAME gateway as public mode, bound to
// loopback by default with no TLS and no password — `--host` widens the bind to a chosen interface
// (LAN/tailnet viewing) while staying plain HTTP; the internet face remains `spex serve --public`.
// It serves the bundled dist and proxies /api + the terminal socket to a separately-run `spex serve`.
// This is the post-install replacement for the dogfood-only `npm run web` (a vite dev server an
// installed user has no source tree for). See [[packaging]].
export function serveDashboardLocal(opts: { port: number; apiPort: number; host?: string }): void {
  const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
  const distDir = resolveDistDir()
  ensureDashboardBuilt(join(pkgRoot, '..'), distDir) // bundled dist already has index.html → returns at once
  console.log(`[dashboard] serving ${distDir.endsWith('dashboard-dist') ? 'bundled' : 'monorepo'} build, /api → backend :${opts.apiPort}`)
  startGateway({ host: opts.host ?? '127.0.0.1', publicPort: opts.port, upstreamPort: opts.apiPort, password: '', tls: null, distDir, label: 'dashboard' })
}
