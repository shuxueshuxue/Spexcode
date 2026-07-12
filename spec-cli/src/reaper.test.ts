// installConnectionReaper — the socket-level reaper that reaps abandoned sockets Node's own HTTP timeouts
// leave open (measured: server-reaps-abandoned-connections). Exercised against a real ephemeral http.Server
// with short deadlines: a slow-loris partial-header socket is reaped ≤ header deadline; a completed request
// then idle keep-alive is reaped ≤ idle deadline; an ACTIVE SSE stream is NOT reaped for the run's duration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { installConnectionReaper } from './reaper.js'

const HEADER_MS = 250
const IDLE_MS = 250

function startServer(): Promise<{ port: number; close(): void }> {
  const server = http.createServer((req, res) => {
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
  })
  installConnectionReaper(server, { headerMs: HEADER_MS, idleMs: IDLE_MS })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      resolve({ port, close: () => server.close() })
    })
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

test('slow-loris partial-header socket is reaped at ~header deadline', async () => {
  const srv = await startServer()
  const sock = net.connect(srv.port, '127.0.0.1', () => {
    sock.write('GET /api/graph HTTP/1.1\r\nHost: x\r\nX-Slow: ')  // dangling — request never completes
  })
  const t0 = Date.now()
  const reaped = await closesWithin(sock, HEADER_MS * 4)
  const dt = Date.now() - t0
  assert.ok(reaped, 'slow-loris socket must be reaped, not left open')
  assert.ok(dt >= HEADER_MS - 80 && dt < HEADER_MS * 3, `reaped at ~header deadline, got ${dt}ms`)
  sock.destroy(); srv.close()
})

test('completed request then idle keep-alive socket is reaped at ~idle deadline', async () => {
  const srv = await startServer()
  const sock = net.connect(srv.port, '127.0.0.1', () => {
    sock.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')  // a COMPLETE request
  })
  // read the response so the reaper sees 'finish' and re-arms the idle deadline; then stay silent.
  await new Promise<void>((resolve) => { sock.once('data', () => resolve()) })
  const armedAt = Date.now()
  const reaped = await closesWithin(sock, IDLE_MS * 5)
  const dt = Date.now() - armedAt
  assert.ok(reaped, 'idle keep-alive socket must be reaped after the idle window')
  assert.ok(dt >= IDLE_MS - 80, `reaped no earlier than the idle deadline, got ${dt}ms`)
  sock.destroy(); srv.close()
})

test('active SSE stream with a slow consumer is NOT reaped for the run duration', async () => {
  const srv = await startServer()
  const sock = net.connect(srv.port, '127.0.0.1', () => {
    sock.write('GET /sse HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n')  // completes, then streams
  })
  let bytes = 0
  sock.on('data', (b) => { bytes += b.length })   // a real (if slow) consumer draining the stream
  // wait well past BOTH deadlines — an active response must never be reaped on duration.
  const closedEarly = await closesWithin(sock, HEADER_MS + IDLE_MS + 600)
  assert.equal(closedEarly, false, 'active SSE stream must stay open past the deadlines')
  assert.ok(bytes > 0, 'SSE consumer received streamed bytes')
  sock.destroy(); srv.close()
})
