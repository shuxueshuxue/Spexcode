import { serve } from '@hono/node-server'
import type { Server as HttpServer } from 'node:http'
import { installConnectionReaper } from './reaper.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, loadSpecsLite, specContent, specHistory, specDiffAt, loadConfig, loadReviewConfig } from './specs.js'
import { issuesEnabled, remarkOnHost, resolveRemark, retractRemark } from './localIssues.js'
import { closeIssue, createIssue, findIssue, issueStores, mergedIssues, promote, replyIssue } from './issues.js'
import { residentForgeState, refreshForgeNow } from '../../spec-forge/src/resident.js'
import { resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { summarize } from './mentions.js'
import { resolveLayout, mainBranch } from './layout.js'
import { getBoardJson } from './graphCache.js'
import { boardStream, ensureBoardFileWatchers, notifyBoardChanged } from './graphStream.js'
import { gitA, gitTry, repoRoot } from './git.js'
import { listSessions, sendText, rawKey, stopSession, closeSession, resumeSession, mergeSession, reviewPayload, captureSessionResult, sessionPrompt, sessionGraph, registerWatch, deregisterWatch, renameSession, setSessionSort, sessionCreateRequest, superviseQueue, TMUX_SOCK } from './sessions.js'
import { superviseTimeline, readTimeline } from './session-timeline.js'
import { defaultHarness, HARNESSES, launcherList, launcherDefault } from './harness.js'
import { evalTimeline, readBlobByHash } from '../../spec-eval/src/evaltab.js'
import { putBlob } from '../../spec-eval/src/cache.js'
import { fileHumanReading } from '../../spec-eval/src/filing.js'
import { fileHumanOk } from '../../spec-eval/src/humanok.js'
import { buildExportModel, renderExportHtml, SessionEvalUnavailableError } from '../../spec-eval/src/sessioneval.js'
import { saveUpload, MAX_UPLOAD_BYTES } from './uploads.js'
import { attachViewer, detachViewer, resizeBridge, hideViewer, forwardWheel, superviseBridges, type Viewer } from './pty-bridge.js'
import { installProcessGuards } from './resilience.js'
import { resolveProjectIdentity } from './project-identity.js'
import { evalDetailReview, evalsReview, issuesReview } from './reviews.js'

// last-resort net: an unforeseen async throw (e.g. a worktree vanishing mid-read during a worker
// self-merge) is logged and the server KEEPS SERVING instead of exiting and dropping the public port.
installProcessGuards()

const app = new Hono()
app.use('/api/*', cors())
app.onError((error, c) => {
  if (error instanceof SessionEvalUnavailableError) return c.json({ error: error.message }, 503)
  console.error(error)
  return c.text('Internal Server Error', 500)
})
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/', (c) => c.text('spec-cli — GET /api/graph · /api/specs · /api/specs/:id/history · /api/settings · /api/sessions · /api/slash-commands'))
// the supervisor's readiness gate (supervise.ts): a bare git-free 200 so a booting child reports ready the
// instant Hono is listening. Not under /api/* — loopback-only (supervisor→child), no CORS needed.
app.get('/health', (c) => c.text('ok'))
// @@@ instance identity - who THIS backend is: the serve generation's instanceId (minted by the supervisor,
// constant across zero-downtime reloads, handed down via env) and the project root it serves. This is the
// answer the host gateway ([[host-gateway]]) compares an endpoint record against before proxying to it — a
// recycled port serving another project or a stale record fails the match instead of being routed to. Git-free
// after the first memoized resolution; a self-run child (no supervisor) answers instanceId:null, which no
// record claims, so it is simply not hosted.
const instanceStartedAt = new Date().toISOString()
app.get('/api/instance', (c) => {
  const root = repoRoot()
  return c.json({
    instanceId: process.env.SPEXCODE_INSTANCE_ID ?? null,
    root,
    identity: resolveProjectIdentity(root, root),
    pid: process.pid,
    startedAt: instanceStartedAt,
  })
})
// the assembled graph (merged tree + overlay + sessions) — the dashboard's single source. Same data
// as `spex graph --json`; the frontend only adds x/y pixels on top. Freshness is PUSH-first ([[graph-stream]]): the
// dashboard reloads on a `/api/graph/stream` event, not a tight poll, so the route is a conditional-request
// endpoint: `etag()` hashes the serialized body, and a reload whose `If-None-Match` matches gets a bodyless 304
// instead of the full transfer (~1 MB on the dogfood board — it scales with the node count). The 304 saves the
// WIRE only; the COMPUTE is saved by [[graph-cache]]: getBoard() is single-flight + cached, so a poll storm
// shares ONE build instead of each running its own — the poll-frequency cut (push channel) and the
// build-coalescing cut compound. A hard timeout bounds a wedged build to a loud 503 rather than an
// unboundedly-held connection (the wall sits well above the legitimately-several-seconds cold first build);
// a merely-slow single-flight build keeps running and caches for the next poll, while a NEVER-settling one
// is bounded by [[graph-cache]]'s own build watchdog, so the next poll retries a fresh build.
const BOARD_TIMEOUT_MS = Number(process.env.SPEXCODE_BOARD_TIMEOUT_MS || 20000)
app.get('/api/graph', etag(), async (c) => {
  ensureBoardFileWatchers()
  const timeout = Symbol('timeout')
  const json = await Promise.race([getBoardJson(), new Promise<typeof timeout>((r) => setTimeout(() => r(timeout), BOARD_TIMEOUT_MS))])
  if (json === timeout) return c.json({ error: 'graph build timed out' }, 503)
  return c.body(json as string, 200, { 'content-type': 'application/json; charset=UTF-8' })
})
// the graph's push channel: an SSE that fires `board-changed` on any session-store write, so the dashboard
// reloads the instant status moves instead of waiting for its slow fallback poll ([[graph-stream]]).
app.get('/api/graph/stream', (c) => boardStream(c))
app.get('/api/specs', async (c) => c.json(await loadSpecs()))
// the search corpus ([[graph-lean]]): a filesystem-only {id,title,path,desc,body} for every node, NO git. The
// board omits `body` to stay lean, so the search palette fetches this ONCE when it opens (cached client-side)
// to rank nodes over their prose — off the board's hot poll. Review rows, including scenarios, come only
// from their paged endpoints and cannot be reconstructed from this corpus.
app.get('/api/specs/lite', (c) => c.json(loadSpecsLite()))
// one node's body + parsed parts ([[graph-lean]]): the board no longer ships either, so the detail view
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
// a node's eval timeline (read half of `spex eval`): eval-sidecar readings joined with a live freshness
// flag, newest-first; `hasEvalFile:false` when none declared. Contract belongs to [[spec-eval]].
app.get('/api/specs/:id/evals', async (c) => c.json(await evalTimeline(c.req.param('id'))))
// the eval seam's WRITE half over HTTP ([[spec-eval]] filing.ts) — the REST pair of the GET above: a
// programmatic caller files a reading (verdict + optional transcript) through the SAME append the CLI
// uses. The dashboard does not call this — [[event-detail]] reads readings and hosts remarks, never files.
app.post('/api/specs/:id/evals', async (c) => {
  const b = await c.req.json().catch(() => null)
  if (!b || typeof b.scenario !== 'string') return c.json({ error: 'body needs { scenario, status, note?, transcript? }' }, 400)
  const r = fileHumanReading(c.req.param('id'), b)
  return r.ok ? c.json({ ok: true, reading: r.reading }) : c.json({ error: r.error }, 400)
})
// the HUMAN SIGN-OFF write ([[human-ok]]) — the dashboard's ok affordance and `spex eval ok` share this ONE
// write (LAW L: no dashboard-only path). Identity is SERVER-DERIVED 'human', never the request body (the
// same rule as /api/remarks). The write appends a monotonic human-ok event bound to the scenario's latest
// reading and — on the trunk checkout — commits it straight to trunk; the board cache is invalidated
// atomically with persistence so the writer's own refetch never races a stale cache.
app.post('/api/specs/:id/evals/ok', async (c) => {
  const b = await c.req.json().catch(() => null)
  if (!b || typeof b.scenario !== 'string') return c.json({ error: 'body needs { scenario }' }, 400)
  const r = fileHumanOk(c.req.param('id'), b.scenario, 'human')
  if (!r.ok) return c.json({ error: r.error }, 400)
  notifyBoardChanged('full')
  return c.json({ ok: true, already: r.already, humanOk: r.humanOk })
})
// serve a reading's evidence blob by content hash (bytes never enter git): bad hash → 400, missing → 404,
// else the bytes with a sniffed MIME and an immutable cache header (the name IS the content hash).
// HTTP Range is honored — a <video> can only SEEK when the server answers byte ranges (a browser clamps
// currentTime to the seekable window, which stays [0,0] without them); one general mechanism at the
// transport, so every evidence kind streams the same way. A trailing `.<ext>` on the hash is IGNORED
// decoration for third-party markdown renderers (GitLab/GitHub only emit a <video> player when the URL
// ends in a video extension); the served bytes and MIME stay the stored ones — a wrong suffix never lies.
app.get('/api/evidence/:hash', (c) => {
  const r = readBlobByHash(c.req.param('hash').replace(/\.[a-z0-9]+$/i, ''))
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
// and stashes the bytes here, content-addressed (same putBlob the eval cache uses). The returned hash is
// what an anchored comment references (image link in the body, and the typed evidence[] on its thread) —
// bytes never enter git. Raw body, sniffed by the same content-addressed name. Empty → 400, over cap → 413.
app.post('/api/evidence', async (c) => {
  const buf = Buffer.from(await c.req.arrayBuffer())
  if (buf.length === 0) return c.json({ error: 'empty evidence' }, 400)
  if (buf.length > MAX_UPLOAD_BYTES) return c.json({ error: 'evidence too large' }, 413)
  return c.json({ hash: putBlob(buf) }, 201)
})
// the SETTINGS read surface — one route for everything spexcode.json / spexcode.local.json resolves to:
// `layout` (resolveLayout()'s main/worktrees/branch shape — the write-guard's project-identity probe reads
// `.layout.main`) and the named launcher profiles ([[launcher-select]]) the New-Session picker
// offers — `{ name, harness, cmd }`: the cmd is read-only display data for the picker (the dashboard sits
// behind the gateway auth; the browser can read but never edit config) — plus the configured `default` NAME
// so the picker pre-selects the SAME
// launcher a bare `spex session new` uses (the CLI/config default), instead of the alphabetically-first one,
// Missing defaultLauncher is returned as an actionable config error, not hidden by falling through to the
// built-in `claude` launcher.
// `tmuxSocket` is the `-L <name>` label our private tmux server runs under (a backend fact, env-overridable),
// so the row's attach modal ([[attach-menu]]) can offer the RAW `tmux -L <socket> attach -t <id>` fallback
// beside the blessed `spex session attach` command — the frontend never hardcodes the socket.
app.get('/api/settings', async (c) => c.json({
  layout: await resolveLayout(),
  launchers: launcherList(),
  tmuxSocket: TMUX_SOCK,
  ...launcherDefault(),
}))
// the `surface: command` plugin-root nodes (built/active only) for the new-session `/` dropdown — each with
// its prompt `body` ({{targets}} placeholder), `kind`, and folder `dir` + co-located `files`. surface is a
// frontmatter field, not a dir (specs.ts loadSurface); `surface: system` siblings are gathered elsewhere.
// `?surface=review` lists the review-track presets instead ([[review-commands]] — the eval detail's
// remark-composer `/` dropdown); the exposed surfaces stay this explicit whitelist, never a passthrough.
app.get('/api/plugins', (c) => c.json(c.req.query('surface') === 'review' ? loadReviewConfig() : loadConfig()))
// the ISSUES read surface ([[issues]]) for the dashboard's issues page — the merged list over every store
// (local threads + the resident forge slice), the SAME mergedIssues() the CLI drain reads, verbatim
// (the dashboard computes nothing over it: no re-sort, no salience ranking). The `enabled` flag mirrors
// the issues-workflow on/off switch so the frontend hides the view when the feature is OFF.
app.get('/api/issues', etag(), async (c) => c.json(await issuesReview(c.req.query('q'), c.req.query('page'))))
// Evals uses the identical paged-review response. `scope:` inside q selects the worktree source; without
// it the source is the current cached board. Filtering/counts always precede the one 25-row slice.
app.get('/api/evals', etag(), async (c) => {
  ensureBoardFileWatchers()
  const page = await evalsReview(c.req.query('q'), c.req.query('page'), { view: c.req.query('view') })
  return page ? c.json(page) : c.json({ error: 'no such review source' }, 404)
})
// ONE bounded detail response for both source roots: the selected scenario's complete A/B history and at
// most five lightweight neighbors. It never serializes another scenario's history or the scoped model.
app.get('/api/evals/detail', etag(), async (c) => {
  ensureBoardFileWatchers()
  const node = c.req.query('node')?.trim()
  const scenario = c.req.query('scenario')?.trim()
  if (!node || !scenario) return c.json({ error: 'node and scenario are required' }, 400)
  const detail = await evalDetailReview(node, scenario, c.req.query('scope')?.trim() || null)
  return detail ? c.json(detail) : c.json({ error: 'no such review source' }, 404)
})
// the single-thread read ([[issues]]) behind `spex issue show <id>` — the SAME findIssue lookup, from the
// resident forge slice (instant view, background reconcile — the list route's freshness contract). A local
// id, or a forge id (`<host>#<n>`); unknown → 404 (eval-remark threads are not issues, so they 404 here too).
app.get('/api/issues/:id', (c) => {
  const t = findIssue(c.req.param('id'), { host: resolveForgeHost(), state: residentForgeState() }, loadSpecsLite().map((s) => s.id))
  return t ? c.json(t) : c.json({ error: `no issue '${c.req.param('id')}'` }, 404)
})
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
      ? mergedIssues({ host: resolveForgeHost(), state: residentForgeState() }, loadSpecsLite().map((s) => s.id)).find((i) => i.id === id)?.nodes[0] ?? null
      : null
    const r = await replyIssue(id, text, { author: 'human', node, evidence })
    if (r.store !== 'local') await refreshForgeNow()
    notifyBoardChanged('full')   // atomic with persistence — see the /api/remarks block below
    return c.json({ ok: true, replies: r.replies, url: r.url, outcomes: summarize(r.outcomes, r.loopIn) })
  } catch (e) {
    const msg = String((e as Error).message || e)
    return c.json({ error: msg }, id.includes('#') ? 502 : 404)
  }
})
// store-routed lifecycle close ([[issues]]): local resolves the local thread, forge closes the remote
// issue through the driver. A forge close forces read-back before the dashboard reloads the resident list.
app.post('/api/issues/:id/close', async (c) => {
  if (!issuesEnabled()) return c.json({ error: 'issues workflow is off' }, 403)
  const id = c.req.param('id')
  try {
    const r = await closeIssue(id)
    if (r.store !== 'local') await refreshForgeNow()
    notifyBoardChanged('full')   // atomic with persistence — see the /api/remarks block below
    return c.json({ ok: true, ...r })
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
  const store = typeof body?.store === 'string' && body.store.trim() ? body.store.trim() : 'local'
  // typed evidence[] — content-addressed evidence hashes (the annotator's clip reference rides here, not prose)
  const evidence = Array.isArray(body?.evidence) ? (body.evidence as unknown[]).filter((h): h is string => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h)) : []
  try {
    const r = await createIssue(concern, { store, nodes, body: postBody, evidence, author: 'human' })
    if (r.store !== 'local') await refreshForgeNow()
    notifyBoardChanged('full')   // atomic with persistence — see the /api/remarks block below
    return c.json({ ok: true, id: r.id, store: r.store, url: r.url, outcomes: summarize(r.outcomes) }, 201)
  } catch (e) {
    return c.json({ error: String((e as Error).message || e) }, store === 'local' ? 500 : 502)
  }
})

// promotion moves an open local thread to the forge as one recorded action ([[issues]]'s promote verb,
// verbatim: forge issue first, then the permalink reply + local close. The forced forge read-back means
// the reload that follows shows the promoted issue in the merged list. Fail loud: an unreachable forge is a
// 502 with the local thread untouched.
app.post('/api/issues/:id/promote', async (c) => {
  if (!issuesEnabled()) return c.json({ error: 'issues workflow is off' }, 403)
  const id = c.req.param('id')
  if (id.includes('#')) return c.json({ error: 'only a local issue promotes' }, 400)
  try {
    const r = await promote(id, { author: 'human' })
    await refreshForgeNow()
    notifyBoardChanged('full')   // atomic with persistence — see the /api/remarks block below
    return c.json({ ok: true, ...r })
  } catch (e) {
    const msg = String((e as Error).message || e)
    return c.json({ error: msg }, /^no local issue/.test(msg) ? 404 : 502)
  }
})

// the REMARK write surface ([[remark-substrate]]) — server PARITY with the CLI: the dashboard can author /
// resolve / retract a remark through the SAME functions `spex remark|resolve|retract` call, adding no
// capability. A ref (`<thread-id>#<rid>`) rides the request BODY, not the path (a '#' in a URL is a
// fragment). Identity is derived SERVER-SIDE — this is the dashboard's human surface, so the actor is
// `'human'`, the SAME sentinel /api/issues stamps; it is NEVER read from the request body. That keeps R3's
// teeth structural (identity is not spoofable over the wire) and identical on both surfaces: resolve is any
// SECOND party's deliberate judgment — the human resolves an agent's remark here exactly as an agent
// resolves through the CLI, and self-resolve stays rejected by the same identity comparison ('human' can
// never resolve a human-authored remark) — and retract binds to the author (only the human's own remarks).
// Who-may-resolve/retract cannot depend on transport.
//
// Every issue/remark write route below ends its success path with notifyBoardChanged('full') — the board
// cache is invalidated ATOMICALLY with persistence ([[remark-substrate]] write-visibility), before the
// response, so the writer's own post-write refetch can never race an async fs event into the stale cache.
// This explicit nudge is the ONE in-process mechanism (the store dir is deliberately NOT in the watch set);
// a cross-process write (a CLI `spex remark add`) reaches the board through its trunk commit via the
// existing refs watcher instead.
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
    notifyBoardChanged('full')
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
    notifyBoardChanged('full')
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
// edges derived live from `spex session watch` monitors (A→B = agent A is watching B), not a stored subscription;
// watch/unwatch register + heartbeat. A literal `edges` segment so it never collides with the `:id` routes.
app.get('/api/sessions/edges', async (c) => c.json(await sessionGraph()))
app.post('/api/sessions/edges/watch', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const selectors = Array.isArray(b?.selectors) ? b.selectors.map(String) : []
  const ok = registerWatch(String(b?.token || ''), String(b?.watcher || ''), selectors, Number(b?.ttlMs) || undefined)
  return c.json({ ok }, ok ? 200 : 400)
})
app.post('/api/sessions/edges/unwatch', async (c) => {
  const b = await c.req.json().catch(() => ({}))
  const ok = deregisterWatch(String(b?.token || ''))
  return c.json({ ok }, ok ? 200 : 404)
})
app.post('/api/sessions', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = await sessionCreateRequest(body)
  return result.status === 201 ? c.json(result.session, 201) : c.json({ error: result.error }, 400)
})
// one server-side merge bundle (ahead/dirty/diff(merge-base)/gates/proposal) for the manager cockpit;
// dashboard and `spex session review` are thin callers. 404 for an unknown id. See [[manager-cockpit]].
app.get('/api/sessions/:id/review', async (c) => {
  const r = await reviewPayload(c.req.param('id'))
  return r ? c.json(r) : c.json({ error: 'no such session' }, 404)
})
// The self-contained HTML is the sole full-model transport exception. Interactive rows, including the CLI,
// use /api/evals pages; a bare request fails loudly rather than reopening a hidden full JSON path.
app.get('/api/sessions/:id/evals', async (c) => {
  if (c.req.query('format') === 'html') {
    const m = await buildExportModel(c.req.param('id'))
    return m ? c.html(renderExportHtml(m)) : c.text('no such session', 404)
  }
  return c.json({ error: 'interactive eval rows use /api/evals pagination; use ?format=html only for export' }, 400)
})
// the session's live pane as text (one-shot snapshot) for a backend client (`spex session show --capture`). Empty and fail
// stay distinct: an empty pane is 200 with empty body; unknown id → 404, offline (no live pane) → 409, error → 502.
app.get('/api/sessions/:id/capture', async (c) => {
  const r = await captureSessionResult(c.req.param('id'))
  if (r.ok) return c.text(r.pane)
  if (r.reason === 'unknown') return c.text('no such session', 404)
  if (r.reason === 'offline') return c.text('session offline (no live pane)', 409)
  return c.text('capture failed', 502)
})
// the session's persisted interaction history ([[session-timeline]]): authored status transitions (with the
// FULL note text) + delivered prompts, timestamped, oldest first — what a terminal-free surface renders as
// the conversation. `?limit=<n>` caps the tail (default 500). 404 for an unknown/non-governed id.
app.get('/api/sessions/:id/timeline', (c) => {
  const limit = Number(c.req.query('limit'))
  const r = readTimeline(c.req.param('id'), Number.isFinite(limit) && limit > 0 ? limit : undefined)
  return r ? c.json(r) : c.json({ error: 'no such session' }, 404)
})
// the session RECORD detail (`spex session show`): the board row (status · node · branch · launcher · …)
// plus the full originating prompt (the row itself carries only the preview). One id-addressed read backs
// the CLI's show; 404 for an unknown id.
app.get('/api/sessions/:id', async (c) => {
  const id = c.req.param('id')
  const row = (await listSessions()).find((s) => s.id === id)
  if (!row) return c.json({ error: 'no such session' }, 404)
  return c.json({ ...row, prompt: await sessionPrompt(id) })
})
// lifecycle transitions (thin callers of the session state machine)
// relaunch ONLY if confirmed offline; demotes working→idle, keeps any declaration. The RESUME GUARD refuses
// (409) when the agent is alive or its liveness is unproven — restore-on-alive was the incident's kill-shot.
// `force` (query ?force=1 or JSON {force:true}) overrides for a wedged-but-alive process.
app.post('/api/sessions/:id/resume', async (c) => {
  const body = await c.req.json().catch(() => ({} as { force?: boolean }))
  const force = body?.force === true || c.req.query('force') === '1'
  const r = await resumeSession(c.req.param('id'), { force })
  return c.json(r, r.ok ? 200 : (r.refused ? 409 : 404))
})
// a dispatch to the session's own agent (it runs the merge), never a server merge — the server never touches
// main's tree. 200 {dispatched:true} once the prompt is accepted, 409 {dispatched:false} if the agent is unreachable.
app.post('/api/sessions/:id/merge', async (c) => {
  const r = await mergeSession(c.req.param('id'))
  return c.json(r, r.dispatched ? 200 : 409)
})

// one WS over a shared native tmux client (pty-bridge): server→client = tmux's rendered PTY bytes (binary); the
// view takes no keyboard input, so client→server is only a text control frame — resize, visibility,
// or wheel. Server→client text commits a completed resize immediately before its binary tmux transaction;
// hiding releases the native helper without closing the warm socket. tmux itself resolves wheel input between
// copy-mode and a mouse-owning TUI. The bridge never splices capture-pane state into this stream.
// keep-alive ping cadence for the terminal socket — the server half of [[reconnect]]'s heartbeat contract,
// and the contract's ONE primitive number: the client mirrors it (SERVER_PING_MS in the dashboard's
// resilientSocket.js, pinned by its test) and DERIVES its silence deadline (2.5×) from it.
// A healthy link is guaranteed inbound traffic every PING window, so the client may presume an OPEN socket
// silent past its derived window dead (the half-open link a NAT/tunnel kills without a close event), and the
// traffic itself keeps an idle socket warm through those middleboxes. Text frame; the terminal renders only
// binary frames, so it needs no client-side filtering beyond what already exists.
const TERM_PING_MS = 10000
app.get('/api/sessions/:id/socket', upgradeWebSocket((c) => {
  const id = c.req.param('id') as string
  let viewer: Viewer | null = null
  let ping: ReturnType<typeof setInterval> | undefined
  return {
    onOpen(_evt, ws) {
      viewer = {
        send: (buf) => { try { ws.send(Uint8Array.from(buf)) } catch { /* viewer gone */ } },
        commitSize: (cols, rows) => { try { ws.send(JSON.stringify({ t: 'resize-commit', cols, rows })) } catch { /* viewer gone */ } },
      }
      attachViewer(id, viewer)
      ping = setInterval(() => { try { ws.send('ping') } catch { /* viewer gone; onClose reaps */ } }, TERM_PING_MS)
    },
    onMessage(evt) {
      if (!viewer) return
      const data = evt.data
      // No keyboard input: client→server text only measures, changes visibility, or forwards wheel
      // navigation. Binary is ignored; pane navigation stays in the tmux bridge instead of browser scroll state.
      if (typeof data === 'string') {
        try {
          const m = JSON.parse(data)
          if (m?.t === 'resize') resizeBridge(id, viewer, Number(m.cols), Number(m.rows))
          else if (m?.t === 'visible' && m.visible === false) hideViewer(id, viewer)
          else if (m?.t === 'wheel') forwardWheel(id, !!m.up, Number(m.col), Number(m.row), Number(m.ticks))
        } catch { /* ignore */ }
      }
    },
    onClose() { if (ping) clearInterval(ping); if (viewer) detachViewer(id, viewer) },
  }
}))
// ONE input route, `kind` the discriminator — the transport split is an implementation fact, not API surface.
// kind:"text" (the docked ❯ line, `spex session send`, the server-side merge dispatch) injects a whole prompt
// through the rendezvous control socket — socket-only + fail-loud: a prompt the agent doesn't confirm
// accepting returns 502 with the reason (never a silent 200), so a dead dispatch is seen, not a false success.
// kind:"keys" is the LAST-RESORT raw face (`send --keys`, the dashboard's type mode): an ORDERED BATCH of
// nav-mode key tokens over tmux send-keys, delivered in array order so tap order survives
// ([[nav-mode-key-ordering]]); unstable by nature — callers try a plain text send first. An unknown kind is a
// loud 400, never a guessed channel.
app.post('/api/sessions/:id/input', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body?.kind === 'text') {
    // `from` (the sender's session id) rides only an agent-to-agent send → the backend records the comms
    // edge ([[comms-edge]]); a raw human dispatch omits it and is not logged. `replyVia:"note"` marks a
    // terminal-free sender ([[session-timeline]]): the server appends the note-reply insert to the delivery.
    const r = await sendText(c.req.param('id'), typeof body?.text === 'string' ? body.text : '', typeof body?.from === 'string' ? body.from : undefined,
      body?.replyVia === 'note' ? { replyVia: 'note' } : {})
    return c.json(r, r.ok ? 200 : 502)
  }
  if (body?.kind === 'keys') {
    const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === 'string') : []
    const ok = await rawKey(c.req.param('id'), keys)
    return c.json({ ok }, ok ? 200 : 404)
  }
  return c.json({ error: 'input needs kind: "text" | "keys"' }, 400)
})
// soft stop: kill the agent's tmux + socket but KEEP the worktree (resumable). Distinct from close, which
// removes the worktree. {ok:false} = no such session.
app.post('/api/sessions/:id/stop', async (c) => c.json({ ok: await stopSession(c.req.param('id')) }))
app.post('/api/sessions/:id/close', async (c) => c.json({ ok: await closeSession(c.req.param('id')) }))
// set (or clear, with a blank) a session's display-name override; persists to the session's global record
// (`session.json`) so it survives a restart. Unknown id → 404. That record sits INSIDE the watched store, but
// the store watch is best-effort (it can fail to attach), so the route still nudges the stream explicitly
// ([[graph-stream]]) — the rename shows in ~150ms deterministically, never waiting out a cold tick.
app.post('/api/sessions/:id/rename', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ok = await renameSession(c.req.param('id'), typeof body?.name === 'string' ? body.name : '')
  if (ok) notifyBoardChanged('sessions')
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
// @@@ server-side connection reaping ([[spec-cli]]) - abandoned connections must die SERVER-SIDE, or they
// pile up and wedge the backend (135 leaked conns once starved :8787 into looking dead — the cascade that
// triggered the mass-restore incident, since every client-side timeout-kill leaks one). The ONE mechanism is
// the socket-level `installConnectionReaper` below (reaper.ts): a per-socket deadline that reaps a
// slow-loris / idle keep-alive but exempts an ACTIVE WS/SSE stream (board-stream, terminal socket) for as
// long as it streams. Deliberately NO `serverOptions` timeouts here: they were measured to be not harmless
// but a second mechanism racing the reaper (issue #65 — a 20s headersTimeout won at default config and
// silently capped SPEXCODE_REAP_HEADER_MS); the install disables Node's overlapping timeouts so the
// deadlines have a single owner.
// @@@ loopback bind ([[public-mode]]) - this child is NEVER the internet face: the supervisor (and in public
// mode the gateway) fronts it, and dials it only via 127.0.0.1. Binding loopback is what makes "loopback is
// the trust boundary" true — without a hostname Node binds all interfaces and the child is reachable from
// the LAN with no password, bypassing the gate entirely (measured: eval auth-boundary).
const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' })
installConnectionReaper(server as unknown as HttpServer)
injectWebSocket(server)
superviseBridges()   // restore visible helpers after failure; their viewer subscriptions survive replacement
superviseQueue()     // launch queued sessions as slots free (catches agent-authored proposals/crashes the server never sees directly)
superviseTimeline()  // record authored-lifecycle transitions to each session's durable timeline ([[session-timeline]])
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
