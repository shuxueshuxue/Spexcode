import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, specHistory } from './specs.js'
import { resolveLayout } from './layout.js'
import { buildBoard } from './board.js'
import { newSession, listSessions, sendKeys, closeSession, reopen, propose, mergeSession } from './sessions.js'
import { attachViewer, detachViewer, writeViewer, resizeBridge, superviseBridges, type Viewer } from './pty-bridge.js'

const app = new Hono()
app.use('/api/*', cors())
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/', (c) => c.text('spec-cli — GET /api/board · /api/specs · /api/specs/:id/history · /api/layout · /api/sessions'))
// the assembled board (merged tree + overlay + sessions) — the dashboard's single source. Same data
// as `spex board`; the frontend only adds x/y pixels on top.
app.get('/api/board', async (c) => c.json(await buildBoard()))
app.get('/api/specs', (c) => c.json(loadSpecs()))
app.get('/api/specs/:id/history', (c) => c.json(specHistory(c.req.param('id'))))
app.get('/api/layout', async (c) => c.json(await resolveLayout()))

// sessions: real tmux-backed Claude Code sessions. List + spawn, stream the live pane (WebSocket),
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

// @@@ terminal socket - ONE bidirectional WebSocket replaces the old SSE-down + POST/keys + POST/resize
// trio. The browser is wired to a shared tmux client (pty-bridge): server→client = raw pane bytes
// (binary); client→server = raw terminal input (binary: keystrokes + mouse) and a control frame (text
// JSON {t:'resize',cols,rows}). No base64, no snapshot splice — the bridge is a real tmux client, so
// scrollback is tmux's own (mouse wheel → copy-mode) and the first paint is one coherent repaint.
app.get('/api/sessions/:id/socket', upgradeWebSocket((c) => {
  const id = c.req.param('id') as string
  let viewer: Viewer | null = null
  return {
    onOpen(_evt, ws) {
      viewer = { send: (buf) => { try { ws.send(Uint8Array.from(buf)) } catch { /* viewer gone */ } } }
      if (!attachViewer(id, viewer)) { try { ws.close() } catch { /* already closed */ } }
    },
    onMessage(evt) {
      if (!viewer) return
      const data = evt.data
      if (typeof data === 'string') {
        // text frame = control. Only resize today.
        try { const m = JSON.parse(data); if (m?.t === 'resize') resizeBridge(id, Number(m.cols), Number(m.rows)) } catch { /* ignore */ }
      } else if (data instanceof ArrayBuffer) {
        writeViewer(id, Buffer.from(data))                              // binary: raw terminal input
      } else if (ArrayBuffer.isView(data)) {
        writeViewer(id, Buffer.from(data.buffer, data.byteOffset, data.byteLength))  // (keystrokes / mouse)
      }
    },
    onClose() { if (viewer) detachViewer(id, viewer) },
  }
}))
// the docked ❯ line input (and server-side merge dispatch) still send a whole line via send-keys.
app.post('/api/sessions/:id/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await sendKeys(c.req.param('id'), typeof body?.text === 'string' ? body.text : '', body?.enter !== false)
  return c.json({ ok }, ok ? 200 : 404)
})
app.post('/api/sessions/:id/close', async (c) => c.json({ ok: await closeSession(c.req.param('id')) }))

const port = Number(process.env.PORT || 8787)
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
superviseBridges()   // keep a warm tmux client per live session, so opening a tab is instant
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)
