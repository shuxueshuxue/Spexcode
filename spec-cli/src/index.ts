import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, specHistory, specDiff } from './specs.js'
import { resolveLayout } from './layout.js'
import { buildBoard } from './board.js'
import { newSession, listSessions, sendKeys, rawKey, closeSession, reopen, propose, mergeSession, sessionGraph, subscribe, unsubscribe } from './sessions.js'
import { slashCommands } from './slash-commands.js'
import { attachViewer, detachViewer, writeViewer, resizeBridge, superviseBridges, type Viewer } from './pty-bridge.js'

const app = new Hono()
app.use('/api/*', cors())
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/', (c) => c.text('spec-cli — GET /api/board · /api/specs · /api/specs/:id/history · /api/layout · /api/sessions · /api/slash-commands'))
// the assembled board (merged tree + overlay + sessions) — the dashboard's single source. Same data
// as `spex board`; the frontend only adds x/y pixels on top.
app.get('/api/board', async (c) => c.json(await buildBoard()))
app.get('/api/specs', async (c) => c.json(await loadSpecs()))
app.get('/api/specs/:id/history', async (c) => c.json(await specHistory(c.req.param('id'))))
// the spec.md line diff of the node's latest version — the recent pane's proof-of-change when a node
// has no A→B screenshot evidence yet.
app.get('/api/specs/:id/diff', async (c) => c.json(await specDiff(c.req.param('id'))))
app.get('/api/layout', async (c) => c.json(await resolveLayout()))
// the dashboard input's `/` dropdown — the union of built-in + user/project/skill commands, computed
// the same way Claude Code computes its own `/` menu. Insert-only on the client; nothing executes here.
app.get('/api/slash-commands', (c) => c.json(slashCommands()))

// sessions: real tmux-backed Claude Code sessions. List + spawn, stream the live pane (WebSocket),
// forward keystrokes, and close.
app.get('/api/sessions', async (c) => c.json(await listSessions()))
// @@@ session graph - the directed SUBSCRIPTION network (A subscribes to B). GET returns live sessions
// as nodes + the persisted edges (pruned to live endpoints); subscribe/unsubscribe create and remove one
// directed edge. A literal `graph` segment, so it never collides with the `:id` lifecycle routes below.
app.get('/api/sessions/graph', async (c) => c.json(await sessionGraph()))
app.post('/api/sessions/graph/subscribe', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ok = subscribe(String(b?.from || ''), String(b?.to || ''))
  return c.json({ ok }, ok ? 200 : 400)
})
app.post('/api/sessions/graph/unsubscribe', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ok = unsubscribe(String(b?.from || ''), String(b?.to || ''))
  return c.json({ ok }, ok ? 200 : 404)
})
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
// @@@ raw single-keystroke nav - the PRESERVED tmux send-keys path, distinct from the prompt socket the
// ❯ box uses. The dashboard's nav mode POSTs one key per keydown so a human can drive the agent's
// interactive TUI menus in real time: Up/Down/Left/Right/Enter/Escape/Tab/Space/Backspace + single
// printable chars (e.g. `s`). It forwards keystrokes only — no other behavior rides on this channel.
app.post('/api/sessions/:id/rawkey', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await rawKey(c.req.param('id'), typeof body?.key === 'string' ? body.key : '')
  return c.json({ ok }, ok ? 200 : 404)
})
app.post('/api/sessions/:id/close', async (c) => c.json({ ok: await closeSession(c.req.param('id')) }))

const port = Number(process.env.PORT || 8787)
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
superviseBridges()   // keep a warm tmux client per live session, so opening a tab is instant
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)
