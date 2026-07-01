import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, mkdirSync, rmSync, readdirSync, realpathSync } from 'node:fs'
import { join, dirname, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, gitA, gitTry, repoRoot, mergeBaseDiff, mergeConflicts, type ReviewDiffFile } from './git.js'
import { loadSpecs } from './specs.js'
import { defaultHarness, harnessById, rvSock, type Harness, type DispatchResult } from './harness.js'
import { materialize } from './materialize.js'
import { mainBranch, gitCommonDir, readConfig, runtimeRoot, sessionStoreDir, sessionRecordPath, sessionArtifactPath, listSessionIds, readAliasedRawRecord, envSessionId, type RawRecord } from './layout.js'

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
//   liveness (derived for EVERY session): online | starting | offline. offline = no tmux for the id, or the
//              harness online-signal (claude's rendezvous socket) is gone past the boot grace; starting =
//              the boot window. reconcile composes the two into the compact DisplayStatus for one-glyph surfaces.
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
// The agent only ever PROPOSES (awaiting); merge/close are human-only. Every proposal is reversible via
// reopen() (clearing a LIVE proposal → active; a plain resume of an offline session → idle, see reopen).
// `merges` is METADATA (how many times merged), shown as a badge, not a state.
//
// Launch rules (CLAUDE.md / memory): private `tmux -L <label>` socket + `--dangerously-skip-permissions`.
// SPEXCODE_TMUX / SPEXCODE_CLAUDE_CMD override both for tests.

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
// the harness the dashboard/CLI launcher drives. ALL harness-specific launch facts (the agent command, the
// session-id flag, the hook shim, the session env var) come from this adapter — the launcher never names
// Claude. Resolved once here ([[harness-adapter]]); a future codex launcher flips defaultHarness, nothing else.
const HARNESS = defaultHarness
const COLS = 120, ROWS = 32
// @@@ concurrency cap - the most working agents we let run AT ONCE. Heavy multi-agent load (many claude
// processes computing simultaneously) was the source of resource-pressure crashes, so a launch beyond the
// cap is QUEUED, not started: it becomes a durable `queued` worktree that the drainer launches the moment a
// slot frees (an agent stops working/dies). NOT hardcoded — configured PER PROJECT in `spexcode.json`
// (`sessions.maxActive`), so a box can be tuned to its capacity without touching the toolchain. Precedence:
// spexcode.json → `SPEXCODE_MAX_ACTIVE` env → default 6. Read LIVE (cheap file read) so an edit takes effect
// on the next drain tick, no restart. Floored at 1 so a bad value can't wedge the queue to 0.
function maxActive(): number {
  let v: number | undefined
  try {
    const fromJson = readConfig(mainRoot()).sessions?.maxActive
    if (typeof fromJson === 'number' && Number.isFinite(fromJson)) v = fromJson
  } catch { /* config unreadable — fall through to env/default */ }
  if (v === undefined) { const e = Number(process.env.SPEXCODE_MAX_ACTIVE); if (Number.isFinite(e) && e > 0) v = e }
  return Math.max(1, Math.floor(v ?? 6))
}

// the rendezvous control socket path + its prompt-delivery/liveness logic now live in the [[harness-adapter]]
// (claude OWNS the rendezvous; codex does not), so product code asks the adapter rather than hard-wiring it.
// rvSock is imported only for the two NON-delivery uses that remain product-level: building the launch env var
// (rvEnv, below) and the best-effort socket sweep on close.
// env prefix put in front of the spawned agent so it creates this session's rendezvous control socket — and
// so its hooks + materialize render to the SAME store the backend uses. SPEXCODE_HOME/CODEX_HOME are
// propagated when set, because the session inherits the tmux SERVER's env (not the backend's), so without this
// an overridden home would silently leak the session's hook-state + codex-trust to the default ~/.spexcode /
// ~/.codex. Deterministic: the session's store = the backend's store, never the ambient env's.
const rvEnv = (id: string, harness = HARNESS) => {
  // SPEXCODE_SESSION_ID is the GOVERNED record id every hook resolves (hp_session_id prefers it) — it makes a
  // codex session, whose own thread id is un-pinnable, still feed its governed record; harmless for claude
  // (= its pinned id). The CLAUDE_BG rendezvous control socket is the reclaude prompt-delivery path and exists
  // ONLY for harnesses that own one (claude) — codex has no such daemon, so it's omitted there.
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
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'starting' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'
// liveness — the orthogonal axis to Lifecycle: whether the agent process is actually up, derived (never
// authored) for EVERY session regardless of its lifecycle. See [[state]]: lifecycle and liveness never
// override each other; the UI keys the terminal-mount / relaunch panel on this, the badge on lifecycle.
export type Liveness = 'online' | 'starting' | 'offline'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; title: string | null; name: string | null; branch: string | null; path: string
  harness: string   // which harness (claude|codex) runs this session — carried so liveness/occupancy route through its adapter
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

// the STABLE human label for a session row: a user-chosen NAME (the rename override) wins over everything;
// else the spec node it references, else a prompt-derived title (node-agnostic sessions), else the branch,
// else the id. Stable across turns — used for tables/selectors. The frontend mirrors this (session.js
// sessionName).
export const sessionLabel = (s: Session): string => s.name || s.node || s.title || s.branch || s.id

// @@@ sessionHeadline - the cross-surface HEADLINE: the SAME chain the board card shows (frontend session.js
// `sessionHeadline`). A user-chosen NAME wins, else the worker's LIVE self-summary (`activity`, the Claude
// Code pane title — see [[session-activity]]), else a fuller prompt preview, else node/title/branch/id. Use
// it wherever a session is NAMED FOR A HUMAN in CROSS-SESSION comms (the reply-channel footer, the watch
// greeting), so an agent recognises a peer the way it reads the board — NOT the bare 7-word prompt
// truncation `title` that `sessionLabel` stops at. `sessionLabel` stays the stable name for tables/selectors.
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
type SessRec = {
  session: string; governed: boolean; worktreePath: string; branch: string | null
  node: string | null; title: string | null; name: string | null
  status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null
  sortKey: number | null; createdAt: number; harness: string; harnessSessionId: string | null
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
    node: raw.node || null, title: raw.title || null, name: raw.name || null,
    status, proposal, merges: Number(raw.merges) || 0, note: raw.note || null, sortKey, createdAt: Number(raw.createdAt) || 0,
    harness: raw.harness || 'claude',   // records written before the harness field default to claude
    harnessSessionId: raw.harness_session_id || null,
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
    status: rec.status,
    proposal: rec.proposal ?? '',
    merges: rec.merges,
    note: rec.note ?? '',
    sortkey: rec.sortKey ?? '',
    createdAt: rec.createdAt,
    harness: rec.harness || 'claude',
    harness_session_id: rec.harnessSessionId ?? '',
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

// @@@ liveTmux - which of OUR tmux sessions exist, in ONE tmux call. reconcile used to spawn two tmux per
// session (has-session + display-message), so listing N sessions was 2N spawns — the dominant /api/sessions
// cost under multi-agent load. `tmux list-sessions` returns every session on our socket at once; a session
// present in this set has a live tmux window (session_name = the id we created it with). tmux server down /
// no sessions → empty set → everything reconciles to offline, which is correct. We deliberately do NOT read
// `pane_current_command` any more: workers launch through the `reclaude` wrapper, which runs claude as a
// CHILD rather than exec'ing it, so the pane's foreground command is the wrapper/shell even while claude is
// very much alive — the pane command is NOT a liveness signal. claude liveness is its rendezvous socket
// (see reconcile). The per-session alive() above stays for the single-session ops (capture / rawKey).
async function liveTmux(): Promise<Set<string>> {
  const s = new Set<string>()
  let out = ''
  try { out = await tmux(['list-sessions', '-F', '#{session_name}']) } catch { return s }
  for (const line of out.split('\n')) { const name = line.trim(); if (name) s.add(name) }
  return s
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
  try { out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_title}']) } catch { return m }
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) continue
    const id = line.slice(0, tab), title = line.slice(tab + 1)
    if (id && title) m.set(id, title)
  }
  return m
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
export function selfSummary(paneTitle: string): string | null {
  const m = /^[\s·]*(?:[✳✶✻✽✢⠀-⣿][\s·]*)+(.*)$/u.exec(paneTitle)
  return m ? (m[1].trim() || null) : null
}

// @@@ launchedAt - when we last started a tmux window for an id (set in launch()). claude needs ~15-20s
// after the window appears to recreate its rendezvous socket; in that window the socket is absent but the
// session is booting, NOT dead. reconcile consults this to report 'starting' (a distinct transient state)
// instead of 'offline' for BOOT_GRACE_MS after launch — so 'offline' only ever means genuinely dead. In-
// memory in the single server process (lost on restart, which is fine: a restart has nothing in flight).
const launchedAt = new Map<string, number>()
const BOOT_GRACE_MS = 45000   // > SOCKET_READY_TIMEOUT_MS, and spans launchScript's bounded fast-fail retry
                              // window (~3 attempts) so a relaunching session reads 'starting', not 'offline'
const LAUNCH_FAST_FAIL_S = 12 // launchScript retries the agent command when it exits faster than this — the
                              // launcher daemon-not-ready race fails in ~8s; a real session runs far longer

// @@@ liveness - the orthogonal axis ([[state]]): is the agent process up, for ANY session regardless of
// lifecycle, from a prebuilt tmux set (no per-call spawn — see liveTmux) + the rendezvous socket. offline
// iff the tmux window is gone OR claude's rendezvous socket is absent past the boot window. claude (via the
// reclaude wrapper) holds CLAUDE_BG_RENDEZVOUS_SOCK open the whole time it is alive, so the socket — NOT
// pane_current_command, which is the wrapper/shell while claude runs as its child — is the truth it is up.
// A just-launched agent whose socket hasn't appeared yet reads the transient 'starting' for the grace
// window; only past it (socket still gone) is it genuinely 'offline'.
function liveness(rec: SessRec, live: Set<string>): Liveness {
  if (!rec.session) return 'offline'
  // ask the ADAPTER ([[harness-adapter]]): claude = tmux up AND its rendezvous socket present; codex = tmux up,
  // app-server up, AND native thread id captured. The 'starting' grace stays here (a launcher concern): a
  // just-launched agent whose online-signal hasn't appeared yet reads 'starting' for the boot window, only past
  // it 'offline'.
  const h = harnessById(rec.harness || defaultHarness.id)
  if (h.liveness(rec, live.has(rec.session), runtimeRoot()) === 'online') return 'online'
  const at = launchedAt.get(rec.session)
  return at && Date.now() - at < BOOT_GRACE_MS ? 'starting' : 'offline'
}

// reconcile the compact DisplayStatus — a DERIVED label composing lifecycle + liveness for one-glyph
// surfaces ([[state]]), never a third source of truth. Lifecycle wins the label except where liveness must
// show through: awaiting → its proposal label; parked/error/asking/queued → themselves; active/idle → their
// liveness (offline/starting), else the active-only idle/working inference (the mark-active hook flips idle
// → active on the next real work, self-correcting). The orthogonal liveness field is what the UI keys
// terminal-mount and the relaunch panel on; this label is for badges and `spex ls`.
function reconcile(rec: SessRec, live: Set<string>): DisplayStatus {
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (rec.status !== 'active' && rec.status !== 'idle') return rec.status  // parked | error | asking | queued (no tmux yet)
  const lv = liveness(rec, live)
  if (lv !== 'online') return lv  // 'offline' | 'starting'
  return rec.status === 'idle' ? 'idle' : 'working'
}

// resolve a session id to its record + worktree. Now a DIRECT store read (the record carries worktree_path),
// not a scan of every worktree reading its `.session` — O(1) and exact. null when the id has no governed-or-not
// record. Shape kept ({path, branch, rec}) so the many callers (rename/propose/reopen/merge/close/…) are unchanged.
async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  const rec = readRecord(id)
  if (!rec) return null
  return { path: rec.worktreePath, branch: rec.branch, rec }
}

function toSession(rec: SessRec, status: DisplayStatus, lv: Liveness, activity: string | null = null): Session {
  const prompt = readPromptFile(rec.session)   // the originating ask, captured at launch (store artifact; null for old sessions)
  // activity is the LIVE pane title; it only means anything while the worker is genuinely up — a
  // dead/booting session would show a stale or absent title, so it's suppressed unless liveness is online.
  const showActivity = lv === 'online'
  return { id: rec.session, node: rec.node, title: rec.title, name: rec.name, branch: rec.branch, path: rec.worktreePath, harness: rec.harness, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status, liveness: lv, prompt, promptPreview: prompt ? promptPreview(prompt) : null, created: rec.createdAt, activity: showActivity ? activity : null, sortKey: rec.sortKey }
}

// @@@ renameSession - set (or clear) a session's human display NAME: the user-chosen override that wins
// over the derived label (node/title/branch/id) on every surface. Persisted to the worktree's `.session`
// — the only writer of that file — so the name survives backend restarts and is read back like any other
// field. A blank name CLEARS the override, reverting the row to its derived label. Works for a session in
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
  const [ids, live, titles] = await Promise.all([
    Promise.resolve(listSessionIds()), liveTmux(), paneTitles(),
  ])
  const rows = ids.map((id) => guardSession(id, () => {
    const rec = readRecord(id)
    if (!rec || !rec.governed) { lastKnownSession.delete(id); return null }   // no record, or a self-launched (non-board) one
    // the pane title → headline activity, gated by THIS session's harness ([[harness-adapter]]): claude's title
    // is its task self-summary (used); codex's is the cwd folder name (refused → headline falls to the prompt).
    const activity = paneActivity(harnessById(rec.harness || defaultHarness.id), titles.get(id))
    const s = toSession(rec, reconcile(rec, live), liveness(rec, live), activity)
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
  // simply appends — a stable spatial map across every surface (dashboard window, session tabs, `spex ls`).
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
// running `spex watch B` (the Monitor tool) over B" — derived from live watch registrations, never a
// persisted subscription. When a `spex watch` process starts it registers here and heartbeats; the edge
// exists ONLY while that watch runs (deregistered on exit, dropped on a missed heartbeat). Single owner:
// this in-memory map in the SERVER process — the watch process (a separate `spex watch`) talks to it over
// HTTP (POST /api/sessions/graph/watch + …/unwatch). No datastore, no file: a backend restart starts
// empty and live watches re-register on their next heartbeat. Kept isolated from the board assembler.
// an edge is either a LIVE monitor arrow (A→B = A watches B, directed) or a recorded comms link (A↔B =
// they have exchanged `count` direct messages, undirected). The dashboard renders the two kinds apart.
export type Edge = { from: string; to: string; kind: 'monitor' | 'comms'; count?: number }

// @@@ comms log - direct agent talk ([[comms-edge]]), recorded per-worktree. `spex session send` goes
// THROUGH the backend (sendKeys); on a delivered message that carries a sender, the backend appends one
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

// @@@ watch registration (CLIENT side) - a `spex watch` process is separate from the server, so it
// REPORTS itself to the backend's registration store over HTTP: register+heartbeat while it runs,
// deregister on exit (see cli.ts `watch`). All best-effort — if the backend is down the watch still
// streams its events; the graph edge just won't appear until a heartbeat lands. Never throws.
export const apiBase = () => process.env.SPEXCODE_API_URL || `http://127.0.0.1:${process.env.PORT || 8787}`
// the agent's OWN session id from the HARNESS env var — the public name used across cli.ts/sessions.ts.
// Single adapter-routed impl lives in layout.ts (`envSessionId`, iterating each adapter's sessionEnvVar);
// re-exported here so callers keep one name. Used by `spex watch` + the agent-typed `spex session …`
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
    await fetch(`${apiBase()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  } catch { /* best-effort: backend may be down; the next heartbeat / TTL reconciles */ }
}
export const reportWatch = (token: string, watcher: string, selectors: string[], ttlMs: number): Promise<void> =>
  postJSON('/api/sessions/graph/watch', { token, watcher, selectors, ttlMs })
export const reportUnwatch = (token: string): Promise<void> => postJSON('/api/sessions/graph/unwatch', { token })

// @@@ isBackendDown - a `client.ts` BackendError surfacing in the watch poll loop (whose session
// `source` is the HTTP backend client). Matched by NAME, not `instanceof`, so sessions.ts never imports
// client.ts at runtime (client.ts imports apiBase from here — a runtime import back would be a cycle). A
// backend-down poll must NOT be swallowed as a transient git/tmux hiccup: watch warns ONCE and keeps
// streaming rather than emitting false `closed` events for every session.
export const isBackendDown = (e: unknown): boolean => e instanceof Error && e.name === 'BackendError'

const slugify = (s: string | null) => (s || 'session').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'session'

// @@@ node + title from the prompt - the spec node a session works on is whatever it @-mentions, NOT a UI
// "focused node": the dashboard prefills `@<focused> ` as a deletable convenience, so the node the user
// actually left in the prompt (changed it, or deleted it for a node-agnostic prompt) is the truth. We read
// the FIRST `@<id>` that begins a word (same positional rule the dashboard's mention menu uses). When there
// is none, the session is node-agnostic and we label it by the first few words of the prompt instead.
// The OPTIONAL leading dot is load-bearing: a node id is its dir basename, so a dot-prefixed config root
// (`.config`) keeps the dot — without `\.?` here `@.config` captures nothing and never resolves to a node.
const MENTION = /(?:^|\s)@(\.?[A-Za-z0-9_-]+)/
const mentionedNode = (prompt: string): string | null => prompt.match(MENTION)?.[1] ?? null
function titleFromPrompt(prompt: string): string | null {
  const first = (prompt || '').trim().split('\n')[0].trim()
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
function launchScript(id: string, tail: string, harness: Harness = HARNESS): string {
  const file = join(storeDir(id), 'launch.sh')
  // NO --append-system-prompt / --settings: the contract + hooks are materialized into the worktree at
  // createSession ([[harness-delivery]]) and the agent auto-discovers them — the SAME path as a self-launched
  // agent. The launch line is just the rendezvous env + the harness command + the session-id/spec-pointer/prompt tail.
  const invocation = `${rvEnv(id, harness)} ${harness.launchCmd(id, runtimeRoot())} ${tail}`
  // Bounded relaunch on a FAST exit: the agent launcher (e.g. the reclaude daemon) can lose a startup
  // race ("daemon did not become ready") and exit within seconds before the rendezvous socket ever
  // appears — a fast exit is the race, not real work, so retry a few times. Once the agent has run past
  // LAUNCH_FAST_FAIL_S it has genuinely started; its eventual (much later) exit is a normal session end
  // and is NEVER retried — the loop exits. BOOT_GRACE_MS and SOCKET_READY_TIMEOUT_MS both span this retry
  // window, so liveness stays 'starting' and waitForReady keeps holding the slot across retries. This only
  // closes the startup race — it adds no fallback and never masks a genuinely dead agent (3 attempts, then give up).
  writeFileSync(file, [
    `for __spex_try in 1 2 3; do`,
    `  __spex_t0=$SECONDS`,
    `  ${invocation}`,
    `  __spex_rc=$?`,
    `  [ $(( SECONDS - __spex_t0 )) -ge ${LAUNCH_FAST_FAIL_S} ] && exit $__spex_rc`,
    `  printf '[spex launch] attempt %s exited in %ss (rc=%s) — likely a launcher daemon race; retrying\\n' "$__spex_try" "$(( SECONDS - __spex_t0 ))" "$__spex_rc" >&2`,
    `  sleep 2`,
    `done`,
    `exit $__spex_rc`,
    ``,
  ].join('\n'))
  return file
}
async function launch(id: string, path: string, tail: string, harness: Harness = HARNESS): Promise<void> {
  await tmux(['new-session', '-d', '-s', id, '-x', String(COLS), '-y', String(ROWS), '-c', path])
  await tmux(['send-keys', '-t', id, '-l', '--', `bash ${launchScript(id, tail, harness)}`])
  await tmux(['send-keys', '-t', id, 'Enter'])
  launchedAt.set(id, Date.now())   // stamp the boot window so reconcile reads 'starting', not 'offline', until the socket is up
}

// @@@ node directives - a dashboard board chord (nn / dd) prefixes the New Session prompt with a
// structured op the server PERFORMS in the fresh worktree before the agent starts, then hands the agent
// a prompt to finish it intelligently. The directive is anchored at the prompt start and carries an
// @<target>, so it's unambiguous and wins over the plain first-@ mention. `rest` is the human's own text
// after it (what they want the new node to be, or why the node is going away). No directive → the prompt
// is an ordinary session prompt and nothing is mutated.
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

// @@@ directive prompts - the INTENT handed to the dispatched agent. The server did the mechanical
// spec-tree mutation; the agent does the intelligent rest (name + spec + code, or history-driven
// refactor). Like mergePrompt, the op is a DISPATCH: the server never authors specs or refactors code.
// These state only the TASK — they deliberately do NOT restate the git flow's mechanics (commit format, the
// Session: trailer, the node-branch flow, the merge style). Those are carried by product MECHANISM, not a
// dispatch string: newSession makes the branch, the prepare-commit-msg hook stamps the trailer, the
// `core/spec` system contract (gathered into appendSysArg) demands commit-before-declare, and mergePrompt
// states the merge style at merge time. The only handoff detail kept here is "propose merge, don't merge
// yourself" (the human triggers
// the merge later, see mergePrompt).
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
function isOccupying(s: Session, live: Set<string>): boolean {
  if (!OCCUPIES_SLOT.has(s.status)) return false                          // waiting-on-human / proposed / queued / dead → free
  const rec = readRecord(s.id)
  if (!rec) return false
  return harnessById(rec.harness || defaultHarness.id).liveness(rec, live.has(rec.session), runtimeRoot()) === 'online'  // and only while the agent is genuinely live (its adapter's channel)
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
    await launch(id, wt.path, `${h.sessionIdArg(id)} ${sq}`.trim(), h)
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

// @@@ superviseQueue - the periodic drainer. Started once at serve(). The explicit drainQueue() calls on
// newSession/close/propose cover the slot-freeing events the SERVER handles, but an agent proposing done or
// going parked writes its .session from a hook subprocess the server never sees, and a crash just makes a
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

// @@@ assertProjectMatch - the launch is PROJECT-BOUND, but routing is by URL. `spex new`'s intent is "create a
// session for the project my cwd is in", yet `apiBase()` is SPEXCODE_API_URL||PORT||8787 — a pure URL carrying
// no project identity. The backend it answers builds the worktree under ITS OWN mainRoot, so a stale inherited
// SPEXCODE_API_URL (e.g. pointing at another repo's backend) silently lands the session in the WRONG repo. Read/
// control verbs deliberately point anywhere (viewer-points-anywhere, see remote-client); only the mutating
// launch is bound to the caller's project. So before launching, compare the caller's repo root to the backend's
// served root and FAIL LOUD on a provable, same-host mismatch — never a silent misroute. The guard fires only on
// a positive mismatch: no local repo, an unreachable backend, or a backend root that isn't a resolvable local
// path (a genuinely remote backend) all fall through to allow, so legit remote dispatch is untouched.
async function assertProjectMatch(): Promise<void> {
  let localMain: string
  try { localMain = realpathSync(mainRoot()) } catch { return }   // caller not in a repo → can't prove a mismatch
  let served: string | null = null
  try {
    const r = await fetch(`${apiBase()}/api/layout`)
    if (r.ok) served = (await r.json() as { main?: string }).main ?? null
  } catch { return }                                              // backend unreachable → the POST surfaces it (fail-loud there)
  if (!served || !isAbsolute(served)) return                      // unknown / config-aliased root → don't risk a false refusal
  let backendMain: string
  try { backendMain = realpathSync(served) } catch { return }     // backend root not a local path → a remote backend, allow
  if (backendMain !== localMain)
    throw new Error(
      `spex new: refusing — cwd is in ${localMain} but the backend at ${apiBase()} serves ${backendMain}.\n` +
      `Start this project's backend:  cd ${localMain} && spex serve   (or point SPEXCODE_API_URL at it)`)
}

// @@@ createSession (dispatch via backend) - `spex new` / `spex session new` must launch the worker in the
// BACKEND's process, not the caller's. The backend owns the launch env (notably SPEXCODE_CLAUDE_CMD, which
// reclaude strips from agent envs) AND the concurrency cap. An agent that runs `spex new` (e.g. a supervisor)
// has a stripped env, so an in-process launch would spawn workers under plain `claude` and 401 at boot. So
// the CLI POSTs to the running backend whenever one answers, making the backend the single owner of session
// launching. Only when NO backend is reachable do we fall back to launching in this process (with a stderr
// warning) — the backend's own POST handler calls newSession directly, so it never re-enters this path.
export async function createSession(node: string | null, prompt: string, harness: string = defaultHarness.id): Promise<Session> {
  await assertProjectMatch()
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node, prompt, harness }),
    })
  } catch {
    console.error('spex: no backend reachable — launching in-process (caller env owns auth, no concurrency cap)')
    return newSession(node, prompt, harness)
  }
  if (!res.ok) throw new Error(`backend rejected session (${res.status}): ${await res.text().catch(() => '')}`)
  return await res.json() as Session
}

// @@@ newSession - durable worktree (branch node/<slug> off main) + .session label. The agent does NOT
// launch inline any more: the worktree is prepared and parked as `queued`, then drainQueue() launches it
// immediately if we're under the concurrency cap, else it waits its turn. Backs both the dashboard POST and
// `spex session new`. A board directive (nn/dd) additionally mutates the worktree's spec tree up front and
// hands the agent a finish-the-op prompt.
export async function newSession(node: string | null, prompt: string, harness: string = defaultHarness.id): Promise<Session> {
  const id = randomUUID()
  const h = harnessById(harness)   // throws on an unknown id — fail loud, never silently launch the wrong harness
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
  // slot is free, else it waits — durable as a global record (+ its worktree), so it survives a backend
  // restart and is still findable. governed:true — this is a DASHBOARD/CLI-launched session, so it feeds the
  // board and the lifecycle hooks act on it; worktreePath/branch/createdAt are stamped here (the record, not
  // the worktree, is the board's enumeration source now).
  const rec: SessRec = {
    session: id, governed: true, worktreePath: path, branch,
    node: ref || null, title, name: null, status: 'queued', proposal: null, merges: 0, note: null, sortKey: null, createdAt: Date.now(),
    harness: h.id, harnessSessionId: null,
  }
  writeRecord(rec)
  writePromptFile(id, prompt)   // capture the ORIGINATING prompt (the human/manager's ask) as store metadata (best-effort)
  // render the harness-discovered artifacts INTO the worktree (CLAUDE.md/AGENTS.md contract block, .claude/.codex
  // shims, manifest to the global store) so the launched agent gets the contract + hooks the SAME way a
  // self-launched one does — by auto-discovery, not CLI injection. This is why the launch line below carries no
  // --append-system-prompt / --settings, and why we no longer hide CLAUDE.md: hiding it suppressed the agent's
  // own memory load too. One delivery path for both launch modes ([[harness-delivery]]).
  try { materialize(path) } catch { /* best-effort; the dispatch.sh gate re-renders on the first event anyway */ }
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
    // @@@ spec pointer - the ref (explicit --node, else the prompt's first @mention) named an EXISTING node.
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
                                        // waitForReady (slot-hold + reopen) waits through a daemon-race retry
                                        // instead of returning before a recovering socket
const SOCKET_POLL_MS = 200
async function waitForReady(id: string, harness: Harness, timeoutMs = SOCKET_READY_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const rec = readRecord(id)
    if (rec && harness.liveness(rec, await alive(id), runtimeRoot()) === 'online') return true
    if (Date.now() >= deadline) return false
    await new Promise((r) => setTimeout(r, SOCKET_POLL_MS))
  }
}

// @@@ reopen - clear any proposal, then ONE relaunch path. The agent needs
// (re)starting iff it isn't running for this id — the SAME deterministic liveness the adapter computes
// ([[harness-adapter]]): claude offline = no tmux OR no rendezvous socket (claude exited, even though the
// wrapper/shell may still hold the pane); codex offline = no tmux, no project app-server, or no captured native
// thread id. When it IS offline we drop any stale pane and launch a fresh window through the adapter's resumeArg
// — claude `--resume <id>` (the SAME conversation), codex `resume <thread-id>` once captured, else a fresh TUI
// in the same worktree/record. Then we WAIT for the
// agent to come online (waitForReady) before returning, so a caller that dispatches immediately after reopen
// (e.g. mergeSession) addresses a LIVE agent rather than racing the boot.
// The resulting lifecycle depends on WHY we reopened: a plain RESUME of an offline session (the frontend
// relaunch panel / `spex session resume`) just brings the agent back up sitting at its prompt with nothing to
// do → **idle**, not a phantom "working"; only clearing a LIVE proposal ("back to working") keeps **active**.
// Either way the resting state is honest — a following prompt (e.g. mergeSession's dispatch) flips it back to
// active via mark-active. If it's still live we only cleared the proposal — no wait. Fail-loud is
// unchanged: if the agent never comes online, the later deliver() fails loud.
export async function reopen(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  const h = harnessById(wt.rec.harness || defaultHarness.id)
  const offline = h.liveness(wt.rec, await alive(id), runtimeRoot()) !== 'online'
  writeRecord({ ...wt.rec, status: offline ? 'idle' : 'active', proposal: null })
  if (offline) {
    await tmuxOk(['kill-session', '-t', id])   // drop a dead/offline pane if any (no-op when none)
    await launch(id, wt.path, h.resumeArg(wt.rec).trim(), h)
    await waitForReady(id, h)   // a relaunched agent is "ready" only once the adapter reads it online
  }
  return true
}

// agent/human PROPOSAL → awaiting (review = propose merge, done = nothing, close-pending = propose close).
export async function propose(id: string, proposal: Proposal): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeRecord({ ...wt.rec, status: 'awaiting', proposal })
  void drainQueue()   // a proposal frees this session's slot — start the next queued one if any
  return true
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
export const markDone = (proposal: Proposal = 'nothing', sessionId?: string) => markState('awaiting', { proposal, sessionId })
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
// the worktree (the runtime lives in ~/.spexcode), and the only in-tree SpexCode artifacts are gitignored
// (the materialize shims/skills) or tracked-and-committed (the contract block in CLAUDE.md/AGENTS.md), so
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
// whether uncommitted non-runtime work remains, the merge/typecheck/lint gates, and the agent's standing
// proposal. ahead/dirty/diff/conflicts are computed against the SESSION's worktree (per id); typecheck and
// lint reflect the CLI package's OWN location (where this runs) — the spec-cli that's actually live. null
// when no session has that id.
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

// @@@ typecheckPkg - `tsc --noEmit` on the CLI package at its OWN location (pkgRoot — never a hardcoded
// path), using the tsc binary from that package's node_modules. errorCount counts `error TSxxxx` lines; ok
// is the exit status. If tsc can't be spawned at all (no node_modules) it resolves ok:false / 0 errors — a
// loud "couldn't typecheck" rather than a false green.
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

// @@@ reviewPayload - assemble the cockpit review for one session. The five session-specific reads
// (ahead / dirty / diff / conflict gate) plus the two location gates (typecheck / lint) are all
// independent, so they run in parallel. lint is the existing spec-lint module run in-process (it reports
// over this process's repo — the CLI package's own tree).
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
  // the worktree carries no SpexCode runtime files any more (the store lives in ~/.spexcode), so every dirty
  // path is genuine work — this is just the total uncommitted count.
  const dirtyNonRuntime = statusOut.split('\n').filter(Boolean).map(porcelainPath).length
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
// main's tree). It reopens the session (clears the proposal, `--resume`s via reopen if tmux died —
// which waits for the rendezvous socket, closing the just-relaunched-no-socket race) and dispatches mergePrompt
// — that delivered prompt flips the lifecycle to active regardless of reopen's resting state
// through sendKeys. The reason = the node branch's latest commit subject minus a leading `spec: ` (visible from
// the main checkout, no worktree path needed). Async + fail-loud: returns {dispatched:true} once the prompt is
// CONFIRMED accepted, else {dispatched:false, reason} (the loud DispatchResult error). The server no longer
// re-checks gates, runs git, bumps `merges`, or closes the session — review shows the gates; the agent verifies.
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

// @@@ stopAgentProcess - the shared teardown both exit and close begin with, so there is ONE kill path, not
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

// @@@ exitSession - the SOFT stop (vs closeSession's removal): stops the agent process but LEAVES the durable
// worktree + branch + transcript intact. The session stays on the board, now reading `offline` (no tmux window)
// whatever its lifecycle, so the relaunch panel offers to --resume the SAME conversation (see reopen). This is
// "step away, come back later"; closeSession is "discard this work". An offline session occupies no slot, so
// the freed capacity drains a queued session next (drainQueue).
export async function exitSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await stopAgentProcess(id)
  void drainQueue()   // an exit frees a slot — start the next queued session if any
  return !!wt
}

// @@@ closeSession - the REMOVAL (human-confirmed): exit's soft stop PLUS removing the worktree + branch AND
// the session's whole global-store record dir — the work is gone, not just stopped. Same stop primitive as
// exitSession (no duplicate kill path), then the git worktree/branch teardown that exit deliberately skips,
// then the store sweep (exit KEEPS the record so the session stays on the board offline; close discards it).
export async function closeSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await stopAgentProcess(id)
  if (wt) {
    await gitA(['-C', mainRoot(), 'worktree', 'remove', '--force', wt.path])
    if (wt.branch) await gitA(['-C', mainRoot(), 'branch', '-D', wt.branch])
  }
  try { rmSync(sessionStoreDir(id), { recursive: true, force: true }) } catch { /* best-effort sweep of the global record */ }
  void drainQueue()   // a close frees a slot — start the next queued session if any
  return !!wt
}

// @@@ captureSessionResult - the session's live pane as a one-shot snapshot (output), the server side of
// `GET /api/sessions/:id/capture` that `spex capture` (a backend client) reads. A monitoring read MUST
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
//   Monitor({ command: 'spex watch', persistent: true, description: 'spex session state changes' })
// @@@ presentation + selection - shared by `spex ls` (pretty), `spex watch` (events) and the API.
export const STATUS_GLYPH: Record<DisplayStatus, string> = {
  working: '\u25cf', idle: '\u25cb', offline: '\u23fb', starting: '\u25d4', review: '\u25c6', done: '\u2713',
  'close-pending': '\u2715', parked: '\u29d6', error: '\u2717', asking: '\u2370', queued: '\u25cc',
}
const ANSI: Record<DisplayStatus, string> = {
  working: '33', idle: '90', offline: '90', starting: '36', review: '35', done: '34', 'close-pending': '31', parked: '36', error: '31', asking: '93', queued: '90',
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
  // silence forever.
  return q.split(',').map((p) => p.trim()).filter(Boolean)
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
// selectSessions, for the control verbs (review/send/merge/close/reopen/capture/prompt). The backend matches
// ids EXACTLY, so a verb resolves the selector here first and then calls with the FULL id — a node/branch/
// prefix selector drives a verb just as it filters `ls`. The result is DISCRIMINATED so a caller can fail
// precisely: an exact full-id hit wins outright (never reported ambiguous just for prefixing a longer id);
// otherwise a lone match is `ok`, several is `ambiguous` (a prefix/node hitting many), none is `none`.
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

// @@@ statusLegend - one-line glyph\u2192meaning key, BUILT from STATUS_GLYPH so it can never drift from
// the glyphs the table actually prints. Shown under `spex ls` so the symbols are self-explanatory.
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
// @@@ launchEvent - a session's FIRST sighting. A launch goes straight to 'working' (not actionable), so
// without this the watch feed would be blind to new sessions starting. Emitted ONCE per id, regardless of
// status, so `spex watch` is a complete lifecycle feed: launched → [actionable transitions] → closed.
export function launchEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  const asked = s.promptPreview ? ` · asked: ${s.promptPreview}` : ''
  return `[spex] launched · ${sessionLabel(s)} — act: capture | send "<msg>"${note}${asked}  [id ${s.id}]`
}
// @@@ source - the session board the poll reads. The CLI passes the BACKEND CLIENT (client.ts
// clientListSessions), so `spex watch` streams whatever backend SPEXCODE_API_URL points at — including a
// REMOTE machine's. It is REQUIRED (no local default): a forgotten source must be a compile error, never a
// silent in-process read of the wrong (local) board — the exact false-green the 2-machine test guards.
export type WatchOpts = { source: () => Promise<Session[]>; selectors?: string[]; statuses?: string[]; includeIdle?: boolean; intervalMs?: number; as?: string; until?: { timeoutMs: number } }
// @@@ watch outcome - only the BOUNDED `until` mode resolves (that mode is what `spex wait` runs on); a
// plain watch (no `until`) streams forever and never resolves. The bound is what makes `wait` a one-shot
// "block for a worker, then exit" that is GUARANTEED to return. The deadline is checked EVERY poll, before
// EVERY sleep (and even when a poll throws), so a target stuck in ANY non-actionable state
// (`working`/`parked`/`idle`/`queued`/`starting`) can never hang the caller — it exits at the deadline.
// `reached` = the target hit an actionable status; the rest are the loud exits.
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
      // @@@ closed = the worktree is GONE. Because listSessions lists every EXISTING worktree (a flaky detail
      // read degrades, never drops), an id absent from the board means its worktree directory was actually
      // removed: a DEFINITIVE fact, not a flaky absence. So removal needs no 2-poll debounce / existsSync
      // re-check; emit `closed` exactly once the moment the id leaves the list.
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

// @@@ sendKeys - PROMPT control for a session, delivered through the session's HARNESS ADAPTER
// ([[harness-adapter]]) — claude the rendezvous control socket (inject + submit + confirm accepted), codex
// app-server JSON-RPC into the visible TUI's thread. Either way there is NO silent fallback: a prompt that can't be
// delivered — no socket / dead agent (claude), no app-server/thread (codex) — FAILS LOUD, returning
// ok:false with a reason that propagates to the caller (API non-2xx, `spex session send`, the merge dispatch),
// instead of reporting a false success. The harness is resolved from the record; an unknown id fails before any
// harness transport is addressed. (The separate RAW nav-key channel keeps its own `tmux send-keys` path — see rawKey.)
export async function sendKeys(id: string, text: string, from?: string): Promise<DispatchResult> {
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
// keystroke-navigation state its input box is replaced by the menu, so the dashboard's nav mode forwards
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
