import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, loadSpecsLite, specContent, specHistory, specDiffAt, loadConfig } from './specs.js'
import { issuesEnabled, postLocalIssue, remarkOnHost, resolveRemark, retractRemark } from './localIssues.js'
import { mergedIssues, replyIssue } from './issues.js'
import { residentForgeState, refreshForgeNow } from '../../spec-forge/src/resident.js'
import { summarize } from './mentions.js'
import { resolveLayout, mainBranch } from './layout.js'
import { getBoardJson } from './boardCache.js'
import { boardStream, notifyBoardChanged } from './boardStream.js'
import { gitA, gitTry, repoRoot } from './git.js'
import { newSession, listSessions, sendKeys, rawKey, exitSession, closeSession, reopen, mergeSession, reviewPayload, captureSessionResult, sessionPrompt, sessionGraph, registerWatch, deregisterWatch, renameSession, setSessionSort, superviseQueue } from './sessions.js'
import { defaultHarness, HARNESSES, launcherList, defaultLauncher } from './harness.js'
import { evalTimeline, readBlobByHash } from '../../spec-yatsu/src/evaltab.js'
import { putBlob } from '../../spec-yatsu/src/cache.js'
import { yatsuNodes } from '../../spec-yatsu/src/yatsu.js'
import { fileHumanReading } from '../../spec-yatsu/src/filing.js'
import { buildProofModel, renderProofHtml, buildSessionEvals } from '../../spec-yatsu/src/proof.js'
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
// WIRE only; the COMPUTE is saved by [[board-cache]]: getBoard() is single-flight + cached, so a poll storm
// shares ONE build instead of each running its own — the poll-frequency cut (push channel) and the
// build-coalescing cut compound. A hard timeout bounds a wedged build to a loud 503 rather than an
// unboundedly-held connection (the wall sits well above the legitimately-several-seconds cold first build);
// the underlying single-flight build keeps running and caches for the next poll.
const BOARD_TIMEOUT_MS = Number(process.env.SPEXCODE_BOARD_TIMEOUT_MS || 20000)
app.get('/api/board', etag(), async (c) => {
  const timeout = Symbol('timeout')
  const json = await Promise.race([getBoardJson(), new Promise<typeof timeout>((r) => setTimeout(() => r(timeout), BOARD_TIMEOUT_MS))])
  if (json === timeout) return c.json({ error: 'board build timed out' }, 503)
  return c.body(json as string, 200, { 'content-type': 'application/json; charset=UTF-8' })
})
// the board's push channel: an SSE that fires `board-changed` on any session-store write, so the dashboard
// reloads the instant status moves instead of waiting for its slow fallback poll ([[board-stream]]).
app.get('/api/board/stream', (c) => boardStream(c))
app.get('/api/specs', async (c) => c.json(await loadSpecs()))
// the search corpus ([[board-lean]]): a filesystem-only {id,title,path,desc,body} for every node, NO git. The
// board omits `body` to stay lean, so the search palette fetches this ONCE when it opens (cached client-side)
// to rank nodes over their prose — off the board's hot poll. A literal segment, before the `:id` routes.
// Scenario prose rides the same corpus: the board's `scenarios` fold is slim ({name, tags}), so a yatsu
// node's row here carries its declared scenarios' description/expected (+ per-scenario code) — one fetch
// serves both the palette's scenario plane and the focus-panel preview.
app.get('/api/specs/lite', (c) => {
  const scByNode = new Map(yatsuNodes(repoRoot()).map((y) => [y.id, y.scenarios]))
  return c.json(loadSpecsLite().map((row) => {
    const sc = scByNode.get(row.id)
    return sc?.length
      ? { ...row, scenarios: sc.map((s) => ({ name: s.name, description: s.description, expected: s.expected, ...(s.code?.length ? { code: s.code } : {}) })) }
      : row
  }))
})
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
// the eval seam's WRITE half over HTTP ([[spec-yatsu]] filing.ts): a programmatic caller files a manual@1
// reading (verdict + optional transcript) through the SAME append the CLI uses. The dashboard does not
// call this — [[event-detail]] reads readings and hosts remarks, never files.
app.post('/api/specs/:id/yatsu/eval', async (c) => {
  const b = await c.req.json().catch(() => null)
  if (!b || typeof b.scenario !== 'string') return c.json({ error: 'body needs { scenario, status, note?, transcript? }' }, 400)
  const r = fileHumanReading(c.req.param('id'), b)
  return r.ok ? c.json({ ok: true, reading: r.reading }) : c.json({ error: r.error }, 400)
})
// serve a reading's evidence blob by content hash (bytes never enter git): bad hash → 400, missing → 404,
// else the bytes with a sniffed MIME and an immutable cache header (the name IS the content hash).
// HTTP Range is honored — a <video> can only SEEK when the server answers byte ranges (a browser clamps
// currentTime to the seekable window, which stays [0,0] without them); one general mechanism at the
// transport, so every evidence kind streams the same way.
app.get('/api/yatsu/blob/:hash', (c) => {
  const r = readBlobByHash(c.req.param('hash'))
  if (!r.ok) return c.text(r.message, r.reason === 'invalid' ? 400 : 404)
  const total = r.bytes.length
  const base = { 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? parseInt(m[1], 10) : total - parseInt(m[2], 10)
    const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1
    if (!(start >= 0 && start <= end && end < total)) return c.body(null, 416, { 'Content-Range': `bytes */${total}` })
    return c.body(new Uint8Array(r.bytes.subarray(start, end + 1)), 206, { ...base, 'Content-Range': `bytes ${start}-${end}/${total}` })
  }
  return c.body(new Uint8Array(r.bytes), 200, base)
})
// the WRITE half of the blob store ([[annotator]]): the annotator captures a circled video frame to a PNG
// and stashes the bytes here, content-addressed (same putBlob the yatsu cache uses). The returned hash is
// what an anchored comment references (image link in the body, and the typed evidence[] on its thread) —
// bytes never enter git. Raw body, sniffed by the same content-addressed name. Empty → 400, over cap → 413.
app.post('/api/yatsu/blob', async (c) => {
  const buf = Buffer.from(await c.req.arrayBuffer())
  if (buf.length === 0) return c.json({ error: 'empty blob' }, 400)
  if (buf.length > MAX_UPLOAD_BYTES) return c.json({ error: 'blob too large' }, 413)
  return c.json({ hash: putBlob(buf) }, 201)
})
app.get('/api/layout', async (c) => c.json(await resolveLayout()))
// the `surface: command` config-root plugins (built/active only) for the new-session `/` dropdown — each with
// its prompt `body` ({{targets}} placeholder), `kind`, and folder `dir` + co-located `files`. surface is a
// frontmatter field, not a dir (specs.ts loadSurface); `surface: system` siblings are gathered elsewhere.
app.get('/api/config', (c) => c.json(loadConfig()))
// the named launcher profiles ([[launcher-select]]) the New-Session form's dropdown offers — `{ name, harness }`
// only (the `cmd` is a host secret, never shipped to the browser) — plus the configured `default` NAME so the
// dropdown pre-selects the SAME launcher a bare `spex new` uses (the CLI/config default), instead of the
// alphabetically-first one. `launchers` is empty (and `default` '') when a project configured none, so the form
// falls back to the plain harness picker.
app.get('/api/launchers', (c) => c.json({
  launchers: launcherList().map(({ name, harness }) => ({ name, harness })),
  default: defaultLauncher(),
}))
// the ISSUES read surface ([[issues]]) for the dashboard's issues page — the merged list over every store
// (local threads + the resident forge slice), the SAME mergedIssues() the CLI drain reads, verbatim
// (the dashboard computes nothing over it: no re-sort, no salience ranking). The `enabled` flag mirrors
// the issues-workflow on/off switch so the frontend hides the view when the feature is OFF.
app.get('/api/issues', etag(), (c) =>
  c.json({
    enabled: issuesEnabled(),
    issues: mergedIssues({ host: 'github', state: residentForgeState() }, loadSpecsLite().map((s) => s.id)),
  }))
// the WRITE surface ([[local-issues]] / [[issues-view]]) — the human reply path, STORE-ROUTED through the one
// reply verb ([[issues]] replyIssue): a local id git-commits to the trunk store, a forge id ('github#N')
// posts a REAL comment through the driver; either way the text's @-mentions dispatch (a human summons an
// agent from the issues page). `outcomes` is the one-line @-dispatch summary the dashboard echoes. The
// server owns its freshness: a forge write forces the resident slice's read-back before answering, so the
// reload that follows shows the comment. Honor the on/off switch: 403 when the feature is OFF; an unknown
// local thread → 404; a failed forge write → 502 with the driver's own message (fail loud, never queued).
app.post('/api/issues/:id/reply', async (c) => {
  if (!issuesEnabled()) return c.json({ error: 'issues workflow is off' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const text = typeof body?.body === 'string' ? body.body : ''
  if (!text.trim()) return c.json({ error: 'empty reply' }, 400)
  // typed evidence[] — an anchored annotation's frame-blob hashes accrue onto the local thread (same shape
  // as the create route); a forge reply ignores them (its frame rides the comment body's image link).
  const evidence = Array.isArray(body?.evidence) ? (body.evidence as unknown[]).filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []
  const id = c.req.param('id')
  try {
    // the mention prompt's node context, from the same resident merge the GET serves
    const node = id.includes('#')
      ? mergedIssues({ host: 'github', state: residentForgeState() }, loadSpecsLite().map((s) => s.id)).find((i) => i.id === id)?.nodes[0] ?? null
      : null
    const r = await replyIssue(id, text, { author: 'human', node, evidence })
    if (r.store !== 'local') await refreshForgeNow()
    return c.json({ ok: true, replies: r.replies, url: r.url, outcomes: summarize(r.outcomes, r.loopIn) })
  } catch (e) {
    const msg = String((e as Error).message || e)
    return c.json({ error: msg }, id.includes('#') ? 502 : 404)
  }
})
app.post('/api/issues', async (c) => {
  if (!issuesEnabled()) return c.json({ error: 'issues workflow is off' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const concern = typeof body?.concern === 'string' ? body.concern.trim() : ''
  if (!concern) return c.json({ error: 'empty concern' }, 400)
  const nodes = Array.isArray(body?.nodes) ? (body.nodes as unknown[]).filter((n): n is string => typeof n === 'string') : []
  const postBody = typeof body?.body === 'string' ? body.body : undefined
  // typed evidence[] — yatsu content-addressed hashes (the annotator's clip reference rides here, not prose)
  const evidence = Array.isArray(body?.evidence) ? (body.evidence as unknown[]).filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []
  const { thread, outcomes } = await postLocalIssue(concern, { nodes, body: postBody, evidence, author: 'human' })
  return c.json({ ok: true, id: thread.id, outcomes: summarize(outcomes) }, 201)
})

// the REMARK write surface ([[remark-substrate]]) — server PARITY with the CLI: the dashboard can author /
// resolve / retract a remark through the SAME functions `spex remark|resolve|retract` call, adding no
// capability. A ref (`<thread-id>#<rid>`) rides the request BODY, not the path (a '#' in a URL is a
// fragment). Identity is derived SERVER-SIDE — this is the dashboard's human surface, so the actor is
// `'human'`, the SAME sentinel /api/issues stamps; it is NEVER read from the request body. That keeps R3's
// teeth structural (identity is not spoofable over the wire) and honest on both surfaces: resolve rejects
// `'human'` (agent-only — an agent resolves through the CLI, never the dashboard), and retract binds to the
// human who authored (only their own `'human'` remarks). Who-may-resolve/retract cannot depend on transport.
app.post('/api/remarks', async (c) => {
  if (!issuesEnabled()) return c.json({ error: 'issues workflow is off' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const text = typeof body?.body === 'string' ? body.body : ''
  if (!text.trim()) return c.json({ error: 'empty remark' }, 400)
  const evidence = Array.isArray(body?.evidence) ? (body.evidence as unknown[]).filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []
  const host = typeof body?.scenario === 'string' && body.scenario
    ? { node: typeof body?.node === 'string' ? body.node : undefined, scenario: body.scenario as string }
    : { issue: typeof body?.issue === 'string' ? body.issue : undefined }
  const codeSha = typeof body?.codeSha === 'string' ? body.codeSha : undefined
  try {
    const r = await remarkOnHost(host, text, { codeSha, author: 'human', evidence })
    return c.json({ ok: true, ref: r.ref, rid: r.rid, codeSha: r.codeSha, outcomes: summarize(r.outcomes, r.loopIn) }, 201)
  } catch (e) {
    return c.json({ error: String((e as Error).message || e) }, 400)
  }
})
app.post('/api/remarks/:action{resolve|retract}', async (c) => {
  if (!issuesEnabled()) return c.json({ error: 'issues workflow is off' }, 403)
  const body = await c.req.json().catch(() => ({}))
  const ref = typeof body?.ref === 'string' ? body.ref : ''
  if (!ref) return c.json({ error: 'missing remark ref' }, 400)
  const by = 'human'   // server-derived identity — never the request body (see /api/remarks above)
  try {
    if (c.req.param('action') === 'resolve') resolveRemark(ref, by)
    else retractRemark(ref, by)
    return c.json({ ok: true, ref })
  } catch (e) {
    return c.json({ error: String((e as Error).message || e) }, 400)
  }
})
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
  // the named launcher ([[launcher-select]]) — fixes the session's harness AND its persisted launch command.
  const launcher = typeof body?.launcher === 'string' && body.launcher.trim() ? body.launcher.trim() : undefined
  // parent = the spawning session's id, resolved by the CALLER (createSession) in its own process and passed
  // through here ([[session-nesting]]); the browser's New Session omits it → a top-level session.
  const parent = typeof body?.parent === 'string' && body.parent.trim() ? body.parent.trim() : null
  try {
    return c.json(await newSession(typeof body?.node === 'string' ? body.node : null, prompt, harness, parent, launcher), 201)
  } catch (e) { return c.json({ error: String((e as Error).message || e) }, 400) }   // unknown harness/launcher id → 400, not a 500
})
// one server-side merge bundle (ahead/dirty/diff(merge-base)/gates/proposal) for the manager cockpit;
// dashboard and `spex review` are thin callers. 404 for an unknown id. See [[manager-cockpit]].
app.get('/api/sessions/:id/review', async (c) => {
  const r = await reviewPayload(c.req.param('id'))
  return r ? c.json(r) : c.json({ error: 'no such session' }, 404)
})
// the [[review-proof]] EXPORT artifact: one self-contained HTML (diff + gates + evidence inlined as
// data-URIs) for CI/share/bare-browser. `?format=json` returns the model; default = rendered HTML. The
// dashboard's interactive face is the lean route below, never this. 404 unknown id.
app.get('/api/sessions/:id/proof', async (c) => {
  const m = await buildProofModel(c.req.param('id'))
  if (!m) return c.text('no such session', 404)
  if (c.req.query('format') === 'json') return c.json(m)
  return c.html(renderProofHtml(m))
})
// the session EVAL model ([[review-proof]]'s interactive face): worktree-rooted rows only — no diff
// enrichment, no inlined bytes; evidence streams lazily from /api/yatsu/blob. Each reading carries
// `inSession` so the tab leads with what THIS session measured.
app.get('/api/sessions/:id/evals', async (c) => {
  const m = await buildSessionEvals(c.req.param('id'))
  return m ? c.json(m) : c.json({ error: 'no such session' }, 404)
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
// relaunch ONLY if confirmed offline; demotes working→idle, keeps any declaration. The RESUME GUARD refuses
// (409) when the agent is alive or its liveness is unproven — restore-on-alive was the incident's kill-shot.
// `force` (query ?force=1 or JSON {force:true}) overrides for a wedged-but-alive process.
app.post('/api/sessions/:id/resume', async (c) => {
  const body = await c.req.json().catch(() => ({} as { force?: boolean }))
  const force = body?.force === true || c.req.query('force') === '1'
  const r = await reopen(c.req.param('id'), { force })
  return c.json(r, r.ok ? 200 : (r.refused ? 409 : 404))
})
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
// it survives a restart. Unknown id → 404. The worktree file is OUTSIDE the store the board watchers see,
// so the route nudges the stream explicitly ([[board-stream]]) — the rename shows in ~150ms, not a cold tick.
app.post('/api/sessions/:id/rename', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await renameSession(c.req.param('id'), typeof body?.name === 'string' ? body.name : '')
  if (ok) notifyBoardChanged()
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
