import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { fileURLToPath } from 'node:url'
import { git, gitA, gitTry, repoRoot, mergeBaseDiff, mergeConflicts, type ReviewDiffFile } from './git.js'
import { guardWorktree } from './resilience.js'
import { loadSystemConfig, loadSpecs, type ConfigPreset } from './specs.js'
import { mainBranch, gitCommonDir, statePath, runtimePath, RUNTIME_DIR, readConfig } from './layout.js'

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const CLAUDE_CMD = process.env.SPEXCODE_CLAUDE_CMD || 'claude --dangerously-skip-permissions'
const COLS = 120, ROWS = 32
// precedence: spexcode.json sessions.maxActive → SPEXCODE_MAX_ACTIVE env → default 6, read live, floored at 1.
function maxActive(): number {
  let v: number | undefined
  try {
    const fromJson = readConfig(mainRoot()).sessions?.maxActive
    if (typeof fromJson === 'number' && Number.isFinite(fromJson)) v = fromJson
  } catch { /* config unreadable — fall through to env/default */ }
  if (v === undefined) { const e = Number(process.env.SPEXCODE_MAX_ACTIVE); if (Number.isFinite(e) && e > 0) v = e }
  return Math.max(1, Math.floor(v ?? 6))
}

export function appendSysArg(cfgs: ConfigPreset[] = loadSystemConfig()): string {
  const parts: string[] = []
  for (const cfg of cfgs) {
    if (cfg.body.trim()) parts.push(cfg.body.trim())
  }
  if (parts.length === 0) return ''
  const full = parts.join('\n\n')
  return `--append-system-prompt '${full.replace(/'/g, `'\\''`)}'`
}

const rvSock = (id: string) => join(tmpdir(), `spexcode-rv-${id}.sock`)
// env prefix put in front of the spawned `claude` so it creates this session's rendezvous control socket.
const rvEnv = (id: string) => `CLAUDE_BG_BACKEND=daemon CLAUDE_BG_RENDEZVOUS_SOCK=${rvSock(id)}`

// a prompt-dispatch outcome. ok=true ONLY when the agent confirmably ACCEPTED the prompt; otherwise `error`
// carries a human-readable reason that propagates to the API route (non-2xx) and the CLI/dashboard/manager.
export type DispatchResult = { ok: boolean; error?: string }
const ACCEPT_TIMEOUT_MS = 2500

// confirm acceptance via an in-order round-trip: write reply then repaint; a repaint-done with no preceding
// reply-rejected proves the reply was enqueued (the daemon acks no accepted reply, repaint is auth-exempt).
function replyViaSocket(sock: string, text: string): Promise<DispatchResult> {
  return new Promise((resolve) => {
    let settled = false, buf = ''
    let c: ReturnType<typeof createConnection>
    const done = (r: DispatchResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { c?.destroy() } catch { /* */ }
      resolve(r)
    }
    const timer = setTimeout(
      () => done({ ok: false, error: `rendezvous socket gave no acceptance confirmation within ${ACCEPT_TIMEOUT_MS}ms` }),
      ACCEPT_TIMEOUT_MS,
    )
    try {
      c = createConnection({ path: sock })
    } catch (e) {
      done({ ok: false, error: `rendezvous socket connect threw: ${String(e)}` })
      return
    }
    c.on('error', (e: NodeJS.ErrnoException) => done({ ok: false, error: `rendezvous socket connect failed: ${e?.code || String(e)}` }))
    c.on('close', () => done({ ok: false, error: 'rendezvous connection closed before the prompt was confirmed accepted' }))
    c.on('connect', () => c.write(JSON.stringify({ type: 'reply', text }) + '\n' + JSON.stringify({ type: 'repaint' }) + '\n'))
    c.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1)
        if (!line) continue
        let type: string | undefined
        try { type = JSON.parse(line)?.type } catch { continue }   // ignore any non-JSON noise on the wire
        if (type === 'reply-rejected') return done({ ok: false, error: 'agent REJECTED the prompt (rendezvous reply-rejected — auth-gated daemon?)' })
        if (type === 'shutting-down') return done({ ok: false, error: 'agent is shutting down — prompt not accepted' })
        if (type === 'repaint-done') return done({ ok: true })   // reply was enqueued in-order before this
        // heartbeat / state / other frames → keep waiting for the decisive repaint-done or a rejection.
      }
    })
  })
}

export type Lifecycle = 'active' | 'idle' | 'awaiting' | 'parked' | 'error' | 'asking' | 'queued'
export type Proposal = 'merge' | 'nothing' | 'close'
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'starting' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'
// liveness — the orthogonal axis to Lifecycle: whether the agent process is actually up, derived (never
// authored) for EVERY session regardless of its lifecycle. See [[state]]: lifecycle and liveness never
// override each other; the UI keys the terminal-mount / relaunch panel on this, the badge on lifecycle.
export type Liveness = 'online' | 'starting' | 'offline'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; title: string | null; name: string | null; branch: string | null; path: string
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; liveness: Liveness; note: string | null
  prompt: string | null; promptPreview: string | null; created: number; activity: string | null
  sortKey: number | null   // manual drag-reorder override ([[session-reorder]]); null = sort by `created`
}

const PROMPT_FILE = '.session-prompt'   // legacy flat name; the live path is `.session/prompt` (runtime dir)
function writePromptFile(dir: string, prompt: string): void {
  try { writeFileSync(join(runtimeDir(dir), 'prompt'), prompt) } catch { /* best-effort; must never block the launch */ }
}
function readPromptFile(dir: string): string | null {
  try {
    const p = runtimePath(dir, 'prompt', PROMPT_FILE)
    if (!existsSync(p)) return null
    const s = readFileSync(p, 'utf8')
    return s.trim() ? s : null
  } catch { return null }
}
const LAUNCH_FILE = '.session-launch'   // legacy flat name; the live path is `.session/launch` (runtime dir)
function writeLaunchFile(dir: string, prompt: string): void {
  try { writeFileSync(join(runtimeDir(dir), 'launch'), prompt) } catch { /* best-effort; the drainer treats a missing file as nothing-to-launch */ }
}
function readLaunchFile(dir: string): string | null {
  try { const p = runtimePath(dir, 'launch', LAUNCH_FILE); return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null }
}
function removeLaunchFile(dir: string): void {
  try { rmSync(runtimePath(dir, 'launch', LAUNCH_FILE), { force: true }) } catch { /* best-effort */ }
}

// a one-line preview of the originating prompt for tables/events: first non-empty line, truncated.
function promptPreview(prompt: string, n = 60): string {
  const first = prompt.split('\n').map((l) => l.trim()).find(Boolean) || ''
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

// the STABLE human label for a session row: a user-chosen NAME (the rename override) wins over everything;
// else the spec node it references, else a prompt-derived title (node-agnostic sessions), else the branch,
// else the id. Stable across turns — used for tables/selectors. The frontend mirrors this (session.js
// sessionName).
export const sessionLabel = (s: Session): string => s.name || s.node || s.title || s.branch || s.id

export const sessionHeadline = (s: Session): string => s.name || s.activity || s.promptPreview || s.node || s.title || s.branch || s.id

async function tmux(args: string[]): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8' })
  return stdout
}
async function tmuxOk(args: string[]): Promise<boolean> { try { await tmux(args); return true } catch { return false } }
export async function alive(id: string): Promise<boolean> { return tmuxOk(['has-session', '-t', id]) }

// worktrees + branches are created off MAIN even when the server runs inside a worktree.
function mainRoot(): string {
  try { return dirname(gitCommonDir()) }
  catch { return repoRoot() }
}

// the CLI package's own dir, derived from this module's location (<pkgRoot>/src/sessions.ts), never hardcoded.
function pkgRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

// `name` is the user-chosen display override set by the rename gesture — distinct from the auto-derived
// `title` (from the prompt), so a rename never has to fight or overwrite the launch-time derivation.
type SessRec = { node: string | null; title: string | null; name: string | null; session: string | null; status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null; sortKey: number | null }
// ensure a worktree's `.session/` runtime dir exists, returning its path. Idempotent (recursive mkdir) —
// every writer that drops a file under the runtime dir calls this first so launch order never matters.
function runtimeDir(path: string): string { const d = join(path, RUNTIME_DIR); mkdirSync(d, { recursive: true }); return d }

function readSessionFile(dir: string): SessRec {
  const r: SessRec = { node: null, title: null, name: null, session: null, status: 'active', proposal: null, merges: 0, note: null, sortKey: null }
  const p = statePath(dir)
  if (!existsSync(p)) return r
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (k === 'node') r.node = v || null
    else if (k === 'title') r.title = v || null
    else if (k === 'name') r.name = v || null
    else if (k === 'session') r.session = v || null
    else if (k === 'status' && (v === 'active' || v === 'idle' || v === 'awaiting' || v === 'parked' || v === 'error' || v === 'asking' || v === 'queued')) r.status = v
    else if (k === 'proposal' && v) r.proposal = v as Proposal
    else if (k === 'merges') r.merges = Number(v) || 0
    else if (k === 'note') r.note = v || null
    // Number('') is 0 (not NaN), so reject the empty case first → null reverts the row to `created` order.
    else if (k === 'sortkey') { const n = v === '' ? NaN : Number(v); r.sortKey = Number.isFinite(n) ? n : null }
  }
  return r
}
function writeSessionFile(dir: string, rec: SessRec): void {
  const lines = [`node: ${rec.node || ''}`]
  if (rec.title) lines.push(`title: ${rec.title}`)
  if (rec.name) lines.push(`name: ${rec.name}`)
  lines.push(`session: ${rec.session || ''}`, `status: ${rec.status}`)
  if (rec.status === 'awaiting' && rec.proposal) lines.push(`proposal: ${rec.proposal}`)
  if (rec.merges) lines.push(`merges: ${rec.merges}`)
  if (rec.note) lines.push(`note: ${rec.note}`)
  if (rec.sortKey != null) lines.push(`sortkey: ${rec.sortKey}`)
  const p = statePath(dir)   // `.session/state` for a new session; the flat `.session` file for a legacy one
  mkdirSync(dirname(p), { recursive: true })   // creates `.session/`; no-op when p is the legacy flat file
  writeFileSync(p, lines.join('\n') + '\n')
}

async function listWorktrees(): Promise<{ path: string; branch: string | null }[]> {
  const r = await gitTry(['-C', mainRoot(), 'worktree', 'list', '--porcelain'])
  if (!r.ok) throw new Error(`git worktree list failed: ${r.stderr.trim() || 'unknown error'}`)
  const list: { path: string; branch: string | null }[] = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur) }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '')
  }
  if (!list.length) throw new Error('git worktree list returned no worktrees (enumeration failed; the main worktree is always present)')
  return list
}

// every tmux session on our socket in ONE call; a present session_name = a live tmux window for that id.
async function liveTmux(): Promise<Set<string>> {
  const s = new Set<string>()
  let out = ''
  try { out = await tmux(['list-sessions', '-F', '#{session_name}']) } catch { return s }
  for (const line of out.split('\n')) { const name = line.trim(); if (name) s.add(name) }
  return s
}

// each worker's live pane title (its OSC self-summary) in one list-panes call, mapped id → summary.
async function paneTitles(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  let out = ''
  try { out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_title}']) } catch { return m }
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) continue
    const id = line.slice(0, tab), title = selfSummary(line.slice(tab + 1))
    if (id && title) m.set(id, title)
  }
  return m
}

// a genuine Claude Code self-summary always leads with a status glyph (✳/blink frames idle, braille spinner
// working); the regex REQUIRES ≥1 such glyph (proof it's the agent's OSC title, not tmux's host-name/splash
// default) and strips the glyph run, returning the summary text — null when absent or empty.
export function selfSummary(paneTitle: string): string | null {
  const m = /^[\s·]*(?:[✳✶✻✽✢⠀-⣿][\s·]*)+(.*)$/u.exec(paneTitle)
  return m ? (m[1].trim() || null) : null
}

// when we last started a tmux window for an id; the boot-grace window during which an absent socket reads
// 'starting' not 'offline'. In-memory in the single server process (lost on restart — nothing in flight then).
const launchedAt = new Map<string, number>()
const BOOT_GRACE_MS = 25000   // > waitForSocket's 15s timeout, covering the observed ~15-20s socket boot window

function liveness(rec: SessRec, live: Set<string>): Liveness {
  if (!rec.session || !live.has(rec.session)) return 'offline'
  if (!existsSync(rvSock(rec.session))) {
    const at = launchedAt.get(rec.session)
    return at && Date.now() - at < BOOT_GRACE_MS ? 'starting' : 'offline'
  }
  return 'online'
}

function reconcile(rec: SessRec, live: Set<string>): DisplayStatus {
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (rec.status !== 'active' && rec.status !== 'idle') return rec.status  // parked | error | asking | queued (no tmux yet)
  const lv = liveness(rec, live)
  if (lv !== 'online') return lv  // 'offline' | 'starting'
  return rec.status === 'idle' ? 'idle' : 'working'
}

async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  for (const w of await listWorktrees()) {
    const rec = readSessionFile(w.path)
    if (rec.session === id) return { path: w.path, branch: w.branch, rec }
  }
  return null
}

// a session's birth instant = the worktree DIRECTORY's birthtime (the .session file's resets on every
// rewrite, so it can't anchor order); falls back to dir mtime where birthtime is unreported, then 0.
function createdAt(dir: string): number {
  try { const s = statSync(dir); return s.birthtimeMs || s.mtimeMs || 0 } catch { return 0 }
}

function toSession(rec: SessRec, branch: string | null, path: string, status: DisplayStatus, lv: Liveness, activity: string | null = null): Session {
  const prompt = readPromptFile(path)   // the originating ask, captured at launch (sidecar; null for old sessions)
  // activity is the LIVE pane title; it only means anything while the worker is genuinely up — a
  // dead/booting session would show a stale or absent title, so it's suppressed unless liveness is online.
  const showActivity = lv === 'online'
  return { id: rec.session!, node: rec.node, title: rec.title, name: rec.name, branch, path, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status, liveness: lv, prompt, promptPreview: prompt ? promptPreview(prompt) : null, created: createdAt(path), activity: showActivity ? activity : null, sortKey: rec.sortKey }
}

export async function renameSession(id: string, name: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, name: name.trim() || null })
  return true
}

export async function setSessionSort(id: string, key: number | null): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, sortKey: key != null && Number.isFinite(key) ? key : null })
  return true
}

// the session's full ORIGINATING prompt (what it was asked to do), or null if none was recorded.
export async function sessionPrompt(id: string): Promise<string | null> {
  const wt = await findWorktree(id)
  return wt ? readPromptFile(wt.path) : null
}

// the last successfully-read Session row per worktree path, served when a detail read degrades (see
// guardWorktree) so a transient failure never drops a live worktree. Pruned each poll to present paths.
const lastKnownSession = new Map<string, Session>()

// every worktree that IS a session (has a .session id), status reconciled.
export async function listSessions(): Promise<Session[]> {
  // ONE worktree enumeration + ONE tmux liveness snapshot + ONE pane-title snapshot for the whole list (all
  // independent), then every session reconciles by a pure set lookup + one existsSync — no per-session tmux
  // spawn.
  const [wts, live, titles] = await Promise.all([listWorktrees(), liveTmux(), paneTitles()])
  // each row reads that worktree's .session + prompt sidecar. A worktree whose directory is GENUINELY gone
  // (a worker self-merged and retired it) is omitted; one whose directory still exists but hit a transient
  // read failure is served from its last-known row — never dropped. See resilience.guardWorktree.
  const rows = await Promise.all(wts.map((w) => guardWorktree<Session | null>(w.path, () => {
    const rec = readSessionFile(w.path)
    if (!rec.session) { lastKnownSession.delete(w.path); return null }   // exists but isn't a session
    const s = toSession(rec, w.branch, w.path, reconcile(rec, live), liveness(rec, live), titles.get(rec.session) ?? null)
    lastKnownSession.set(w.path, s)
    return s
  }, () => {
    // DEGRADED: the directory still exists but reading its .session failed transiently. NEVER drop a live
    // session — serve its last-known row. (No last-known means a first sighting raced a failure; nothing to
    // show yet, it reappears next poll — and since it was never in watchSessions' `prev`, no false closed.)
    return lastKnownSession.get(w.path) ?? null
  })))
  // prune last-known entries for worktrees that no longer appear at all (genuinely removed), keeping it bounded.
  const livePaths = new Set(wts.map((w) => w.path))
  for (const p of [...lastKnownSession.keys()]) if (!livePaths.has(p)) lastKnownSession.delete(p)
  // order by `sortKey ?? created` (birth time, a manual drag overriding one row), id breaking ties.
  return rows.filter((s): s is Session => s != null).sort((a, b) => (a.sortKey ?? a.created) - (b.sortKey ?? b.created) || a.id.localeCompare(b.id))
}

// an edge is either a LIVE monitor arrow (A→B = A watches B, directed) or a recorded comms link (A↔B =
// they have exchanged `count` direct messages, undirected).
export type Edge = { from: string; to: string; kind: 'monitor' | 'comms'; count?: number }

// layout-aware (like statePath): a new session writes `.session/comms.ndjson`; a legacy session (`.session`
// is a flat file, so the dir can't be made) writes the flat sibling `.session-comms.ndjson` — both gitignored.
const COMMS_FILE = 'comms.ndjson'
const LEGACY_COMMS = '.session-comms.ndjson'
function commsLog(dir: string): { path: string; mkdir: boolean } {
  const base = join(dir, RUNTIME_DIR)
  try { if (statSync(base).isFile()) return { path: join(dir, LEGACY_COMMS), mkdir: false } } catch { /* missing or dir */ }
  return { path: join(base, COMMS_FILE), mkdir: true }
}
async function recordComms(toId: string, fromId: string): Promise<void> {
  if (!fromId || fromId === toId) return
  try {
    const wt = await findWorktree(toId)
    if (!wt) return
    const { path, mkdir } = commsLog(wt.path)
    if (mkdir) mkdirSync(join(wt.path, RUNTIME_DIR), { recursive: true })
    appendFileSync(path, JSON.stringify({ peer: fromId, ts: new Date().toISOString() }) + '\n')
  } catch { /* a recording failure must not fail the delivered send */ }
}
// the peers this session has exchanged messages with — one entry per message, newest appended last.
function readComms(dir: string): string[] {
  try {
    const { path } = commsLog(dir)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return String(JSON.parse(l).peer || '') } catch { return '' } }).filter(Boolean)
  } catch { return [] }
}
// keyed by an opaque per-watch token (one per `spex watch` process), so a single agent may run several
// monitors without them clobbering each other. `selectors` is what the watch targets (resolved LIVE at
// read time, not frozen here); empty / @all = a GLOBAL watcher. `expires` is the heartbeat backstop.
type WatchReg = { watcher: string; selectors: string[]; expires: number }
const watches = new Map<string, WatchReg>()
const DEFAULT_WATCH_TTL_MS = 15000
// register OR heartbeat a live monitor. watcher = the watching agent's OWN session id; ttlMs = how long
// this stays live without another beat. Returns false on a bad pair (the route answers 400).
export function registerWatch(token: string, watcher: string, selectors: string[], ttlMs = DEFAULT_WATCH_TTL_MS): boolean {
  if (!token || !watcher) return false
  watches.set(token, { watcher, selectors: selectors.filter(Boolean), expires: Date.now() + Math.max(1000, ttlMs) })
  return true
}
// deregister a watch (its `spex watch` exited); false if the token wasn't registered.
export function deregisterWatch(token: string): boolean { return watches.delete(token) }
// the still-live registrations, pruning any whose heartbeat lapsed — the backstop for a watch that died
// without a clean unwatch (SIGKILL, a dropped connection, a backend that was down at exit time).
function liveWatches(): WatchReg[] {
  const now = Date.now()
  const out: WatchReg[] = []
  for (const [token, reg] of watches) {
    if (reg.expires <= now) watches.delete(token)
    else out.push(reg)
  }
  return out
}
export async function sessionGraph(): Promise<{ nodes: Session[]; edges: Edge[] }> {
  const nodes = await listSessions()
  const live = new Set(nodes.map((s) => s.id))
  const edges: Edge[] = []
  const seen = new Set<string>()
  for (const reg of liveWatches()) {
    if (!live.has(reg.watcher)) continue   // the watching agent itself is gone
    for (const t of selectSessions(nodes, reg.selectors)) {
      if (t.id === reg.watcher) continue
      const key = `${reg.watcher} ${t.id}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: reg.watcher, to: t.id, kind: 'monitor' })
    }
  }
  // comms edges: undirected direct-talk, one per pair, carrying the message count — read from each live
  // session's per-worktree log and aggregated by sorted pair so A→B and B→A fold into one A↔B count. An
  // edge to a non-live session is dropped, like the monitor edges.
  const commsCount = new Map<string, number>()
  for (const n of nodes) {
    for (const peer of readComms(n.path)) {
      if (peer === n.id || !live.has(peer)) continue
      const key = n.id < peer ? `${n.id}\t${peer}` : `${peer}\t${n.id}`
      commsCount.set(key, (commsCount.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of commsCount) {
    const [from, to] = key.split('\t')
    edges.push({ from, to, kind: 'comms', count })
  }
  return { nodes, edges }
}

export const apiBase = () => process.env.SPEXCODE_API_URL || `http://127.0.0.1:${process.env.PORT || 8787}`
// the agent's OWN session id: Claude Code's env var if set, else the worktree `.session` in the cwd (the
// `spex watch` runs from the worker's worktree, whose .session id equals the worker claude's session id).
export function ownSessionId(): string | null {
  const env = process.env.CLAUDE_CODE_SESSION_ID
  if (env && env.trim()) return env.trim()
  return readSessionFile(process.cwd()).session
}

export type MsgSender = { id: string; label: string | null }
export function withSenderHint(text: string, sender: MsgSender | null): string {
  if (!sender) return text
  const who = sender.label && sender.label !== sender.id ? `session "${sender.label}" (${sender.id})` : `session ${sender.id}`
  return `${text}\n\n— from ${who}. To reply: spex session send ${sender.id} "<your reply>"`
}
async function postJSON(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${apiBase()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch { /* best-effort: backend may be down; the next heartbeat / TTL reconciles */ }
}
export const reportWatch = (token: string, watcher: string, selectors: string[], ttlMs: number): Promise<void> =>
  postJSON('/api/sessions/graph/watch', { token, watcher, selectors, ttlMs })
export const reportUnwatch = (token: string): Promise<void> => postJSON('/api/sessions/graph/unwatch', { token })

// matched by NAME, not instanceof, so this module never imports client.ts at runtime (client.ts imports
// apiBase from here — the back-import would be a cycle).
export const isBackendDown = (e: unknown): boolean => e instanceof Error && e.name === 'BackendError'

const slugify = (s: string | null) => (s || 'session').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'session'

// the FIRST `@<id>` that begins a word. The optional leading dot is load-bearing: without `\.?` here
// `@.config` (a dot-prefixed config root) would capture nothing and never resolve to a node.
const MENTION = /(?:^|\s)@(\.?[A-Za-z0-9_-]+)/
const mentionedNode = (prompt: string): string | null => prompt.match(MENTION)?.[1] ?? null
function titleFromPrompt(prompt: string): string | null {
  const first = (prompt || '').trim().split('\n')[0].trim()
  const words = first.split(/\s+/).filter(Boolean).slice(0, 7).join(' ')
  if (!words) return null
  return words.length > 50 ? words.slice(0, 49).trimEnd() + '…' : words
}

const HIDE_CLAUDE_MD = process.env.SPEXCODE_HIDE_CLAUDE_MD !== '0' && process.env.SPEXCODE_HIDE_CLAUDE_MD !== 'false'
async function hideClaudeMd(path: string): Promise<void> {
  if (!HIDE_CLAUDE_MD) return
  const src = join(path, 'CLAUDE.md')
  if (!existsSync(src)) return
  try {
    // pin the tracked path assume-unchanged FIRST, so the rename's deletion is never seen by git.
    await gitA(['-C', path, 'update-index', '--assume-unchanged', 'CLAUDE.md'])
    renameSync(src, join(runtimeDir(path), 'claude.md'))
  } catch { /* isolation is best-effort; a failure must not block the launch */ }
}

// the spec-first PreToolUse hook keys on its OWN sentinel file so it never races mark-active's
// `.session/state` write. Hook commands use MAIN's tsx+cli by absolute path ($SPEX) since a fresh worktree
// has no node_modules. The idle command keys on the structured `notification_type` field, not the blob.
function settingsJson(): string {
  const root = pkgRoot()
  const gate = join(root, 'hooks', 'stop-gate.sh')
  const markCmd = `bash ${join(root, 'hooks', 'mark-active.sh')}`
  const specFirstCmd = `bash ${join(root, 'hooks', 'spec-first.sh')}`   // one-shot read-the-spec nudge (sessions/spec-first)
  const spex = `${join(root, 'node_modules', '.bin', 'tsx')} ${join(root, 'src', 'cli.ts')}`
  const specOfFileCmd = `SPEX='${spex}' bash ${join(root, 'hooks', 'spec-of-file.sh')}`   // per-edit, once-per-file: name the governing spec (sessions/spec-first)
  const idleCmd = `p=$(cat); case "$p" in *'"notification_type":"idle_prompt"'*) ${spex} session idle ;; esac`
  const hooks: Record<string, unknown> = {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: markCmd }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: markCmd }, { type: 'command', command: specFirstCmd }] }],
    PostToolUse: [{ hooks: [{ type: 'command', command: specOfFileCmd }] }],
    Stop: [{ hooks: [{ type: 'command', command: `SPEX='${spex}' bash ${gate}` }] }],
    StopFailure: [{ hooks: [{ type: 'command', command: `${spex} session fail` }] }],
    Notification: [{ hooks: [{ type: 'command', command: idleCmd }] }],
  }
  return JSON.stringify({ hooks }, null, 2)
}
// write the hooks file into the worktree and return the `--settings <file>` arg (no shell-quoting hazard).
function writeSettings(path: string): string {
  const file = join(runtimeDir(path), 'hooks.json')
  writeFileSync(file, settingsJson())
  return `--settings ${file}`
}
// the whole launch invocation is written to a file and run via `bash <file>`, not typed inline: send-keys
// truncates past ~2KB and the system-prompt gather can be arbitrarily large, so only the short `bash <file>`
// line is typed.
function launchScript(id: string, path: string, tail: string): string {
  const file = join(runtimeDir(path), 'launch.sh')
  writeFileSync(file, `${rvEnv(id)} ${CLAUDE_CMD} ${appendSysArg()} ${writeSettings(path)} ${tail}\n`)
  return file
}
async function launch(id: string, path: string, tail: string): Promise<void> {
  await tmux(['new-session', '-d', '-s', id, '-x', String(COLS), '-y', String(ROWS), '-c', path])
  await tmux(['send-keys', '-t', id, '-l', '--', `bash ${launchScript(id, path, tail)}`])
  await tmux(['send-keys', '-t', id, 'Enter'])
  launchedAt.set(id, Date.now())   // stamp the boot window so reconcile reads 'starting', not 'offline', until the socket is up
}

// a directive is anchored at the prompt start and carries an @<target>, so it wins over the plain first-@
// mention; `rest` is the human's own text after it.
//   @new under @<parentId>: <describe the node>   → create a placeholder child, agent names+specs+codes it
//   @delete @<nodeId>: <why / guidance>            → remove the node's dir, agent refactors per git history
type Directive = { kind: 'new'; targetId: string; rest: string } | { kind: 'delete'; targetId: string; rest: string }
const NEW_OP = /^\s*@new\b[^\n@]*@([A-Za-z0-9_-]+)\s*:?\s*/i
const DEL_OP = /^\s*@delete\b[^\n@]*@([A-Za-z0-9_-]+)\s*:?\s*/i
function parseDirective(prompt: string): Directive | null {
  let m = prompt.match(NEW_OP); if (m) return { kind: 'new', targetId: m[1], rest: prompt.slice(m[0].length).trim() }
  m = prompt.match(DEL_OP); if (m) return { kind: 'delete', targetId: m[1], rest: prompt.slice(m[0].length).trim() }
  return null
}

// find a spec node's directory inside a worktree's .spec tree (id = dir basename, the node-identity rule).
function findNodeDir(specRoot: string, nodeId: string): string | null {
  if (!existsSync(specRoot)) return null
  const stack = [specRoot]
  while (stack.length) {
    const dir = stack.pop()!
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue
      const child = join(dir, e.name)
      if (e.name === nodeId && existsSync(join(child, 'spec.md'))) return child
      stack.push(child)
    }
  }
  return null
}

// a lint-clean placeholder spec.md: minimal valid frontmatter + a two-part body, NO `code:` list (an
// empty governed-files list keeps `spex lint` integrity at 0 errors). The agent replaces it wholesale.
function placeholderSpec(id: string, sessionId: string): string {
  return [
    '---', `title: ${id}`, 'status: pending', 'hue: 210',
    'desc: placeholder — to be named and specified by the dispatched session.',
    `session: ${sessionId}`, '---', `# ${id}`, '',
    '## raw source', '',
    'Placeholder node. The dispatched session replaces this with the real human intent, renames the',
    'directory to a proper id, and writes the matching spec and code.', '',
    '## expanded spec', '',
    'Pending — authored by the dispatched session.', '',
  ].join('\n')
}
// create the placeholder child under <parentId> (or the .spec root if the parent isn't in this worktree).
// returns the new spec.md path relative to the worktree, for the agent prompt.
function createPlaceholder(wtPath: string, parentId: string, placeholderId: string, sessionId: string): string {
  const specRoot = join(wtPath, '.spec')
  const parentDir = findNodeDir(specRoot, parentId) || specRoot
  const dir = join(parentDir, placeholderId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'spec.md'), placeholderSpec(placeholderId, sessionId))
  return relative(wtPath, join(dir, 'spec.md'))
}
// remove a node's whole directory (its subtree). Returns the deleted spec.md's worktree-relative path
// (so the agent can `git log --follow` it), or null when the node isn't present in this worktree.
function removeNode(wtPath: string, nodeId: string): string | null {
  const dir = findNodeDir(join(wtPath, '.spec'), nodeId)
  if (!dir) return null
  const rel = relative(wtPath, join(dir, 'spec.md'))
  rmSync(dir, { recursive: true, force: true })
  return rel
}

function newNodePrompt(placeholderId: string, parentId: string, relPath: string, rest: string): string {
  return `A placeholder spec node \`${placeholderId}\` was created under parent \`${parentId}\` at ${relPath} in this worktree. ` +
    `Turn it into a real node and build it, per this request:\n\n${rest || '(no extra description — infer the intent from the parent and the codebase)'}\n\n` +
    `1. Choose a good kebab-case id reflecting the intent (node id = its directory basename) and \`git mv\` the directory \`${dirname(relPath)}\` to it, keeping it under \`${parentId}\`. ` +
    `2. Rewrite spec.md at contract altitude: real title/desc, the two-part body (raw source = human intent · expanded spec = behavioral contract), and a \`code:\` list of the files it will govern. ` +
    `3. Implement the code the spec describes. 4. Keep \`spex lint\` at 0 errors and the build green. ` +
    `When it's ready, propose merge for the human to review — do NOT merge it yourself.`
}
function deleteNodePrompt(nodeId: string, relPath: string | null, rest: string): string {
  const recover = relPath
    ? `Recover what it was: \`git log --follow -- ${relPath}\` then \`git show\` the relevant commits to read its old spec and the \`code:\` files it governed.`
    : `The node's spec.md wasn't found in the tree; recover what \`${nodeId}\` was from git history (\`git log\` / \`git show\`).`
  return `The spec node \`${nodeId}\` has been intentionally DELETED (its directory removed) in this worktree. ` +
    `Make the codebase consistent without it, per this request:\n\n${rest || '(no extra guidance — use your judgement)'}\n\n` +
    `1. ${recover} ` +
    `2. Decide what happens to that governed code now the spec is gone — remove it, fold it into another node's responsibility, or re-point references — and fix any specs that linked \`[[${nodeId}]]\`. ` +
    `3. Apply the refactor; keep \`spex lint\` at 0 errors and the build green. ` +
    `When it's ready, propose merge for the human to review — do NOT merge it yourself.`
}

// a slot is COMPUTE pressure: only a genuinely live agent that is `working` or self-resuming `parked` holds
// one; everything waiting on the human (idle/asking/proposals) frees it, like offline/queued.
const OCCUPIES_SLOT = new Set<DisplayStatus>(['working', 'parked', 'starting'])  // starting's boot window is also held via `launching`
function isOccupying(s: Session, live: Set<string>): boolean {
  if (!OCCUPIES_SLOT.has(s.status)) return false                          // waiting-on-human / proposed / queued / dead → free
  return live.has(s.id) && existsSync(rvSock(s.id))                       // and only while its claude is genuinely live
}
// sessions we've JUST launched whose rendezvous socket hasn't come up yet. During that boot window reconcile
// reads them `offline` (socket absent) and isOccupying would miss them, so the drainer would over-launch and
// blow past the cap. We hold the slot here from launch until the socket appears (waitForSocket) or times out.
// In-memory in the single server process (the only drainer) — lost on restart, which is fine: a restart drains
// the durable `queued` worktrees fresh with nothing in flight.
const launching = new Set<string>()
let draining = false   // re-entrancy guard: only one drain pass runs at a time (no double-launch)

// launch a prepared `queued` worktree: feed it its parked launch prompt, flip it to active. Returns false
// (leaving it queued, to be retried next drain) if the worktree/prompt is gone or the tmux launch threw.
async function startQueued(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  const launchPrompt = readLaunchFile(wt.path)
  if (launchPrompt == null) return false   // a queued session always has one; if it's gone, don't spin on it
  launching.add(id)   // hold the slot across the boot window BEFORE we launch, so a concurrent count can't race us
  try {
    const sq = `'${launchPrompt.replace(/'/g, `'\\''`)}'`
    await launch(id, wt.path, `--session-id ${id} ${sq}`)
  } catch {
    launching.delete(id)
    return false   // launch failed → stays `queued`, retried on the next drain tick
  }
  writeSessionFile(wt.path, { ...wt.rec, status: 'active', proposal: null })
  removeLaunchFile(wt.path)   // consumed
  // release the boot-window hold once the socket is up (then isOccupying takes over) or after the bounded
  // wait — so a launch that never booted reads offline and the drainer reclaims the slot instead of pinning it.
  void waitForSocket(id).finally(() => launching.delete(id))
  return true
}

// start as many `queued` sessions as there are free slots, oldest first. Re-lists each iteration so a
// freshly launched session (held in `launching`) counts immediately and we never exceed the cap.
export async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const cap = maxActive()   // read once per drain pass (spexcode.json → env → 6); won't shift mid-burst
    for (;;) {
      const [sessions, live] = await Promise.all([listSessions(), liveTmux()])
      const occupied = sessions.reduce((n, s) => n + (launching.has(s.id) || isOccupying(s, live) ? 1 : 0), 0)
      if (occupied >= cap) break
      const next = sessions.find((s) => s.status === 'queued' && !launching.has(s.id))
      if (!next) break
      if (!(await startQueued(next.id))) break   // launch failed → stop this pass; a later tick retries
    }
  } finally { draining = false }
}

// the periodic drainer (started once at serve()) catches frees the server never sees directly: an agent
// proposing done/parked from a hook subprocess, or a crash that just makes a socket vanish.
let supervisingQueue = false
export function superviseQueue(intervalMs = 3000): void {
  if (supervisingQueue) return
  supervisingQueue = true
  const tick = async () => {
    try { await drainQueue() } catch { /* transient git/tmux hiccup; next tick retries */ }
    setTimeout(tick, intervalMs)
  }
  void tick()
}

export async function createSession(node: string | null, prompt: string): Promise<Session> {
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node, prompt }),
    })
  } catch {
    console.error('spex: no backend reachable — launching in-process (caller env owns auth, no concurrency cap)')
    return newSession(node, prompt)
  }
  if (!res.ok) throw new Error(`backend rejected session (${res.status}): ${await res.text().catch(() => '')}`)
  return await res.json() as Session
}

export async function newSession(node: string | null, prompt: string): Promise<Session> {
  const id = randomUUID()
  const directive = parseDirective(prompt)
  // node identity + label: a delete targets an existing node (link it); a new op has no id yet so it's
  // labeled by the human's text; otherwise explicit --node wins, else the prompt's first @-mention.
  const ref = directive?.kind === 'delete' ? directive.targetId
    : directive?.kind === 'new' ? null
    : (node || mentionedNode(prompt))
  const title = ref ? null : titleFromPrompt(directive?.rest ?? prompt)
  const slug = `${slugify(ref || title || (directive ? `${directive.kind}-node` : null))}-${id.slice(0, 4)}`
  const branch = `node/${slug}`
  const path = join(mainRoot(), '.worktrees', slug)
  await gitA(['-C', mainRoot(), 'worktree', 'add', '-b', branch, path, mainBranch()])
  // prepared but NOT launched: enters the queue as `queued`. drainQueue() below launches it at once when a
  // slot is free, else it waits — durable as a worktree, so it survives a backend restart and is still findable.
  const rec: SessRec = { node: ref || null, title, name: null, session: id, status: 'queued', proposal: null, merges: 0, note: null, sortKey: null }
  writeSessionFile(path, rec)
  writePromptFile(path, prompt)   // capture the ORIGINATING prompt (the human/manager's ask) as sidecar metadata (best-effort)
  await hideClaudeMd(path)   // isolate the dispatched agent from the project CLAUDE.md (before launch)
  // perform the directive's spec-tree mutation in the worktree, then PARK the finish-the-op prompt for launch.
  // the mutation is uncommitted, so the board's overlay shows it instantly (added ghost / deleted mark) even
  // while the session only sits queued.
  let launchPrompt = prompt
  if (directive?.kind === 'new') {
    const placeholderId = `untitled-${id.slice(0, 4)}`
    const relPath = createPlaceholder(path, directive.targetId, placeholderId, id)
    launchPrompt = newNodePrompt(placeholderId, directive.targetId, relPath, directive.rest)
  } else if (directive?.kind === 'delete') {
    launchPrompt = deleteNodePrompt(directive.targetId, removeNode(path, directive.targetId), directive.rest)
  } else if (ref) {
    // ref named an EXISTING node: append one line pointing the agent at its spec.md (absolute path inside its
    // own worktree, so it reads the live file). An unknown id resolves to nothing — fail quiet, no pointer.
    const spec = (await loadSpecs()).find((n) => n.id === ref)
    if (spec) launchPrompt = `${prompt}\n\nThe spec node \`${ref}\` is your ground truth — read its spec at ${join(path, spec.path)}.`
  }
  writeLaunchFile(path, launchPrompt)   // park the exact launch prompt for the drainer (consumed at launch)
  await drainQueue()                    // launch now if under the cap, else leave it queued for a free slot
  const after = readSessionFile(path)   // 'active' if the drain launched it, else still 'queued'
  // queued → no process yet (offline liveness); just-launched → its socket is still booting (starting).
  const queued = after.status === 'queued'
  return toSession(after, branch, path, queued ? 'queued' : 'working', queued ? 'offline' : 'starting')
}

// poll for the resumed claude's rendezvous socket up to a bounded timeout, so a follow-on dispatch hits a
// live socket instead of racing the boot. A dead agent never creates it → the caller's later check fails loud.
const SOCKET_READY_TIMEOUT_MS = 15000
const SOCKET_POLL_MS = 200
async function waitForSocket(id: string, timeoutMs = SOCKET_READY_TIMEOUT_MS): Promise<boolean> {
  const sock = rvSock(id)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(sock)) return true
    await new Promise((r) => setTimeout(r, SOCKET_POLL_MS))
  }
  return existsSync(sock)
}

export async function reopen(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, status: 'active', proposal: null })
  if (!(await alive(id)) || !existsSync(rvSock(id))) {
    await tmuxOk(['kill-session', '-t', id])   // drop a dead/socketless pane if any (no-op when none)
    await launch(id, wt.path, `--resume ${id}`)
    await waitForSocket(id)   // a relaunched agent is "ready" only once its rendezvous socket is up
  }
  return true
}

// agent/human PROPOSAL → awaiting (review = propose merge, done = nothing, close-pending = propose close).
export async function propose(id: string, proposal: Proposal): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, status: 'awaiting', proposal })
  void drainQueue()   // a proposal frees this session's slot — start the next queued one if any
  return true
}
export function markStateFromCwd(status: Lifecycle, opts: { proposal?: Proposal; note?: string } = {}): boolean {
  const rec = readSessionFile(process.cwd())
  if (!rec.session) return false
  writeSessionFile(process.cwd(), {
    ...rec, status,
    proposal: status === 'awaiting' ? (opts.proposal ?? 'nothing') : null,
    note: opts.note ?? null,
  })
  return true
}
export const markDoneFromCwd = (proposal: Proposal = 'nothing') => markStateFromCwd('awaiting', { proposal })
export const markErrorFromCwd = () => markStateFromCwd('error')
export function markIdleFromCwd(): boolean {
  const rec = readSessionFile(process.cwd())
  if (!rec.session || rec.status !== 'active') return false  // active-only: never clobber a declaration
  writeSessionFile(process.cwd(), { ...rec, status: 'idle' })
  return true
}
// legacy flat runtime files (pre runtime-dir refactor) — still recognised so an in-flight worktree's
// sidecars never count as real work; drop this set once no flat-layout session remains.
const LEGACY_RUNTIME = new Set(['.session', '.session-prompt', '.session-launch', '.spex-hooks.json', '.spex-launch.sh', 'CLAUDE.spexhidden.md'])
// is this `git status` path one of SpexCode's own runtime artifacts (the whole `.session/` dir, or a
// legacy flat sidecar) rather than the agent's spec/code work? Belt-and-suspenders to .gitignore — an
// adopted project's ignore list may differ, so the gate filters by path, not just by tracking state.
function isRuntimePath(p: string): boolean {
  return p === RUNTIME_DIR || p.startsWith(RUNTIME_DIR + '/') || LEGACY_RUNTIME.has(p)
}
export function mergeReadiness(): { ready: boolean; reason?: string } {
  let dirty: string[] = []
  try {
    dirty = git(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean)
      .map(porcelainPath).filter((p) => !isRuntimePath(p))
  } catch { /* git status failed — fall through to the ahead check, still a real guard */ }
  if (dirty.length) {
    const shown = dirty.slice(0, 8).join(', ') + (dirty.length > 8 ? ', …' : '')
    return { ready: false, reason: `uncommitted changes on your node branch (${shown}) — commit your spec+code first` }
  }
  let ahead = 0
  const base = mainBranch()
  try { ahead = Number(git(['rev-list', '--count', `${base}..HEAD`]).trim()) || 0 } catch { ahead = 0 }
  if (ahead === 0) return { ready: false, reason: `your node branch is 0 commits ahead of ${base} — nothing is committed to merge` }
  return { ready: true }
}

// the path a `git status --porcelain` line refers to: strip the `XY ` status, and for a rename keep the
// NEW path (after ` -> `). Shared by the dirty-file counters (mergeReadiness above, reviewPayload below).
function porcelainPath(line: string): string {
  let p = line.slice(3)
  const arrow = p.indexOf(' -> '); if (arrow >= 0) p = p.slice(arrow + 4)
  return p
}

export type ReviewGates = {
  conflictsWithMain: boolean                       // a dry-run merge into main would conflict (in-memory, safe)
  typecheck: { ok: boolean; errorCount: number }   // `tsc --noEmit` on the CLI package
  lint: { errorCount: number; warningCount: number } // the spec↔code graph lint
}
export type ReviewPayload = {
  id: string; node: string | null; branch: string | null
  ahead: number              // commits the node branch is ahead of main
  dirtyNonRuntime: number    // uncommitted files excluding SpexCode's own runtime files
  diff: ReviewDiffFile[]     // the worker's real changes, anchored at the merge-base
  gates: ReviewGates
  proposal: { kind: Proposal | null; note: string | null }   // the session's standing proposal + its note
}

// `tsc --noEmit` on the CLI package; a spawn failure (no node_modules) resolves ok:false / 0 errors — a
// loud "couldn't typecheck", never a false green.
function typecheckPkg(): Promise<{ ok: boolean; errorCount: number }> {
  const root = pkgRoot()
  const tsc = join(root, 'node_modules', '.bin', 'tsc')
  return new Promise((resolve) => {
    execFile(tsc, ['--noEmit'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 24 }, (err, stdout) => {
      const out = (stdout || '') + (err && (err as unknown as { stdout?: string }).stdout || '')
      resolve({ ok: !err, errorCount: (out.match(/error TS\d+/g) || []).length })
    })
  })
}

export async function reviewPayload(id: string): Promise<ReviewPayload | null> {
  const wt = await findWorktree(id)
  if (!wt) return null
  const { specLint } = await import('./lint.js')
  const base = mainBranch()
  const [aheadOut, statusOut, diff, conflictsWithMain, typecheck, findings] = await Promise.all([
    gitA(['-C', wt.path, 'rev-list', '--count', `${base}..HEAD`]),
    gitA(['-C', wt.path, 'status', '--porcelain', '--untracked-files=all']),
    mergeBaseDiff(wt.path, base),
    mergeConflicts(wt.path, base),
    typecheckPkg(),
    specLint(),
  ])
  const dirtyNonRuntime = statusOut.split('\n').filter(Boolean)
    .map(porcelainPath).filter((p) => !isRuntimePath(p)).length
  return {
    id, node: wt.rec.node, branch: wt.branch,
    ahead: Number(aheadOut.trim()) || 0,
    dirtyNonRuntime, diff,
    gates: {
      conflictsWithMain, typecheck,
      lint: {
        errorCount: findings.filter((f) => f.level === 'error').length,
        warningCount: findings.filter((f) => f.level === 'warn').length,
      },
    },
    proposal: { kind: wt.rec.proposal, note: wt.rec.note },
  }
}

function mergePrompt(mainPath: string, branch: string, reason: string): string {
  const base = mainBranch()
  return `Merge your branch \`${branch}\` into \`${base}\`, then propose close. You know this work, so resolve any conflicts yourself.\n\n` +
    `1. Merge from the main checkout with a no-ff merge commit:\n   git -C ${mainPath} merge --no-ff -m "merge ${branch}: ${reason}" ${branch}\n` +
    `2. If it conflicts, resolve the conflicts (you know the intent) and complete the merge commit. ` +
    `3. Verify it landed: \`${base}\`'s HEAD must now be the new merge commit and no merge may be left in progress — if anything went half-merged, run \`git -C ${mainPath} merge --abort\` and report it rather than leaving \`${base}\` mid-state. ` +
    `4. Once you've verified \`${base}\` advanced cleanly, propose close for the human — do NOT close it yourself.`
}

// reason = the node branch's latest commit subject minus a leading `spec: ` (read from the main checkout).
export async function mergeSession(id: string): Promise<{ dispatched: boolean; reason?: string }> {
  const wt = await findWorktree(id)
  if (!wt || !wt.branch) return { dispatched: false, reason: 'no such session' }
  const branch = wt.branch, main = mainRoot()
  if (!(await reopen(id))) return { dispatched: false, reason: 'could not reopen session' }
  const subject = (await gitA(['-C', main, 'log', '-1', '--format=%s', branch])).trim()
  const reason = subject.replace(/^spec:\s+/, '') || branch
  const r = await sendKeys(id, mergePrompt(main, branch, reason))
  if (!r.ok) return { dispatched: false, reason: r.error }
  return { dispatched: true }
}

// shared kill path for exit+close. The rendezvous socket lives in the OS tmpdir (not the worktree), so unlink
// it here or closing sessions leaks stale sock files. Does NOT drainQueue — the caller drains once, after.
async function stopAgentProcess(id: string): Promise<void> {
  await tmuxOk(['kill-session', '-t', id])
  launchedAt.delete(id)
  try { rmSync(rvSock(id), { force: true }) } catch { /* best-effort sweep; tmpdir socket, claude/OS may already be gone */ }
}

export async function exitSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await stopAgentProcess(id)
  void drainQueue()   // an exit frees a slot — start the next queued session if any
  return !!wt
}

export async function closeSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await stopAgentProcess(id)
  if (wt) {
    await gitA(['-C', mainRoot(), 'worktree', 'remove', '--force', wt.path])
    if (wt.branch) await gitA(['-C', mainRoot(), 'branch', '-D', wt.branch])
  }
  void drainQueue()   // a close frees a slot — start the next queued session if any
  return !!wt
}

// the known-vs-offline check only runs on the cold/not-alive branch, so a live capture costs one capture-pane.
export type CaptureResult = { ok: true; pane: string } | { ok: false; reason: 'unknown' | 'offline' | 'capture-failed' }
export async function captureSessionResult(id: string): Promise<CaptureResult> {
  if (!(await alive(id))) {
    const known = (await listSessions()).some((s) => s.id === id)
    return { ok: false, reason: known ? 'offline' : 'unknown' }
  }
  try { return { ok: true, pane: await tmux(['capture-pane', '-e', '-p', '-t', id]) } }
  catch { return { ok: false, reason: 'capture-failed' } }
}

export const STATUS_GLYPH: Record<DisplayStatus, string> = {
  working: '\u25cf', idle: '\u25cb', offline: '\u23fb', starting: '\u25d4', review: '\u25c6', done: '\u2713',
  'close-pending': '\u2715', parked: '\u29d6', error: '\u2717', asking: '\u2370', queued: '\u25cc',
}
const ANSI: Record<DisplayStatus, string> = {
  working: '33', idle: '90', offline: '90', starting: '36', review: '35', done: '34', 'close-pending': '31', parked: '36', error: '31', asking: '93', queued: '90',
}

export function matchesSelector(s: Session, q: string): boolean {
  return s.id === q || s.id.startsWith(q) || s.node === q || s.branch === q
}

// no selectors (or '@all') = everything. Optional status filter on top. This IS the ls/watch subscription.
export function selectSessions(all: Session[], selectors: string[], statuses?: string[]): Session[] {
  let out = all
  const sel = selectors.filter((x) => x && x !== '@all')
  if (sel.length) out = out.filter((s) => sel.some((q) => matchesSelector(s, q)))
  if (statuses && statuses.length) out = out.filter((s) => statuses.includes(s.status))
  return out
}

// an exact full-id hit wins outright (never reported ambiguous just for prefixing a longer id).
export type Resolved = { ok: Session } | { ambiguous: Session[] } | { none: true }
export function resolveSession(selector: string, sessions: Session[]): Resolved {
  const exact = sessions.find((s) => s.id === selector)
  if (exact) return { ok: exact }
  const hits = sessions.filter((s) => matchesSelector(s, selector))
  if (hits.length === 1) return { ok: hits[0] }
  return hits.length ? { ambiguous: hits } : { none: true }
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '\u2026' : s)
// short display label per status (only close-pending differs from the status name) \u2014 used by the legend.
const SHORT: Partial<Record<DisplayStatus, string>> = { 'close-pending': 'close' }

// built from STATUS_GLYPH so the legend can never drift from the glyphs the table actually prints.
export function statusLegend(color = true): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const parts = (Object.keys(STATUS_GLYPH) as DisplayStatus[]).map(
    (k) => `${c(ANSI[k], STATUS_GLYPH[k])} ${SHORT[k] || k}`,
  )
  return c('90', '  key: ') + parts.join('  ')
}

// human-friendly aligned table: header + (glyph + colour + status + name + id + merges + note) rows +
// a status legend, so the table tells the whole story (incl. each agent's note) at a glance.
export function formatTable(sessions: Session[], color = true): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  if (!sessions.length) return c('90', '  no living sessions')
  const header = c('90', `    ${'STATUS'.padEnd(13)} ${'NODE'.padEnd(22)} ${'ID'.padEnd(8)} ${'\u00d7'.padEnd(4)}${'PROMPT'.padEnd(42)}NOTE`)
  const rows = sessions.map((s) => {
    const g = STATUS_GLYPH[s.status] ?? '\u00b7'
    const code = ANSI[s.status] ?? '0'
    const name = sessionLabel(s).slice(0, 22).padEnd(22)
    const st = s.status.padEnd(13)
    const merges = (s.merges ? `\u00d7${s.merges}` : '').padEnd(4)
    const prompt = c('90', (s.promptPreview ? trunc(s.promptPreview, 40) : '').padEnd(42))   // what it was asked to do
    const note = s.note ? c('90', trunc(s.note, 50)) : ''
    return `  ${c(code, g)} ${c(code, st)} ${name} ${c('90', s.id.slice(0, 8))} ${merges}${prompt}${note}`
  })
  return [c('1', `SpexCode sessions (${sessions.length})`), header, ...rows, statusLegend(color)].join('\n')
}

const WATCH_ACTIONABLE = new Set<DisplayStatus>(['review', 'done', 'close-pending', 'offline', 'error', 'asking'])
const NEXT: Record<string, string> = {
  review: 'merge | reopen(back-to-working) | close',
  done: 'merge | reopen | close',
  'close-pending': 'close | reopen',
  offline: 'reopen (relaunch & resume)',
  error: 'reopen (relaunch & retry) | capture | close',
  asking: 'send "<msg>" | capture',
  idle: 'send "<msg>" | capture',
  queued: 'waiting for a free slot — starts automatically | close',
}
export function sessionEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] ${s.status} · ${sessionLabel(s)} — act: ${NEXT[s.status] || '—'}${note}${asked}  [id ${s.id}]`
}
export function launchEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] launched · ${sessionLabel(s)} — act: capture | send "<msg>"${note}${asked}  [id ${s.id}]`
}
// `source` is REQUIRED (no local default): a forgotten source must be a compile error, never a silent
// in-process read of the wrong (local) board.
export type WatchOpts = { source: () => Promise<Session[]>; selectors?: string[]; statuses?: string[]; includeIdle?: boolean; intervalMs?: number; as?: string; until?: { timeoutMs: number } }
// only the BOUNDED `until` mode resolves (what `spex wait` runs); a plain watch streams forever.
export type WatchOutcome = { reached: DisplayStatus } | { timedOut: true } | { gone: true } | { backendDown: string }
export async function watchSessions(emit: (line: string) => void, opts: WatchOpts): Promise<WatchOutcome> {
  const { source, selectors = [], statuses, includeIdle = false, intervalMs = 5000, as, until } = opts
  const tag = as ? `[${as}] ` : ''
  const prev = new Map<string, DisplayStatus>()
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // the no-hang wall: a fixed deadline computed ONCE, checked unconditionally every iteration below.
  const deadline = until ? Date.now() + Math.max(1000, until.timeoutMs) : 0
  const isActionable = (st: DisplayStatus) => WATCH_ACTIONABLE.has(st) || (includeIdle && st === 'idle')
  let warnedDown = false
  for (;;) {
    try {
      // EXISTENCE is the selector-matched board across ALL statuses — listSessions now lists every worktree
      // that exists (a transient detail-read failure degrades a row, never drops it — see guardWorktree), so
      // membership here IS the worktree's existence. The `statuses` filter governs only which TRANSITIONS we
      // emit, never whether a session is present — using it for presence would read a status change out of the
      // filtered set as a (false) removal.
      const all = selectSessions(await source(), selectors)
      warnedDown = false   // a successful poll re-arms the down-warning, so a recovered-then-redowned backend warns again
      const ids = new Set(all.map((s) => s.id))
      const passesStatus = (st: DisplayStatus) => !statuses?.length || statuses.includes(st)
      for (const s of all) {
        if (!prev.has(s.id)) emit(tag + launchEvent(s)) // FIRST sighting → launched, any status (incl. 'working'), once
        if (s.status === prev.get(s.id)) continue // only on transition, not every tick
        prev.set(s.id, s.status)
        if (passesStatus(s.status) && (WATCH_ACTIONABLE.has(s.status) || (includeIdle && s.status === 'idle'))) emit(tag + sessionEvent(s))
      }
      // an id absent from the board = its worktree is gone (listSessions degrades a flaky read, never drops),
      // a definitive removal → emit `closed` once, no debounce.
      for (const id of [...prev.keys()]) {
        if (ids.has(id)) continue
        prev.delete(id)
        emit(`${tag}[spex] closed \u00b7 removed  [id ${id}]`)
      }
      // BOUNDED mode (`until`, what `spex wait` runs): return the moment a watched target is actionable; an empty selected set
      // means the target is gone (absent from the board), which it can never come back from. Both sit inside
      // the try, after the emit pass, so the caller still saw every transition before we hand control back.
      if (until) {
        const hit = all.find((s) => isActionable(s.status))
        if (hit) return { reached: hit.status }
        if (!all.length) return { gone: true }
      }
    } catch (e) {
      // a backend-down poll must NOT be swallowed as a transient hiccup AND must NOT emit a false `closed`
      // for every session: we skip the tick (prev is untouched → no phantom removals) and warn ONCE, loudly,
      // so a manager sees the stream is blind rather than reading silence as "all sessions fine".
      if (until && isBackendDown(e)) return { backendDown: (e as Error).message }   // a bounded wait fails loud, never a false timeout
      if (isBackendDown(e) && !warnedDown) { warnedDown = true; console.error(`${tag}[spex] watch: ${(e as Error).message}; retrying every ${intervalMs / 1000}s…`) }
    }
    // the HARD wall — checked every iteration, in EVERY state, even after a thrown poll, BEFORE the sleep:
    // this is what guarantees `spex wait` can never hang on a worker stuck outside WATCH_ACTIONABLE.
    if (until && Date.now() >= deadline) return { timedOut: true }
    await sleep(intervalMs)
  }
}

export async function sendKeys(id: string, text: string, from?: string): Promise<DispatchResult> {
  if (!text) return { ok: false, error: 'empty prompt — nothing to dispatch' }
  const sock = rvSock(id)
  if (!existsSync(sock)) return { ok: false, error: `no rendezvous control socket for session ${id} (socketless/old session, or the agent is offline) — prompt NOT delivered` }
  const r = await replyViaSocket(sock, text)
  // record the delivered agent-to-agent message ([[comms-edge]]): only when it carries a sender (an agent
  // send, not a raw human dispatch) and actually landed. Fire-and-forget — never gates the send result.
  if (r.ok && from) void recordComms(id, from)
  return r
}

// the raw-keystroke nav channel — single keys to drive an interactive TUI menu (e.g. `/model`'s list), one
// per call. Named keys map to tmux key names; a bare printable char is sent literally (`-l`) so tmux doesn't
// reinterpret it; a C-/M-/S- combo is passed unescaped so tmux parses it.
const TMUX_KEY: Record<string, string> = {
  Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Space: 'Space', Backspace: 'BSpace',
  Home: 'Home', End: 'End', Delete: 'DC',
}
// tmux honours an `S-` (shift) modifier ONLY on these named keys; on Enter/Space/BSpace it would send the
// literal text "S-Enter" etc. (and shift is a no-op there anyway), so a stray S- is dropped. Shift+Tab is
// the named exception: tmux spells it `BTab` (back-tab → ESC[Z, what Claude Code's mode-cycle reads).
const SHIFTABLE = new Set(['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'DC'])
export async function rawKey(id: string, key: string): Promise<boolean> {
  if (!key || !(await alive(id))) return false
  // peel the optional C-/M-/S- modifier prefixes (each at most once, in any order) off the front; the
  // remainder is the BASE key. The frontend only ever sends {C-,M-,S-} prefixes + a named key or one char.
  let rest = key, prefix = ''
  const seen = new Set<string>()
  while (rest.length >= 2 && (rest[0] === 'C' || rest[0] === 'M' || rest[0] === 'S') && rest[1] === '-' && !seen.has(rest[0])) {
    seen.add(rest[0]); prefix += rest.slice(0, 2); rest = rest.slice(2)
  }
  const named = TMUX_KEY[rest]
  if (named) {
    const noShift = prefix.replace('S-', '')   // C-/M- without the shift bit
    let token: string
    if (prefix.includes('S-') && named === 'Tab') token = noShift + 'BTab'              // Shift+Tab → back-tab
    else if (prefix.includes('S-') && !SHIFTABLE.has(named)) token = noShift + named     // tmux can't carry S- here
    else token = prefix + named
    await tmux(['send-keys', '-t', id, token]); return true
  }
  if ([...rest].length === 1) {
    // a single printable char: bare → literal (`-l`, so tmux never reinterprets it as a key name);
    // modified → hand tmux the `C-`/`M-`/`S-` combo to parse (e.g. `C-a`), which `-l` would defeat.
    if (prefix) { await tmux(['send-keys', '-t', id, prefix + rest]); return true }
    await tmux(['send-keys', '-t', id, '-l', '--', rest]); return true
  }
  return false
}
