import { serve } from '@hono/node-server'
import type { Server as HttpServer, ServerResponse as HttpServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { installConnectionReaper } from './reaper.js'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { etag } from 'hono/etag'
import { createNodeWebSocket } from '@hono/node-ws'
import { loadSpecs, loadSpecsLite, specContent, specHistory, specDiffAt, loadConfig, loadReviewConfig, readAliasedRawRecord, runtimeRoot } from '@spexcode/spec-core'
import { issuesEnabled, resolveRemark, retractRemark } from './localIssues.js'
import { closeIssue, createIssue, findIssue, issueStores, mergedIssues, promote } from './issues.js'
import { remarkWithLoopIn, replyIssueWithLoopIn } from './loop-in.js'
import { residentForgeState, refreshForgeNow } from '@spexcode/spec-forge/resident'
import { resolveForgeHost } from '@spexcode/spec-forge/drivers'
import { dispatchNewMentions, summarizeDispatch, summarizeLoopIn } from './mentions.js'
import { resolveLayout, mainBranch } from '@spexcode/spec-core'
import { getBoardJson } from './graphCache.js'
import { boardStream, closeBoardFileWatchers, ensureBoardFileWatchers, notifyBoardChanged, flushDeferredWorktreeRegistryChange } from './graphStream.js'
import { gitA, gitTry, repoRoot } from '@spexcode/spec-core'
import { cockpitReview } from './cockpit.js'
import { listSessions, listArchivedSessionIndex, sendText, drainSession, markHumanPromptActive, interruptSession, rawKey, stopSession, closeSession, quarantineCorruptRecord, restoreQuarantinedRecord, resumeSession, mergeSession, captureSessionResult, sessionPrompt, renameSession, setSessionSort, linkZCodeChildSession, projectCreatedSession, sessionCreateRequest, superviseQueue, superviseTurnFailures, superviseDelivery, startWorktreeTrashReaper, SessionRecordUnusable, TMUX_SOCK, sessionDiff, saveDiffComment, sendDiffComments, canonicalWatchRecipients } from './sessions.js'
import { readTimeline } from './session-timeline.js'
import { readSessionExecution, sessionExecutionStream } from './session-execution.js'
import { defaultHarness, HARNESSES, codexHarness, dashboardLauncherList, launcherDefault, harnessById } from './harness.js'
import { ensureCodexGenerationLedger, reclaimDrainingCodexGenerations } from './codex-runtime-generations.js'
import { TranscriptReadError } from './transcript-reader.js'
import { readBlobByHash } from '@spexcode/spec-eval/evaltab'
import { putBlob } from '@spexcode/spec-eval/cache'
import { fileHumanReading } from '@spexcode/spec-eval/filing'
import { fileHumanOk } from '@spexcode/spec-eval/humanok'
import { buildExportModel, renderExportHtml, buildSessionEvals, SessionEvalUnavailableError } from '@spexcode/spec-eval/sessioneval'
import { appendUpload, cancelUpload, completeUpload, createUpload, evidenceMaxBytes, startUploadReaper, UploadError, uploadStatus } from './uploads.js'
import { listSessionFiles, openSessionFile, SESSION_FILE_PREVIEW_MAX_BYTES, sessionFilePreviewKind, SessionFileError } from './session-files.js'
import { readSourceSlice, SourceReadError, SOURCE_SLICE_MAX_BYTES } from './source-read.js'
import { listSourceDir } from './source-list.js'
import { loadConfig as loadLintConfig } from './lint.js'
import { listNodeAttachments, readNodeAttachment } from './spec-attachments.js'
import { attachViewer, detachViewer, resizeBridge, hideViewer, forwardInput, superviseBridges, type Viewer } from './pty-bridge.js'
import { installProcessGuards } from '@spexcode/spec-core'
import { resolveProjectIdentity } from '@spexcode/spec-core'
import { evalDetailReview, evalsReview, issuesReview } from './reviews.js'
import { collectResourceReport, ResourceConflict } from './host-resources.js'
import { reparentRequest, SessionReparentRequestError } from './session-reparent.js'
import { buildGuidanceCatalog } from './guidance-catalog.js'
import { installEvalHost } from './eval-host.js'
import { configuredSessionApplicationIfCutover, setSessionApplicationCommitObserver } from './session-application.js'
import { editSpecBody, readSpecBodyEdit, SpecBodyEditError } from './spec-body-edit.js'

installEvalHost()

// last-resort net: an unforeseen async throw (e.g. a worktree vanishing mid-read during a worker
// self-merge) is logged and the server KEEPS SERVING instead of exiting and dropping the public port.
installProcessGuards()
startWorktreeTrashReaper()

const app = new Hono()
// Canonical lifecycle commits do not touch a watched JSON file. Bridge those commits into the existing board
// stream so status/proposal/parent changes arrive without waiting for a later human send or delivery tick.
setSessionApplicationCommitObserver(() => notifyBoardChanged('sessions'))
startUploadReaper()
app.use('/api/*', cors())
app.onError((error, c) => {
  if (error instanceof SessionEvalUnavailableError) return c.json({ error: error.message }, 503)
  // a record that cannot carry state is a CONFLICT with the caller's request, not a server fault: the refusal
  // is deliberate and already carries its own diagnosis + repair ([[sessions-core]]). Answering 500 with a
  // stack would hide exactly the sentence the human needs.
  if (error instanceof SessionRecordUnusable) return c.json({ error: error.message, code: error.code }, 409)
  if (error instanceof ResourceConflict) return c.json({ error: error.message, code: error.code }, 409)
  if (error instanceof SessionReparentRequestError) return c.json({ error: error.message }, 400)
  console.error(error)
  return c.text('Internal Server Error', 500)
})
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

app.get('/', (c) => c.text('spec-cli — GET /api/graph · /api/specs · /api/specs/:id/history · /api/settings · /api/sessions · /api/resources · /api/slash-commands'))
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
  await ensureBoardFileWatchers()
  const timeout = Symbol('timeout')
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    getBoardJson('stale-ok'),
    new Promise<typeof timeout>((resolve) => {
      timer = setTimeout(() => resolve(timeout), BOARD_TIMEOUT_MS)
      timer.unref?.()
    }),
  ])
  clearTimeout(timer)
  if (result === timeout) return c.json({ error: 'graph build timed out' }, 503)
  const freshness = result.refreshing ? `${result.freshness}, refreshing` : result.freshness
  c.header('x-spexcode-graph', freshness)
  return c.body(result.json, 200, { 'content-type': 'application/json; charset=UTF-8' })
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
// [[spec-body-edit]]: the WRITE half of the spec document — a human at the board replaces a line range of
// a node's body and it lands as a real commit. The endpoint takes no path (it derives one from the node id)
// and rewrites nothing but the body, so a request cannot reach code or frontmatter; a region that moved
// since it was read is a 409 with the current text, never a merge. The version bump and drift are
// recomputed from the commit by [[source-of-truth]] — nothing else is written.
app.post('/api/specs/:id/body', async (c) => {
  try {
    const result = await editSpecBody(c.req.param('id'), readSpecBodyEdit(await c.req.json().catch(() => null)))
    if (result.changed) notifyBoardChanged('full')
    return c.json(result)
  } catch (e) {
    if (e instanceof SpecBodyEditError) return c.json({ error: e.message, code: e.code, ...(e.detail ?? {}) }, e.status)
    throw e
  }
})
app.get('/api/specs/:id/history', async (c) => c.json(await specHistory(c.req.param('id'))))
// the spec.md line diff one version introduced — the history tab's per-version proof-of-change, fetched
// lazily when an older version's item expands (the latest version's diff ships with the board as node.lastDiff).
app.get('/api/specs/:id/diff/:hash', async (c) => c.json(await specDiffAt(c.req.param('id'), c.req.param('hash'))))
// a unified diff of a node's spec.md from its fork point (the worktree's merge-base with main) to that
// worktree's working tree. An untracked brand-new node is invisible to `git diff <base>`, so when the base
// diff is empty AND status is `??` synthesize an all-additions view via `diff --no-index` (gitTry — --no-index
// exits 1, which gitA would swallow). Gated on `??` so a tracked file with no pending change stays empty.
// [[source-read]]: a governed source file, read as a byte WINDOW. The spec tree names the files it governs
// but the board could never open one — this is the read half of "spec and code on one screen". The policy
// gate is `isSourceFile`, the SAME predicate the coverage walk uses, so the set of files the board can show
// is by construction the set the project governs. Query: path (repo-relative), offset, limit; the response
// carries the file's total size so the client can page without a second HEAD.
app.get('/api/source', (c) => {
  try {
    const root = repoRoot()
    const slice = readSourceSlice(
      root,
      c.req.query('path') || '',
      loadLintConfig(root),
      Number(c.req.query('offset') ?? 0),
      Number(c.req.query('limit') ?? SOURCE_SLICE_MAX_BYTES),
    )
    return c.json(slice)
  } catch (e) {
    if (e instanceof SourceReadError) return c.json({ error: e.message }, e.status as 400 | 404)
    throw e
  }
})
// [[source-list]]: the LISTING half of the same surface. /api/source opens a file the caller can already
// name; this names what is there to open, one directory at a time, so the explorer can browse ordinary code
// the way any editor does. Same `isSourceFile` gate and the same refusals — a row the reader clicks and gets
// a 404 from is worse than a row that was never drawn. `dir` empty lists the governed roots themselves.
app.get('/api/files', (c) => {
  try {
    const root = repoRoot()
    const cfg = loadLintConfig(root)
    return c.json(listSourceDir(root, c.req.query('dir') || '', cfg, cfg.governedRoots))
  } catch (e) {
    if (e instanceof SourceReadError) return c.json({ error: e.message }, e.status as 400 | 404)
    throw e
  }
})
// [[node-attachments]]: what a node carries in its own folder besides its body and its readings. The board
// showed exactly one file per node folder; these are the rest — eval contracts, evidence dirs, raw captures.
// A different gate from /api/source on purpose (the spec tree is the product's own data, deliberately outside
// the coverage policy), the same windowed read underneath.
app.get('/api/specs/:id/files', (c) => {
  try {
    return c.json({ files: listNodeAttachments(repoRoot(), c.req.param('id')) })
  } catch (e) {
    if (e instanceof SourceReadError) return c.json({ error: e.message }, e.status as 400 | 404)
    throw e
  }
})
app.get('/api/specs/:id/files/content', (c) => {
  try {
    const slice = readNodeAttachment(
      repoRoot(),
      c.req.param('id'),
      c.req.query('name') || '',
      Number(c.req.query('offset') ?? 0),
      Number(c.req.query('limit') ?? SOURCE_SLICE_MAX_BYTES),
    )
    return c.json(slice)
  } catch (e) {
    if (e instanceof SourceReadError) return c.json({ error: e.message }, e.status as 400 | 404)
    throw e
  }
})
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
// the eval seam's WRITE half over HTTP ([[spec-eval]] filing.ts): a
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
  if (buf.length > evidenceMaxBytes()) return c.json({ error: 'evidence too large' }, 413)
  return c.json({ hash: putBlob(buf) }, 201)
})
// the SETTINGS read surface — one route for everything spexcode.json / spexcode.local.json resolves to:
// `layout` (resolveLayout()'s main/worktrees/branch shape — the write-guard's project-identity probe reads
// `.layout.main`) and the dashboard-visible launcher profiles ([[launcher-visibility]]) the New-Session picker
// offers — `{ name, harness, cmd, headless }`: the cmd is read-only display data for the picker (the dashboard sits
// behind the gateway auth; the browser can read but never edit config) — plus the configured `default` NAME
// so the picker pre-selects the SAME launcher a bare `spex session new` uses when that row is visible, else
// its first visible row rather than a hidden headless default,
// Missing defaultLauncher is returned as an actionable config error, not hidden by falling through to the
// built-in `claude` launcher.
// `tmuxSocket` is the `-L <name>` label our private tmux server runs under (a backend fact, env-overridable),
// so the row's attach modal ([[attach-menu]]) can offer the RAW `tmux -L <socket> attach -t <id>` fallback
// beside the blessed `spex session attach` command — the frontend never hardcodes the socket.
app.get('/api/settings', async (c) => c.json({
  layout: await resolveLayout(),
  launchers: dashboardLauncherList(),
  tmuxSocket: TMUX_SOCK,
  ...launcherDefault(),
}))
// the `surface: command` plugin-root nodes (built/active only) for new-session and live-inbox `/` dropdowns — each with
// its prompt `body` ({{targets}} placeholder), `kind`, and folder `dir` + co-located `files`. surface is a
// frontmatter field, not a dir (specs.ts loadSurface); `surface: system` siblings are gathered elsewhere.
// `?surface=review` lists the review-track presets instead ([[review-commands]] — the eval detail's
// remark-composer `/` dropdown); the exposed surfaces stay this explicit whitelist, never a passthrough.
app.get('/api/plugins', (c) => c.json(c.req.query('surface') === 'review' ? loadReviewConfig() : loadConfig()))
// Read-only, deterministic projection over the authoritative plugin/help/guide surfaces. The response carries
// exact rendered guidance plus provenance so decoupled consumers need no checkout or shared source directory.
app.get('/api/guidance', (c) => c.json(buildGuidanceCatalog().toJSON()))
// the ISSUES read surface ([[issues]]) for the dashboard's issues page — the merged list over every store
// (local threads + the resident forge slice), the SAME mergedIssues() the CLI drain reads, verbatim
// (the dashboard computes nothing over it: no re-sort, no salience ranking). The `enabled` flag mirrors
// the issues-workflow on/off switch so the frontend hides the view when the feature is OFF.
app.get('/api/issues', etag(), async (c) => c.json(await issuesReview(c.req.query('q'), c.req.query('page'))))
// Evals uses the identical paged-review response. `scope:` inside q selects the worktree source; without
// it the source is the current cached board. Filtering/counts always precede the one 25-row slice.
app.get('/api/evals', etag(), async (c) => {
  const scope = c.req.query('q')?.match(/(?:^|\s)scope:([^\s]+)/)?.[1]
  await ensureBoardFileWatchers(scope)
  const page = await evalsReview(c.req.query('q'), c.req.query('page'), { view: c.req.query('view') })
  return page ? c.json(page) : c.json({ error: 'no such review source' }, 404)
})
// The exact impact graph proves a scope's membership and selector decisions. It is deliberately a named
// read: paged Evals rows retain their own reasons but never transport this scope-sized projection.
app.get('/api/evals/impact', etag(), async (c) => {
  const scope = c.req.query('scope')?.trim()
  if (!scope) return c.json({ error: 'scope is required' }, 400)
  await ensureBoardFileWatchers(scope)
  const model = await buildSessionEvals(scope)
  return model
    ? c.json({ scope, impact: model.impact, evalRevision: model.evalRevision })
    : c.json({ error: 'no such review source' }, 404)
})
// ONE bounded detail response for both source roots: the selected scenario's complete A/B history and at
// most five lightweight neighbors. A missing worktree scope resolves explicitly to trunk; it never
// serializes another scenario's history or the scoped model.
app.get('/api/evals/detail', etag(), async (c) => {
  // Detail is a bounded, direct eval read. It builds only the addressed scope and must not
  // synchronously reconcile the global worktree watcher registry before answering.
  const node = c.req.query('node')?.trim()
  const scenario = c.req.query('scenario')?.trim()
  if (!node || !scenario) return c.json({ error: 'node and scenario are required' }, 400)
  const detail = await evalDetailReview(node, scenario, c.req.query('scope')?.trim() || null)
  return c.json(detail)
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
// posts a REAL comment through the driver. @session remains prose in either store; it never sends or spawns.
// The server owns its freshness: a forge write forces the resident slice's read-back before answering, so the
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
    const r = await replyIssueWithLoopIn(id, text, { author: 'human', node, evidence })
    if (r.store !== 'local') await refreshForgeNow()
    notifyBoardChanged('full')   // atomic with persistence — see the /api/remarks block below
    return c.json({ ok: true, replies: r.replies, url: r.url, outcomes: [summarizeDispatch(r.outcomes), summarizeLoopIn(r.loopIn)].filter(Boolean).join('  |  ') })
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
    return c.json({ ok: true, id: r.id, store: r.store, url: r.url, outcomes: summarizeDispatch(r.outcomes) }, 201)
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
    const r = await remarkWithLoopIn(host, text, { codeSha, author: 'human', evidence })
    notifyBoardChanged('full')
    return c.json({ ok: true, ref: r.ref, rid: r.rid, codeSha: r.codeSha, outcomes: [summarizeDispatch(r.outcomes), summarizeLoopIn(r.loopIn)].filter(Boolean).join('  |  ') }, 201)
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
// the harness slice of the dashboard input's `/` dropdown — computed by the launcher's HARNESS adapter the same way that harness
// computes its own `/` menu ([[harness-adapter]]). The client passes `?harness=<id>` for the ACTIVE session,
// so a codex tab gets CODEX's menu, not the default's; unknown/absent → default. Insert-only on the client.
app.get('/api/slash-commands', (c) => {
  const h = HARNESSES.find((x) => x.id === c.req.query('harness')) || defaultHarness
  return c.json(h.slashCommands())
})

function uploadFailure(error: unknown): Response {
  if (!(error instanceof UploadError)) throw error
  const body: { error: string; offset?: number } = { error: error.message }
  if (error.offset != null) body.offset = error.offset
  return new Response(JSON.stringify(body), { status: error.status, headers: { 'content-type': 'application/json' } })
}

// One offset protocol for every attachment. Chunks stream through the existing /api proxy and stage only on
// the worker machine; completion is the one boundary that makes a prompt-visible absolute path exist.
app.post('/api/uploads', async (c) => {
  const body = await c.req.json().catch(() => null) as { name?: unknown; size?: unknown } | null
  try {
    return c.json(createUpload(body?.name, body?.size), 201)
  } catch (error) {
    return uploadFailure(error)
  }
})
app.get('/api/uploads/:id', (c) => {
  try {
    return c.json(uploadStatus(c.req.param('id')))
  } catch (error) {
    return uploadFailure(error)
  }
})
app.patch('/api/uploads/:id', async (c) => {
  try {
    return c.json(await appendUpload(
      c.req.param('id'), Number(c.req.header('upload-offset')), c.req.raw.body, c.req.header('content-length'),
    ))
  } catch (error) {
    return uploadFailure(error)
  }
})
app.post('/api/uploads/:id/complete', (c) => {
  try {
    return c.json({ path: completeUpload(c.req.param('id')) }, 201)
  } catch (error) {
    return uploadFailure(error)
  }
})
app.delete('/api/uploads/:id', (c) => {
  try {
    cancelUpload(c.req.param('id'))
    return c.body(null, 204)
  } catch (error) {
    return uploadFailure(error)
  }
})

// sessions: real tmux-backed Claude Code sessions. List + spawn, stream the live pane (WebSocket),
// forward keystrokes, and close.
app.get('/api/sessions', async (c) => c.json(await listSessions(c.req.query('all') === '1' || c.req.query('all') === 'true')))
app.get('/api/sessions/archive-index', async (c) => c.json(await listArchivedSessionIndex()))
app.get('/api/resources', async (c) => c.json(await collectResourceReport()))
app.post('/api/sessions', async (c) => {
  const requestKey = c.req.header('idempotency-key') || randomUUID()
  const controller = new AbortController()
  const rawSignal = c.req.raw.signal
  const outgoing = (c.env as { outgoing?: HttpServerResponse }).outgoing
  const cancel = () => {
    if (!outgoing?.writableEnded) controller.abort(new Error('session-create caller disconnected'))
  }
  const cancelFromRequest = () => controller.abort(rawSignal.reason)
  rawSignal.addEventListener('abort', cancelFromRequest, { once: true })
  outgoing?.once('close', cancel)
  try {
    const body = await c.req.json().catch(() => null)
    const result = await sessionCreateRequest(body, { requestKey, signal: controller.signal, onPublished: projectCreatedSession })
    // The durable row is now public. Nudge the cheap session projection explicitly so a dashboard does not
    // wait for the best-effort store watcher; any held candidate worktree event remains a separate full claim.
    if (result.status === 201) notifyBoardChanged('sessions')
    // A candidate registry event is intentionally held while Git creates the private worktree. Once the
    // transaction has published or cleaned up its record, release the one deferred full refresh.
    flushDeferredWorktreeRegistryChange()
    if (result.status === 201) {
      c.header('Idempotency-Key', requestKey)
      return c.json(result.session, 201)
    }
    return c.json({ error: result.error, ...(result.code ? { code: result.code } : {}), ...(result.phase ? { phase: result.phase } : {}) }, result.status as any)
  } finally {
    flushDeferredWorktreeRegistryChange()
    rawSignal.removeEventListener('abort', cancelFromRequest)
    outgoing?.off('close', cancel)
  }
})

const runtimeApplicationOr503 = (_c: any) => {
  const application = configuredSessionApplicationIfCutover()
  if (!application) throw new ResourceConflict('session runtime is unavailable until the legacy JSON store is migrated')
  return application
}

app.get('/api/session-runtime/:id/events', (c) => {
  const application = runtimeApplicationOr503(c)
  return c.json(application.events.read(c.req.param('id')))
})
app.get('/api/session-runtime/:id/replay', (c) => {
  const application = runtimeApplicationOr503(c)
  return c.json(application.replayState(c.req.param('id')))
})
app.post('/api/session-runtime/:id/state', async (c) => {
  const application = runtimeApplicationOr503(c)
  const body = await c.req.json().catch(() => null) as { status?: unknown; proposal?: unknown; note?: unknown; parentSessionId?: unknown; reason?: unknown } | null
  if (body?.status !== undefined && typeof body.status !== 'string') return c.json({ error: 'status must be a string' }, 400)
  if (body?.proposal !== undefined && body.proposal !== null && typeof body.proposal !== 'string') return c.json({ error: 'proposal must be a string or null' }, 400)
  if (body?.note !== undefined && body.note !== null && typeof body.note !== 'string') return c.json({ error: 'note must be a string or null' }, 400)
  if (body?.parentSessionId !== undefined && body.parentSessionId !== null && typeof body.parentSessionId !== 'string') return c.json({ error: 'parentSessionId must be a string or null' }, 400)
  try {
    const sessionId = c.req.param('id')
    const nextStatus = (body?.status as string | undefined) ?? application.readState(sessionId)?.status
    return c.json(application.transitionSession(c.req.param('id'), {
      status: body?.status as string | undefined,
      proposal: body?.proposal as string | null | undefined,
      note: body?.note as string | null | undefined,
      parentSessionId: body?.parentSessionId as string | null | undefined,
      reason: typeof body?.reason === 'string' ? body.reason : null,
      recipientSessionIds: nextStatus === undefined ? undefined : canonicalWatchRecipients(application, sessionId, nextStatus),
    }))
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error), code: (error as { code?: unknown })?.code }, 409)
  }
})
app.post('/api/session-runtime/:id/watch', async (c) => {
  const application = runtimeApplicationOr503(c)
  const body = await c.req.json().catch(() => null) as { watcherSessionId?: unknown; channel?: unknown } | null
  if (typeof body?.watcherSessionId !== 'string' || !body.watcherSessionId.trim()) return c.json({ error: 'watcherSessionId is required; identity is never inferred' }, 400)
  const edge = application.attachWatcher(body.watcherSessionId, c.req.param('id'), typeof body.channel === 'string' ? body.channel : undefined)
  return c.json(edge, 201)
})
app.post('/api/session-runtime/:id/bind', async (c) => {
  const application = runtimeApplicationOr503(c)
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body.namespace !== 'string' || typeof body.runtimeKind !== 'string' || typeof body.nativeSessionId !== 'string' || typeof body.nativeStartToken !== 'string') {
    return c.json({ error: 'namespace, runtimeKind, nativeSessionId, and nativeStartToken are required; identity is never inferred' }, 400)
  }
  try {
    const binding = application.bindRuntime(c.req.param('id'), {
      namespace: body.namespace,
      runtimeKind: body.runtimeKind,
      nativeSessionId: body.nativeSessionId,
      nativeStartToken: body.nativeStartToken,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata) ? body.metadata as Record<string, unknown> : undefined,
    }, typeof body.expectedGeneration === 'number' ? body.expectedGeneration : undefined)
    return c.json(binding, 200)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error), code: (error as { code?: unknown })?.code }, 409)
  }
})
app.post('/api/session-runtime/:id/publish', async (c) => {
  const application = runtimeApplicationOr503(c)
  const body = await c.req.json().catch(() => null) as { kind?: unknown; body?: unknown; senderSessionId?: unknown } | null
  if (typeof body?.kind !== 'string' || typeof body.body !== 'string') return c.json({ error: 'kind and UTF-8 body are required' }, 400)
  const result = application.notifyRecipients(c.req.param('id'), {
    kind: body.kind,
    body: Buffer.from(body.body, 'utf8'),
    senderSessionId: typeof body.senderSessionId === 'string' ? body.senderSessionId : undefined,
  })
  return c.json(result, 201)
})
app.post('/api/session-runtime/:id/dequeue', async (c) => {
  const application = runtimeApplicationOr503(c)
  const body = await c.req.json().catch(() => null) as { namespace?: unknown; expectedGeneration?: unknown } | null
  if (typeof body?.namespace !== 'string') return c.json({ error: 'namespace is required' }, 400)
  try {
    const message = application.dequeueForRuntime(c.req.param('id'), body.namespace, typeof body.expectedGeneration === 'number' ? body.expectedGeneration : undefined)
    return c.json(message, 200)
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error), code: (error as { code?: unknown })?.code }, 409)
  }
})
// one server-side merge bundle (ahead/dirty/diff(merge-base)/gates/proposal) for the manager cockpit;
// dashboard and `spex session review` are thin callers. 404 for an unknown id. See [[manager-cockpit]].
app.get('/api/sessions/:id/review', async (c) => {
  const r = await cockpitReview(c.req.param('id'))
  return r ? c.json(r) : c.json({ error: 'no such session' }, 404)
})
// Per-worktree branch diff. Metadata is cheap and patches are fetched per file, with an explicit byte window
// so a large review never materializes the whole tree in one response.
app.get('/api/sessions/:id/diff', async (c) => {
  const offset = Math.max(0, Number(c.req.query('offset')) || 0)
  const limit = Math.min(240_000, Math.max(1, Number(c.req.query('limit')) || 120_000))
  const result = await sessionDiff(c.req.param('id'), c.req.query('path') || undefined, offset, limit)
  return result ? c.json(result) : c.json({ error: 'no such session' }, 404)
})
app.post('/api/sessions/:id/diff-comments', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const comment = await saveDiffComment(c.req.param('id'), {
      id: typeof body?.id === 'string' ? body.id : undefined,
      filePath: typeof body?.filePath === 'string' ? body.filePath : '',
      lineStart: Number(body?.lineStart), lineEnd: Number(body?.lineEnd),
      body: typeof body?.body === 'string' ? body.body : '',
      diffIdentity: typeof body?.diffIdentity === 'string' ? body.diffIdentity : '',
    })
    return comment ? c.json(comment, 201) : c.json({ error: 'no such session' }, 404)
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 400) }
})
app.post('/api/sessions/:id/diff-comments/send', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown): id is string => typeof id === 'string') : undefined
  const result = await sendDiffComments(c.req.param('id'), ids)
  return c.json(result, result.ok ? 200 : 409)
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
// A live adapter-owned execution observation, intentionally distinct from the durable conversation timeline.
// The response carries only the backend-normalized latest working note and typed tool rows; no transcript bytes
// or parser schema cross this API boundary.
app.get('/api/sessions/:id/execution', (c) => {
  const execution = readSessionExecution(c.req.param('id') || '')
  return execution ? c.json(execution) : c.json({ error: 'no such session' }, 404)
})
app.get('/api/sessions/:id/execution/stream', (c) => sessionExecutionStream(c))
// The native transcript is a bounded payload behind the durable timeline index. Bounds are explicit epoch
// milliseconds so the route never guesses which status interval the caller intended.
app.get('/api/sessions/:id/transcript', async (c) => {
  const id = c.req.param('id') || ''
  const fromRaw = c.req.query('from')
  const toRaw = c.req.query('to')
  if (fromRaw == null || toRaw == null || fromRaw === '' || toRaw === '')
    return c.json({ error: 'transcript needs both from and to epoch milliseconds' }, 400)
  const from = Number(fromRaw)
  const to = Number(toRaw)
  if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isInteger(from) || !Number.isInteger(to) || from >= to)
    return c.json({ error: 'transcript interval is invalid: from and to must be integer epoch milliseconds with from < to' }, 400)
  let raw: ReturnType<typeof readAliasedRawRecord>
  try { raw = readAliasedRawRecord(id) } catch (error) { return c.json({ error: `session ${id} record is unreadable: ${error instanceof Error ? error.message : String(error)}` }, 500) }
  if (!raw || !raw.governed) return c.json({ error: `session ${id} does not exist` }, 404)
  let harness
  try { harness = harnessById(typeof raw.harness === 'string' && raw.harness ? raw.harness : defaultHarness.id) }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : String(error) }, 500) }
  const threadId = harness.exactNativeTargetId({
    session: raw.session_id,
    harnessSessionId: typeof raw.harness_session_id === 'string' ? raw.harness_session_id : null,
    stopped: !!raw.stopped,
    archived: !!raw.archived,
  })
  if (!threadId) return c.json({ error: `session ${id} transcript is unavailable: native harness identity is missing` }, 409)
  try {
    return c.json(await harness.readTranscript(threadId, { from, to }))
  } catch (error) {
    if (!(error instanceof TranscriptReadError)) throw error
    const status = error.reason === 'unsupported' ? 501 : error.reason === 'invalid' ? 422 : 409
    return c.json({ error: error.message, reason: error.reason }, status)
  }
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
  const row = (await listSessions(true)).find((s) => s.id === id)
  if (!row) return c.json({ error: 'no such session' }, 404)
  return c.json({ ...row, prompt: await sessionPrompt(id) })
})
app.get('/api/sessions/:id/files', (c) => {
  try { return c.json({ files: listSessionFiles(c.req.param('id')) }) }
  catch (error) {
    if (error instanceof SessionFileError) return c.json({ error: error.message }, error.status)
    throw error
  }
})
const sessionFileDownload = (c: any) => {
  try {
    const requested = c.req.query('path')
    if (!requested) return c.json({ error: 'download needs a posted path' }, 400)
    const file = openSessionFile(c.req.param('id'), requested)
    const preview = c.req.query('preview') === '1'
    const previewType = preview ? sessionFilePreviewKind(file.path) : null
    if (preview && !previewType) return c.json({ error: 'no preview for this file type; download it instead' }, 415)
    if (preview && file.size > SESSION_FILE_PREVIEW_MAX_BYTES)
      return c.json({ error: `preview is limited to ${SESSION_FILE_PREVIEW_MAX_BYTES / (1024 * 1024)} MiB; download this ${file.size}-byte file instead` }, 413)
    const headers: Record<string, string> = {
      'Cache-Control': 'no-store',
      'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Content-Length': String(file.size),
      'Content-Type': previewType?.contentType ?? 'application/octet-stream',
    }
    if (previewType) headers['X-Spexcode-Preview-Kind'] = previewType.kind
    if (c.req.method === 'HEAD') return c.body(null, 200, headers)
    return c.body(Readable.toWeb(createReadStream(file.path)) as ReadableStream, 200, headers)
  } catch (error) {
    if (error instanceof SessionFileError) return c.json({ error: error.message }, error.status)
    throw error
  }
}
app.get('/api/sessions/:id/files/download', sessionFileDownload)
app.on('HEAD', '/api/sessions/:id/files/download', sessionFileDownload)
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
// A merge intent to the session's own agent (it runs the merge), never a server merge.
app.post('/api/sessions/:id/merge', async (c) => {
  const r = await mergeSession(c.req.param('id'))
  return c.json(r, r.dispatched ? 200 : 409)
})

// one WS owns one native tmux client (pty-bridge): server→client = that client's rendered PTY bytes (binary);
// client→server text controls resize, visibility, and xterm-native input (which carries the mouse/wheel
// SGR reports xterm produces natively in mouse-report mode). Server→client text commits a completed resize immediately before its binary tmux transaction;
// hiding starts that viewer's bounded helper release without closing the warm socket. tmux itself resolves wheel input between
// copy-mode and a mouse-owning TUI. The bridge never splices capture-pane state into this stream.
// keep-alive ping cadence for the terminal socket — the server half of [[reconnect]]'s heartbeat contract,
// and the contract's ONE primitive number: the client mirrors it (SERVER_PING_MS in the dashboard's
// resilientSocket.js, pinned by its test) and DERIVES its silence deadline (2.5×) from it.
// A healthy link is guaranteed inbound traffic every PING window, so the client may presume an OPEN socket
// silent past its derived window dead. The same tick also sends a WebSocket protocol ping; browsers answer its
// pong below JavaScript, so a backend reload stays compatible with a tab running the previous frontend bundle.
// The server owns that mirror deadline and detaches the viewer itself when a half-open link never reports close.
// Terminal pixels remain binary frames, so heartbeat controls never enter xterm.
const TERM_PING_MS = 10000
const TERM_DEAD_MS = 2.5 * TERM_PING_MS
app.get('/api/sessions/:id/socket', upgradeWebSocket((c) => {
  const id = c.req.param('id') as string
  let viewer: Viewer | null = null
  let ping: ReturnType<typeof setInterval> | undefined
  let pongDeadline: ReturnType<typeof setTimeout> | undefined
  let cleaned = false
  const disarmPongDeadline = () => { if (pongDeadline) clearTimeout(pongDeadline); pongDeadline = undefined }
  let armPongDeadline = () => {}
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    if (ping) clearInterval(ping)
    disarmPongDeadline()
    if (viewer) detachViewer(id, viewer)
    viewer = null
  }
  return {
    onOpen(_evt, ws) {
      viewer = {
        send: (buf) => { try { ws.send(Uint8Array.from(buf)) } catch { /* viewer gone */ } },
        commitSize: (cols, rows) => { try { ws.send(JSON.stringify({ t: 'resize-commit', cols, rows })) } catch { /* viewer gone */ } },
      }
      attachViewer(id, viewer)
      armPongDeadline = () => {
        if (cleaned) return
        disarmPongDeadline()
        pongDeadline = setTimeout(() => {
          cleanup()
          try { ws.close() } catch { /* cleanup already detached the dead viewer */ }
        }, TERM_DEAD_MS)
        pongDeadline.unref()
      }
      // `raw` is @hono/node-ws's real ws.WebSocket. Protocol pong is intentionally the server-side liveness
      // signal: unlike an application text reply, every browser generation answers it automatically.
      ws.raw.on('pong', armPongDeadline)
      armPongDeadline()
      ping = setInterval(() => {
        try { ws.raw.ping() } catch { /* viewer gone; onClose reaps */ }
        try { ws.send('ping') } catch { /* client dead-man still needs observable inbound traffic */ }
      }, TERM_PING_MS)
    },
    onMessage(evt) {
      if (!viewer) return
      const data = evt.data
      // Binary input is ignored; JSON keeps terminal input distinct from binary pane output while preserving
      // xterm's ordered string exactly. The bridge accepts input only from this viewer's visible claim.
      if (typeof data === 'string') {
        if (data === 'pong') {
          armPongDeadline()
          return
        }
        try {
          const m = JSON.parse(data)
          if (m?.t === 'resize') resizeBridge(id, viewer, Number(m.cols), Number(m.rows))
          else if (m?.t === 'visible' && m.visible === false) hideViewer(id, viewer)
          else if (m?.t === 'input' && typeof m.data === 'string') forwardInput(id, viewer, m.data)
        } catch { /* ignore */ }
      }
    },
    onClose() { cleanup() },
  }
}))
// ONE input route, `kind` the discriminator — the transport split is an implementation fact, not API surface.
// kind:"text" (`spex session send`, the server-side merge dispatch) appends the prompt to the
// target timeline, then best-effort pokes its adapter. A proven-unreachable transport joined to a live
// registered agent is stranded and refuses before append; an unproven/dead-restartable channel stays queued.
// 502 means the record rejected the write.
// kind:"keys" is the LAST-RESORT raw face (`spex session send --keys`): an ORDERED BATCH of
// nav-mode key tokens over tmux send-keys, delivered in array order so tap order survives
// ([[nav-mode-key-ordering]]); unstable by nature — callers try a plain text send first. An unknown kind is a
// loud 400, never a guessed channel.
app.post('/api/sessions/:id/input', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body?.kind === 'text') {
    // `from` (the sender's session id) rides only an agent-to-agent send → the backend records the comms
    // edge ([[session-timeline]]); a raw human dispatch omits it and is not logged. `replyVia:"note"` marks a
    // terminal-free sender ([[session-timeline]]): the server appends the note-reply insert to the delivery.
    const r = await sendText(c.req.param('id'), typeof body?.text === 'string' ? body.text : '', typeof body?.from === 'string' ? body.from : undefined, {
      ...(body?.replyVia === 'note' ? { replyVia: 'note' as const } : {}),
    })
    return c.json(r, r.ok ? 200 : 502)
  }
  if (body?.kind === 'command') {
    const id = c.req.param('id')
    const text = typeof body?.text === 'string' ? body.text : ''
    const deliveryKey = typeof body?.deliveryId === 'string' && body.deliveryId.trim() ? body.deliveryId.trim() : undefined
    // Command Box acceptance is the durable append. Do not hold the HTTP request on a
    // slow native handoff: the delivery supervisor already owns the queued retry path.
    const r = await sendText(id, text, undefined, deliveryKey ? { deliveryKey, deferDrain: true } : { deferDrain: true })
    if (!r.ok) return c.json(r, 502)
    // Start the first handoff without holding the HTTP response on native readiness. The queue remains the
    // acceptance boundary; only a successful dequeue is allowed to publish human activity.
    // A deferred drain is an asynchronous handoff, not proof that a prompt was delivered. Only the
    // accepted queue state for this request may reopen a waiting lifecycle; an empty/raced drain must
    // never turn a focus-only or retry-only path into `working`.
    const handoffWasQueued = r.delivery === 'queued'
    void drainSession(id).then(() => {
      if (!handoffWasQueued) return
      const application = configuredSessionApplicationIfCutover()
      if (application ? !application.readPendingMessages(id).length : true) markHumanPromptActive(id)
    }).catch((error) => console.error(`spex: command handoff deferred for ${id}: ${error instanceof Error ? error.message : String(error)}`))
    const outcomes = await dispatchNewMentions(text, { sessionId: id })
    return c.json({ ...r, outcomes, mentionSummary: summarizeDispatch(outcomes) })
  }
  if (body?.kind === 'keys') {
    const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown) => typeof k === 'string') : []
    const ok = await rawKey(c.req.param('id'), keys)
    return c.json({ ok }, ok ? 200 : 404)
  }
  return c.json({ error: 'input needs kind: "text" | "command" | "keys"' }, 400)
})
app.post('/api/sessions/reparent', async (c) => {
  const result = await reparentRequest(await c.req.json().catch(() => null))
  notifyBoardChanged('sessions')
  return c.json(result)
})
// soft stop: kill the agent's tmux + socket but KEEP the worktree (resumable). Distinct from close, which
// removes the worktree. {ok:false} = no such session.
app.post('/api/sessions/:id/stop', async (c) => {
  const sessionId = c.req.param('id')
  const ok = await stopSession(sessionId)
  return c.json(ok ? { ok: true } : { ok: false, error: `no stop transition was committed for session ${sessionId}` }, ok ? 200 : 404)
})
app.post('/api/sessions/:id/interrupt', async (c) => {
  const result = await interruptSession(c.req.param('id'))
  return c.json(result, result.ok ? 200 : 502)
})
app.post('/api/sessions/:id/close', async (c) => {
  const sessionId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const ok = await closeSession(sessionId, body?.source)
  // The close route owns its write's visible boundary: filesystem watchers can be unavailable, so cache
  // invalidation must happen before the success response rather than leaving the confirming board to patrol.
  if (ok) notifyBoardChanged('sessions')
  return c.json(ok ? { ok: true } : { ok: false, error: `no close transition was committed for session ${sessionId}` }, ok ? 200 : 404)
})
app.post('/api/sessions/:id/quarantine', async (c) => {
  const body = await c.req.json().catch(() => null)
  const result = await quarantineCorruptRecord(c.req.param('id'), body)
  return c.json({ ok: true, ...result })
})
app.post('/api/sessions/:id/quarantine/restore', async (c) => {
  const result = await restoreQuarantinedRecord(c.req.param('id'))
  return c.json({ ok: true, ...result })
})
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
// Cross-product identity is opt-in and exact: a ZCode tool/hook reports its own opaque child id against the
// SpexCode session it belongs to. No route derives an association from labels, timing, worktrees, or branches.
app.post('/api/sessions/:id/zcode-child-sessions', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body || typeof body.childSessionId !== 'string' || !body.childSessionId || body.childSessionId.trim() !== body.childSessionId)
    return c.json({ error: 'body needs a non-empty, whitespace-free childSessionId' }, 400)
  const link = await linkZCodeChildSession(c.req.param('id'), body?.childSessionId)
  if (!link) return c.json({ error: 'no such governed session' }, 404)
  // The store watch is best effort. The confirming reader must see its asserted identity immediately.
  notifyBoardChanged('sessions')
  return c.json(link, link.alreadyLinked ? 200 : 201)
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
// Reclaim only stale, draining Codex generations whose exact detached identity and native reference census
// prove they have no loaded threads. The current generation and any uncertain/shared process remain intact.
try {
  const root = runtimeRoot()
  await ensureCodexGenerationLedger(root)
  const descriptors = new Map((codexHarness.sharedRuntimes?.(root) ?? []).map((descriptor) => [descriptor.key, descriptor]))
  const results = await reclaimDrainingCodexGenerations(root, async (endpoint) => {
    const key = endpoint.id === 'legacy' ? 'codex-app-server' : `codex-app-server:${endpoint.id}`
    const residency = descriptors.get(key)?.residency
    if (!residency) return { healthy: false, referenceIds: [], peerCount: 0 }
    const result = await residency()
    return { healthy: result.healthy, referenceIds: result.referenceIds, peerCount: 0 }
  })
  for (const result of results) if (result.reclaimed) console.log(`[codex] reclaimed stale generation ${result.generationId}`)
} catch (error) {
  console.error(`[codex] stale generation sweep retained resources: ${(error as Error).message}`)
}
superviseBridges()   // restore visible helpers after failure; their viewer subscriptions survive replacement
superviseQueue()     // launch queued sessions as slots free (catches agent-authored proposals/crashes the server never sees directly)
superviseTurnFailures() // reconcile adapter-owned native failure subscriptions across backend replacement
superviseDelivery()  // hand over messages an earlier pass could not ([[delivery-queue]]): the retry half of dispatch

let graphWatchersClosed = false
const closeGraphWatchers = (): void => {
  if (graphWatchersClosed) return
  graphWatchersClosed = true
  closeBoardFileWatchers()
}
process.once('exit', closeGraphWatchers)

// graceful drain (the other half of zero-downtime reload, supervise.ts): on SIGTERM stop accepting new
// connections, let in-flight requests finish, and sweep now-idle keep-alive sockets so close() fires the
// instant the last request drains. A hard cap still forces exit if a connection won't close.
process.on('SIGTERM', () => {
  closeGraphWatchers()
  const srv = server as unknown as { close(cb?: () => void): void; closeIdleConnections?(): void }
  const sweep = setInterval(() => srv.closeIdleConnections?.(), 200)
  srv.close(() => { clearInterval(sweep); process.exit(0) })
  setTimeout(() => process.exit(0), 10000).unref()
})
