import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, loadSpecsLite, specContent, specHistory, specDiffAt, loadConfig } from './specs.js'
import { resolveLayout, mainBranch } from './layout.js'
import { buildBoard } from './board.js'
import { boardStream } from './boardStream.js'
import { gitA, gitTry } from './git.js'
import { newSession, listSessions, sendKeys, rawKey, exitSession, closeSession, reopen, propose, mergeSession, reviewPayload, captureSessionResult, sessionPrompt, sessionGraph, registerWatch, deregisterWatch, renameSession, setSessionSort, superviseQueue } from './sessions.js'
import { defaultHarness, HARNESSES } from './harness.js'
import { evalTimeline, readBlobByHash } from '../../spec-yatsu/src/evaltab.js'
import { buildProofModel, renderProofHtml } from '../../spec-yatsu/src/proof.js'
import { saveUpload, MAX_UPLOAD_BYTES } from './uploads.js'
import { attachViewer, detachViewer, resizeBridge, forwardWheel, superviseBridges, type Viewer } from './pty-bridge.js'
import { installProcessGuards } from './resilience.js'

// last-resort net: an unforeseen async throw (e.g. a worktree vanishing mid-read during a worker
// self-merge) is logged and the server KEEPS SERVING instead of exiting and dropping the public port.
installProcessGuards()

const app = new Hono()
app.use('/api/*', cors())
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/', (c) => c.text('spec-cli — GET /api/board · /api/specs · /api/specs/:id/history · /api/layout · /api/sessions · /api/slash-commands'))
// the supervisor's readiness gate (supervise.ts): a bare git-free 200 so a booting child reports ready the
// instant Hono is listening. Not under /api/* — loopback-only (supervisor→child), no CORS needed.
app.get('/health', (c) => c.text('ok'))
// the assembled board (merged tree + overlay + sessions) — the dashboard's single source. Same data
// as `spex board`; the frontend only adds x/y pixels on top. Freshness is PUSH-first ([[board-stream]]): the
// dashboard reloads on a `/api/board/stream` event, not a tight poll, so the route is a conditional-request
// endpoint: `etag()` hashes the serialized body, and a reload whose `If-None-Match` matches gets a bodyless 304
// instead of the full transfer (~1 MB on the dogfood board — it scales with the node count). The 304 saves the
// WIRE only: buildBoard still runs its git read on every request, so cutting poll frequency (the push channel
// does) is what saves the server work.
app.get('/api/board', etag(), async (c) => c.json(await buildBoard()))
// the board's push channel: an SSE that fires `board-changed` on any session-store write, so the dashboard
// reloads the instant status moves instead of waiting for its slow fallback poll ([[board-stream]]).
app.get('/api/board/stream', (c) => boardStream(c))
app.get('/api/specs', async (c) => c.json(await loadSpecs()))
// the search corpus ([[board-lean]]): a filesystem-only {id,title,path,desc,body} for every node, NO git. The
// board omits `body` to stay lean, so the search palette fetches this ONCE when it opens (cached client-side)
// to rank nodes over their prose — off the board's hot poll. A literal segment, before the `:id` routes.
app.get('/api/specs/lite', (c) => c.json(loadSpecsLite()))
// one node's body + parsed parts ([[board-lean]]): the board no longer ships either, so the detail view
// fetches this when a node opens. 404 for an unknown id.
app.get('/api/specs/:id/content', (c) => {
  const x = specContent(c.req.param('id'))
  return x ? c.json(x) : c.json({ body: '', parts: null }, 404)
})
app.get('/api/specs/:id/history', async (c) => c.json(await specHistory(c.req.param('id'))))
// the spec.md line diff one version introduced — the history tab's per-version proof-of-change, fetched
// lazily when an older version's item expands (the latest version's diff ships with the board as node.lastDiff).
app.get('/api/specs/:id/diff/:hash', async (c) => c.json(await specDiffAt(c.req.param('id'), c.req.param('hash'))))
// a unified diff of a node's spec.md from its fork point (the worktree's merge-base with main) to that
// worktree's working tree. An untracked brand-new node is invisible to `git diff <base>`, so when the base
// diff is empty AND status is `??` synthesize an all-additions view via `diff --no-index` (gitTry — --no-index
// exits 1, which gitA would swallow). Gated on `??` so a tracked file with no pending change stays empty.
app.get('/api/edit', async (c) => {
  const source = c.req.query('source') || '', path = c.req.query('path') || ''
  if (!source || !path) return c.json({ patch: '' })
  const mb = mainBranch()
  const base = (await gitA(['-C', source, 'merge-base', mb, 'HEAD'])).trim() || mb
  let patch = await gitA(['-C', source, 'diff', base, '--', path])
  if (!patch) {
    const status = await gitA(['-C', source, 'status', '--porcelain', '--untracked-files=all', '--', path])
    if (status.startsWith('??')) patch = (await gitTry(['-C', source, 'diff', '--no-index', '--', '/dev/null', path])).stdout
  }
  return c.json({ patch })
})
// a node's eval timeline (read half of `spex yatsu`): yatsu-sidecar readings joined with a live freshness
// flag, newest-first; `hasYatsu:false` when none declared. Contract belongs to [[spec-yatsu]].
app.get('/api/specs/:id/evals', async (c) => c.json(await evalTimeline(c.req.param('id'))))
// serve a reading's evidence blob by content hash (bytes never enter git): bad hash → 400, missing → 404,
// else the bytes with a sniffed MIME and an immutable cache header (the name IS the content hash).
app.get('/api/yatsu/blob/:hash', (c) => {
  const r = readBlobByHash(c.req.param('hash'))
  if (!r.ok) return c.text(r.message, r.reason === 'invalid' ? 400 : 404)
  return c.body(new Uint8Array(r.bytes), 200, { 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable' })
})
app.get('/api/layout', async (c) => c.json(await resolveLayout()))
// the `surface: command` config-root plugins (built/active only) for the new-session `/` dropdown — each with
// its prompt `body` ({{targets}} placeholder), `kind`, and folder `dir` + co-located `files`. surface is a
// frontmatter field, not a dir (specs.ts loadSurface); `surface: system` siblings are gathered elsewhere.
app.get('/api/config', (c) => c.json(loadConfig()))
// the dashboard input's `/` dropdown — computed by the launcher's HARNESS adapter the same way that harness
// computes its own `/` menu ([[harness-adapter]]). The client passes `?harness=<id>` for the ACTIVE session,
// so a codex tab gets CODEX's menu, not the default's; unknown/absent → default. Insert-only on the client.
app.get('/api/slash-commands', (c) => {
  const h = HARNESSES.find((x) => x.id === c.req.query('harness')) || defaultHarness
  return c.json(h.slashCommands())
})

// write a pasted/dropped/picked file to this (worker) machine's /tmp and return its absolute path for the
// client to splice into the prompt. Fail-loud: no/empty file → 400, over the size cap → 413, write error → 500.
app.post('/api/uploads', async (c) => {
  const body = await c.req.parseBody().catch(() => ({} as Record<string, string | File>))
  const file = body['file']
  if (!(file instanceof File) || file.size === 0) return c.json({ error: 'no file' }, 400)
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large' }, 413)
  try {
    return c.json({ path: await saveUpload(file) }, 201)
  } catch (e) {
    return c.json({ error: String((e as Error)?.message || e) }, 500)
  }
})

// sessions: real tmux-backed Claude Code sessions. List + spawn, stream the live pane (WebSocket),
// forward keystrokes, and close.
app.get('/api/sessions', async (c) => c.json(await listSessions()))
// edges derived live from `spex watch` monitors (A→B = agent A is watching B), not a stored subscription;
// watch/unwatch register + heartbeat. A literal `graph` segment so it never collides with the `:id` routes.
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
  const harness = typeof body?.harness === 'string' ? body.harness : undefined
  // parent = the spawning session's id, resolved by the CALLER (createSession) in its own process and passed
  // through here ([[session-nesting]]); the browser's New Session omits it → a top-level session.
  const parent = typeof body?.parent === 'string' && body.parent.trim() ? body.parent.trim() : null
  try {
    return c.json(await newSession(typeof body?.node === 'string' ? body.node : null, prompt, harness, parent), 201)
  } catch (e) { return c.json({ error: String((e as Error).message || e) }, 400) }   // unknown harness id → 400, not a 500
})
// one server-side merge bundle (ahead/dirty/diff(merge-base)/gates/proposal) for the manager cockpit;
// dashboard and `spex review` are thin callers. 404 for an unknown id. See [[manager-cockpit]].
app.get('/api/sessions/:id/review', async (c) => {
  const r = await reviewPayload(c.req.param('id'))
  return r ? c.json(r) : c.json({ error: 'no such session' }, 404)
})
// the [[review-proof]] HTML: the diff grouped by node, each node's measured yatsu loss with evidence inlined
// as data-URIs, and the merge gates. `?format=json` returns the model; default = rendered HTML. 404 unknown id.
app.get('/api/sessions/:id/proof', async (c) => {
  const m = await buildProofModel(c.req.param('id'))
  if (!m) return c.text('no such session', 404)
  if (c.req.query('format') === 'json') return c.json(m)
  return c.html(renderProofHtml(m))
})
// the session's live pane as text (one-shot snapshot) for a backend client (`spex capture`). Empty and fail
// stay distinct: an empty pane is 200 with empty body; unknown id → 404, offline (no live pane) → 409, error → 502.
app.get('/api/sessions/:id/capture', async (c) => {
  const r = await captureSessionResult(c.req.param('id'))
  if (r.ok) return c.text(r.pane)
  if (r.reason === 'unknown') return c.text('no such session', 404)
  if (r.reason === 'offline') return c.text('session offline (no live pane)', 409)
  return c.text('capture failed', 502)
})
// the session's originating prompt (what it was asked to do), for a manager client; 404 if none recorded.
app.get('/api/sessions/:id/prompt', async (c) => {
  const p = await sessionPrompt(c.req.param('id'))
  return p == null ? c.text('no prompt recorded', 404) : c.text(p)
})
// lifecycle transitions (thin callers of the session state machine)
app.post('/api/sessions/:id/resume', async (c) => c.json({ ok: await reopen(c.req.param('id')) }))   // relaunch if offline; demotes working→idle, keeps any declaration
app.post('/api/sessions/:id/review', async (c) => c.json({ ok: await propose(c.req.param('id'), 'merge') }))
// a dispatch to the session's own agent (it runs the merge), never a server merge — the server never touches
// main's tree. 200 {dispatched:true} once the prompt is accepted, 409 {dispatched:false} if the agent is unreachable.
app.post('/api/sessions/:id/merge', async (c) => {
  const r = await mergeSession(c.req.param('id'))
  return c.json(r, r.dispatched ? 200 : 409)
})

// one WS over a shared tmux control-mode client (pty-bridge): server→client = raw pane bytes (binary); the
// view takes no keyboard input, so client→server is only a text control frame — {t:'resize',cols,rows} or
// {t:'wheel',…}. The bridge resolves the wheel against tmux pane state: copy-mode repaint for normal panes,
// SGR mouse report injection for mouse-owning TUIs. A real tmux client, so the first paint is one coherent
// frame and live bytes arrive as events.
app.get('/api/sessions/:id/socket', upgradeWebSocket((c) => {
  const id = c.req.param('id') as string
  // the size-first handshake: a client that already knows its pane size carries it as ?cols=&rows= so the
  // first frame is drawn at the true size. Absent/garbage → undefined, and the bridge falls back to prewarm.
  const qc = Number(c.req.query('cols')), qr = Number(c.req.query('rows'))
  const initialSize = qc > 0 && qr > 0 ? { cols: qc, rows: qr } : undefined
  let viewer: Viewer | null = null
  return {
    onOpen(_evt, ws) {
      viewer = { send: (buf) => { try { ws.send(Uint8Array.from(buf)) } catch { /* viewer gone */ } } }
      if (!attachViewer(id, viewer, initialSize)) { try { ws.close() } catch { /* already closed */ } }
    },
    onMessage(evt) {
      if (!viewer) return
      const data = evt.data
      // no keyboard input: the only client→server messages are the resize frame and the wheel frame. Binary
      // is ignored; pane navigation stays inside the tmux bridge instead of becoming browser scroll state.
      if (typeof data === 'string') {
        try {
          const m = JSON.parse(data)
          if (m?.t === 'resize') resizeBridge(id, Number(m.cols), Number(m.rows), !!m.full)
          else if (m?.t === 'wheel') forwardWheel(id, !!m.up, Number(m.col), Number(m.row), Number(m.ticks))
        } catch { /* ignore */ }
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
  // `from` (the sender's session id) rides only an agent-to-agent send → the backend records the comms
  // edge ([[comms-edge]]); a raw human dispatch omits it and is not logged.
  const r = await sendKeys(c.req.param('id'), typeof body?.text === 'string' ? body.text : '', typeof body?.from === 'string' ? body.from : undefined)
  return c.json(r, r.ok ? 200 : 502)
})
// the preserved tmux send-keys path (distinct from the ❯ prompt socket): the human drives the agent's
// interactive TUI menus in real time. Accepts an ORDERED BATCH (`keys`, the client coalesces fast typing) or a
// single `key`; rawKey delivers them in array order so tap order is preserved ([[nav-mode-key-ordering]]).
app.post('/api/sessions/:id/rawkey', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === 'string')
    : typeof body?.key === 'string' ? [body.key] : []
  const ok = await rawKey(c.req.param('id'), keys)
  return c.json({ ok }, ok ? 200 : 404)
})
// soft stop: kill the agent's tmux + socket but KEEP the worktree (relaunchable). Distinct from close, which
// removes the worktree. {ok:false} = no such session.
app.post('/api/sessions/:id/exit', async (c) => c.json({ ok: await exitSession(c.req.param('id')) }))
app.post('/api/sessions/:id/close', async (c) => c.json({ ok: await closeSession(c.req.param('id')) }))
// set (or clear, with a blank) a session's display-name override; persists to the worktree's `.session` so
// it survives a restart. Unknown id → 404.
app.post('/api/sessions/:id/rename', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await renameSession(c.req.param('id'), typeof body?.name === 'string' ? body.name : '')
  return c.json({ ok }, ok ? 200 : 404)
})

// set/clear a session's sort-key ([[session-reorder]]): a finite number pins the row's slot, null (or
// non-numeric) restores birth order. Mirrors /rename.
app.post('/api/sessions/:id/sort', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const key = typeof body?.key === 'number' && Number.isFinite(body.key) ? body.key : null
  const ok = await setSessionSort(c.req.param('id'), key)
  return c.json({ ok }, ok ? 200 : 404)
})

const port = Number(process.env.PORT || 8787)
const server = serve({ fetch: app.fetch, port })
injectWebSocket(server)
superviseBridges()   // keep a warm tmux client per live session, so opening a tab is instant
superviseQueue()     // launch queued sessions as slots free (catches agent-authored proposals/crashes the server never sees directly)
console.log(`spec-cli serving .spec (from git) on http://localhost:${port}`)

// graceful drain (the other half of zero-downtime reload, supervise.ts): on SIGTERM stop accepting new
// connections, let in-flight requests finish, and sweep now-idle keep-alive sockets so close() fires the
// instant the last request drains. A hard cap still forces exit if a connection won't close.
process.on('SIGTERM', () => {
  const srv = server as unknown as { close(cb?: () => void): void; closeIdleConnections?(): void }
  const sweep = setInterval(() => srv.closeIdleConnections?.(), 200)
  srv.close(() => { clearInterval(sweep); process.exit(0) })
  setTimeout(() => process.exit(0), 10000).unref()
})
