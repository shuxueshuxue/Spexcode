import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, specHistory, specDiffAt, loadConfig } from './specs.js'
import { resolveLayout } from './layout.js'
import { buildBoard } from './board.js'
import { newSession, listSessions, sendKeys, rawKey, closeSession, reopen, propose, mergeSession, sessionGraph, registerWatch, deregisterWatch, superviseQueue } from './sessions.js'
import { slashCommands } from './slash-commands.js'
import { attachViewer, detachViewer, writeViewer, resizeBridge, superviseBridges, type Viewer } from './pty-bridge.js'
import { installProcessGuards } from './resilience.js'

// last-resort net: an unforeseen async throw (e.g. a worktree vanishing mid-read during a worker
// self-merge) is logged and the server KEEPS SERVING instead of exiting and dropping the public port.
installProcessGuards()

const app = new Hono()
app.use('/api/*', cors())
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/', (c) => c.text('spec-cli — GET /api/board · /api/specs · /api/specs/:id/history · /api/layout · /api/sessions · /api/slash-commands'))
// @@@ health - the supervisor's readiness gate (src/supervise.ts). Deliberately cheap: a bare 200 with
// no git/.spec read, so a booting child reports "serving" the instant Hono is listening and the proxy
// can flip to it. Not under /api/* (no CORS needed) — it's loopback-only, supervisor→child.
app.get('/health', (c) => c.text('ok'))
// the assembled board (merged tree + overlay + sessions) — the dashboard's single source. Same data
// as `spex board`; the frontend only adds x/y pixels on top.
app.get('/api/board', async (c) => c.json(await buildBoard()))
app.get('/api/specs', async (c) => c.json(await loadSpecs()))
app.get('/api/specs/:id/history', async (c) => c.json(await specHistory(c.req.param('id'))))
// the spec.md line diff one version introduced — the history tab's per-version proof-of-change, fetched
// lazily when an older version's item expands (the latest version's diff ships with the board as node.lastDiff).
app.get('/api/specs/:id/diff/:hash', async (c) => c.json(await specDiffAt(c.req.param('id'), c.req.param('hash'))))
app.get('/api/layout', async (c) => c.json(await resolveLayout()))
// @@@ config presets - the SLASH-surface config nodes: reflexive, skill-shaped plugins living under a
// `slash/` dir in either config root (`.config/slash/*` instance plugins, `config/slash/*` project system).
// A node's surface is its LOCATION, not a field (see specs.ts loadSurface); the sibling system surface
// (`*/system/*`) is gathered separately into launched agents' system prompts and is NOT listed here.
// Pending plugins are excluded — only built/active ones gather. Each entry carries its prompt `body` (with a
// {{targets}} placeholder), its `kind` (mutating|report), and its folder `dir` + co-located `files` so the
// launcher can list these presets in the new-session `/` dropdown. Read live from disk (no git), like specs.
app.get('/api/config', (c) => c.json(loadConfig()))
// the dashboard input's `/` dropdown — the union of built-in + user/project/skill commands, computed
// the same way Claude Code computes its own `/` menu. Insert-only on the client; nothing executes here.
app.get('/api/slash-commands', (c) => c.json(slashCommands()))

// sessions: real tmux-backed Claude Code sessions. List + spawn, stream the live pane (WebSocket),
// forward keystrokes, and close.
app.get('/api/sessions', async (c) => c.json(await listSessions()))
// @@@ session graph - edges DERIVED from LIVE monitors, not a stored relationship. GET returns live
// sessions as nodes + edges where each A→B means "agent A is running `spex watch B` right now". A running
// `spex watch` registers + heartbeats here (watch) and deregisters on exit (unwatch); there is no
// persisted subscription. A literal `graph` segment, so it never collides with the `:id` routes below.
app.get('/api/sessions/graph', async (c) => c.json(await sessionGraph()))
app.post('/api/sessions/graph/watch', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const selectors = Array.isArray(b?.selectors) ? b.selectors.map(String) : []
  const ok = registerWatch(String(b?.token || ''), String(b?.watcher || ''), selectors, Number(b?.ttlMs) || undefined)
  return c.json({ ok }, ok ? 200 : 400)
})
app.post('/api/sessions/graph/unwatch', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ok = deregisterWatch(String(b?.token || ''))
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
// the docked ❯ line input (and server-side merge dispatch) dispatch a whole prompt through the rendezvous
// control socket. Socket-only + fail-loud: a prompt the agent doesn't confirm accepting returns 502 with the
// reason (never a silent 200), so the dashboard/manager sees a dead dispatch instead of a false success.
app.post('/api/sessions/:id/keys', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await sendKeys(c.req.param('id'), typeof body?.text === 'string' ? body.text : '')
  return c.json(r, r.ok ? 200 : 502)
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
superviseQueue()     // launch queued sessions as slots free (catches agent-authored proposals/crashes the server never sees directly)
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)

// @@@ graceful drain - the other half of the zero-downtime reload (src/supervise.ts). When the supervisor
// retires this child it sends SIGTERM; we must NOT die mid-response or the in-flight /api/board (~1.5s of
// git work) is RESET. So: stop accepting new connections (server.close), let active requests finish, and
// repeatedly drop now-idle keep-alive sockets so close()'s callback fires the instant the last request
// drains — then exit. By flip time the proxy already routes NEW traffic to our successor, so this only
// drains the requests we already owned. A hard cap guarantees we still exit if a connection won't close.
process.on('SIGTERM', () => {
  const srv = server as unknown as { close(cb?: () => void): void; closeIdleConnections?(): void }
  const sweep = setInterval(() => srv.closeIdleConnections?.(), 200)
  srv.close(() => { clearInterval(sweep); process.exit(0) })
  setTimeout(() => process.exit(0), 10000).unref()
})
