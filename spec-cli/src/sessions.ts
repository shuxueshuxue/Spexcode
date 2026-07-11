import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, mkdirSync, rmSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { join, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedWorktreeHostState } from './worktree-sources.js'
import { git, gitA, gitTry, repoRoot, mergeBaseDiff, mergeConflicts, type ReviewDiffFile } from './git.js'
import { loadSpecs } from './specs.js'
import { defaultHarness, defaultLauncher, harnessById, resolveLauncher, rvSock, rendezvousListening, type Harness, type DispatchResult, type PaneProbe, type ProcTable } from './harness.js'
import { materialize } from './materialize.js'
import { mainBranch, gitCommonDir, readConfig, runtimeRoot, treeSlotDir, sessionStoreDir, sessionRecordPath, sessionArtifactPath, listSessionIds, readAliasedRawRecord, envSessionId, type RawRecord } from './layout.js'
import { stripRefSigil } from './mentions.js'

// @@@ sessions - the WORKTREE is the durable unit; tmux is a disposable runtime handle. The per-session
// SOURCE OF TRUTH is an untracked record (`session.json`) in a per-user GLOBAL store keyed by the harness
// session_id (NOT a worktree file — the worktree stays pristine), surviving a kill / reboot / moving the
// folder. We launch claude with `--session-id <id>` (id we choose) so the SAME conversation can be
// `--resume`d into a fresh tmux. NO in-memory map: listSessions() ENUMERATES that store every time.
//
// STATE MACHINE — two ORTHOGONAL axes (see [[state]]): an agent-authored LIFECYCLE and a runtime-derived
// LIVENESS, neither overriding the other.
//   lifecycle (authored): active | idle | awaiting | parked | error | asking | queued. `idle` is the ONE
//              inferred one (the Notification(idle_prompt) hook, guarded active-only so it never clobbers a
//              declaration; mark-active flips it back to active on real work).
//   liveness (derived for EVERY session): online | starting | offline | unknown. offline = no tmux for the id,
//              or the harness online-signal (claude's rendezvous socket LISTENER — a connect, not the socket
//              FILE) is gone past the boot grace; starting = the boot window; unknown = the tmux probe itself
//              failed (timed out under load) so death is UNPROVEN — render probe-failed, never offline/vanish.
//              reconcile composes the two into the compact DisplayStatus for one-glyph surfaces.
//   awaiting → the agent's PROPOSAL, awaiting a human:
//                proposal=merge   → shown "review"        ("ready, merge me")
//                proposal=nothing → shown "done"          ("finished, your call")
//                proposal=close   → shown "close-pending" ("I suggest discarding this worktree")
//   asking → the agent is pausing to ask the HUMAN a question. Written DETERMINISTICALLY two ways: the
//                mark-active PreToolUse hook captures it the moment the agent invokes the AskUserQuestion
//                tool (question → note), and the agent may also declare it via `spex session ask --note
//                <question>`. Not inferred. Distinct from `parked` (which waits on a background task/
//                schedule and self-resumes); an asking agent resumes only when a human sends it a prompt.
//   queued → a prepared worktree held below the concurrency cap; the drainer launches it as a slot frees.
//   (closed = the worktree AND the global record are removed; not a stored status)
// The agent only ever PROPOSES (awaiting); merge/close are human-only. Every proposal is reversible — nothing
// auto-disappears; to withdraw one you MESSAGE the session (mark-active clears it), and a relaunch (resume)
// deliberately does NOT touch it. `merges` is METADATA (how many times merged), shown as a badge, not a state.
//
// Launch rules (CLAUDE.md / memory): private `tmux -L <label>` socket + `--dangerously-skip-permissions`.
// SPEXCODE_TMUX overrides the tmux socket for tests; the launch COMMAND comes from the session's pinned
// launcher ([[launcher-select]]), not an env var.

const pexec = promisify(execFile)
export const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
// the legacy/default harness for helpers and old records. New sessions derive their harness from the selected
// launcher; all harness-specific launch facts still come from the adapter.
const HARNESS = defaultHarness
const COLS = 120, ROWS = 32
// @@@ concurrency cap - the most working agents we let run AT ONCE. Heavy multi-agent load (many claude
// processes computing simultaneously) was the source of resource-pressure crashes, so a launch beyond the
// cap is QUEUED, not started: it becomes a durable `queued` worktree that the drainer launches the moment a
// slot frees (an agent stops working/dies). NOT hardcoded — configured PER PROJECT in `spexcode.json`
// (`sessions.maxActive`), so a box can be tuned to its capacity without touching the toolchain. Precedence:
// spexcode.json → `SPEXCODE_MAX_ACTIVE` env → default 8. Read LIVE (cheap file read) so an edit takes effect
// on the next drain tick, no restart. Floored at 1 so a bad value can't wedge the queue to 0.
const DEFAULT_MAX_ACTIVE = 8
function maxActive(): number {
  let v: number | undefined
  try {
    const fromJson = readConfig(mainRoot()).sessions?.maxActive
    if (typeof fromJson === 'number' && Number.isFinite(fromJson)) v = fromJson
  } catch { /* config unreadable — fall through to env/default */ }
  if (v === undefined) { const e = Number(process.env.SPEXCODE_MAX_ACTIVE); if (Number.isFinite(e) && e > 0) v = e }
  return Math.max(1, Math.floor(v ?? DEFAULT_MAX_ACTIVE))
}

// the rendezvous control socket path + its prompt-delivery/liveness logic now live in the [[harness-adapter]]
// (claude OWNS the rendezvous; codex does not), so product code asks the adapter rather than hard-wiring it.
// rvSock is imported only for the two NON-delivery uses that remain product-level: building the launch env var
// (rvEnv, below) and the best-effort socket sweep on close.
// env prefix put in front of the spawned agent so it creates this session's rendezvous control socket — and
// so its hooks + materialize write to the SAME store the backend uses. SPEXCODE_HOME/CODEX_HOME are
// propagated when set, because the session inherits the tmux SERVER's env (not the backend's), so without this
// an overridden home would silently leak the session's hook-state + codex-trust to the default ~/.spexcode /
// ~/.codex. Deterministic: the session's store = the backend's store, never the ambient env's.
const rvEnv = (id: string, harness = HARNESS) => {
  // SPEXCODE_SESSION_ID is the governed record id. Claude's harness id is the same value, so hooks and CLI
  // calls can use it directly. Codex cannot trust this env inside the long-lived shared app-server; codex hooks
  // start from the payload thread id and alias through harness_session_id, while the short-lived codex-launch
  // process uses this env only to store the freshly started thread id on the governed record. The CLAUDE_BG
  // rendezvous control socket is the reclaude prompt-delivery path and exists ONLY for harnesses that own one
  // (claude) — codex has no such daemon, so it's omitted there.
  const parts = [`SPEXCODE_SESSION_ID=${id}`]
  if (harness.ownsRendezvous) parts.push(`CLAUDE_BG_BACKEND=daemon`, `CLAUDE_BG_RENDEZVOUS_SOCK=${rvSock(id)}`)
  for (const v of ['SPEXCODE_HOME', 'CODEX_HOME']) { const val = process.env[v]; if (val) parts.push(`${v}=${val}`) }
  return parts.join(' ')
}

// the prompt-dispatch outcome type + its claude/codex delivery implementations live in the [[harness-adapter]]
// (each harness OWNS its input channel — claude the rendezvous socket, codex app-server JSON-RPC). Re-exported here
// for the existing importers (client.ts) that read it off the sessions module.
export type { DispatchResult }

export type Lifecycle = 'active' | 'idle' | 'awaiting' | 'parked' | 'error' | 'asking' | 'queued'
export type Proposal = 'merge' | 'nothing' | 'close'
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'starting' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued' | 'unknown'
// liveness — the orthogonal axis to Lifecycle: whether the agent process is actually up, derived (never
// authored) for EVERY session regardless of its lifecycle. See [[state]]: lifecycle and liveness never
// override each other; the UI keys the terminal-mount / relaunch panel on this, the badge on lifecycle.
// `unknown` = the liveness PROBE ITSELF failed (the tmux snapshot timed out / errored under load), so we
// CANNOT tell — the row renders probe-failed, NEVER offline/closed and never vanishes (board honesty: a slow
// box must not masquerade as a graveyard, the failure that drove the mass-restore incident).
export type Liveness = 'online' | 'starting' | 'offline' | 'unknown'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; branch: string | null; path: string
  label: string; headline: string   // the DERIVED display strings ([[session-label]]) — the only names surfaces read
  raw: { name: string | null; title: string | null }   // the bare parts, for explicit consumers only (rename prefill)
  parent: string | null   // the SPAWNING session's id ([[session-nesting]]) — set once at creation when `spex session new` ran inside another session, else null; the frontend folds a child under it at read time
  harness: string   // which harness (claude|codex) runs this session — carried so liveness/occupancy route through its adapter
  launcher: string | null   // the launcher profile this session launched under ([[launcher-select]]); null only for old records predating launchers
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; liveness: Liveness; note: string | null
  prompt: string | null; promptPreview: string | null; created: number; activity: string | null
  sortKey: number | null   // manual drag-reorder override ([[session-reorder]]); null = sort by `created`
}

// ensure a session's GLOBAL store dir exists, returning its path. Idempotent (recursive mkdir) — every
// writer that drops an artifact (record/prompt/launch/launch.sh/comms) calls this first so order never matters.
function storeDir(id: string): string { const d = sessionStoreDir(id); mkdirSync(d, { recursive: true }); return d }

// @@@ originating prompt - what the session was ASKED to do, captured at launch so a manager (human or
// agent) can later answer "what was this session for?" WITHOUT transcript archaeology. Prompts are
// multi-line, so they live as their own artifact (`prompt`) in the session's GLOBAL store dir (keyed by
// session_id, [[state]]), never in the worktree. Everything here is BEST-EFFORT: a missing artifact (a
// session launched before this existed) just means no prompt is shown — never an error, never blocks a launch.
function writePromptFile(id: string, prompt: string): void {
  try { writeFileSync(join(storeDir(id), 'prompt'), prompt) } catch { /* best-effort; must never block the launch */ }
}
function readPromptFile(id: string): string | null {
  try {
    const p = sessionArtifactPath(id, 'prompt')
    if (!existsSync(p)) return null
    const s = readFileSync(p, 'utf8')
    return s.trim() ? s : null
  } catch { return null }
}
// @@@ deferred launch prompt - a QUEUED session is a fully-prepared worktree we have NOT launched claude
// into yet. The exact prompt to launch it with — the directive-generated finish-the-op prompt, or the plain
// human prompt — is parked as the `launch` artifact in the store dir so the drainer can launch it later
// (possibly after a backend restart) WITHOUT re-deriving anything. CONSUMED (removed) the moment the session
// launches, so it exists only while the session waits in the queue. Distinct from `prompt` (the originating ask).
function writeLaunchFile(id: string, prompt: string): void {
  try { writeFileSync(join(storeDir(id), 'launch'), prompt) } catch { /* best-effort; the drainer treats a missing file as nothing-to-launch */ }
}
function readLaunchFile(id: string): string | null {
  try { const p = sessionArtifactPath(id, 'launch'); return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null }
}
function removeLaunchFile(id: string): void {
  try { rmSync(sessionArtifactPath(id, 'launch'), { force: true }) } catch { /* best-effort */ }
}

// a one-line preview of the originating prompt for tables/events: first non-empty line, truncated.
function promptPreview(prompt: string, n = 60): string {
  const first = prompt.split('\n').map((l) => l.trim()).find(Boolean) || ''
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

// @@@ session-label — the ONE place a session's display strings are derived ([[session-label]]). The raw
// parts (a user rename `name`, the 7-word prompt truncation `title`) never leave this module at the top
// level: toSession computes `label` (STABLE: name > node > title > branch > id — tables/selectors) and
// `headline` (LIVE: name > activity > promptPreview > node > title > branch > id — what a human reads,
// see [[session-activity]]) and the wire carries THOSE; the parts ride only under `raw` for the few
// explicit consumers (the rename prefill). A surface that wants a session's name reads s.label/s.headline
// — there is no bare s.title/s.name to reach for, which is the enforcement.
export const deriveLabel = (r: { name?: string | null; node?: string | null; title?: string | null; branch?: string | null; id: string }): string =>
  r.name || r.node || r.title || r.branch || r.id
export const deriveHeadline = (r: { name?: string | null; activity?: string | null; promptPreview?: string | null; node?: string | null; title?: string | null; branch?: string | null; id: string }): string =>
  r.name || r.activity || r.promptPreview || r.node || r.title || r.branch || r.id

// accessors kept for the human-naming call sites (watch/notify/reply-channel): trivially the precomputed
// wire fields, so every surface — CLI, dashboard, comms — reads the same derivation by construction.
export const sessionLabel = (s: Session): string => s.label
export const sessionHeadline = (s: Session): string => s.headline

// @@@ tmux probe timeout - under load (the incident: load ~30 + swap thrash) a bare `tmux list-sessions` can
// HANG, and with no bound the whole board assembly hung behind it — the dashboard froze / dropped rows, which
// the human read as "sessions disappeared". So the liveness/title probes pass a bounded timeout; on expiry
// execFile SIGKILLs the child and rejects with `killed:true`, which liveSnapshot tells apart from a clean
// "no server" exit (see probeTimedOut) so a timeout renders `unknown`, not a false `offline`.
const TMUX_PROBE_TIMEOUT_MS = 4000
async function tmux(args: string[], timeoutMs?: number): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8', ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' as const } : {}) })
  return stdout
}
// a rejected pexec whose child we KILLED (timeout) vs one that exited cleanly non-zero (e.g. tmux "no server
// running" when there are genuinely no sessions). Only the former is a PROBE FAILURE (→ unknown); a clean
// non-zero exit is authoritative (→ everything offline). node sets `killed`/`signal` when it SIGKILLs on timeout.
function probeTimedOut(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string | null; code?: string }
  return err?.killed === true || err?.signal === 'SIGKILL' || err?.code === 'ETIMEDOUT'
}
async function tmuxOk(args: string[]): Promise<boolean> { try { await tmux(args); return true } catch { return false } }
export async function alive(id: string): Promise<boolean> { return tmuxOk(['has-session', '-t', id]) }

// worktrees + branches are created off MAIN even when the server runs inside a worktree.
function mainRoot(): string {
  try { return dirname(gitCommonDir()) }
  catch { return repoRoot() }
}

// @@@ pkgRoot - the CLI package's OWN directory, derived from this module's location, never a hardcoded
// repoRoot()+'spec-cli'. This file lives at <pkgRoot>/src/sessions.ts, so `..` from it is the package
// root — making the launch-script paths (hooks/, node_modules/.bin/tsx, src/cli.ts) survive the package
// being renamed or relocated out of the default <repo>/spec-cli layout.
function pkgRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

// the in-memory session record — the typed view of session.json. `governed` (dashboard-launched=true vs
// user-self-launched=false), `worktreePath`/`branch`/`createdAt` are the fields the board USED to read off
// the worktree (its path/birthtime); now they live IN the record, since the record is the enumeration source.
// `name` is the rename override (distinct from the prompt-derived `title`); `session` is the harness session_id
// (the store key). The launcher mints the id (`claude --session-id <id>`) so it equals what every hook payload
// and CLAUDE_CODE_SESSION_ID carry — one id across the record dir, tmux window, rendezvous socket, and commits.
export type SessRec = {
  session: string; governed: boolean; worktreePath: string; branch: string | null
  node: string | null; title: string | null; name: string | null
  parent: string | null   // the spawning session's id ([[session-nesting]]); null for a top-level launch
  status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null
  sortKey: number | null; createdAt: number; harness: string; harnessSessionId: string | null
  launcher: string | null   // the launcher profile this session launches under ([[launcher-select]]); null only for old records predating launchers
  launchCmd: string | null  // the RESOLVED base launcher command pinned at creation ([[launcher-select]] resume-launcher-pin); null → old record → fall back to the launcher name / ambient
}
const LIFECYCLES = new Set<Lifecycle>(['active', 'idle', 'awaiting', 'parked', 'error', 'asking', 'queued'])
const PROPOSALS = new Set<Proposal>(['merge', 'nothing', 'close'])

// typed read of a session's record from the global store (null if it has none — a self-launched session that
// only ever wrote spec-discipline sentinels has a store dir but no session.json). Goes through layout's
// readAliasedRawRecord (the seam that owns the path + the codex-thread-id alias), then validates the loose
// on-disk fields into the typed shape — so a codex hook resolving by its thread id reaches the real record.
function readRecord(id: string): SessRec | null {
  const raw = readAliasedRawRecord(id)
  if (!raw) return null
  return fromRaw(raw)
}
function fromRaw(raw: RawRecord): SessRec {
  const status = LIFECYCLES.has(raw.status as Lifecycle) ? raw.status as Lifecycle : 'active'
  const proposal = raw.proposal && PROPOSALS.has(raw.proposal as Proposal) ? raw.proposal as Proposal : null
  const sk = raw.sortkey
  const sortKey = typeof sk === 'number' && Number.isFinite(sk) ? sk : null
  return {
    session: raw.session_id, governed: !!raw.governed, worktreePath: raw.worktree_path || '', branch: raw.branch || null,
    node: raw.node || null, title: raw.title || null, name: raw.name || null, parent: raw.parent || null,
    status, proposal, merges: Number(raw.merges) || 0, note: raw.note || null, sortKey, createdAt: Number(raw.createdAt) || 0,
    harness: raw.harness || 'claude',   // records written before the harness field default to claude
    harnessSessionId: raw.harness_session_id || null,
    launcher: raw.launcher || null,     // records written before launchers → null → old-record fallback
    launchCmd: raw.launch_cmd || null,  // records written before the pin → null → fall back to launcher name / ambient
  }
}
// @@@ session.json format - written one-field-per-line (JSON.stringify(_, null, 2)) with EVERY key ALWAYS
// present (nulls rendered as "" / the empty value, never an absent key). That stable shape is the contract the
// pure-shell hot-path hook (mark-active) relies on: it value-replaces `"status"`/`"proposal"`/`"note"` with a
// single sed and never needs jq on the user's box. So do NOT switch to conditional keys or a compact dump.
function writeRecord(rec: SessRec): void {
  const obj = {
    session_id: rec.session,
    governed: rec.governed,
    worktree_path: rec.worktreePath,
    branch: rec.branch ?? '',
    node: rec.node ?? '',
    title: rec.title ?? '',
    name: rec.name ?? '',
    parent: rec.parent ?? '',
    status: rec.status,
    proposal: rec.proposal ?? '',
    merges: rec.merges,
    note: rec.note ?? '',
    sortkey: rec.sortKey ?? '',
    createdAt: rec.createdAt,
    harness: rec.harness || 'claude',
    harness_session_id: rec.harnessSessionId ?? '',
    launcher: rec.launcher ?? '',
    launch_cmd: rec.launchCmd ?? '',
  }
  mkdirSync(sessionStoreDir(rec.session), { recursive: true })
  writeFileSync(sessionRecordPath(rec.session), JSON.stringify(obj, null, 2) + '\n')
}

// @@@ fail-loud enumeration - the worktree set is the board's EXISTENCE truth, so a failed enumeration must
// NEVER masquerade as an empty repo. `gitA` swallows a git error to '' (→ zero rows), which a caller would
// read as "every worktree was removed" — exactly the false mass-`closed` watchSessions would emit once the
// flicker debounce is gone. `git worktree list` ALWAYS lists at least the main worktree, so an ok run with
// zero `worktree ` lines is itself a failure. Both cases THROW; the caller (listSessions) propagates and
// watchSessions' poll `catch` simply skips the tick with `prev` intact — no fabricated removals.
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

// @@@ reconcile - the shown status. awaiting → the proposal's label (review/done/close-pending),
// shown regardless of liveness. active/idle → their LIVENESS: offline if no tmux for the recorded id OR
// claude's rendezvous socket is gone (claude exited), else idle if the idle_prompt hook has fired since
// the last tool use, else working.

// @@@ liveTmux - which of OUR tmux sessions exist AND each pane's runtime probe, in TWO spawns total (one
// tmux, one ps) for the WHOLE list. reconcile used to spawn two tmux per session (has-session +
// display-message), so listing N sessions was 2N spawns — the dominant /api/sessions cost under multi-agent
// load. `tmux list-sessions` returns every session on our socket at once; a session present here has a live
// tmux window (session_name = the id we created it with), mapped to a PaneProbe: its pane's ROOT pid
// (`#{pane_pid}`) plus ONE shared whole-box pid→(ppid, comm) table from a single `ps` spawn. tmux server
// down / no sessions → empty map → everything reconciles to offline, which is correct. `live.has(id)` = the
// window presence; `live.get(id)` = the probe, which the CODEX adapter's liveness walks to tell a running TUI
// (a codex/node process among the pane pid's descendants) from a failed launch that dropped back to the bare
// shell (see [[harness-adapter]] paneTreeRunsCodex — the pane's FOREGROUND command is `bash`, the launch
// wrapper, even while the TUI renders, so the foreground name is NOT the signal). CLAUDE ignores the probe —
// its workers launch through the `reclaude` wrapper, which runs claude as a CHILD, so claude liveness stays
// its rendezvous socket. The per-session alive() above stays for the single-session ops (capture / rawKey).
async function procSnapshot(): Promise<ProcTable> {
  const t: ProcTable = new Map()
  let out = ''
  try { ({ stdout: out } = await pexec('ps', ['-eo', 'pid=,ppid=,comm='], { timeout: TMUX_PROBE_TIMEOUT_MS, killSignal: 'SIGKILL' })) } catch { return t }
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (m) t.set(Number(m[1]), { ppid: Number(m[2]), comm: m[3].trim() })
  }
  return t
}
// @@@ LiveSnap - the ONE liveness snapshot the whole session list shares. `windows` = our live tmux windows
// (id → PaneProbe) + one whole-box process table; `sockets` = the ids whose rendezvous socket has a LIVE
// LISTENER (connect-probed once here, not the file-exists lie — [[harness-adapter]]); `unproven` = the ids whose
// LISTENER probe could not conclude (timeout under load / EAGAIN off a full-but-alive backlog — see
// rendezvousListening's tri-state) — death UNPROVEN, so those rows read `unknown`, never `offline`;
// `probeFailed` = the tmux window probe itself FAILED (timed out under load), which is DISTINCT from "tmux up,
// no sessions" — the former means death is UNPROVEN so those rows read `unknown`, the latter is authoritative
// and reads `offline`.
export type LiveSnap = { probeFailed: boolean; windows: Map<string, PaneProbe>; sockets: Set<string>; unproven: Set<string> }
async function liveSnapshot(): Promise<LiveSnap> {
  const windows = new Map<string, PaneProbe>()
  let out: string
  try {
    out = await tmux(['list-sessions', '-F', '#{session_name}\t#{pane_pid}'], TMUX_PROBE_TIMEOUT_MS)
  } catch (e) {
    // a TIMEOUT/kill is a probe FAILURE (we can't tell who's alive → unknown, never a false graveyard). A clean
    // non-zero exit ("no server running" — genuinely zero sessions) is authoritative → the empty map = offline.
    return { probeFailed: probeTimedOut(e), windows, sockets: new Set(), unproven: new Set() }
  }
  const procs = await procSnapshot().catch(() => undefined)   // codex-only, auxiliary; its failure isn't a liveness failure
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) { const name = line.trim(); if (name) windows.set(name, { procs }); continue }
    const name = line.slice(0, tab).trim(); if (!name) continue
    const pid = Number(line.slice(tab + 1).trim())
    windows.set(name, { panePid: Number.isFinite(pid) && pid > 0 ? pid : undefined, procs })
  }
  // LISTENER probe for every windowed session, once, in parallel (tooth: a live listener, not a lingering
  // socket file). A codex session has no rvSock → instant ENOENT → proven dead for the socket axis (codex
  // ignores it anyway). The tri-state matters here: 'unproven' (timeout/EAGAIN — a wedged or thrashed but
  // possibly-alive listener) lands in `unproven`, never silently in the not-live bucket, so liveness() can
  // render it `unknown` instead of a false `offline` (issue #40's load-spike graveyard).
  const ids = [...windows.keys()]
  const listening = await Promise.all(ids.map((id) => rendezvousListening(id)))
  const sockets = new Set<string>()
  const unproven = new Set<string>()
  ids.forEach((id, i) => {
    if (listening[i] === 'live') sockets.add(id)
    else if (listening[i] === 'unproven') unproven.add(id)
  })
  return { probeFailed: false, windows, sockets, unproven }
}

// @@@ paneTitles - every session pane's RAW tmux title, free from tmux. The worker launches one pane per
// session, named with the session id, so ONE `list-panes -a` maps id → its raw `#{pane_title}`. Same shape
// and cost as liveTmux (one tmux call for the whole list); failure → empty map, so a tmux hiccup just drops
// the subtitle for a tick, never the session. The raw title is NOT yet a headline — what a pane title MEANS
// is harness-specific (claude: a self-authored task summary; codex: a spinner + the cwd folder name), so the
// id→harness gating + glyph parse happens per session in paneActivity, not here.
async function paneTitles(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  let out = ''
  try { out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_title}'], TMUX_PROBE_TIMEOUT_MS) } catch { return m }
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) continue
    const id = line.slice(0, tab), title = line.slice(tab + 1)
    if (id && title) m.set(id, title)
  }
  return m
}

// @@@ sessionSignature - a CHEAP fingerprint of the two live board signals the session-store fs-watch can't
// see, because they are tmux-derived, not file writes: LIVENESS (which sessions exist — a crash/offline) and
// ACTIVITY (each pane's self-summary title). Two tmux calls, NO git and NO store walk, so [[graph-stream]] can
// poll this to push a `board-changed` the instant a worker dies or updates its headline, instead of the
// dashboard waiting for its slow cold-path fallback. Sorted so it only moves on a real change.
export async function sessionSignature(): Promise<string> {
  const [snap, titles] = await Promise.all([liveSnapshot(), paneTitles()])
  // fold in probe-failure, the live-listener set AND the unproven set so a socket dying (claude exit), the
  // probe flipping to unknown, or a listener wedging (unproven) pushes a board-changed immediately, not only
  // on window churn.
  return (snap.probeFailed ? 'PROBEFAIL|' : '') + [...snap.windows.keys()].sort().join(',') + '#' +
    [...snap.sockets].sort().join(',') + '~' + [...snap.unproven].sort().join(',') + '|' + [...titles].sort().map(([k, v]) => `${k}=${v}`).join(',')
}

// @@@ paneActivity - the harness-aware live self-summary: the SINGLE place a raw pane title becomes (or does
// NOT become) a session's headline activity. The board headline derives from the pane title ONLY for a
// harness whose pane title is its own task self-summary (`paneTitleIsSelfSummary`, an adapter capability —
// [[harness-adapter]]). claude qualifies (it writes its task summary into the OSC title), so we parse it with
// selfSummary (glyph-gated). codex does NOT — its pane title is a spinner glyph + the cwd FOLDER name, so
// returning it would headline the worktree folder, not the task; we refuse it (→ null) and sessionHeadline
// falls through to promptPreview (the launch prompt). The ONLY harness branch is the capability read here —
// no `if (codex)`, no glyph special-case; selfSummary stays the pure claude-title parser.
export function paneActivity(harness: Harness, paneTitle: string | null | undefined): string | null {
  if (paneTitle == null || !harness.paneTitleIsSelfSummary) return null
  return selfSummary(paneTitle)
}

// @@@ selfSummary - the agent's OWN live one-line description, parsed from its tmux pane title — the SINGLE
// place the "is this the agent speaking?" rule lives, exported so it is unit-auditable. Claude Code sets that
// title via an OSC escape and ALWAYS leads it with a status glyph: ✳ (and its ✶✻✽✢ blink frames) when idle, a
// braille spinner frame (U+2800–U+28FF) while working. That leading glyph is the only reliable proof the
// title is the agent and not tmux's default — which, from pane birth until the first turn, is the HOST NAME
// (e.g. `ser581555022561`) or a bare `Claude Code` splash. So the glyph is REQUIRED: no leading glyph → null,
// and the caller keeps showing the launch-prompt placeholder instead of flickering through the host name and
// splash. The leading glyph run (with the spaces/`·` between and after) is stripped — the dashboard draws its
// own status dot, a frozen spinner frame is just noise — leaving only the summary text (null if it is empty).
// ONE regex is the single source of the glyph rule: it gates (requires ≥1 glyph) and strips in one match.
// The glyph gate alone is not enough: Claude Code emits a glyph-led SPLASH of its own app name (`✳ Claude
// Code`) between pane birth and its first real task summary — it CLEARS the glyph gate yet is the app naming
// itself, not the task. GENERIC_SUMMARY rejects that stripped splash too, so the row keeps its launch-prompt
// placeholder instead of flashing "Claude Code" for a tick (the glyph-LESS `Claude Code` splash was already
// rejected by the gate; this catches its glyph-led twin).
const GENERIC_SUMMARY = /^claude code$/i
export function selfSummary(paneTitle: string): string | null {
  const m = /^[\s·]*(?:[✳✶✻✽✢⠀-⣿][\s·]*)+(.*)$/u.exec(paneTitle)
  if (!m) return null
  const text = m[1].trim()
  return text && !GENERIC_SUMMARY.test(text) ? text : null
}

// @@@ launchedAt - when we last started a tmux window for an id (set in launch()). claude needs ~15-20s
// after the window appears to recreate its rendezvous socket; in that window the socket is absent but the
// session is booting, NOT dead. reconcile consults this to report 'starting' (a distinct transient state)
// instead of 'offline' for BOOT_GRACE_MS after launch — so 'offline' only ever means genuinely dead. In-
// memory in the single server process (lost on restart, which is fine: a restart has nothing in flight).
const launchedAt = new Map<string, number>()
const BOOT_GRACE_MS = 45000   // > SOCKET_READY_TIMEOUT_MS, and spans launchScript's bounded fast-fail retry
                              // window (~3 attempts) so a relaunching session reads 'starting', not 'offline'
const LAUNCH_FAST_FAIL_S = 12 // launchScript retries the agent command when it exits faster than this: fast
                              // exit before readiness is retryable, but it is not proof of one specific cause

// @@@ liveness - the orthogonal axis ([[state]]): is the agent process up, for ANY session regardless of
// lifecycle, from a prebuilt runtime snapshot (no per-call spawn — see liveSnapshot) + the adapter's own channel
// check. Order of honesty: if the PROBE ITSELF failed (tmux timed out under load) death is UNPROVEN → `unknown`
// (render probe-failed, NEVER a false offline that empties the board and provokes a mass-restore). Else offline
// iff the tmux window is gone OR the adapter's online-signal is absent past the boot window. claude (via the
// reclaude wrapper) holds CLAUDE_BG_RENDEZVOUS_SOCK open the whole time it is alive, so a LIVE LISTENER on that
// socket (`snap.sockets`, connect-probed — NOT the socket FILE, which a crash leaves behind) is the truth —
// not the pane, whose foreground is the wrapper/shell while claude runs as its child. codex has no such socket,
// so its truth is the pane's DESCENDANT PROCESS TREE from the SAME snapshot: a live TUI keeps a codex/node
// process below the pane pid; a failed launch leaves the pane at a bare shell, even while the shared app-server
// sock lingers. A just-launched agent whose online-signal hasn't appeared yet reads the transient 'starting'
// for the grace window; only past it (still not online) is it genuinely 'offline'.
export function liveness(rec: SessRec, snap: LiveSnap): Liveness {
  if (!rec.session) return 'offline'
  if (snap.probeFailed) return 'unknown'   // the probe failed — we can't tell, and MUST NOT guess offline
  // ask the ADAPTER ([[harness-adapter]]): claude = tmux up AND a live listener on its rendezvous socket; codex
  // = tmux up AND a codex-ish process live among the pane pid's descendants (not the bare shell a failed launch
  // dropped back to). The 'starting' grace stays here (a launcher concern): a just-launched agent whose
  // online-signal hasn't appeared yet reads 'starting' for the boot window, only past it 'offline'.
  const h = harnessById(rec.harness || defaultHarness.id)
  if (h.liveness(rec, snap.windows.has(rec.session), runtimeRoot(), snap.windows.get(rec.session), snap.sockets.has(rec.session)) === 'online') return 'online'
  // not provably online — but if this session's LISTENER probe couldn't conclude (timeout under load / EAGAIN
  // off a full-but-alive backlog), death is UNPROVEN: `unknown`, never a false `offline` a supervisor would
  // act on (issue #40 — a wedged-but-alive worker must not read as an actionable corpse).
  if (snap.unproven.has(rec.session)) return 'unknown'
  const at = launchedAt.get(rec.session)
  return at && Date.now() - at < BOOT_GRACE_MS ? 'starting' : 'offline'
}

// reconcile the compact DisplayStatus — a DERIVED label composing lifecycle + liveness for one-glyph
// surfaces ([[state]]), never a third source of truth. Lifecycle wins the label except where liveness must
// show through: awaiting → its proposal label; parked/error/asking/queued → themselves; active/idle → their
// liveness (offline/starting/unknown), else the active-only idle/working inference (the mark-active hook flips
// idle → active on the next real work, self-correcting). The orthogonal liveness field is what the UI keys
// terminal-mount and the relaunch panel on; this label is for badges and `spex session ls`.
function reconcile(rec: SessRec, snap: LiveSnap): DisplayStatus {
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (rec.status !== 'active' && rec.status !== 'idle') return rec.status  // parked | error | asking | queued (no tmux yet)
  const lv = liveness(rec, snap)
  if (lv !== 'online') return lv  // 'offline' | 'starting' | 'unknown'
  return rec.status === 'idle' ? 'idle' : 'working'
}

// resolve a session id to its record + worktree. Now a DIRECT store read (the record carries worktree_path),
// not a scan of every worktree reading its `.session` — O(1) and exact. null when the id has no governed-or-not
// record. Shape kept ({path, branch, rec}) so the many callers (rename/propose/resume/merge/close/…) are unchanged.
async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  const rec = readRecord(id)
  if (!rec) return null
  return { path: rec.worktreePath, branch: rec.branch, rec }
}

export function toSession(rec: SessRec, status: DisplayStatus, lv: Liveness, activity: string | null = null): Session {
  const prompt = readPromptFile(rec.session)   // the originating ask, captured at launch (store artifact; null for old sessions)
  // activity is the LIVE pane title; it only means anything while the worker is genuinely up — a
  // dead/booting session would show a stale or absent title, so it's suppressed unless liveness is online.
  const showActivity = lv === 'online'
  const act = showActivity ? activity : null
  const pp = prompt ? promptPreview(prompt) : null
  const parts = { id: rec.session, name: rec.name, node: rec.node, title: rec.title, branch: rec.branch, activity: act, promptPreview: pp }
  return { id: rec.session, node: rec.node, branch: rec.branch, label: deriveLabel(parts), headline: deriveHeadline(parts), raw: { name: rec.name, title: rec.title }, path: rec.worktreePath, parent: rec.parent, harness: rec.harness, launcher: rec.launcher, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status, liveness: lv, prompt, promptPreview: pp, created: rec.createdAt, activity: act, sortKey: rec.sortKey }
}

// @@@ renameSession - set (or clear) a session's human display NAME: the user-chosen override that wins
// over the derived label (node/title/branch/id) on every surface. Persisted to the session's global
// record (`session.json` in the store, like every other field) so the name survives backend restarts
// and is read back like any other field. A blank name CLEARS the override, reverting the row to its derived label. Works for a session in
// any state (queued/live/offline) since it edits the on-disk record, not the live tmux. Unknown id → false
// (the route answers 404). The frontend's right-click rename is the sole caller today.
export async function renameSession(id: string, name: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeRecord({ ...wt.rec, name: name.trim() || null })
  return true
}

// @@@ setSessionSort - set (or clear) a session's drag-reorder pseudo-time ([[session-reorder]]), parallel
// to renameSession: persisted to the session's global record so the manual order survives restarts and
// shows on every surface (all sort by `sortKey ?? created`). A null key CLEARS it, dropping the row back to
// its `created` slot. Works in any state since it edits the on-disk record. Unknown id → false (route 404s).
export async function setSessionSort(id: string, key: number | null): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeRecord({ ...wt.rec, sortKey: key != null && Number.isFinite(key) ? key : null })
  return true
}

// the session's full ORIGINATING prompt (what it was asked to do), or null if none was recorded.
export async function sessionPrompt(id: string): Promise<string | null> {
  return readRecord(id) ? readPromptFile(id) : null
}

// @@@ lastKnownSession - the last successfully-read Session row per session_id. The record's EXISTENCE in
// the store is definitive; a transient failure reading it (an ENOENT race, or a sibling read failing under a
// concurrent merge) must NOT drop the row from the board — that absence is exactly what watchSessions used to
// mis-read as a `closed · removed`. So a degraded read serves this last-known row instead of vanishing. Pruned
// each poll to only ids still present.
const lastKnownSession = new Map<string, Session>()

// @@@ listSessions - the board's session list, enumerated from the GLOBAL per-session store (replacing the
// old `git worktree list` scan). Every GOVERNED record this project owns becomes a row, status reconciled;
// non-governed (user-self-launched) records are excluded — board state is a managed-session concern ([[state]]).
// Offline and awaiting ones still appear (their record persists), so a session is never lost from view.
export async function listSessions(): Promise<Session[]> {
  // ONE store enumeration + ONE tmux liveness snapshot + ONE pane-title snapshot for the whole list (all
  // independent), then every session reconciles by a pure set lookup + one existsSync — no per-session tmux spawn.
  const [ids, snap, titles] = await Promise.all([
    Promise.resolve(listSessionIds()), liveSnapshot(), paneTitles(),
  ])
  const rows = ids.map((id) => guardSession(id, () => {
    const rec = readRecord(id)
    if (!rec || !rec.governed) { lastKnownSession.delete(id); return null }   // no record, or a self-launched (non-board) one
    // the pane title → headline activity, gated by THIS session's harness ([[harness-adapter]]): claude's title
    // is its task self-summary (used); codex's is the cwd folder name (refused → headline falls to the prompt).
    const activity = paneActivity(harnessById(rec.harness || defaultHarness.id), titles.get(id))
    const s = toSession(rec, reconcile(rec, snap), liveness(rec, snap), activity)
    lastKnownSession.set(id, s)
    return s
  }, () => {
    // DEGRADED: the record dir still exists but reading session.json failed transiently. NEVER drop a live
    // session — serve its last-known row. (No last-known means a first sighting raced a failure; nothing to
    // show yet, it reappears next poll — and since it was never in watchSessions' `prev`, no false closed.)
    return lastKnownSession.get(id) ?? null
  }))
  // prune last-known entries for ids that no longer appear at all (genuinely removed), keeping it bounded.
  const liveIds = new Set(ids)
  for (const k of [...lastKnownSession.keys()]) if (!liveIds.has(k)) lastKnownSession.delete(k)
  // @@@ creation order - order by birth (oldest first): each session keeps its slot for life and a new one
  // simply appends — a stable spatial map across every surface (dashboard window, session tabs, `spex session ls`).
  // `created` is the record's stored createdAt (set once at launch). A manual drag ([[session-reorder]])
  // overrides one row's slot via a pseudo-time `sortKey`, so sort by `sortKey ?? created`; id breaks ties so
  // same-instant births (or sort-keys) stay deterministic.
  return rows.filter((s): s is Session => s != null).sort((a, b) => (a.sortKey ?? a.created) - (b.sortKey ?? b.created) || a.id.localeCompare(b.id))
}

// a per-session read guard mirroring resilience.guardWorktree but keyed on the store record (not a worktree
// path): run `primary`; if it throws AND the record dir still exists, the failure is transient → serve the
// `degraded` fallback; if the dir is gone (a genuine close), return null (omit). No async git, so it's sync.
function guardSession(id: string, primary: () => Session | null, degraded: () => Session | null): Session | null {
  try { return primary() }
  catch { return existsSync(sessionStoreDir(id)) ? degraded() : null }
}

// @@@ session graph = LIVE monitors, not a stored relationship. An edge A→B means "agent A is RIGHT NOW
// running `spex session watch B` (the Monitor tool) over B" — derived from live watch registrations, never a
// persisted subscription. When a `spex session watch` process starts it registers here and heartbeats; the edge
// exists ONLY while that watch runs (deregistered on exit, dropped on a missed heartbeat). Single owner:
// this in-memory map in the SERVER process — the watch process (a separate `spex session watch`) talks to it over
// HTTP (POST /api/sessions/edges/watch + …/unwatch). No datastore, no file: a backend restart starts
// empty and live watches re-register on their next heartbeat. Kept isolated from the board assembler.
// an edge is either a LIVE monitor arrow (A→B = A watches B, directed) or a recorded comms link (A↔B =
// they have exchanged `count` direct messages, undirected). The dashboard renders the two kinds apart.
export type Edge = { from: string; to: string; kind: 'monitor' | 'comms'; count?: number }

// @@@ comms log - direct agent talk ([[comms-edge]]), recorded per-worktree. `spex session send` goes
// THROUGH the backend (sendText); on a delivered message that carries a sender, the backend appends one
// {peer, ts} line to the RECIPIENT's comms log — each message counted exactly once, on the side the backend
// already resolved. Persisted (survives a backend restart, unlike the in-memory monitor registrations) and
// untracked, in the session's GLOBAL store dir (`comms.ndjson`, keyed by session_id) — it dies with the
// session record, matching a graph of LIVE sessions. No sender → not logged. Best-effort: a recording failure
// must NEVER fail the delivered message.
function commsLog(id: string): string { return sessionArtifactPath(id, 'comms.ndjson') }
async function recordComms(toId: string, fromId: string): Promise<void> {
  if (!fromId || fromId === toId) return
  try {
    if (!readRecord(toId)) return
    appendFileSync(join(storeDir(toId), 'comms.ndjson'), JSON.stringify({ peer: fromId, ts: new Date().toISOString() }) + '\n')
  } catch { /* a recording failure must not fail the delivered send */ }
}
// the peers this session has exchanged messages with — one entry per message, newest appended last.
function readComms(id: string): string[] {
  try {
    const path = commsLog(id)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return String(JSON.parse(l).peer || '') } catch { return '' } }).filter(Boolean)
  } catch { return [] }
}
// keyed by an opaque per-watch token (one per `spex session watch` process), so a single agent may run several
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
// deregister a watch (its `spex session watch` exited); false if the token wasn't registered.
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
// the graph: live sessions as nodes; edges DERIVED from live monitor registrations. Edge A→B = watcher A
// is currently watching B. Selectors are resolved LIVE here via selectSessions (the same matcher `spex
// ls/watch` use), so a global (@all/empty) watcher links to every CURRENT session — incl. ones launched
// after the watch started — and a node/branch selector picks up future matches too. Self-edges and edges
// touching a non-live session are dropped; duplicate A→B (two watches over the same pair) collapse to one.
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
    for (const peer of readComms(n.id)) {
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

// @@@ apiBase resolution - WHICH backend a client verb talks to, resolved ONCE per process with the
// source kept as a discriminant ([[remote-client]]). The core thesis: a FLAG is the only signal that is
// provably deliberate — an env var cannot tell "I exported this on the command" from "I inherited this
// from the backend that launched my shell", and that ambiguity is exactly the misroute bug (a shell
// carrying project A's SPEXCODE_API_URL silently drives every bare `spex` in project B at A's backend).
// The ladder:
//   1. explicit `--api <url>` (`--port <n>` = localhost sugar)      — always wins, any verb
//   2a. WORKER (SPEXCODE_SESSION_ID present): env SPEXCODE_API_URL  — the backend-injected lifeline; a
//       worker's state writes must NEVER gamble on cwd discovery, so the env is not demotable by (2b)
//   2b. HUMAN (no session id): the cwd project's RECORDED live backend (`spex serve` writes it, we
//       /health-probe before trusting — a dead record is ignored, never followed)
//   3. the other side as fallback (human with no live record → env; worker with no env → record)
//   4. default http://127.0.0.1:$PORT||8787
export type ApiBaseSource = 'flag' | 'worker-env' | 'record' | 'env-fallback' | 'default'
export type ApiBaseInfo = { url: string; source: ApiBaseSource }
const usageError = (msg: string): Error => { const e = new Error(msg); e.name = 'UsageError'; return e }
// the explicit routing flag, read from THIS process's argv (never the environment — that's the point).
// `--port` doubles as a BIND port for serve/dashboard, so the sugar is skipped for those verbs.
function explicitApiFlag(): string | null {
  const argv = process.argv
  const ai = argv.indexOf('--api')
  if (ai >= 0) {
    const v = argv[ai + 1]
    if (!v || v.startsWith('--')) throw usageError('--api expects a URL (e.g. --api http://127.0.0.1:8901)')
    const withScheme = v.includes('://') ? v : `http://${v}`
    try { new URL(withScheme) } catch { throw usageError(`--api: not a URL: ${v}`) }
    return withScheme.replace(/\/+$/, '')
  }
  if (argv[2] === 'serve' || argv[2] === 'dashboard') return null   // their --port is a bind port, not routing
  const pi = argv.indexOf('--port')
  if (pi >= 0) {
    const v = argv[pi + 1]
    if (!v || !Number.isInteger(Number(v))) throw usageError('--port expects an integer (localhost sugar for --api http://127.0.0.1:<n>)')
    return `http://127.0.0.1:${v}`
  }
  return null
}
// the cwd project's recorded backend ({url,pid}, written by `spex serve` at bind time into the per-project
// runtime tier), trusted only after a live /health probe — a stale record must never swallow a command.
async function liveRecordUrl(): Promise<string | null> {
  let file: string
  try { file = join(runtimeRoot(), 'backend.json') } catch { return null }   // cwd not in a git repo → nothing to discover
  let url = ''
  try { const rec = JSON.parse(readFileSync(file, 'utf8')); if (typeof rec?.url === 'string') url = rec.url.trim() } catch { return null }
  if (!url) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 600)
  try { return (await fetch(`${url}/health`, { signal: ctrl.signal })).ok ? url : null }
  catch { return null }
  finally { clearTimeout(t) }
}
async function resolveApiBase(): Promise<ApiBaseInfo> {
  const flag = explicitApiFlag()
  if (flag) return { url: flag, source: 'flag' }
  const env = process.env.SPEXCODE_API_URL?.trim() || null
  if (process.env.SPEXCODE_SESSION_ID?.trim()) {
    if (env) return { url: env, source: 'worker-env' }
    const rec = await liveRecordUrl()
    if (rec) return { url: rec, source: 'record' }
  } else {
    const rec = await liveRecordUrl()
    if (rec) return { url: rec, source: 'record' }
    if (env) return { url: env, source: 'env-fallback' }
  }
  return { url: `http://127.0.0.1:${process.env.PORT || 8787}`, source: 'default' }
}
let apiBaseMemo: Promise<ApiBaseInfo> | null = null
export const apiBaseInfo = (): Promise<ApiBaseInfo> => (apiBaseMemo ??= resolveApiBase())
export const apiBase = async (): Promise<string> => (await apiBaseInfo()).url

// @@@ watch registration (CLIENT side) - a `spex session watch` process is separate from the server, so it
// REPORTS itself to the backend's registration store over HTTP: register+heartbeat while it runs,
// deregister on exit (see cli.ts `watch`). All best-effort — if the backend is down the watch still
// streams its events; the graph edge just won't appear until a heartbeat lands. Never throws.
// the agent's OWN session id from the HARNESS env var — the public name used across cli.ts/sessions.ts.
// Single adapter-routed impl lives in layout.ts (`envSessionId`, iterating each adapter's sessionEnvVar);
// re-exported here so callers keep one name. Used by `spex session watch` + the agent-typed `spex session …`
// declarations; the hooks instead pass `--session <id>` from the payload, so they never depend on this.
export const ownSessionId = envSessionId

// @@@ withSenderHint - bidirectional agent messaging. `spex session send` delivers a prompt to the
// recipient; this stamps WHO sent it and HOW to reply as a one-line insert appended to the delivered
// message, so the recipient agent CAN reply (or ignore) and the reply rides the SAME send back into the
// sender's prompt — a reply channel, no workflow enforcement, just a prompt insert. The sender is the
// SENDING agent's OWN session (id from [[dispatch]]'s send-command process via ownSessionId, `label` its
// board HEADLINE — sessionHeadline, the same title the recipient reads on the board); its FULL id is stamped
// so the reply addresses exactly one session, never a prefix. A human running `send` from a plain shell has
// no session id (sender=null) → the bare message, no hint, no loop.
// @@@ delimited as a SESSION TITLE - the headline is wrapped `session "<headline>" (<id>)` so the recipient
// reads it AS a session title, not as prose bleeding into the message (an un-delimited prompt-derived title
// was unrecognisable as a name). A bare-id label (no better name in the chain) needs no quotes.
export type MsgSender = { id: string; label: string | null }
export function withSenderHint(text: string, sender: MsgSender | null): string {
  if (!sender) return text
  const who = sender.label && sender.label !== sender.id ? `session "${sender.label}" (${sender.id})` : `session ${sender.id}`
  return `${text}\n\n— from ${who}. To reply: spex session send ${sender.id} "<your reply>"`
}
async function postJSON(path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${await apiBase()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch { /* best-effort: backend may be down; the next heartbeat / TTL reconciles */ }
}
export const reportWatch = (token: string, watcher: string, selectors: string[], ttlMs: number): Promise<void> =>
  postJSON('/api/sessions/edges/watch', { token, watcher, selectors, ttlMs })
export const reportUnwatch = (token: string): Promise<void> => postJSON('/api/sessions/edges/unwatch', { token })

// @@@ isBackendDown - a `client.ts` BackendError surfacing in the watch poll loop (whose session
// `source` is the HTTP backend client). Matched by NAME, not `instanceof`, so sessions.ts never imports
// client.ts at runtime (client.ts imports apiBase from here — a runtime import back would be a cycle). A
// backend-down poll must NOT be swallowed as a transient git/tmux hiccup: watch warns ONCE and keeps
// streaming rather than emitting false `closed` events for every session.
export const isBackendDown = (e: unknown): boolean => e instanceof Error && e.name === 'BackendError'
// @@@ isBackendUnreachable - the TRANSIENT subset of isBackendDown: the fetch itself failed (nothing
// listening — ECONNREFUSED / "fetch failed"), which client.ts throws as a BackendError with NO HTTP
// `status`. An HTTP BackendError (the backend answered non-2xx) DOES carry a status and is a real error, not
// a momentary blip. The distinction matters to `spex session wait`: a supervisor's backgrounded wait must survive
// the ~1s window where the supervisor reboots its hot-reloaded child behind the stable port, retrying until
// the backend answers again or the deadline hits — never dying on the in-flight fetch that a sibling merge's
// restart happens to interrupt. Read via a structural cast (no client.ts import — that would be a cycle).
export const isBackendUnreachable = (e: unknown): boolean =>
  isBackendDown(e) && (e as { status?: number }).status === undefined

// @@@ slugify - the branch/worktree-safe slug. Keeps ANY unicode letter/number (git refs and the filesystem
// take unicode), so a CJK prompt survives as the readable name its author typed instead of being stripped to
// nothing — transliteration would buy ASCII at the cost of a dependency and a name nobody wrote. NFC pins one
// canonical byte form across IME/OS variants. Non-empty is guaranteed by the 'session' fallback; uniqueness
// is the caller's job (newSession suffixes the session short-id).
export const slugify = (s: string | null) =>
  (s || 'session').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'session'

// @@@ node + title from the prompt - the spec node a session works on is whatever it @-mentions, NOT a UI
// "focused node": the dashboard prefills `@<focused> ` as a deletable convenience, so the node the user
// actually left in the prompt (changed it, or deleted it for a node-agnostic prompt) is the truth. We read
// the FIRST `[[<id>]]` topic reference ([[mentions]]: `[[node]]` is a topic, `@` is now an actor/session).
// When there is none, the session is node-agnostic and we label it by the first few words of the prompt.
// The OPTIONAL leading dot is load-bearing: a node id is its dir basename, so a dot-prefixed config root
// (`.config`) keeps the dot — without `\.?` here `[[.config]]` captures nothing and never resolves to a node.
// Token chars are ANY unicode letter/number (slugify's already-made choice): a CJK dir name is a legal node
// id, so `[[中文节点]]` must bind the session exactly like an ASCII id — ASCII-only here silently launched
// node-agnostic.
const MENTION = /\[\[(\.?[\p{L}\p{N}_-]+)\]\]/u
const mentionedNode = (prompt: string): string | null => prompt.match(MENTION)?.[1] ?? null
// @@@ identity-token strip - an `@session` actor mention ([[mentions]]) or a bare UUID-shaped token in the
// prompt is ANOTHER session's identity, never this one's name. A title/slug wearing it misleads every
// board/git surface — and a worker tasked with cleaning that session can match its OWN worktree and delete
// it from under itself. Strip both before deriving; whatever prose remains names the session.
const UUID_TOKEN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const stripIdentityTokens = (s: string) => s.replace(/(^|\s)@[\p{L}\p{N}_-]+/gu, '$1').replace(UUID_TOKEN, ' ')
export function titleFromPrompt(prompt: string): string | null {
  const first = stripIdentityTokens(prompt || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  const words = first.split(/\s+/).filter(Boolean).slice(0, 7).join(' ')
  if (!words) return null
  return words.length > 50 ? words.slice(0, 49).trimEnd() + '…' : words
}

// @@@ launchScript - the WHOLE launch invocation (rendezvous env prefix + harness command + the human prompt)
// is written to an ephemeral `launch.sh` in the session's GLOBAL store and
// run via `bash <file>`, NOT typed inline. Inline send-keys TRUNCATES past ~2KB (the launch-prompt-limit trap),
// and a long human prompt + spec pointer can exceed it; a file has no length limit
// and the only thing send-keys types is the short `bash <file>` line. It's the SAME command the inline path
// ran (env prefix exports the rendezvous vars to the claude child), just relocated to a file. Liveness no
// longer cares what the pane's foreground command is: claude runs as a child of bash (and, via the
// `reclaude` wrapper, a grandchild), so the pane command is the wrapper/shell — reconcile reads claude's
// rendezvous socket instead (present while claude is alive, gone once it exits). The file lives OUTSIDE the
// worktree (in the store, keyed by session_id), so it never pollutes the spec/code work.
// the launch command for THIS session ([[launcher-select]] resume-launcher-pin): the RESOLVED base command
// PINNED on the record at creation wins — so a (re)launch replays the EXACT launcher that made the conversation
// (and its config-dir env), never re-resolving against a since-changed default that would send `--resume` to the
// wrong config dir and lose the transcript. Fall back to the named-launcher resolution (an old record with a
// launcher name but no pinned cmd; fail-loud on a since-removed launcher), then undefined (truly old record →
// the harness adapter's ambient resolution, best-effort).
export function launcherCmd(rec: SessRec): string | undefined {
  if (rec.launchCmd) return rec.launchCmd
  return rec.launcher ? resolveLauncher(rec.launcher).cmd : undefined
}
export function launchScript(id: string, tail: string, harness: Harness = HARNESS, cmd?: string): string {
  const file = join(storeDir(id), 'launch.sh')
  // NO --append-system-prompt / --settings: the contract + hooks are materialized into the worktree at
  // createSession ([[harness-delivery]]) and the agent auto-discovers them — the SAME path as a self-launched
  // agent. The launch line is just the rendezvous env + the harness command + the session-id/spec-pointer/prompt tail.
  // `cmd` is the session's persisted launcher command ([[launcher-select]]); when set it OVERRIDES the harness's
  // ambient default so resume reuses the same auth. Undefined is only for old records before launch_cmd existed.
  const invocation = `${rvEnv(id, harness)} ${harness.launchCmd(id, runtimeRoot(), cmd)} ${tail}`
  // Bounded relaunch on a FAST exit: the agent launcher can exit within seconds before the rendezvous socket
  // ever appears. That is enough evidence to retry, but not enough evidence to name the cause. Once the agent
  // has run past LAUNCH_FAST_FAIL_S it has genuinely started; its eventual (much later) exit is a normal
  // session end and is NEVER retried — the loop exits. BOOT_GRACE_MS and SOCKET_READY_TIMEOUT_MS both span this
  // retry window, so liveness stays 'starting' and waitForReady keeps holding the slot across retries. This
  // only closes startup unready failures — it adds no fallback and never masks a genuinely dead agent (3
  // attempts, then give up).
  writeFileSync(file, [
    `for __spex_try in 1 2 3; do`,
    `  __spex_t0=$SECONDS`,
    `  ${invocation}`,
    `  __spex_rc=$?`,
    `  [ $(( SECONDS - __spex_t0 )) -ge ${LAUNCH_FAST_FAIL_S} ] && exit $__spex_rc`,
    `  printf '[spex launch] attempt %s exited in %ss (rc=%s) - fast launcher exit before readiness; retrying\\n' "$__spex_try" "$(( SECONDS - __spex_t0 ))" "$__spex_rc" >&2`,
    `  sleep 2`,
    `done`,
    `exit $__spex_rc`,
    ``,
  ].join('\n'))
  return file
}
async function launch(id: string, path: string, tail: string, harness: Harness = HARNESS, cmd?: string): Promise<void> {
  await tmux(['new-session', '-d', '-s', id, '-x', String(COLS), '-y', String(ROWS), '-c', path])
  await tmux(['send-keys', '-t', id, '-l', '--', `bash ${launchScript(id, tail, harness, cmd)}`])
  await tmux(['send-keys', '-t', id, 'Enter'])
  launchedAt.set(id, Date.now())   // stamp the boot window so reconcile reads 'starting', not 'offline', until the socket is up
}


// @@@ concurrency cap + queue - keep at most maxActive() agents AUTONOMOUSLY PROGRESSING at once. A slot is
// COMPUTE pressure, so only an agent actually consuming it holds one: genuinely live (tmux window + rendezvous
// socket present) AND either churning (`working`) or paused-to-self-resume (`parked`). Every state that is
// WAITING ON THE HUMAN frees its slot — `idle` (stopped at its prompt), `asking` (asked a question), and the
// proposal states (review/done/close-pending) — exactly as `offline`/`queued` do. Those agents burn no
// compute, so they must NEVER block a fresh launch: the old rule counted them, so a pile of "waiting on you"
// sessions wedged the queue while the box sat near-idle (the reported blockage). Liveness is still checked
// directly (the socket truth reconcile uses), so an authored `parked` whose claude has since died does NOT
// pin a slot. The cap throttles concurrent COMPUTE; everything waiting-on-you waits cheap as a live pane.
const OCCUPIES_SLOT = new Set<DisplayStatus>(['working', 'parked', 'starting'])  // starting's boot window is also held via `launching`
function isOccupying(s: Session, snap: LiveSnap): boolean {
  if (!OCCUPIES_SLOT.has(s.status)) return false                          // waiting-on-human / proposed / queued / dead → free
  const rec = readRecord(s.id)
  if (!rec) return false
  return harnessById(rec.harness || defaultHarness.id).liveness(rec, snap.windows.has(rec.session), runtimeRoot(), snap.windows.get(rec.session), snap.sockets.has(rec.session)) === 'online'  // and only while the agent is genuinely live (its adapter's channel)
}
// sessions we've JUST launched whose agent hasn't come online yet. During that boot window reconcile reads them
// `offline` (the adapter's online-signal not up yet) and isOccupying would miss them, so the drainer would
// over-launch and blow past the cap. We hold the slot here from launch until the agent is online (waitForReady)
// or it times out.
// In-memory in the single server process (the only drainer) — lost on restart, which is fine: a restart drains
// the durable `queued` worktrees fresh with nothing in flight.
const launching = new Set<string>()
let draining = false   // re-entrancy guard: only one drain pass runs at a time (no double-launch)

// launch a prepared `queued` worktree: feed it its parked launch prompt, flip it to active. Returns false
// (leaving it queued, to be retried next drain) if the worktree/prompt is gone or the tmux launch threw.
async function startQueued(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  const launchPrompt = readLaunchFile(id)
  if (launchPrompt == null) return false   // a queued session always has one; if it's gone, don't spin on it
  launching.add(id)   // hold the slot across the boot window BEFORE we launch, so a concurrent count can't race us
  const h = harnessById(wt.rec.harness || defaultHarness.id)   // launch THIS session's chosen harness (also drives waitForReady below)
  try {
    const sq = `'${launchPrompt.replace(/'/g, `'\\''`)}'`
    await launch(id, wt.path, `${h.sessionIdArg(id)} ${sq}`.trim(), h, launcherCmd(wt.rec))
  } catch {
    launching.delete(id)
    return false   // launch failed → stays `queued`, retried on the next drain tick
  }
  writeRecord({ ...wt.rec, status: 'active', proposal: null })
  removeLaunchFile(id)   // consumed
  // release the boot-window hold once the socket is up (then isOccupying takes over) or after the bounded
  // wait — so a launch that never booted reads offline and the drainer reclaims the slot instead of pinning it.
  void waitForReady(id, h).finally(() => launching.delete(id))
  return true
}

// @@@ drainQueue - start as many `queued` sessions as there are free slots, oldest first. Idempotent and
// re-entrancy-guarded; safe to call on every slot-freeing event (newSession / close / propose) AND on a
// periodic tick (superviseQueue) — the periodic tick is what catches the AGENT-authored transitions
// (done/parked written by a hook SUBPROCESS, which can't reach this server's queue). Re-lists each iteration
// so a freshly launched session (held in `launching`) counts immediately and we never exceed the cap.
export async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const cap = maxActive()   // read once per drain pass (spexcode.json → env → default); won't shift mid-burst
    for (;;) {
      const [sessions, snap] = await Promise.all([listSessions(), liveSnapshot()])
      // if the liveness probe FAILED (tmux timing out — the overload condition), occupancy is UNKNOWABLE: every
      // session would read window-less and isOccupying would undercount, so the drainer would OVER-launch and pile
      // MORE compute onto an already-thrashing box. Under load, do the safe thing — launch nothing this pass and
      // let the next tick re-drain once the probe recovers ([[state]] board honesty applied to the cap).
      if (snap.probeFailed) break
      const occupied = sessions.reduce((n, s) => n + (launching.has(s.id) || isOccupying(s, snap) ? 1 : 0), 0)
      if (occupied >= cap) break
      const next = sessions.find((s) => s.status === 'queued' && !launching.has(s.id))
      if (!next) break
      if (!(await startQueued(next.id))) break   // launch failed → stop this pass; a later tick retries
    }
  } finally { draining = false }
}

// @@@ superviseQueue - the periodic drainer. Started once at serve(). The explicit drainQueue() calls on
// newSession/close/propose cover the slot-freeing events the SERVER handles, but an agent proposing done or
// going parked writes its global session.json record from a hook subprocess the server never sees, and a crash just makes a
// socket vanish — so a timer is what turns those into freed slots. Cheap: one worktree+tmux snapshot per tick,
// and a no-op when nothing is queued. Idempotent (guarded), so a second call is harmless.
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

// @@@ assertProjectMatch - a WRITE is PROJECT-BOUND, but routing is by URL. A mutating verb's intent is
// "act on the project my cwd is in", yet the resolved base is a pure URL carrying no project identity —
// the backend it answers acts on ITS OWN mainRoot, so a stale inherited SPEXCODE_API_URL (pointing at
// another repo's backend) silently lands the write in the WRONG repo. Read/control-READS deliberately
// point anywhere (viewer-points-anywhere, see remote-client); every MUTATING verb (new/merge/send/close/
// rename/input/resume/stop) is bound to the caller's project. So before writing, compare the caller's
// repo root to the backend's served root and FAIL LOUD on a provable, same-host mismatch — never a silent
// misroute. An explicit `--api`/`--port` flag SKIPS the guard: the flag is the one provably-deliberate
// cross-project signal (that's the whole flag-beats-env thesis). The guard fires only on a positive
// mismatch: no local repo, an unreachable backend, or a backend root that isn't a resolvable local path
// (a genuinely remote backend) all fall through to allow, so legit remote drive stays untouched.
export async function assertProjectMatch(verb: string): Promise<void> {
  const { url, source } = await apiBaseInfo()
  if (source === 'flag') return                                   // explicitly routed — the caller named the target
  let localMain: string
  try { localMain = realpathSync(mainRoot()) } catch { return }   // caller not in a repo → can't prove a mismatch
  let served: string | null = null
  try {
    const r = await fetch(`${url}/api/layout`)
    if (r.ok) served = (await r.json() as { main?: string }).main ?? null
  } catch { return }                                              // backend unreachable → the write itself surfaces it (fail-loud there)
  if (!served || !isAbsolute(served)) return                      // unknown / config-aliased root → don't risk a false refusal
  let backendMain: string
  try { backendMain = realpathSync(served) } catch { return }     // backend root not a local path → a remote backend, allow
  if (backendMain !== localMain) {
    const e = new Error(
      `${verb}: refusing WRITE — cwd is in ${localMain} but the backend at ${url} serves ${backendMain}.\n` +
      `Name the target explicitly (--api <url> / --port <n>) to write cross-project on purpose,\n` +
      `or run this project's own backend:  cd ${localMain} && spex serve.  (Reads stay unguarded.)`)
    e.name = 'GuardError'
    throw e
  }
}

// @@@ createSession (dispatch via backend) - `spex session new` must launch the worker in the
// BACKEND's process, not the caller's, because the backend is the single owner of the concurrency cap and the
// launch QUEUE (drainQueue). An in-process launch by an agent that runs `spex session new` (e.g. a supervisor) would
// bypass that queue and the maxActive gate. (The launch COMMAND is not a process-env concern anymore — it
// comes from the session's pinned launcher, resolved from project config [[launcher-select]], identical in
// either process.) So the CLI POSTs to the running backend whenever one answers. Only when NO backend is
// reachable do we fall back to launching in this process (with a stderr warning) — the backend's own POST
// handler calls newSession directly, so it never re-enters this path.
export async function createSession(node: string | null, prompt: string, launcher?: string): Promise<Session> {
  await assertProjectMatch('spex session new')
  // @@@ parent = the CALLER's own session ([[session-nesting]]). Resolve it HERE, in the caller's process,
  // via the SAME ownSessionId env read [[agent-reply-channel]] uses for its sender hint — NOT inside the
  // backend, whose process env carries no acting session id. An agent that runs `spex session new` stamps its own id;
  // a human in a plain shell has none → null → the new session is top-level (no phantom nesting).
  const parent = ownSessionId()
  let res: Response
  try {
    res = await fetch(`${await apiBase()}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node, prompt, parent, launcher }),
    })
  } catch {
    console.error('spex: no backend reachable — launching in-process (caller env owns auth, no concurrency cap)')
    return newSession(node, prompt, parent, launcher)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error || text } catch {}
    const err = new Error(`backend rejected session (${res.status}): ${msg}`)
    err.name = 'BackendError'
    throw err
  }
  return await res.json() as Session
}

// @@@ newSession - durable worktree (branch node/<slug> off main) + a global session.json record. The agent does NOT
// launch inline any more: the worktree is prepared and parked as `queued`, then drainQueue() launches it
// immediately if we're under the concurrency cap, else it waits its turn. Backs both the dashboard POST and
// `spex session new`. Creating or deleting a spec node is NOT a server op — it is prompt-driven work the
// launched agent does itself (the composer's nn/dd chords just prefill a plain instruction). So the server
// only ever launches a session; it never mutates the spec tree ([[mentions]]: the issue store is the sole
// programmatic surface, every other surface is prompt only).
export async function newSession(node: string | null, prompt: string, parent: string | null = null, launcher?: string): Promise<Session> {
  const id = randomUUID()
  // a launcher ([[launcher-select]]) fixes BOTH the launch command (persisted below) AND the harness — so
  // picking one is the ONLY launch choice. Explicit --launcher wins, else the configured defaultLauncher.
  // A missing/unknown default throws fail-loud; there is no built-in-claude or harness fallback.
  const lname = launcher ?? defaultLauncher(mainRoot())
  const chosen = resolveLauncher(lname)
  const h = harnessById(chosen.harness)
  // node identity + label: explicit --node wins, else the prompt's first `[[id]]` topic ref; a prompt with
  // none is node-agnostic and labeled by its first few words.
  const ref = node || mentionedNode(prompt)
  const title = ref ? null : titleFromPrompt(prompt)
  const slug = `${slugify(ref || title)}-${id.slice(0, 4)}`
  const branch = `node/${slug}`
  const path = join(mainRoot(), '.worktrees', slug)
  await gitA(['-C', mainRoot(), 'worktree', 'add', '-b', branch, path, mainBranch()])
  // the checkout delivers the tracked spec sources and the materialize below delivers the materialized
  // artifacts; the ONE
  // thing git cannot carry is the machine-local spexcode.local.json — copied as a snapshot ([[residence]];
  // no-op when the main checkout has none).
  seedWorktreeHostState(mainRoot(), path)
  // prepared but NOT launched: enters the queue as `queued`. drainQueue() below launches it at once when a
  // slot is free, else it waits — durable as a global record (+ its worktree), so it survives a backend
  // restart and is still findable. governed:true — this is a DASHBOARD/CLI-launched session, so it feeds the
  // board and the lifecycle hooks act on it; worktreePath/branch/createdAt are stamped here (the record, not
  // the worktree, is the board's enumeration source now).
  const rec: SessRec = {
    session: id, governed: true, worktreePath: path, branch,
    // parent = the SPAWNING session's id, captured ONCE here ([[session-nesting]]): a durable pointer, never
    // mutated after. A self-parent (a resolver quirk) is dropped so a session can't nest under itself.
    node: ref || null, title, name: null, parent: parent && parent !== id ? parent : null,
    status: 'queued', proposal: null, merges: 0, note: null, sortKey: null, createdAt: Date.now(),
    harness: h.id, harnessSessionId: null, launcher: chosen.name,
    // PIN the resolved base launcher command NOW ([[launcher-select]] resume-launcher-pin) so every future
    // (re)launch replays THIS exact launcher — the one whose config-dir env holds the conversation — instead of
    // re-resolving against a default that may have flipped (a backend restarted under a different launcher).
    launchCmd: h.baseCmd(chosen.cmd),
  }
  writeRecord(rec)
  writePromptFile(id, prompt)   // capture the ORIGINATING prompt (the human/manager's ask) as store metadata (best-effort)
  // materialize the harness-discovered artifacts INTO the worktree (CLAUDE.md/AGENTS.md contract block, .claude/.codex
  // shims, manifest to the global store) so the launched agent gets the contract + hooks the SAME way a
  // self-launched one does — by auto-discovery, not CLI injection. This is why the launch line below carries no
  // --append-system-prompt / --settings, and why we no longer hide CLAUDE.md: hiding it suppressed the agent's
  // own memory load too. One delivery path for both launch modes ([[harness-delivery]]).
  bootstrapMaterialize(rec)
  let launchPrompt = prompt
  if (ref) {
    // @@@ spec pointer - the ref (explicit --node, else the prompt's first [[id]] ref) named an EXISTING node.
    // Append ONE line pointing the agent at that node's spec.md as an ABSOLUTE path INSIDE its own worktree, so
    // it reads the LIVE file (never a stale snapshot we'd inject). relPath already carries the .spec/ prefix and
    // is identical in this freshly-branched worktree, so the absolute path is just join(worktree, relPath). Only
    // a real node gets a pointer; an unknown id resolves to nothing and we fail quiet (no pointer appended).
    const spec = (await loadSpecs()).find((n) => n.id === ref)
    if (spec) launchPrompt = `${prompt}\n\nThe spec node \`${ref}\` is your ground truth — read its spec at ${join(path, spec.path)}.`
  }
  writeLaunchFile(id, launchPrompt)     // park the exact launch prompt for the drainer (consumed at launch)
  await drainQueue()                    // launch now if under the cap, else leave it queued for a free slot
  const after = readRecord(id) ?? rec   // 'active' if the drain launched it, else still 'queued'
  // queued → no process yet (offline liveness); just-launched → its socket is still booting (starting).
  const queued = after.status === 'queued'
  return toSession(after, queued ? 'queued' : 'working', queued ? 'offline' : 'starting')
}

// @@@ bootstrapMaterialize - the creation-time materialize is BOOTSTRAP, not best-effort: it is what writes
// the worktree's .claude/.codex shims (the settings.json hook wiring) in the first place, and every
// lifecycle dispatch RIDES ON those hooks — so when this materialize fails, no hook ever fires,
// and the worker comes up ungoverned (no contract block, no stop-gate) with nothing saying so. Fail loud
// instead: log the cause + worktree, and stamp the failure on the record's `note` so the board/watch surface
// it. The launch still proceeds — a visibly degraded worker the human can close + re-dispatch beats a refused
// launch, and status stays agent-authored ([[state]]): we stamp the note, never an inferred `error` state.
// `doMaterialize` is injectable only so tests can simulate the failure.
export function bootstrapMaterialize(rec: SessRec, doMaterialize: (proj: string) => unknown = materialize): void {
  try {
    doMaterialize(rec.worktreePath)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`spex: materialize failed for worktree ${rec.worktreePath} — hooks/contract not materialized, worker launches UNGOVERNED: ${msg}`)
    writeRecord({ ...rec, note: `materialize failed at creation — worker ungoverned (no hooks/contract): ${msg}` })
  }
}

// @@@ waitForReady - after a launch/relaunch, the agent needs SEVERAL SECONDS to come up; launch() only TYPES
// the start line via send-keys and returns immediately, so the agent's online-signal does not exist yet on
// return. Poll the ADAPTER's liveness ([[harness-adapter]]) at a small interval up to a bounded timeout so the
// agent counts as "ready" only once it is genuinely online — claude: its rendezvous socket up; codex: its
// project app-server socket up AND native thread id captured — then a follow-on dispatch (merge / send) lands
// in a LIVE agent instead of racing the boot and failing loud on a session that is actually recovering.
// BOUNDED + fail-loud preserved: a
// genuinely dead/unrecoverable agent never goes online, so after the timeout we return and the caller's own
// deliver() fails loud exactly as before — this only closes the startup race, it adds no fallback.
const SOCKET_READY_TIMEOUT_MS = 30000   // spans launchScript's bounded fast-fail relaunch window, so
                                        // waitForReady (slot-hold + resume) waits through a daemon-race retry
                                        // instead of returning before a recovering socket
const SOCKET_POLL_MS = 200
async function waitForReady(id: string, harness: Harness, timeoutMs = SOCKET_READY_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rec = readRecord(id)
    const snap = await liveSnapshot()   // window + pane probe + live-listener set in one snapshot — all the adapter needs
    if (rec && harness.liveness(rec, snap.windows.has(id), runtimeRoot(), snap.windows.get(id), snap.sockets.has(id)) === 'online') return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, SOCKET_POLL_MS))
  }
}

// @@@ resumeSession - bring the agent back up and settle its RESTING lifecycle. THREE rules:
//   • RESUME GUARD ([[state]]): a relaunch KILLS the running agent (`kill-session` + fresh window), so it is a
//     data-loss operation the moment the agent is actually ALIVE — the incident's kill-shot was restore-on-alive
//     (the board LIED offline, the human relaunched, live workers died mid-work). So resume re-derives the
//     agent's liveness FRESH and, when the caller is guarding (the human relaunch panel / `spex session resume`,
//     `guard` default true), REFUSES LOUD rather than relaunch a live agent — you steer a live agent by
//     MESSAGING it, not by restoring it. Death must be PROVEN: an `unknown` probe (tmux timed out under load —
//     the exact condition that started the incident) also refuses, since a live worker can't be ruled out. A
//     `force` escape exists for a genuinely-wedged-but-alive process. The merge dispatch passes `guard:false`:
//     it only needs a LIVE agent to send the merge prompt to, so an already-online agent is a satisfied no-op
//     (never a refusal), and only a CONFIRMED-offline one is relaunched.
//   • liveness/relaunch: relaunch only when the agent is CONFIRMED `offline` (or `force`) — never on `online`
//     (alive), `starting` (booting), or `unknown` (unproven). We drop any stale pane and launch a fresh window
//     through the adapter's resumeArg — claude `--resume <id>` (the SAME conversation), codex `resume
//     <thread-id>` once captured, else a fresh TUI — then WAIT (waitForReady) so a caller that dispatches
//     immediately after (mergeSession's merge) addresses a LIVE agent, not a racing boot.
//   • lifecycle: the SAME active-only guard markIdle uses — a resumed agent that was WORKING (`active`) is now
//     just sitting at its prompt → `idle`; EVERY deliberate declaration survives untouched (`awaiting` + its
//     proposal, `asking`, `parked`, `error`, `queued`). resume does NOT touch the `proposal` — resuming a
//     session that is proposing a merge must NOT silently withdraw it. Only applied when we actually relaunch;
//     a refusal leaves the record wholly untouched.
// Fail-loud is unchanged: if the agent never comes online, the later deliver() fails loud.
export async function resumeSession(id: string, opts: { force?: boolean; guard?: boolean } = {}): Promise<{ ok: boolean; error?: string; refused?: boolean }> {
  const { force = false, guard = true } = opts
  const wt = await findWorktree(id)
  if (!wt) return { ok: false, error: `no such session ${id}` }
  const h = harnessById(wt.rec.harness || defaultHarness.id)
  const lv = liveness(wt.rec, await liveSnapshot())   // FRESH, honest liveness (listener-verified) — the guard must not trust a stale board reading
  if (guard && !force && lv === 'online')
    return { ok: false, refused: true, error: `session ${id} is ALIVE — refusing to relaunch, which would kill a live worker mid-work. To steer it, send it a message; use force only for a genuinely wedged (but alive) process.` }
  if (guard && !force && lv === 'unknown')
    return { ok: false, refused: true, error: `session ${id}: the liveness probe failed (the box is likely overloaded) — refusing to relaunch since a live worker can't be ruled out. Retry in a moment, or use force to override.` }
  // proceeding: settle the RESTING lifecycle (a resumed working agent is now idle), then relaunch iff the agent
  // is CONFIRMED offline (or force — the wedged-but-alive escape). `starting`/`unknown` fall through to a no-op.
  writeRecord({ ...wt.rec, status: wt.rec.status === 'active' ? 'idle' : wt.rec.status })
  if (force || lv === 'offline') {
    await tmuxOk(['kill-session', '-t', id])   // drop a dead/offline pane (or a force-killed live one)
    await launch(id, wt.path, h.resumeArg(wt.rec).trim(), h, launcherCmd(wt.rec))   // resume under the SAME persisted launcher ([[launcher-select]])
    await waitForReady(id, h)   // a relaunched agent is "ready" only once the adapter reads it online
  }
  return { ok: true }
}

// @@@ agent-authored state - the agent (forced by gates at boundaries) writes its OWN state; it is the
// authority on what a stop MEANS (awaiting human vs parked on a background task). External hooks only know
// SOMETHING changed, not the transition, so they force a write, never infer. The session it writes is resolved
// by id: `sessionId` (the hooks pass `--session <id>` from the payload) wins, else ownSessionId() (the env var
// the agent's own `spex session …` carries). Unknown id / no record → false (the route/CLI reports it).
export function markState(status: Lifecycle, opts: { proposal?: Proposal; note?: string; sessionId?: string } = {}): boolean {
  const id = opts.sessionId || ownSessionId()
  if (!id) return false
  const rec = readRecord(id)
  if (!rec) return false
  writeRecord({
    ...rec, status,
    proposal: status === 'awaiting' ? (opts.proposal ?? 'nothing') : null,
    note: opts.note ?? null,
  })
  return true
}
export const markDone = (proposal: Proposal = 'nothing', sessionId?: string, note?: string) => markState('awaiting', { proposal, note, sessionId })
export const markError = (sessionId?: string) => markState('error', { sessionId })
export function markHarnessSessionId(sessionId: string | undefined, harnessSessionId: string | undefined): boolean {
  const id = sessionId || ownSessionId()
  if (!id || !harnessSessionId) return false
  const rec = readRecord(id)
  if (!rec) return false
  writeRecord({ ...rec, harnessSessionId })
  return true
}
// @@@ markIdle - the ONE INFERRED state, so (unlike the agent-authored writers above) it carries a strict
// active-only guard: the Notification(idle_prompt) hook fires it when claude is waiting at its prompt, and it
// may ONLY overwrite `active` → `idle`. A deliberate declaration (awaiting / asking / parked / error) must
// survive — idle only fills the gap where the agent stopped WITHOUT declaring (e.g. an API error killed the
// turn before the Stop gate). The mark-active hook flips idle → active on resume. Same id resolution as markState.
export function markIdle(sessionId?: string): boolean {
  const id = sessionId || ownSessionId()
  if (!id) return false
  const rec = readRecord(id)
  if (!rec || rec.status !== 'active') return false  // active-only: never clobber a declaration
  writeRecord({ ...rec, status: 'idle' })
  return true
}
// @@@ asking has TWO writers, both deterministic (neither guarded active-only): (1) the mark-active
// PreToolUse hook captures it the instant the agent invokes the AskUserQuestion tool (status=asking,
// the question as the note) — a HARD signal that the agent is asking the human; (2) the agent declares it
// itself via markState('asking', { note }) — `spex session ask`, e.g. at the Stop gate. Either
// way the mark-active path clears it back to active on the next tool / prompt, same as any non-active state.

// @@@ mergeReadiness - the deterministic commit gate the Stop hook enforces before a session may declare
// done / propose merge. The dogfood ritual lands every change as a COMMIT on the node branch first, so two
// states block a declaration: (1) any uncommitted working-tree change, or (2) 0 commits ahead of main
// (nothing committed to merge). Since the global-store refactor, SpexCode writes NO per-session files into
// the worktree (the runtime lives in ~/.spexcode), and the only in-tree SpexCode artifacts are exclude-
// hidden materialized artifacts or filter-covered contract blocks ([[residence]]), so
// neither shows as an uncommitted change — the worktree is pristine and EVERY dirty path is genuine spec/code
// work, no runtime-file filtering needed.
// Runs from cwd = the session worktree; ALL git goes through git() so the hook's exported GIT_DIR/GIT_INDEX_FILE
// can't misdirect repo discovery to the cwd (the same trap git.ts documents). `main` resolves via the shared
// refs, so `main..HEAD` works from any linked worktree regardless of where main is checked out.
export function mergeReadiness(): { ready: boolean; reason?: string } {
  let dirty: string[] = []
  try {
    dirty = git(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map(porcelainPath)
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

// @@@ MANAGER COCKPIT - the review payload (the cockpit's first verb; see the manager-cockpit spec node).
// One server-side bundle that lets a manager (human or agent) decide whether to merge a session WITHOUT
// hand-running git: how far ahead it is, its REAL changes (merge-base diff, never a phantom main..HEAD one),
// whether uncommitted non-runtime work remains, the merge/lint gates, and the agent's standing proposal.
// ahead/dirty/diff/conflicts are computed against the SESSION's worktree (per id); lint reflects the CLI
// package's OWN location (where this runs) — the spec-cli that's actually live. There is deliberately NO
// build/typecheck/test gate: whether a change is SOUND is proven by the node's yatsu (measured through the
// real product), not by a language-specific automated checker — so the gates stay language-agnostic (git +
// the spec↔code graph, which every governed project has, TS or Python or otherwise). null when no session
// has that id.
export type ReviewGates = {
  conflictsWithMain: boolean                       // a dry-run merge into main would conflict (in-memory, safe)
  lint: { errorCount: number; warningCount: number } // the spec↔code graph lint
}
export type ReviewPayload = {
  id: string; node: string | null; branch: string | null
  label: string              // the session's identity, derived ONCE via deriveLabel — the review surface renders THIS, never its own node||branch||id chain
  ahead: number              // commits the node branch is ahead of main
  dirtyNonRuntime: number    // uncommitted files excluding SpexCode's own runtime files
  diff: ReviewDiffFile[]     // the worker's real changes, anchored at the merge-base
  gates: ReviewGates
  proposal: { kind: Proposal | null; note: string | null }   // the session's standing proposal + its note
}

// @@@ lintGate - the spec↔code graph lint is a LOCATION gate: a function of the backend checkout's tree ALONE
// (its .spec graph + governed files), not of which session is reviewed, and it costs a few seconds. Re-running
// it on every reviewPayload — i.e. on every [[review-proof]] Proof-tab open, and once per session — is
// wasteful, so memoize it on a whole-repo fingerprint: `rev-parse HEAD` + `status --porcelain` + the mtimes of
// the changed paths (covers committed state, the dirty SET, and dirty-file CONTENT). An identical fingerprint
// reuses the last (in-flight) result — a re-open or a second session's proof is instant — while any commit or
// working-tree edit moves the fingerprint and recomputes. A rejected run is not cached.
let gateCache: { fp: string; p: Promise<ReviewGates['lint']> } | null = null
async function lintGate(): Promise<ReviewGates['lint']> {
  const root = repoRoot()
  const [head, status] = await Promise.all([
    gitA(['-C', root, 'rev-parse', 'HEAD']),
    gitA(['-C', root, 'status', '--porcelain', '--untracked-files=all']),
  ])
  // `status --porcelain` gives the SET of changed paths + status letters but is CONTENT-BLIND: re-editing an
  // already-listed (dirty or untracked) file leaves the string byte-identical, so HEAD+status alone would
  // freeze the gate after a file first goes dirty. `--untracked-files=all` stops an untracked dir from
  // collapsing to one line (which hides a newly-added file); then fold each listed path's mtime in, so a
  // content edit to a dirty file also moves the fingerprint. HEAD covers committed state, this covers the
  // working tree. (Residual, accepted: the fingerprint is snapshot just before the compute, so a change
  // landing mid-compute is labelled with the pre-change fp — rare, and the gate is advisory, re-verified at merge.)
  const mtimes = status.split('\n').filter(Boolean).map(porcelainPath)
    .map((p) => { try { return statSync(join(root, p)).mtimeMs } catch { return 0 } }).join(',')
  const fp = head.trim() + '\n' + status + '\n' + mtimes
  if (gateCache?.fp === fp) return gateCache.p
  const p = (async () => {
    const { specLint } = await import('./lint.js')
    const findings = await specLint()
    return {
      errorCount: findings.filter((f) => f.level === 'error').length,
      warningCount: findings.filter((f) => f.level === 'warn').length,
    }
  })()
  p.catch(() => { if (gateCache?.p === p) gateCache = null })   // don't pin a failed run
  gateCache = { fp, p }
  return p
}

// @@@ reviewPayload - assemble the cockpit review for one session. The four session-specific reads
// (ahead / dirty / diff / conflict gate) plus the one location gate (lint) are all independent, so they run
// in parallel. The lint gate goes through lintGate(), which memoizes it on the checkout's tree fingerprint —
// so an unchanged tree doesn't re-run the lint on each review / Proof-tab open, while any commit or edit
// invalidates and recomputes.
export async function reviewPayload(id: string): Promise<ReviewPayload | null> {
  const wt = await findWorktree(id)
  if (!wt) return null
  const base = mainBranch()
  const [aheadOut, statusOut, diff, conflictsWithMain, lint] = await Promise.all([
    gitA(['-C', wt.path, 'rev-list', '--count', `${base}..HEAD`]),
    gitA(['-C', wt.path, 'status', '--porcelain', '--untracked-files=all']),
    mergeBaseDiff(wt.path, base),
    mergeConflicts(wt.path, base),
    lintGate(),   // lint — memoized on the checkout fingerprint, not re-run per session/open
  ])
  // the worktree carries no SpexCode runtime files any more (the store lives in ~/.spexcode), so every dirty
  // path is genuine work — this is just the total uncommitted count.
  const dirtyNonRuntime = statusOut.split('\n').filter(Boolean).map(porcelainPath).length
  return {
    id, node: wt.rec.node, branch: wt.branch,
    label: deriveLabel({ id, name: wt.rec.name, node: wt.rec.node, title: wt.rec.title, branch: wt.branch }),
    ahead: Number(aheadOut.trim()) || 0,
    dirtyNonRuntime, diff,
    gates: { conflictsWithMain, lint },
    proposal: { kind: wt.rec.proposal, note: wt.rec.note },
  }
}

// @@@ mergePrompt - the human's merge INTENT, handed to the session's OWN agent. Merge is a DISPATCH, not a
// server git script: the agent knows the work, so IT runs the merge, resolves any conflicts, and VERIFIES the
// outcome — the guarantee lives in that verification, never a server-side gate. This is also the ONE place the
// merge STYLE is stated (no other mechanism carries it): a --no-ff merge commit `merge <branch>: <reason>`
// into main. The agent runs git from the MAIN checkout (`-C <mainPath>`; its own cwd is the node worktree).
// After a clean merge the branch is 0 ahead of main, so the agent proposes CLOSE — not merge (the commit gate
// would block a merge proposal; propose-close is exempt) — and the human confirms the close.
function mergePrompt(mainPath: string, branch: string, reason: string): string {
  const base = mainBranch()
  return `Merge your branch \`${branch}\` into \`${base}\`, then propose close. You know this work, so resolve any conflicts yourself.\n\n` +
    `1. Merge from the main checkout with a no-ff merge commit:\n   git -C ${mainPath} merge --no-ff -m "merge ${branch}: ${reason}" ${branch}\n` +
    `2. If it conflicts, resolve the conflicts (you know the intent) and complete the merge commit. ` +
    `3. Verify it landed: \`${base}\`'s HEAD must now be the new merge commit and no merge may be left in progress — if anything went half-merged, run \`git -C ${mainPath} merge --abort\` and report it rather than leaving \`${base}\` mid-state. ` +
    `4. Once you've verified \`${base}\` advanced cleanly, propose close for the human — do NOT close it yourself.`
}

// @@@ mergeSession - the cockpit's ACT verb, the sequel to review — but a DISPATCH, not a server script: the
// SESSION'S OWN agent lands the merge, never the server (it carries no `git merge` logic and never touches
// main's tree). It resumes the session (clears the proposal, `--resume`s via resumeSession if tmux died —
// which waits for the rendezvous socket, closing the just-relaunched-no-socket race) and dispatches mergePrompt
// — that delivered prompt flips the lifecycle to active regardless of resume's resting state
// through sendText. The reason = the node branch's latest commit subject minus a leading `spec: ` (visible from
// the main checkout, no worktree path needed). Async + fail-loud: returns {dispatched:true} once the prompt is
// CONFIRMED accepted, else {dispatched:false, reason} (the loud DispatchResult error). The server no longer
// re-checks gates, runs git, bumps `merges`, or closes the session — review shows the gates; the agent verifies.
export async function mergeSession(id: string): Promise<{ dispatched: boolean; reason?: string }> {
  const wt = await findWorktree(id)
  if (!wt || !wt.branch) return { dispatched: false, reason: 'no such session' }
  const branch = wt.branch, main = mainRoot()
  // ensure-live, NOT the guarded human relaunch: an already-online agent is reused (the merge prompt just needs
  // a live socket), and only a confirmed-offline one is relaunched — so merge never refuses on a live agent.
  const re = await resumeSession(id, { guard: false })
  if (!re.ok) return { dispatched: false, reason: re.error || 'could not resume session' }
  const subject = (await gitA(['-C', main, 'log', '-1', '--format=%s', branch])).trim()
  const reason = subject.replace(/^spec:\s+/, '') || branch
  const r = await sendText(id, mergePrompt(main, branch, reason))
  if (!r.ok) return { dispatched: false, reason: r.error }
  return { dispatched: true }
}

// @@@ stopAgentProcess - the shared teardown both stop and close begin with, so there is ONE kill path, not
// two: kill the agent's tmux client, drop its boot-window stamp (else a just-launched id lingers in the grace
// window reading `starting` instead of `offline`), and sweep its rendezvous socket. The socket lives in the OS
// tmpdir (NOT the worktree), so worktree removal alone would leave it behind — closing many sessions over time
// would accumulate stale `spexcode-rv-*.sock` files; we unlink it here (force = no error if claude/OS already
// removed it). Deliberately does NOT drainQueue — the caller drains once, after it has settled the worktree.
async function stopAgentProcess(id: string): Promise<void> {
  await tmuxOk(['kill-session', '-t', id])
  launchedAt.delete(id)
  try { rmSync(rvSock(id), { force: true }) } catch { /* best-effort sweep; tmpdir socket, claude/OS may already be gone */ }
}

// @@@ stopSession - the SOFT stop (vs closeSession's removal): stops the agent process but LEAVES the durable
// worktree + branch + transcript intact. The session stays on the board, now reading `offline` (no tmux window)
// whatever its lifecycle, so the relaunch panel offers to --resume the SAME conversation (see resumeSession). This is
// "step away, come back later"; closeSession is "discard this work". An offline session occupies no slot, so
// the freed capacity drains a queued session next (drainQueue).
export async function stopSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await stopAgentProcess(id)
  void drainQueue()   // a stop frees a slot — start the next queued session if any
  return !!wt
}

// @@@ closeSession - the REMOVAL (human-confirmed): stop's soft kill PLUS removing the worktree + branch AND
// the session's whole global-store record dir — the work is gone, not just stopped. Same stop primitive as
// stopSession (no duplicate kill path), then the git worktree/branch teardown that stop deliberately skips,
// then the store sweep (stop KEEPS the record so the session stays on the board offline; close discards it).
// The tree's materialize slot ([[runtime]] trees/<enc>) retires with the worktree — its key needs the live tree,
// so it is resolved BEFORE the removal; both sweeps are best-effort (residue is swept at uninstall anyway).
export async function closeSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await stopAgentProcess(id)
  if (wt) {
    let slot: string | null = null
    try { slot = treeSlotDir(wt.path) } catch { /* tree already unresolvable — nothing to key the slot by */ }
    await gitA(['-C', mainRoot(), 'worktree', 'remove', '--force', wt.path])
    if (wt.branch) await gitA(['-C', mainRoot(), 'branch', '-D', wt.branch])
    if (slot) { try { rmSync(slot, { recursive: true, force: true }) } catch { /* best-effort GC */ } }
  }
  try { rmSync(sessionStoreDir(id), { recursive: true, force: true }) } catch { /* best-effort sweep of the global record */ }
  void drainQueue()   // a close frees a slot — start the next queued session if any
  return !!wt
}

// @@@ captureSessionResult - the session's live pane as a one-shot snapshot (output), the server side of
// `GET /api/sessions/:id/capture` that `spex session show --capture` (a backend client) reads. A monitoring read MUST
// distinguish "I failed to read" from "the pane is genuinely empty" — the old captureSession collapsed
// unknown-id, offline, and capture-error all to `''`, indistinguishable from an empty pane (a blank screen
// that exits 0 is worse than useless to a manager). So the result is DISCRIMINATED: an empty pane is a
// legitimate `{ok:true, pane:''}`; the three failure modes carry distinct reasons the route maps to distinct
// HTTP codes (unknown→404, offline→409, capture-failed→502). The known-vs-offline check only runs on the
// cold/not-alive branch, so a live capture (the polled hot path) costs just the one capture-pane.
export type CaptureResult = { ok: true; pane: string } | { ok: false; reason: 'unknown' | 'offline' | 'capture-failed' }
export async function captureSessionResult(id: string): Promise<CaptureResult> {
  if (!(await alive(id))) {
    const known = (await listSessions()).some((s) => s.id === id)
    return { ok: false, reason: known ? 'offline' : 'unknown' }
  }
  try { return { ok: true, pane: await tmux(['capture-pane', '-e', '-p', '-t', id]) } }
  catch { return { ok: false, reason: 'capture-failed' } }
}

// @@@ watch - the event source for Claude Code's Monitor tool (first-class managing-agent support).
// Polls the session list and emits the COMPLETE session lifecycle so it's a true "subscribe to all
// session changes" feed: a LAUNCH (first sighting of an id, even though it enters at 'working', which is
// not actionable — emitted ONCE per id so a manager learns a new session started), each ACTIONABLE state
// transition — review / done / close-pending (agent proposals), offline (process died), error — and the
// removal. Per Monitor's "silence is not success" rule a vanished session pings too. Net feed:
// launched → [actionable transitions] → closed. Each line names the suggested next action(s). Drop into Monitor:
//   Monitor({ command: 'spex session watch', persistent: true, description: 'session state changes' })
// @@@ presentation + selection - shared by `spex session ls` (pretty), `spex session watch` (events) and the API.
export const STATUS_GLYPH: Record<DisplayStatus, string> = {
  working: '\u25cf', idle: '\u25cb', offline: '\u23fb', starting: '\u25d4', review: '\u25c6', done: '\u2713',
  'close-pending': '\u2715', parked: '\u29d6', error: '\u2717', asking: '\u2370', queued: '\u25cc', unknown: '\u2047',
}
const ANSI: Record<DisplayStatus, string> = {
  working: '33', idle: '90', offline: '90', starting: '36', review: '35', done: '34', 'close-pending': '31', parked: '36', error: '31', asking: '93', queued: '90', unknown: '93',
}

// @@@ session selectors - the ONE matcher every session command shares (see [[session-selectors]]). A
// selector matches a session iff it is the session's full id, an id-PREFIX, its node, or its branch. This is
// the single predicate; selectSessions (MANY) and resolveSession (ONE) both call it, so id-prefix/node/branch
// resolution can never drift between "which sessions ls/watch/wait/graph show" and "which session
// review/merge/send/close act on".
export function matchesSelector(s: Session, q: string): boolean {
  // a selector may be a comma-separated list (the same convention as `--status a,b`): it matches iff ANY part
  // names the session, so `watch a,b` and `watch a b` are equivalent. A single name is the one-part case. This
  // is what stops a comma-joined selector from silently matching nothing — an id/node/branch never holds a
  // comma, so without the split `a,b` would be one literal selector that matches no session and streams in
  // silence forever. Each part sheds an optional reference sigil (stripRefSigil): `@<sel>` / `[[<sel>]]` name
  // the same session as the bare token, so the dashboard's mention grammar is tolerated in every CLI selector.
  return q.split(',').map((p) => stripRefSigil(p.trim())).filter(Boolean)
    .some((p) => s.id === p || s.id.startsWith(p) || s.node === p || s.branch === p)
}

// no selectors (or '@all') = everything. Optional status filter on top. This IS the ls/watch subscription.
export function selectSessions(all: Session[], selectors: string[], statuses?: string[]): Session[] {
  let out = all
  const sel = selectors.filter((x) => x && x !== '@all')
  if (sel.length) out = out.filter((s) => sel.some((q) => matchesSelector(s, q)))
  if (statuses && statuses.length) out = out.filter((s) => statuses.includes(s.status))
  return out
}

// @@@ resolveSession - resolve ONE selector to ONE session against a board: the single-target counterpart of
// selectSessions, for the control verbs (review/send/merge/close/resume/show). The backend matches
// ids EXACTLY, so a verb resolves the selector here first and then calls with the FULL id — a node/branch/
// prefix selector drives a verb just as it filters `ls`. The result is DISCRIMINATED so a caller can fail
// precisely: an exact full-id hit wins outright (never reported ambiguous just for prefixing a longer id);
// otherwise a lone match is `ok`, several is `ambiguous` (a prefix/node hitting many), none is `none`.
export type Resolved = { ok: Session } | { ambiguous: Session[] } | { none: true }
export function resolveSession(selector: string, sessions: Session[]): Resolved {
  // the exact-id check sheds the optional sigil too, so `@<full-id>` keeps the exact-wins-over-prefix rule
  const exact = sessions.find((s) => s.id === stripRefSigil(selector))
  if (exact) return { ok: exact }
  const hits = sessions.filter((s) => matchesSelector(s, selector))
  if (hits.length === 1) return { ok: hits[0] }
  return hits.length ? { ambiguous: hits } : { none: true }
}

// @@@ display width - the table aligns by TERMINAL CELLS, not code units. CJK/fullwidth glyphs render
// two cells wide, so `slice`/`padEnd` (which count code units) shear a wide glyph mid-cut and under-pad
// the column, misaligning everything after it. A small wcwidth-style range check covers the wide blocks
// that actually reach session labels/prompts \u2014 no dependency needed.
const isWideCp = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||                   // Hangul Jamo
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||  // CJK radicals \u2026 kana \u2026 CJK ideographs \u2026 Yi
  (cp >= 0xac00 && cp <= 0xd7a3) ||                   // Hangul syllables
  (cp >= 0xf900 && cp <= 0xfaff) ||                   // CJK compatibility ideographs
  (cp >= 0xfe30 && cp <= 0xfe4f) ||                   // CJK compatibility forms
  (cp >= 0xff00 && cp <= 0xff60) ||                   // fullwidth forms
  (cp >= 0xffe0 && cp <= 0xffe6) ||                   // fullwidth signs
  (cp >= 0x1f300 && cp <= 0x1faff) ||                 // emoji
  (cp >= 0x20000 && cp <= 0x3fffd)                    // CJK extensions B+
export function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += isWideCp(ch.codePointAt(0)!) ? 2 : 1
  return w
}
// truncate to a display width (the ellipsis occupies its own cell); never cuts a wide glyph in half.
export function truncWidth(s: string, max: number): string {
  if (displayWidth(s) <= max) return s
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = isWideCp(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return out + '\u2026'
}
// pad to a display width \u2014 `padEnd` would count a double-cell glyph as one and under-pad the column.
export const padWidth = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
const trunc = truncWidth
// the board table's NOTE display cap \u2014 exported so the declaration echo (cli.ts) can tell an author
// exactly where their note gets cut, instead of the cap living as an anonymous magic number here.
export const NOTE_BOARD_LIMIT = 50
// short display label per status (only close-pending differs from the status name) \u2014 used by the legend.
const SHORT: Partial<Record<DisplayStatus, string>> = { 'close-pending': 'close' }

// @@@ statusLegend - one-line glyph\u2192meaning key, BUILT from STATUS_GLYPH so it can never drift from
// the glyphs the table actually prints. Shown under `spex session ls` so the symbols are self-explanatory.
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
    const name = padWidth(truncWidth(sessionLabel(s), 22), 22)
    const st = s.status.padEnd(13)
    const merges = (s.merges ? `\u00d7${s.merges}` : '').padEnd(4)
    const prompt = c('90', padWidth(s.promptPreview ? trunc(s.promptPreview, 40) : '', 42))   // what it was asked to do
    const note = s.note ? c('90', trunc(s.note, NOTE_BOARD_LIMIT)) : ''
    return `  ${c(code, g)} ${c(code, st)} ${name} ${c('90', s.id.slice(0, 8))} ${merges}${prompt}${note}`
  })
  return [c('1', `SpexCode sessions (${sessions.length})`), header, ...rows, statusLegend(color)].join('\n')
}

const WATCH_ACTIONABLE = new Set<DisplayStatus>(['review', 'done', 'close-pending', 'offline', 'error', 'asking'])
const NEXT: Record<string, string> = {
  review: 'merge | close',
  done: 'merge | close',
  'close-pending': 'close',
  offline: 'resume (relaunch the same conversation)',
  error: 'resume (relaunch & retry) | show --capture | close',
  asking: 'send "<msg>" | show --capture',
  idle: 'send "<msg>" | show --capture',
  queued: 'waiting for a free slot — starts automatically | close',
}
export function sessionEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] ${s.status} · ${sessionLabel(s)} — act: ${NEXT[s.status] || '—'}${note}${asked}  [id ${s.id}]`
}
// @@@ launchEvent - a session's FIRST sighting. A launch goes straight to 'working' (not actionable), so
// without this the watch feed would be blind to new sessions starting. Emitted ONCE per id, regardless of
// status, so `spex session watch` is a complete lifecycle feed: launched → [actionable transitions] → closed.
export function launchEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] launched · ${sessionLabel(s)} — act: capture | send "<msg>"${note}${asked}  [id ${s.id}]`
}
// @@@ source - the session board the poll reads. The CLI passes the BACKEND CLIENT (client.ts
// clientListSessions), so `spex session watch` streams whatever backend SPEXCODE_API_URL points at — including a
// REMOTE machine's. It is REQUIRED (no local default): a forgotten source must be a compile error, never a
// silent in-process read of the wrong (local) board — the exact false-green the 2-machine test guards.
export type WatchOpts = { source: () => Promise<Session[]>; selectors?: string[]; statuses?: string[]; includeIdle?: boolean; intervalMs?: number; as?: string; until?: { timeoutMs: number } }
// @@@ watch outcome - only the BOUNDED `until` mode resolves (that mode is what `spex session wait` runs on); a
// plain watch (no `until`) streams forever and never resolves. The bound is what makes `wait` a one-shot
// "block for a worker, then exit" that is GUARANTEED to return. The deadline is checked EVERY poll, before
// EVERY sleep (and even when a poll throws), so a target stuck in ANY non-actionable state
// (`working`/`parked`/`idle`/`queued`/`starting`) can never hang the caller — it exits at the deadline.
// `reached` = the target hit an actionable status; the rest are the loud exits. `backendDown` is a verdict
// about the TRANSPORT, never the session — `kind` keeps its two shapes distinct for the caller's outcome
// surface: 'unreachable' (nothing listening, the whole timeout was spent retrying) vs 'http' (reachable but
// broken, failed loud at once). The caller must surface these OUTSIDE the session-status vocabulary — a
// supervisor must never be able to read a transport failure as a session state (issue #40).
export type WatchOutcome = { reached: DisplayStatus } | { timedOut: true } | { gone: true } | { backendDown: string; kind: 'unreachable' | 'http' }
export async function watchSessions(emit: (line: string) => void, opts: WatchOpts): Promise<WatchOutcome> {
  const { source, selectors = [], statuses, includeIdle = false, intervalMs = 5000, as, until } = opts
  const tag = as ? `[${as}] ` : ''
  const prev = new Map<string, DisplayStatus>()
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // the no-hang wall: a fixed deadline computed ONCE, checked unconditionally every iteration below.
  const deadline = until ? Date.now() + Math.max(1000, until.timeoutMs) : 0
  const isActionable = (st: DisplayStatus) => WATCH_ACTIONABLE.has(st) || (includeIdle && st === 'idle')
  let warnedDown = false
  let downMsg: string | null = null   // set while the backend is unreachable, cleared on a good poll; the deadline reports it
  for (;;) {
    try {
      // EXISTENCE is the selector-matched board across ALL statuses — listSessions now lists every worktree
      // that exists (a transient detail-read failure degrades a row, never drops it — see guardWorktree), so
      // membership here IS the worktree's existence. The `statuses` filter governs only which TRANSITIONS we
      // emit, never whether a session is present — using it for presence would read a status change out of the
      // filtered set as a (false) removal.
      const all = selectSessions(await source(), selectors)
      warnedDown = false; downMsg = null   // a successful poll re-arms the down-warning (and clears the deadline's down-report)
      const ids = new Set(all.map((s) => s.id))
      const passesStatus = (st: DisplayStatus) => !statuses?.length || statuses.includes(st)
      for (const s of all) {
        if (!prev.has(s.id)) emit(tag + launchEvent(s)) // FIRST sighting → launched, any status (incl. 'working'), once
        if (s.status === prev.get(s.id)) continue // only on transition, not every tick
        prev.set(s.id, s.status)
        if (passesStatus(s.status) && (WATCH_ACTIONABLE.has(s.status) || (includeIdle && s.status === 'idle'))) emit(tag + sessionEvent(s))
      }
      // @@@ closed = the worktree is GONE. Because listSessions lists every EXISTING worktree (a flaky detail
      // read degrades, never drops), an id absent from the board means its worktree directory was actually
      // removed: a DEFINITIVE fact, not a flaky absence. So removal needs no 2-poll debounce / existsSync
      // re-check; emit `closed` exactly once the moment the id leaves the list.
      for (const id of [...prev.keys()]) {
        if (ids.has(id)) continue
        prev.delete(id)
        emit(`${tag}[spex] closed \u00b7 removed  [id ${id}]`)
      }
      // BOUNDED mode (`until`, what `spex session wait` runs): return the moment a watched target is actionable; an empty selected set
      // means the target is gone (absent from the board), which it can never come back from. Both sit inside
      // the try, after the emit pass, so the caller still saw every transition before we hand control back.
      if (until) {
        const hit = all.find((s) => isActionable(s.status))
        if (hit) return { reached: hit.status }
        if (!all.length) return { gone: true }
      }
    } catch (e) {
      // a backend error in the poll must NOT be swallowed AND must NOT emit a false `closed` for every session:
      // we skip the tick (prev is untouched → no phantom removals). Two shapes of BackendError diverge here:
      //  • REACHABLE but erroring (an HTTP status) — the backend answered and is broken: a real terminal
      //    condition, so a bounded `wait` fails loud IMMEDIATELY rather than spinning out its whole timeout.
      //  • UNREACHABLE (no status — ECONNREFUSED / fetch failed) — nothing is listening, e.g. the supervisor
      //    is rebooting its hot-reloaded child behind the stable port on a sibling merge. This is TRANSIENT:
      //    record it, warn ONCE, and keep polling — the deadline (below) is the only hard wall, so a
      //    backgrounded `spex session wait` survives the ~1s restart instead of dying on the interrupted fetch.
      if (until && isBackendDown(e) && !isBackendUnreachable(e)) return { backendDown: (e as Error).message, kind: 'http' }
      if (isBackendDown(e)) {
        downMsg = (e as Error).message
        if (!warnedDown) { warnedDown = true; console.error(`${tag}[spex] watch: ${downMsg}; retrying every ${intervalMs / 1000}s…`) }
      }
    }
    // the HARD wall — checked every iteration, in EVERY state, even after a thrown poll, BEFORE the sleep: this
    // guarantees `spex session wait` can never hang on a worker stuck outside WATCH_ACTIONABLE — nor spin forever on a
    // backend that never comes back. Hitting the deadline while still unreachable reports THAT (`backendDown`),
    // not a false "no actionable status" timeout, so the manager sees the honest cause.
    if (until && Date.now() >= deadline) return downMsg ? { backendDown: downMsg, kind: 'unreachable' } : { timedOut: true }
    await sleep(intervalMs)
  }
}

// @@@ sendText - PROMPT control for a session, delivered through the session's HARNESS ADAPTER
// ([[harness-adapter]]) — claude the rendezvous control socket (optimistic-after-liveness: the reply line flushes
// to a live socket), codex app-server JSON-RPC into the visible TUI's thread. Either way there is NO silent
// fallback: a prompt that can't be delivered — no socket / dead agent (claude), no app-server/thread (codex) — FAILS LOUD, returning
// ok:false with a reason that propagates to the caller (API non-2xx, `spex session send`, the merge dispatch),
// instead of reporting a false success. The harness is resolved from the record; an unknown id fails before any
// harness transport is addressed. (The separate RAW nav-key channel keeps its own `tmux send-keys` path — see rawKey.)
export async function sendText(id: string, text: string, from?: string): Promise<DispatchResult> {
  if (!text) return { ok: false, error: 'empty prompt — nothing to dispatch' }
  const rec = readRecord(id)
  if (!rec) return { ok: false, error: `no session record for ${id} — prompt NOT delivered` }
  const h = harnessById(rec.harness || defaultHarness.id)
  const r = await h.deliver({ ...rec, runtimeDir: runtimeRoot() }, text)
  // record the delivered agent-to-agent message ([[comms-edge]]): only when it carries a sender (an agent
  // send, not a raw human dispatch) and actually landed. Fire-and-forget — never gates the send result.
  if (r.ok && from) void recordComms(id, from)
  return r
}

// @@@ rawKey - the RAW-KEYSTROKE nav path, kept DELIBERATELY on `tmux send-keys` and NEVER the rendezvous
// socket. Two channels, two jobs: the socket INJECTS a whole prompt (text + submit), which can drive the
// agent's normal prompt but CANNOT navigate an interactive TUI select menu (e.g. `/model`'s list — ↑/↓ to
// move, ←/→ to adjust, Enter to set, `s` for this-session, Esc to cancel). When the agent is in that
// keystroke-navigation state its input box is replaced by the menu, so the dashboard's type mode forwards
// each key here in real time. send-keys is exactly right for single raw keys: named keys map to tmux's own
// key names; a single printable char is sent literally (`-l`) so tmux doesn't reinterpret it. The dashboard
// also drives the agent with MODIFIER COMBOS — a terminal's three modifiers carried as a `C-`/`M-`/`S-`
// prefix on the token (e.g. `C-r`, `M-b`, `S-Tab`, `C-M-x`); those are passed to tmux UNescaped so it parses
// the combo. One key per call, no socket and no Enter-synthesis — this IS the send-keys channel. False if
// the tmux session is gone, or if the token isn't a known base after its prefixes (defends the send-keys arg).
const TMUX_KEY: Record<string, string> = {
  Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Space: 'Space', Backspace: 'BSpace',
  Home: 'Home', End: 'End', Delete: 'DC',
}
// tmux honours an `S-` (shift) modifier ONLY on these named keys; on Enter/Space/BSpace it would send the
// literal text "S-Enter" etc. (and shift is a no-op there anyway), so a stray S- is dropped. Shift+Tab is
// the named exception: tmux spells it `BTab` (back-tab → ESC[Z, what Claude Code's mode-cycle reads).
const SHIFTABLE = new Set(['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'DC'])
// resolve ONE frontend token to the `tmux send-keys` args for it, or null if it isn't a known base after its
// prefixes (defends the send-keys arg). Pure — the batch loop below sequences the actual sends.
function rawKeyArgs(id: string, key: string): string[] | null {
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
    return ['send-keys', '-t', id, token]
  }
  if ([...rest].length === 1) {
    // a single printable char: bare → literal (`-l`, so tmux never reinterprets it as a key name);
    // modified → hand tmux the `C-`/`M-`/`S-` combo to parse (e.g. `C-a`), which `-l` would defeat.
    if (prefix) return ['send-keys', '-t', id, prefix + rest]
    return ['send-keys', '-t', id, '-l', '--', rest]
  }
  return null
}
// One call carries a BATCH of tokens (or one) — the client coalesces fast typing into an ordered array. Order
// is the whole point ([[nav-mode-key-ordering]]): the keys are sent by ONE awaited `send-keys` each, IN ARRAY
// ORDER, so they reach the pane in exactly the order they were struck. Concurrent per-key POSTs used to race
// (browser + server + send-keys all parallel) and scramble the sequence; a single serialised batch cannot.
// An unknown token is skipped without dropping the rest; false only if the tmux session is gone or nothing sent.
export async function rawKey(id: string, key: string | string[]): Promise<boolean> {
  const list = (Array.isArray(key) ? key : [key]).filter((k) => typeof k === 'string' && k.length > 0)
  if (list.length === 0 || !(await alive(id))) return false
  let sent = false
  for (const k of list) {
    const args = rawKeyArgs(id, k)
    if (!args) continue
    await tmux(args); sent = true
  }
  return sent
}
