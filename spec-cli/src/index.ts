import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { loadSpecs, specHistory } from './specs.js'
import { resolveLayout } from './layout.js'
import { buildBoard } from './board.js'
import { openSync, readSync, closeSync, fstatSync } from 'node:fs'
import { newSession, listSessions, captureSession, sendKeys, closeSession, reopen, propose, mergeSession, alive, resizeSession, openPaneStream, closePaneStream } from './sessions.js'

const app = new Hono()
app.use('/api/*', cors())

app.get('/', (c) => c.text('spec-cli — GET /api/board · /api/specs · /api/specs/:id/history · /api/layout · /api/sessions'))
// the assembled board (merged tree + overlay + sessions) — the dashboard's single source. Same data
// as `spex board`; the frontend only adds x/y pixels on top.
app.get('/api/board', async (c) => c.json(await buildBoard()))
app.get('/api/specs', (c) => c.json(loadSpecs()))
app.get('/api/specs/:id/history', (c) => c.json(specHistory(c.req.param('id'))))
app.get('/api/layout', async (c) => c.json(await resolveLayout()))

// sessions: real tmux-backed Claude Code sessions. List + spawn, stream the live pane (SSE),
// forward keystrokes, and close.
app.get('/api/sessions', async (c) => c.json(await listSessions()))
app.post('/api/sessions', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const prompt = typeof body?.prompt === 'string' ? body.prompt : ''
  if (!prompt.trim()) return c.json({ error: 'empty prompt' }, 400)
  return c.json(await newSession(typeof body?.node === 'string' ? body.node : null, prompt), 201)
})
// lifecycle transitions (thin callers of the session state machine)
app.post('/api/sessions/:id/resume', async (c) => c.json({ ok: await reopen(c.req.param('id')) }))   // back-to-working / relaunch
app.post('/api/sessions/:id/review', async (c) => c.json({ ok: await propose(c.req.param('id'), 'merge') }))
app.post('/api/sessions/:id/merge', async (c) => { const r = await mergeSession(c.req.param('id')); return c.json(r, r.ok ? 200 : 409) })
// SSE: stream the pane as an INCREMENTAL byte feed. First frame is a one-time snapshot of the current
// screen (so a fresh connect isn't blank) — cleared + CRLF'd so raw-mode xterm lays it out — then we
// tail the pipe-pane file by byte offset and push only the new raw bytes, base64'd (raw bytes aren't
// SSE/newline-safe). Polling 60ms makes keystrokes echo promptly; reading appended bytes is cheap (no
// capture-pane per tick). Stops + releases the pipe when the client disconnects or the session ends.
app.get('/api/sessions/:id/stream', (c) => streamSSE(c, async (stream) => {
  const id = c.req.param('id')
  const file = await openPaneStream(id)
  if (!file) return
  let fd = -1
  try {
    const snap = await captureSession(id)
    await stream.writeSSE({ data: Buffer.from('\x1b[H\x1b[2J' + snap.replace(/\n/g, '\r\n')).toString('base64') })
    fd = openSync(file, 'r')
    let pos = fstatSync(fd).size  // tail from EOF: the snapshot already shows everything up to now
    const buf = Buffer.allocUnsafe(64 * 1024)
    while (!stream.aborted) {
      if (!(await alive(id))) break
      let size = fstatSync(fd).size
      while (pos < size) {
        const n = readSync(fd, buf, 0, Math.min(buf.length, size - pos), pos)
        if (n <= 0) break
        pos += n
        await stream.writeSSE({ data: buf.subarray(0, n).toString('base64') })
      }
      await stream.sleep(60)
    }
  } finally {
    if (fd >= 0) closeSync(fd)
    await closePaneStream(id)
  }
}))
app.post('/api/sessions/:id/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await sendKeys(c.req.param('id'), typeof body?.text === 'string' ? body.text : '', body?.enter !== false)
  return c.json({ ok }, ok ? 200 : 404)
})
// fit: the dashboard sends the cols×rows it fitted xterm to, so tmux renders the pane at that size.
app.post('/api/sessions/:id/resize', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const cols = Number(body?.cols), rows = Number(body?.rows)
  return c.json({ ok: await resizeSession(c.req.param('id'), cols, rows) })
})
app.post('/api/sessions/:id/close', async (c) => c.json({ ok: await closeSession(c.req.param('id')) }))

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)
