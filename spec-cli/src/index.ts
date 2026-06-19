import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { loadSpecs, specHistory } from './specs.js'
import { resolveLayout } from './layout.js'
import { buildBoard } from './board.js'
import { newSession, listSessions, captureSession, sendKeys, closeSession, reopen, propose, mergeSession, alive } from './sessions.js'

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
// SSE: push the tmux pane snapshot (~600ms) as a JSON string (escapes the newlines/ANSI safely).
// Stops when the client disconnects (stream.aborted) or the session ends (alive() false).
app.get('/api/sessions/:id/stream', (c) => streamSSE(c, async (stream) => {
  const id = c.req.param('id')
  let last = null
  while (!stream.aborted) {
    if (!(await alive(id))) break
    const snap = await captureSession(id)
    if (snap !== last) { last = snap; await stream.writeSSE({ data: JSON.stringify(snap) }) }
    await stream.sleep(600)
  }
}))
app.post('/api/sessions/:id/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await sendKeys(c.req.param('id'), typeof body?.text === 'string' ? body.text : '', body?.enter !== false)
  return c.json({ ok }, ok ? 200 : 404)
})
app.post('/api/sessions/:id/close', async (c) => c.json({ ok: await closeSession(c.req.param('id')) }))

const port = Number(process.env.PORT || 8787)
serve({ fetch: app.fetch, port })
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)
