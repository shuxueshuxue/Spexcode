// installConnectionReaper — the socket-level reaper that reaps abandoned sockets Node's own HTTP timeouts
// leave open (measured: server-reaps-abandoned-connections). Exercised against real ephemeral servers with
// short deadlines, in BOTH transports the product serves: plain http (the child) and https (the public
// gateway). The TLS cases exist because 'connection' on a TLS server carries the RAW socket while requests
// report the TLSSocket — a deadline stranded on the raw socket once reaped every healthy TLS connection at
// headerMs (measured: stream-survives-public-gateway, the dashboard's "reconnecting…" storm). Covered:
// a slow-loris partial-header socket is reaped ≤ header deadline; a TCP connect that never completes the
// TLS handshake is reaped the same way; a completed request then idle keep-alive is reaped ≤ idle deadline;
// an ACTIVE SSE stream is NOT reaped for the run's duration — on TLS exactly as on plain http.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
import { installConnectionReaper } from './reaper.js'

const HEADER_MS = 250
const IDLE_MS = 250

// static self-signed fixture (CN=reaper-test, valid ~100y) — hermetic, no openssl needed at test time.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDGFqt6a4DBoEJL
cuY1bM+vB8usxZHuj35zUl7yR9idFkj74pT9qrWWpB+lvGbCc8ob9SupHkcUmK9i
g+AiWo5HlYccUxiGJ6Y2lvt7t0Exy2zzPbt+ni6Vr84wZolD8Yfh3sVwD/fMP2Kr
vSuxSCxVxcvGShuZghtsU5daS5Qws74B6WkgW10x2QOfTlkBVwu/tRjUh8zvquEu
G5N8yIg7wc9zPV/MuFIQLZ5Slf6NurFtISYSwSds0sOFT5nBWRJ6phTqb/p/CEBt
8aOdqkB+oTW2rd44y9y/DqVuesAx5AcGFud5QC8cNJtg4TbvstUlSrIYPp0eqYmz
/B+O5kRtAgMBAAECggEAKpH+Jae7SsFaZfUKKMKa6nJqMNXfzA09/2IdIgPTN0Uu
B6XU36QDdN2OKJPR4Km6LmJ00No/K9u5W1pcfX2JFLS7jdiEzXXxaEtvvdFu+xjM
8ARdCjPL7qLS1L+Acd/TFDVIKJJh7lzT43Ua0fVhA8jnh1RvVIDrzE61mPPjo8ho
Htlg7OC70GRsfBtVXcfhqixOcO+dfaoYs2rMVdiFQBhti/ikY90ZDKc9iYbZHtDn
tNlh4exJQ2r45DeII8ynP/FRIZtZPrOCInh/LRlRn95Cbh8QFZETfC9gb7bn94gd
SrF/QNkUpsaTeSoXjJ+H+21kAnITFYtAmdoq+HqoGQKBgQDsSGPRAU8563h/URMW
XkDrscazak/TPclEOoZvExRGI5Y6we5ToMBmg3DDkCSYBf244ObIySDACLYqgfuB
AK1c2h4rjsF+S6IZlCujiLFsfjUiPOzGKrKkiTQjAtKfC/KbSb+YH3LcUoVYynMO
JLXintdFstnsyP5cdhEoMA/m1QKBgQDWnlpQ4QgLbN7DRJHMXbrprvgyFvKC5NB4
gM7jbg4xY2TwLjMQJKcWRfCvd76wKgLuYfBrO33NRS4uppgg9lllpkOqy+zjH5Pi
6sG/uhTR9mZookYkFwnRmH6VwiymWsaPSZ2qvoP8h7WgWt2DRCi8nW2V3kvT3Ngu
6Fthi3njOQKBgQCX2mJEJcpMGBhGAs34lzS0BXoFPrL0uQXL0q0pX6Ks/RwEwTQx
DOP6PklPdij+hwMsOWY47oIcyLyCjy0bGFtSjF/NcJ7MU0FnnQF6xVP5vRba3Try
lOhgtEkMozjHvL77rCb1VmjUTjii+uF82n0Gmz0Q70P9WKOYusyF/nWJzQKBgQDP
j7pdOiVjl1khlHFFKukYE6XqG5NS0CRmRnzQK6ICVdRLDQNJe4k021NZAAAls5u+
HG495v1VxrBRYcEDL/1pd5E935csWV/XN59F45s7LIgCbd5UDQvr7wWNpIs2H9ik
v1eCyFoxorYfbYGJ8CNNtxtCtAi1z4Isa3/lKNUq0QKBgQChvHREOcla0EI3Urug
8/5jsRP6whrL/NlIXQiatuKhiDGL86OeiqXgf+diul4boSXcZ6W/pmdDeWAVrtfx
2DK6qcTSy+iwQjORAMgUzPK35hgGsEcCm3d9gZvjZ3F8YQTqyUD9xtpJBbF6z1zY
2gOxRjldtyyelQGVOCDgTf6Kng==
-----END PRIVATE KEY-----`
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDKzCCAhOgAwIBAgIUcnLtfDCFVbjfItHkSRxuShI4230wDQYJKoZIhvcNAQEL
BQAwFjEUMBIGA1UEAwwLcmVhcGVyLXRlc3QwIBcNMjYwNzEyMDY1MDM0WhgPMjEy
NjA2MTgwNjUwMzRaMBYxFDASBgNVBAMMC3JlYXBlci10ZXN0MIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxharemuAwaBCS3LmNWzPrwfLrMWR7o9+c1Je
8kfYnRZI++KU/aq1lqQfpbxmwnPKG/UrqR5HFJivYoPgIlqOR5WHHFMYhiemNpb7
e7dBMcts8z27fp4ula/OMGaJQ/GH4d7FcA/3zD9iq70rsUgsVcXLxkobmYIbbFOX
WkuUMLO+AelpIFtdMdkDn05ZAVcLv7UY1IfM76rhLhuTfMiIO8HPcz1fzLhSEC2e
UpX+jbqxbSEmEsEnbNLDhU+ZwVkSeqYU6m/6fwhAbfGjnapAfqE1tq3eOMvcvw6l
bnrAMeQHBhbneUAvHDSbYOE277LVJUqyGD6dHqmJs/wfjuZEbQIDAQABo28wbTAd
BgNVHQ4EFgQUIrnRYBGXvz3yToDqIbor94vyxYEwHwYDVR0jBBgwFoAUIrnRYBGX
vz3yToDqIbor94vyxYEwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2Nh
bGhvc3SHBH8AAAEwDQYJKoZIhvcNAQELBQADggEBABkouACCnmcL33EqHgW5JhYc
siLEkCoRmOPFusLqByKWV6wvSM/S0Arce5fNMxQDcYGX0MF2bmHmgwDZJT62VNNT
QMC/Z/iGXpfXXGxRvuIKqsqgZVetO1gQ8Ud+nsKUzXQx8VVDNJ30kklbhDtl/diC
vyznxqUAtFYCNoXgnR87DWNbMEpShEMpyw1S6PR0Ks76hIMIuedol6OwGUxN0OZa
FE+TIhCIOpvlPlbOB0XLZbK6kN9TJJEuPUMoCJtS1H2ATu1w8Pb1mEx4fR8ZMm2i
7+CWBhlEdDLPCvUxmOotheQpQOHgmVEeD9kBoxIcKq4iGYD4Wb19VAkgr0UUD1o=
-----END CERTIFICATE-----`

const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.url === '/sse') {
    // an active long-lived response: headers done (a completed request), body streams forever, never ends.
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': open\n\n')
    const t = setInterval(() => { try { res.write(': tick\n\n') } catch { /* gone */ } }, 60)
    res.on('close', () => clearInterval(t))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('ok')
}

type Started = { port: number; close(): void }
function startServer(kind: 'http' | 'https'): Promise<Started> {
  const server = kind === 'https' ? https.createServer({ key: TEST_KEY, cert: TEST_CERT }, handler) : http.createServer(handler)
  installConnectionReaper(server as http.Server, { headerMs: HEADER_MS, idleMs: IDLE_MS })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      resolve({ port, close: () => server.close() })
    })
  })
}

// dial the server with the transport it speaks: a plain socket, or a completed TLS handshake.
function dial(kind: 'http' | 'https', port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    if (kind === 'http') {
      const s = net.connect(port, '127.0.0.1', () => resolve(s))
      s.once('error', reject)
    } else {
      const s = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => resolve(s))
      s.once('error', reject)
    }
  })
}

// resolve true if the socket closes within `ms`, false if it is still open at the deadline.
function closesWithin(sock: net.Socket, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v) } }
    sock.on('close', () => finish(true))
    sock.on('error', () => finish(true))   // ECONNRESET from a server destroy counts as reaped
    setTimeout(() => finish(false), ms)
  })
}

for (const kind of ['http', 'https'] as const) {
  test(`[${kind}] slow-loris partial-header socket is reaped at ~header deadline`, async () => {
    const srv = await startServer(kind)
    const sock = await dial(kind, srv.port)
    sock.write('GET /api/graph HTTP/1.1\r\nHost: x\r\nX-Slow: ')  // dangling — request never completes
    const t0 = Date.now()
    const reaped = await closesWithin(sock, HEADER_MS * 4)
    const dt = Date.now() - t0
    assert.ok(reaped, 'slow-loris socket must be reaped, not left open')
    assert.ok(dt >= HEADER_MS - 80 && dt < HEADER_MS * 3, `reaped at ~header deadline, got ${dt}ms`)
    sock.destroy(); srv.close()
  })

  test(`[${kind}] completed request then idle keep-alive socket is reaped at ~idle deadline`, async () => {
    const srv = await startServer(kind)
    const sock = await dial(kind, srv.port)
    sock.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')  // a COMPLETE request
    // read the response so the reaper sees 'finish' and re-arms the idle deadline; then stay silent.
    await new Promise<void>((resolve) => { sock.once('data', () => resolve()) })
    const armedAt = Date.now()
    const reaped = await closesWithin(sock, IDLE_MS * 5)
    const dt = Date.now() - armedAt
    assert.ok(reaped, 'idle keep-alive socket must be reaped after the idle window')
    assert.ok(dt >= IDLE_MS - 80, `reaped no earlier than the idle deadline, got ${dt}ms`)
    sock.destroy(); srv.close()
  })

  test(`[${kind}] active SSE stream with a slow consumer is NOT reaped for the run duration`, async () => {
    const srv = await startServer(kind)
    const sock = await dial(kind, srv.port)
    sock.write('GET /sse HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')  // completes, then streams
    let bytes = 0
    sock.on('data', (b) => { bytes += b.length })   // a real (if slow) consumer draining the stream
    // wait well past BOTH deadlines — an active response must never be reaped on duration.
    const closedEarly = await closesWithin(sock, HEADER_MS + IDLE_MS + 600)
    assert.equal(closedEarly, false, 'active SSE stream must stay open past the deadlines')
    assert.ok(bytes > 0, 'SSE consumer received streamed bytes')
    sock.destroy(); srv.close()
  })
}

test('[https] TCP connect that never completes the TLS handshake is reaped at ~header deadline', async () => {
  const srv = await startServer('https')
  const sock = net.connect(srv.port, '127.0.0.1')   // raw TCP, no ClientHello ever sent
  await new Promise<void>((resolve) => sock.once('connect', () => resolve()))
  const t0 = Date.now()
  const reaped = await closesWithin(sock, HEADER_MS * 4)
  const dt = Date.now() - t0
  assert.ok(reaped, 'handshake-stalled socket must be reaped, not left open')
  assert.ok(dt >= HEADER_MS - 80 && dt < HEADER_MS * 3, `reaped at ~header deadline, got ${dt}ms`)
  sock.destroy(); srv.close()
})

// issue #65 pin: a server CREATED with Node's own timeouts BELOW the reaper deadlines must still be governed
// by the reaper alone. Node's headersTimeout/keepAliveTimeout cover the same phases, and when they raced the
// reaper they won (the child's headersTimeout: 20000 beat the 30s default header deadline on every reap and
// silently capped SPEXCODE_REAP_HEADER_MS above 20s). install() claims ownership by zeroing them, so: the
// loris dies at ~headerMs by a BARE destroy — zero bytes received; Node writing "408 Request Timeout" first
// would mean its machinery still owns the socket — and an idle keep-alive dies at ~idleMs, not at Node's
// keepAliveTimeout.
test('[http] hostile serverOptions below the reaper deadlines do not shadow the reaper (issue #65)', async () => {
  const server = http.createServer(
    { keepAliveTimeout: 60, headersTimeout: 100, requestTimeout: 5000, connectionsCheckingInterval: 50 },
    handler,
  )
  installConnectionReaper(server as http.Server, { headerMs: HEADER_MS, idleMs: IDLE_MS })
  const port = await new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port)))

  const loris = await dial('http', port)
  let received = 0
  loris.on('data', (b) => { received += b.length })
  loris.write('GET /api/graph HTTP/1.1\r\nHost: x\r\nX-Slow: ')   // dangling — never completes
  const t0 = Date.now()
  const reaped = await closesWithin(loris, HEADER_MS * 4)
  const dt = Date.now() - t0
  assert.ok(reaped, 'slow-loris socket must still be reaped')
  assert.equal(received, 0, 'a reaper kill is a bare destroy — a 408 means Node headersTimeout fired, shadowing the reaper')
  assert.ok(dt >= HEADER_MS - 80, `the reaper deadline governs, not Node headersTimeout(100ms), got ${dt}ms`)

  const idle = await dial('http', port)
  idle.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')   // a COMPLETE request
  await new Promise<void>((resolve) => { idle.once('data', () => resolve()) })
  const armedAt = Date.now()
  const idleReaped = await closesWithin(idle, IDLE_MS * 5)
  const idleDt = Date.now() - armedAt
  assert.ok(idleReaped, 'idle keep-alive socket must still be reaped')
  assert.ok(idleDt >= IDLE_MS - 80, `the reaper idle deadline governs, not Node keepAliveTimeout(60ms), got ${idleDt}ms`)
  loris.destroy(); idle.destroy(); server.close()
})
