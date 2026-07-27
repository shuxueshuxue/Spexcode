import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { proxyHttp } from './gateway.js'

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
  })
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1500): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function getText(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path, headers: { connection: 'close' } }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
    request.on('error', reject)
  })
}

test('proxyHttp pairs normal and abruptly-closed downstream/upstream lifetimes', async (t) => {
  let activeSse = 0
  let activeCompressed = 0
  let activeEarlyResponses = 0
  const earlyUpstream = { request: null as http.IncomingMessage | null }
  let activeUploads = 0
  let uploadStarted!: () => void
  const uploadStart = new Promise<void>((resolve) => { uploadStarted = resolve })

  const upstream = http.createServer((req, res) => {
    if (req.url === '/normal') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    if (req.url === '/stream') {
      activeSse++
      res.once('close', () => { activeSse-- })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: ready\n\n')
      return
    }
    if (req.url === '/upload') {
      activeUploads++
      req.once('data', uploadStarted)
      req.once('close', () => { activeUploads-- })
      return
    }
    if (req.url === '/compressed-stream') {
      activeCompressed++
      res.once('close', () => { activeCompressed-- })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write(`{"partial":"${'x'.repeat(65536)}`)
      return
    }
    if (req.url === '/early-response') {
      activeEarlyResponses++
      earlyUpstream.request = req
      req.socket.once('close', () => { activeEarlyResponses-- })
      req.once('data', () => {
        res.writeHead(413, { 'content-type': 'text/plain' })
        res.end('too large')
      })
      return
    }
    if (req.url === '/cut') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.write('partial')
      res.socket?.destroy()
      return
    }
    res.writeHead(404)
    res.end()
  })
  const upstreamPort = await listen(upstream)
  const proxy = http.createServer((req, res) => proxyHttp(req, res, upstreamPort))
  const proxyPort = await listen(proxy)
  t.after(() => {
    proxy.closeAllConnections()
    upstream.closeAllConnections()
    proxy.close()
    upstream.close()
  })

  assert.deepEqual(await getText(proxyPort, '/normal'), { status: 200, body: '{"ok":true}' })

  await new Promise<void>((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port: proxyPort, path: '/stream' }, (response) => {
      response.once('data', () => {
        response.destroy()
        request.destroy()
        resolve()
      })
    })
    request.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
    })
  })
  await waitFor(() => activeSse === 0, 'the SSE upstream response to close')

  await new Promise<void>((resolve, reject) => {
    const request = http.get({
      host: '127.0.0.1', port: proxyPort, path: '/compressed-stream',
      headers: { 'accept-encoding': 'gzip' },
    }, (response) => {
      response.once('data', () => {
        response.destroy()
        request.destroy()
        resolve()
      })
    })
    request.on('error', (error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(error)
    })
  })
  await waitFor(() => activeCompressed === 0, 'the compressed upstream response and transform to close')

  const upload = http.request({
    host: '127.0.0.1', port: proxyPort, path: '/upload', method: 'POST',
    headers: { 'content-length': '1000000' },
  })
  upload.on('error', () => {})
  upload.write('partial')
  await uploadStart
  upload.destroy()
  await waitFor(() => activeUploads === 0, 'the aborted upstream upload to close')

  const earlyResponse = await new Promise<{ request: http.ClientRequest; status: number; body: string }>((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1', port: proxyPort, path: '/early-response', method: 'POST',
      headers: { 'content-length': '1000000' },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ request, status: response.statusCode ?? 0, body }))
    })
    request.on('error', reject)
    request.write('partial')
  })
  assert.deepEqual({ status: earlyResponse.status, body: earlyResponse.body }, { status: 413, body: 'too large' })
  earlyResponse.request.destroy()
  await waitFor(() => activeEarlyResponses === 0, 'the early-response upstream socket to close')
  assert.deepEqual({
    active: activeEarlyResponses,
    requestComplete: earlyUpstream.request?.complete,
    socketDestroyed: earlyUpstream.request?.socket.destroyed,
  }, { active: 0, requestComplete: false, socketDestroyed: true })

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('truncated upstream left the downstream response open')), 1500)
    const request = http.get({ host: '127.0.0.1', port: proxyPort, path: '/cut' }, (response) => {
      response.resume()
      response.once('close', () => { clearTimeout(timer); resolve() })
    })
    request.on('error', (error) => {
      clearTimeout(timer)
      if ((error as NodeJS.ErrnoException).code === 'ECONNRESET') resolve()
      else reject(error)
    })
  })
})
