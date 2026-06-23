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
import { mainBranch, statePath, runtimePath, RUNTIME_DIR } from './layout.js'

// @@@ sessions - the WORKTREE is the durable unit; tmux is a disposable runtime handle. Each session
// worktree carries an untracked `.session` file (the source of truth) that survives a kill / reboot /
// moving the folder. We launch claude with `--session-id <id>` (id we choose) so the SAME conversation
// can be `--resume`d into a fresh tmux. NO in-memory map: listSessions() reads worktrees every time.
//
// STATE MACHINE (only two real states; merge is an action, not a state):
//   active   → liveness: working | idle | offline. working/offline are read LIVE (is the tmux alive and
//              still running claude?); idle is PERSISTED (status: idle) by the Notification(idle_prompt)
//              hook when claude sits waiting at its prompt — the ONE inferred state, guarded active-only so
//              it never clobbers a declaration; the mark-active hook flips it back to active on real work.
//              (offline = no tmux for the recorded id, or claude's rendezvous socket is gone — see reconcile)
//   awaiting → the agent's PROPOSAL, awaiting a human:
//                proposal=merge   → shown "review"        ("ready, merge me")
//                proposal=nothing → shown "done"          ("finished, your call")
//                proposal=close   → shown "close-pending" ("I suggest discarding this worktree")
//   asking → the agent is pausing to ask the HUMAN a question. Written DETERMINISTICALLY two ways: the
//                mark-active PreToolUse hook captures it the moment the agent invokes the AskUserQuestion
//                tool (question → note), and the agent may also declare it via `spex session ask --note
//                <question>`. Not inferred. Distinct from `parked` (which waits on a background task/
//                schedule and self-resumes); an asking agent resumes only when a human sends it a prompt.
//   (closed = the worktree is removed; not a stored status)
// The agent only ever PROPOSES (awaiting); merge/close are human-only. Every proposal is reversible
// via reopen() → active. `merges` is METADATA (how many times merged), shown as a badge, not a state.
//
// Launch rules (CLAUDE.md / memory): private `tmux -L <label>` socket + `--dangerously-skip-permissions`.
// SPEXCODE_TMUX / SPEXCODE_CLAUDE_CMD override both for tests.

const pexec = promisify(execFile)
const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const CLAUDE_CMD = process.env.SPEXCODE_CLAUDE_CMD || 'claude --dangerously-skip-permissions'
const COLS = 120, ROWS = 32
// @@@ concurrency cap - the most working agents we let run AT ONCE. Heavy multi-agent load (many claude
// processes computing simultaneously) was the source of resource-pressure crashes, so a launch beyond the
// cap is QUEUED, not started: it becomes a durable `queued` worktree that the drainer launches the moment a
// slot frees (an agent proposes/dies). Configurable; default 6. Floored at 1 so a bad env can't wedge it to 0.
const MAX_ACTIVE = Math.max(1, Number(process.env.SPEXCODE_MAX_ACTIVE) || 6)

// @@@ appendSysArg - the system prompt folded into EVERY launched/resumed agent (both paths go through
// launch() below), assembled ENTIRELY from the system config surface — there is NO baked-in core. The
// contract lives as DATA in the spec tree, not as a string constant here: each ACTIVE node declaring
// `surface: system` (gathered by loadSystemConfig) contributes its body, in name order. Without this a
// dashboard/CLI-launched session gets ONLY the human's terse prompt and carries none of SpexCode's standing
// contracts (agents kept proposing merge with UNCOMMITTED work). The core spec-discipline rules now live in
// the `core/spec` system node, alongside opinionated rules like `voice-before-ask`; adding or editing ANY
// always-on rule is a spec edit, not a code change here. A config node opts in by declaring `surface:
// system` — no slash, no agent choice. Pending plugins are filtered out by loadSystemConfig, so a `status:
// pending` stub never injects. Built fresh per launch, so editing a system node takes effect on the next
// launch with no restart. The combined text is single-quoted onto the launch line and shell-escaped like the
// prompt; the launch line is written to a script file (see launch()), so length is unbounded — it no longer
// rides the ~2KB tmux send-keys limit that capped the inline prompt (the launch-prompt-limit lesson). If
// ZERO system nodes are present, NO flag is emitted at all (empty string) — the launcher tolerates a missing
// flag, so a config-less instance launches without an appended contract. `cfgs` defaults to the live system
// load — it's a parameter only so the gathering is testable.
export function appendSysArg(cfgs: ConfigPreset[] = loadSystemConfig()): string {
  const parts: string[] = []
  for (const cfg of cfgs) {
    if (cfg.body.trim()) parts.push(cfg.body.trim())
  }
  if (parts.length === 0) return ''
  const full = parts.join('\n\n')
  return `--append-system-prompt '${full.replace(/'/g, `'\\''`)}'`
}

// @@@ rendezvous control socket - the DETERMINISTIC, ONLY input path for PROMPTS to sessions WE launch. We
// start `claude` with CLAUDE_BG_BACKEND=daemon + CLAUDE_BG_RENDEZVOUS_SOCK=<per-session sock> set ONLY on
// that one spawned command (env prefix on the launch line — never global/exported, never a plugin or global
// setting). claude opens a unix socket at that path; writing one line `{"type":"reply","text":"…"}\n` to
// it injects the text as a prompt and submits it — no PTY typing, so multi-line input and Enters can't be
// corrupted the way `tmux send-keys` was. The path is uniquely derived from the session id, so we only
// ever address OUR OWN sockets (HARD ethics rule: never touch a Claude Code session outside this product).
// tmux stays the VISIBLE stream (pty-bridge); the socket is CONTROL (input) only. The socket lives in
// tmpdir tied to the claude process, so no extra lifecycle — claude/the OS owns it. There is NO send-keys
// fallback for prompts: a missing socket, a connect error, or a prompt the daemon does not confirm ACCEPTED
// is a LOUD failure that propagates to the caller (API non-2xx) — never a silent degradation to typing into
// the pane, which previously fooled us into thinking a dead dispatch had worked.
const rvSock = (id: string) => join(tmpdir(), `spexcode-rv-${id}.sock`)
// env prefix put in front of the spawned `claude` so it creates this session's rendezvous control socket.
const rvEnv = (id: string) => `CLAUDE_BG_BACKEND=daemon CLAUDE_BG_RENDEZVOUS_SOCK=${rvSock(id)}`

// a prompt-dispatch outcome. ok=true ONLY when the agent confirmably ACCEPTED the prompt; otherwise `error`
// carries a human-readable reason that propagates to the API route (non-2xx) and the CLI/dashboard/manager.
export type DispatchResult = { ok: boolean; error?: string }
const ACCEPT_TIMEOUT_MS = 2500

// @@@ replyViaSocket - inject `text` as a prompt AND confirm the daemon ACCEPTED it (not mere write-success,
// which is what silently masked dead dispatches before). The CLAUDE_BG_BACKEND=daemon rendezvous server
// sends NO ack for an accepted reply, so we confirm via an IN-ORDER round-trip: we write
// `{type:reply}\n{type:repaint}\n`. The daemon dispatches socket lines strictly in order (one handler per
// newline-framed line) and ENQUEUES the reply BEFORE it handles the repaint and answers `{type:repaint-done}`
// — so a `repaint-done` with NO preceding `reply-rejected` proves the reply was processed/enqueued. `repaint`
// is auth-exempt and always answers, so it's a reliable probe even against a future daemon that gates
// `reply` behind auth: a gated reply emits `reply-rejected` FIRST (in-order, before repaint-done), which we
// treat as failure. `reply-rejected` / `shutting-down`, a connect/socket error, an early close, or no
// confirmation within ACCEPT_TIMEOUT_MS ALL resolve to a loud failure with a specific reason. The forced
// repaint is a harmless full redraw of the agent's OWN TUI. Never throws — the reason is returned, not swallowed.
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
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; title: string | null; name: string | null; branch: string | null; path: string
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; note: string | null
  prompt: string | null; promptPreview: string | null; created: number; activity: string | null
}

// @@@ originating prompt - what the session was ASKED to do, captured at launch so a manager (human or
// agent) can later answer "what was this session for?" WITHOUT transcript archaeology. Prompts are
// multi-line, so they live in their own untracked SIDECAR file (`.session-prompt`) beside `.session`,
// not as a line in the line-based `.session`. Everything here is BEST-EFFORT: a missing/old sidecar (a
// session launched before this existed) just means no prompt is shown — never an error, never blocks a launch.
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
// @@@ deferred launch prompt - a QUEUED session is a fully-prepared worktree we have NOT launched claude
// into yet. The exact prompt to launch it with — the directive-generated finish-the-op prompt, or the plain
// human prompt — is parked in its own untracked sidecar (`.session-launch`) so the drainer can launch it
// later (possibly after a backend restart) WITHOUT re-deriving anything. It is CONSUMED (removed) the moment
// the session launches, so it exists only while a session is still waiting in the queue. Distinct from
// `.session-prompt` (the human-facing originating ask, which differs from the launch prompt for directives).
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

// the human label for a session row: a user-chosen NAME (the rename override) wins over everything; else
// the spec node it references, else a prompt-derived title (node-agnostic sessions), else the branch, else
// the id. Used everywhere a session is named for a human. The frontend mirrors this precedence (session.js).
export const sessionLabel = (s: Session): string => s.name || s.node || s.title || s.branch || s.id

async function tmux(args: string[]): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8' })
  return stdout
}
async function tmuxOk(args: string[]): Promise<boolean> { try { await tmux(args); return true } catch { return false } }
export async function alive(id: string): Promise<boolean> { return tmuxOk(['has-session', '-t', id]) }

// worktrees + branches are created off MAIN even when the server runs inside a worktree.
function mainRoot(): string {
  try { return dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()) }
  catch { return repoRoot() }
}

// @@@ pkgRoot - the CLI package's OWN directory, derived from this module's location, never a hardcoded
// repoRoot()+'spec-cli'. This file lives at <pkgRoot>/src/sessions.ts, so `..` from it is the package
// root — making the launch-script paths (hooks/, node_modules/.bin/tsx, src/cli.ts) survive the package
// being renamed or relocated out of the default <repo>/spec-cli layout.
function pkgRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

// `name` is the user-chosen display override set by the rename gesture — distinct from the auto-derived
// `title` (from the prompt), so a rename never has to fight or overwrite the launch-time derivation.
type SessRec = { node: string | null; title: string | null; name: string | null; session: string | null; status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null }
// ensure a worktree's `.session/` runtime dir exists, returning its path. Idempotent (recursive mkdir) —
// every writer that drops a file under the runtime dir calls this first so launch order never matters.
function runtimeDir(path: string): string { const d = join(path, RUNTIME_DIR); mkdirSync(d, { recursive: true }); return d }

function readSessionFile(dir: string): SessRec {
  const r: SessRec = { node: null, title: null, name: null, session: null, status: 'active', proposal: null, merges: 0, note: null }
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
  const p = statePath(dir)   // `.session/state` for a new session; the flat `.session` file for a legacy one
  mkdirSync(dirname(p), { recursive: true })   // creates `.session/`; no-op when p is the legacy flat file
  writeFileSync(p, lines.join('\n') + '\n')
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

// @@@ paneTitles - each worker's LIVE self-summary, free from tmux. Claude Code continuously sets its
// terminal title (an OSC escape) to a short description of what it is doing right now — and tmux captures
// that as the pane title (NOT the window name; OSC titles never touch window_name). Our worker launches one
// pane per session, named with the session id, so ONE `list-panes -a` maps id → "what it's doing". Same
// shape and cost as liveTmux (one tmux call for the whole list); failure → empty map, so a tmux hiccup just
// drops the subtitle for a tick, never the session. The leading status glyph is stripped at read time.
async function paneTitles(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  let out = ''
  try { out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_title}']) } catch { return m }
  for (const line of out.split('\n')) {
    const tab = line.indexOf('\t'); if (tab < 0) continue
    const id = line.slice(0, tab), title = cleanActivity(line.slice(tab + 1))
    if (id && title) m.set(id, title)
  }
  return m
}

// strip Claude Code's leading status glyph (✳ when idle, a braille spinner frame while working) plus the
// space after it: the dashboard draws its own status dot, and a frozen spinner frame is just noise — keep
// only the summary text. Empty after stripping → null (no subtitle).
function cleanActivity(raw: string): string | null {
  const t = raw.replace(/^[\s✳✶✻✽✢·⠀-⣿]+/u, '').trim()
  return t || null
}

// @@@ launchedAt - when we last started a tmux window for an id (set in launch()). claude needs ~15-20s
// after the window appears to recreate its rendezvous socket; in that window the socket is absent but the
// session is booting, NOT dead. reconcile consults this to report 'starting' (a distinct transient state)
// instead of 'offline' for BOOT_GRACE_MS after launch — so 'offline' only ever means genuinely dead. In-
// memory in the single server process (lost on restart, which is fine: a restart has nothing in flight).
const launchedAt = new Map<string, number>()
const BOOT_GRACE_MS = 25000   // > waitForSocket's 15s timeout, covering the observed ~15-20s socket boot window

// reconcile the SHOWN status from a session's declared state + a prebuilt liveness set (no per-call tmux
// spawn — see liveTmux). Declarations win over liveness, in ONE path: awaiting maps to its proposal label;
// parked / error / asking map straight to themselves. We never INFER those externally.
function reconcile(rec: SessRec, live: Set<string>): DisplayStatus {
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (rec.status !== 'active' && rec.status !== 'idle') return rec.status  // parked | error | asking | queued (no tmux yet)
  // active/idle are the SAME live agent — claude runs whether it is churning OR waiting at its prompt — so
  // they share ONE deterministic liveness check: offline iff the tmux window is gone OR claude's rendezvous
  // socket is absent. claude (via the reclaude wrapper) holds CLAUDE_BG_RENDEZVOUS_SOCK open the whole time
  // it is alive, so the socket — NOT pane_current_command, which is the wrapper/shell while claude runs as
  // its child — is the truth that claude is up. else idle if the idle_prompt hook fired since the last tool,
  // else working. The mark-active hook flips idle → active on the next real work, self-correcting.
  if (!rec.session || !live.has(rec.session)) return 'offline'
  if (!existsSync(rvSock(rec.session))) {
    // tmux is up but the socket isn't: a just-launched agent still booting reads 'starting' for the boot
    // window; only past it (socket still gone) is the agent genuinely dead → 'offline'.
    const at = launchedAt.get(rec.session)
    return at && Date.now() - at < BOOT_GRACE_MS ? 'starting' : 'offline'
  }
  return rec.status === 'idle' ? 'idle' : 'working'
}

async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  for (const w of await listWorktrees()) {
    const rec = readSessionFile(w.path)
    if (rec.session === id) return { path: w.path, branch: w.branch, rec }
  }
  return null
}

// @@@ createdAt - a session's birth instant = the WORKTREE DIRECTORY's birthtime. The dir is created once by
// `git worktree add` and lives for the session's whole life, so its birthtime is the one stable anchor. The
// `.session` file's birthtime is NOT usable: writers recreate that file (it's rewritten via replace, not an
// in-place truncate), so its birthtime resets to "last major write" and the order would reshuffle — exactly
// the instability we're avoiding. Falls back to dir mtime where a filesystem reports no birthtime, then 0.
// Drives listSessions' ordering (oldest first, new sessions append).
function createdAt(dir: string): number {
  try { const s = statSync(dir); return s.birthtimeMs || s.mtimeMs || 0 } catch { return 0 }
}

function toSession(rec: SessRec, branch: string | null, path: string, status: DisplayStatus, activity: string | null = null): Session {
  const prompt = readPromptFile(path)   // the originating ask, captured at launch (sidecar; null for old sessions)
  // activity is the LIVE pane title; it only means anything while the worker is up — a dead/booting/queued
  // session would show a stale or absent title, so it's suppressed there (the row falls back to its label).
  const live = status !== 'offline' && status !== 'starting' && status !== 'queued'
  return { id: rec.session!, node: rec.node, title: rec.title, name: rec.name, branch, path, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status, prompt, promptPreview: prompt ? promptPreview(prompt) : null, created: createdAt(path), activity: live ? activity : null }
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
  writeSessionFile(wt.path, { ...wt.rec, name: name.trim() || null })
  return true
}

// the session's full ORIGINATING prompt (what it was asked to do), or null if none was recorded.
export async function sessionPrompt(id: string): Promise<string | null> {
  const wt = await findWorktree(id)
  return wt ? readPromptFile(wt.path) : null
}

// @@@ lastKnownSession - the last successfully-read Session row per worktree path. A worktree's EXISTENCE
// is definitive (it is in `git worktree list`, its directory is on disk); a transient failure reading its
// `.session` (an ENOENT race, or a sibling read failing under a concurrent merge) must NOT drop it from the
// board — that absence is exactly what watchSessions used to mis-read as a `closed · removed`. So a degraded
// read serves this last-known row instead of vanishing. Pruned each poll to only paths still present.
const lastKnownSession = new Map<string, Session>()

// @@@ listSessions - every worktree that IS a session (has a .session id), status reconciled. Offline
// and awaiting ones still appear (their .session persists), so a session is never lost from view.
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
    const s = toSession(rec, w.branch, w.path, reconcile(rec, live), titles.get(rec.session) ?? null)
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
  // @@@ creation order - git lists worktrees alphabetically by path, and a path is a slug of the launch
  // prompt, so the raw enumeration order is effectively random AND reshuffles every time a session joins or
  // leaves. Order by birth instead (oldest first): each session keeps its slot for life and a new one simply
  // appends — a stable spatial map across every surface (dashboard window, session tabs, `spex ls`). id
  // breaks ties so same-instant births stay deterministic.
  return rows.filter((s): s is Session => s != null).sort((a, b) => a.created - b.created || a.id.localeCompare(b.id))
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
// {peer, ts} line to the RECIPIENT's `.session/comms.ndjson` — each message counted exactly once, on the
// side the backend already resolved. Persisted (survives a backend restart, unlike the in-memory monitor
// registrations) and untracked (dies with the worktree, matching a graph of LIVE sessions). No sender →
// not an agent send → not logged. Best-effort: recording must NEVER fail the delivered message.
const COMMS_FILE = 'comms.ndjson'
async function recordComms(toId: string, fromId: string): Promise<void> {
  if (!fromId || fromId === toId) return
  try {
    const wt = await findWorktree(toId)
    if (!wt) return
    appendFileSync(join(runtimeDir(wt.path), COMMS_FILE), JSON.stringify({ peer: fromId, ts: new Date().toISOString() }) + '\n')
  } catch { /* a recording failure must not fail the delivered send */ }
}
// the peers this session has exchanged messages with — one entry per message, newest appended last.
function readComms(path: string): string[] {
  try {
    const p = join(path, RUNTIME_DIR, COMMS_FILE)
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').split('\n').filter(Boolean)
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

// @@@ watch registration (CLIENT side) - a `spex watch` process is separate from the server, so it
// REPORTS itself to the backend's registration store over HTTP: register+heartbeat while it runs,
// deregister on exit (see cli.ts `watch`). All best-effort — if the backend is down the watch still
// streams its events; the graph edge just won't appear until a heartbeat lands. Never throws.
export const apiBase = () => process.env.SPEXCODE_API_URL || `http://127.0.0.1:${process.env.PORT || 8787}`
// the agent's OWN session id: Claude Code's env var if set, else the worktree `.session` in the cwd (the
// `spex watch` runs from the worker's worktree, whose .session id equals the worker claude's session id).
export function ownSessionId(): string | null {
  const env = process.env.CLAUDE_CODE_SESSION_ID
  if (env && env.trim()) return env.trim()
  return readSessionFile(process.cwd()).session
}

// @@@ withSenderHint - bidirectional agent messaging. `spex session send` delivers a prompt to the
// recipient; this stamps WHO sent it and HOW to reply as a one-line insert appended to the delivered
// message, so the recipient agent CAN reply (or ignore) and the reply rides the SAME send back into the
// sender's prompt — a reply channel, no workflow enforcement, just a prompt insert. The sender is the
// SENDING agent's OWN session (id from [[dispatch]]'s send-command process via ownSessionId, label its
// board row); its FULL id is stamped so the reply addresses exactly one session, never a prefix. A human
// running `send` from a plain shell has no session id (sender=null) → the bare message, no hint, no loop.
export type MsgSender = { id: string; label: string | null }
export function withSenderHint(text: string, sender: MsgSender | null): string {
  if (!sender) return text
  const who = sender.label ? `${sender.label} (${sender.id})` : sender.id
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

// @@@ hideClaudeMd - CLAUDE.md isolation. A DISPATCHED agent should run with full SpexCode control over
// its own behavior, not be shaped by the project CLAUDE.md the way the managing session is (auto-discovery
// would inject it as system context). At launch we move the worktree's CLAUDE.md → `.session/claude.md`
// (still on disk, fully readable — NOT deleted, NOT --bare, so auth/hooks/repo stay intact; the lowercase
// name in a dot-dir is invisible to Claude Code's CLAUDE.md auto-discovery), and `update-index
// --assume-unchanged CLAUDE.md` so the move is invisible to git and can NEVER be staged/committed/merged
// back to main. Default ON; disable with SPEXCODE_HIDE_CLAUDE_MD=0. Best-effort: any failure must not block launch.
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

// @@@ stopHook - injected per session via `claude --settings '<inline JSON>'` (a CLI param, so it
// pollutes NOTHING — no global ~/.claude, not even a worktree file). The Stop hook fires when the agent
// finishes a turn and runs `spex session done` from the worktree cwd → the worktree structurally becomes
// `awaiting` the human, with no reliance on the agent remembering. The command must point at MAIN's
// tsx + cli (a fresh worktree off main has no node_modules), running with cwd = the worktree, so
// markDoneFromCwd() writes that worktree's .session. JSON has only double quotes → safe single-quoted.
// @@@ settingsJson - the hooks Claude Code loads via `--settings <FILE>`. Written to a per-worktree
// file (NOT inline on the command line — inline JSON containing single quotes broke the shell quoting
// and claude read it as a missing file path). The file is ephemeral (removed with the worktree), so
// still no global pollution. UserPromptSubmit + PreToolUse → the branching `mark-active` hook (active on
// any work; asking, with the question as the note, when the tool is AskUserQuestion — see
// mark-active.sh); PreToolUse ALSO runs `spec-first` (a one-shot read-the-spec-before-code nudge —
// sessions/spec-first; its own sentinel file, so it never races mark-active's `.session/state` write); Stop
// → the blocking gate (with a loop-break); StopFailure → `error`;
// Notification(idle_prompt) → `idle`. Hook commands use MAIN's tsx+cli by absolute path ($SPEX) since a
// fresh worktree has no node_modules and `spex` may be off the session's PATH.
// @@@ idle hook - the Notification hook fires `session idle` (guarded active-only) when claude sits
// WAITING at its prompt without having declared a state — the case the Stop gate misses: an API error
// killed the turn before the gate ran, or the brief window between stopping and declaring. (claude is
// the pane's foreground process whether churning or idle-waiting, so reconcile alone can't tell them
// apart — only idle_prompt can.) This is DISTINCT from `asking` (the agent asking the human, captured
// from the AskUserQuestion tool or declared via `spex session ask`); idle is the inferred, undeclared
// stop. The active-only guard in `session idle` is what keeps the two from clobbering each other (a
// deliberate awaiting/asking/parked/error declaration always survives). The Notification fires for
// many reasons, so the command keys on the structured `notification_type` field — acting only on the
// idle_prompt one — rather than sniffing the payload blob for the bare word.
function settingsJson(): string {
  const root = pkgRoot()
  const gate = join(root, 'hooks', 'stop-gate.sh')
  const markCmd = `bash ${join(root, 'hooks', 'mark-active.sh')}`
  const specFirstCmd = `bash ${join(root, 'hooks', 'spec-first.sh')}`   // one-shot read-the-spec nudge (sessions/spec-first)
  const spex = `${join(root, 'node_modules', '.bin', 'tsx')} ${join(root, 'src', 'cli.ts')}`
  const idleCmd = `p=$(cat); case "$p" in *'"notification_type":"idle_prompt"'*) ${spex} session idle ;; esac`
  const hooks: Record<string, unknown> = {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: markCmd }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: markCmd }, { type: 'command', command: specFirstCmd }] }],
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
// @@@ launchScript - the WHOLE launch invocation (rendezvous env prefix + claude + --append-system-prompt
// + --settings + the human prompt) is written to an ephemeral `.spex-launch.sh` in the worktree and run via
// `bash <file>`, NOT typed inline. Inline send-keys TRUNCATES past ~2KB (the launch-prompt-limit trap), and
// the system-surface gather can make --append-system-prompt arbitrarily large; a file has no length limit
// and the only thing send-keys types is the short `bash <file>` line. It's the SAME command the inline path
// ran (env prefix exports the rendezvous vars to the claude child), just relocated to a file. Liveness no
// longer cares what the pane's foreground command is: claude runs as a child of bash (and, via the
// `reclaude` wrapper, a grandchild), so the pane command is the wrapper/shell — reconcile reads claude's
// rendezvous socket instead (present while claude is alive, gone once it exits). The file is a RUNTIME_FILE
// (gitignored, ignored by the merge gate, removed with the worktree) so it never pollutes the spec/code work.
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

// @@@ concurrency cap + queue - keep at most MAX_ACTIVE agents WORKING at once. A session OCCUPIES a slot
// while its agent is launched and still OWNS its task: its claude is genuinely live (tmux window present AND
// rendezvous socket present) and it has not yet handed the work to a human (lifecycle `awaiting`). So
// working/idle/parked/asking/error agents that are actually alive each hold a slot; a session frees its
// slot the moment it PROPOSES (review/done/close-pending), goes OFFLINE (crashed/exited — socket gone), or is
// closed. Liveness is checked directly (the same socket truth reconcile uses) rather than off the display
// status, so an authored state (parked/error/asking) whose claude has since died does NOT pin a slot.
// `queued` sessions never occupy. Resource pressure scales with concurrently-WORKING agents, which is exactly
// this set — the cap throttles it; the rest wait as durable `queued` worktrees.
function isOccupying(s: Session, live: Set<string>): boolean {
  if (s.status === 'queued' || s.lifecycle === 'awaiting') return false   // not launched, or handed to a human
  return live.has(s.id) && existsSync(rvSock(s.id))                       // a genuinely live claude (tmux + socket)
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

// @@@ drainQueue - start as many `queued` sessions as there are free slots, oldest first. Idempotent and
// re-entrancy-guarded; safe to call on every slot-freeing event (newSession / close / propose) AND on a
// periodic tick (superviseQueue) — the periodic tick is what catches the AGENT-authored transitions
// (done/parked written by a hook SUBPROCESS, which can't reach this server's queue). Re-lists each iteration
// so a freshly launched session (held in `launching`) counts immediately and we never exceed the cap.
export async function drainQueue(): Promise<void> {
  if (draining) return
  draining = true
  try {
    for (;;) {
      const [sessions, live] = await Promise.all([listSessions(), liveTmux()])
      const occupied = sessions.reduce((n, s) => n + (launching.has(s.id) || isOccupying(s, live) ? 1 : 0), 0)
      if (occupied >= MAX_ACTIVE) break
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

// @@@ createSession (dispatch via backend) - `spex new` / `spex session new` must launch the worker in the
// BACKEND's process, not the caller's. The backend owns the launch env (notably SPEXCODE_CLAUDE_CMD, which
// reclaude strips from agent envs) AND the concurrency cap. An agent that runs `spex new` (e.g. a supervisor)
// has a stripped env, so an in-process launch would spawn workers under plain `claude` and 401 at boot. So
// the CLI POSTs to the running backend whenever one answers, making the backend the single owner of session
// launching. Only when NO backend is reachable do we fall back to launching in this process (with a stderr
// warning) — the backend's own POST handler calls newSession directly, so it never re-enters this path.
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

// @@@ newSession - durable worktree (branch node/<slug> off main) + .session label. The agent does NOT
// launch inline any more: the worktree is prepared and parked as `queued`, then drainQueue() launches it
// immediately if we're under the concurrency cap, else it waits its turn. Backs both the dashboard POST and
// `spex session new`. A board directive (nn/dd) additionally mutates the worktree's spec tree up front and
// hands the agent a finish-the-op prompt.
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
  const rec: SessRec = { node: ref || null, title, name: null, session: id, status: 'queued', proposal: null, merges: 0, note: null }
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
    // @@@ spec pointer - the ref (explicit --node, else the prompt's first @mention) named an EXISTING node.
    // Append ONE line pointing the agent at that node's spec.md as an ABSOLUTE path INSIDE its own worktree, so
    // it reads the LIVE file (never a stale snapshot we'd inject). relPath already carries the .spec/ prefix and
    // is identical in this freshly-branched worktree, so the absolute path is just join(worktree, relPath). Only
    // a real node gets a pointer; an unknown id resolves to nothing and we fail quiet (no pointer appended).
    const spec = (await loadSpecs()).find((n) => n.id === ref)
    if (spec) launchPrompt = `${prompt}\n\nThe spec node \`${ref}\` is your ground truth — read its spec at ${join(path, spec.path)}.`
  }
  writeLaunchFile(path, launchPrompt)   // park the exact launch prompt for the drainer (consumed at launch)
  await drainQueue()                    // launch now if under the cap, else leave it queued for a free slot
  const after = readSessionFile(path)   // 'active' if the drain launched it, else still 'queued'
  return toSession(after, branch, path, after.status === 'queued' ? 'queued' : 'working')
}

// @@@ waitForSocket - after a relaunch, the resumed claude needs SEVERAL SECONDS to boot and recreate its
// rendezvous control socket; launch() only TYPES the start line via send-keys and returns immediately, so
// the socket does not exist yet on return. Poll existsSync(rvSock(id)) at a small interval up to a bounded
// timeout so a resumed agent counts as "ready" only once its socket is up — then a follow-on dispatch
// (merge / send) lands in a LIVE socket instead of racing a not-yet-booted daemon and failing loud (409)
// on a session that is actually recovering. BOUNDED + fail-loud preserved: a genuinely dead/unrecoverable
// agent never creates the socket, so after the timeout we return and the caller's own socket-existence
// check (sendKeys) fails loud exactly as before — this only closes the startup race, it adds no fallback.
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

// @@@ reopen - "back to working": clear any proposal → active, then ONE relaunch path. claude needs
// (re)starting iff it isn't running for this id — the SAME deterministic liveness reconcile uses: no tmux,
// or no rendezvous socket (claude exited, even though the wrapper/shell may still hold the pane). In both
// cases we drop any stale pane and launch a fresh window that --resume's the SAME conversation (with its
// rendezvous socket, via launch). When we DO relaunch we then WAIT for that socket to come up
// (waitForSocket) before returning, so a caller that dispatches immediately after reopen (e.g.
// mergeSession) addresses a live socket rather than racing the boot. If claude is still live we only
// cleared the proposal — no wait, the socket already exists. Also serves the plain "relaunch" of an
// offline (already-active) one. Fail-loud is unchanged: if the socket never appears, the later sendKeys
// existsSync check still fails loud.
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
// @@@ agent-authored state - the agent (forced by gates at boundaries) writes its OWN state to
// .session; it is the authority on what a stop MEANS (awaiting human vs parked on a background task).
// External hooks only know SOMETHING changed, not the transition, so they force a write, never infer.
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
// @@@ markIdleFromCwd - the ONE INFERRED state, so (unlike the agent-authored writers above) it carries a
// strict active-only guard: the Notification(idle_prompt) hook fires it when claude is waiting at its
// prompt, and it may ONLY overwrite `active` → `idle`. A deliberate declaration (awaiting / asking /
// parked / error) must survive — idle only fills the gap where the agent stopped WITHOUT declaring (e.g.
// an API error killed the turn before the Stop gate). The mark-active hook flips idle → active on resume.
export function markIdleFromCwd(): boolean {
  const rec = readSessionFile(process.cwd())
  if (!rec.session || rec.status !== 'active') return false  // active-only: never clobber a declaration
  writeSessionFile(process.cwd(), { ...rec, status: 'idle' })
  return true
}
// @@@ asking has TWO writers, both deterministic (neither guarded active-only): (1) the mark-active
// PreToolUse hook captures it the instant the agent invokes the AskUserQuestion tool (status=asking,
// the question as the note) — a HARD signal that the agent is asking the human; (2) the agent declares it
// itself via markStateFromCwd('asking', { note }) — `spex session ask`, e.g. at the Stop gate. Either
// way the mark-active path clears it back to active on the next tool / prompt, same as any non-active state.

// @@@ mergeReadiness - the deterministic commit gate the Stop hook enforces before a session may declare
// done / propose merge. The dogfood ritual lands every change as a COMMIT on the node branch first, so two
// states block a declaration: (1) uncommitted working-tree changes, ignoring the runtime files SpexCode
// itself writes into the worktree (the whole `.session/` dir — state/prompt/launch/hooks.json/launch.sh/
// claude.md — never part of the spec/code work), or (2) 0 commits ahead of main (nothing committed to
// merge; see isRuntimePath). Runs from
// cwd = the session worktree; ALL git goes through git() so the hook's exported GIT_DIR/GIT_INDEX_FILE can't
// misdirect repo discovery to the cwd (the same trap git.ts documents). `main` resolves via the shared refs,
// so `main..HEAD` works from any linked worktree regardless of where main is checked out.
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
// main's tree). It reopens the session (clears the proposal → active, `--resume`s via reopen if tmux died —
// which waits for the rendezvous socket, closing the just-relaunched-no-socket race) and dispatches mergePrompt
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

// @@@ closeSession - the ONLY removal (human-confirmed): kills tmux, sweeps the rendezvous socket, removes
// the worktree + branch. The rendezvous socket lives in the OS tmpdir (NOT the worktree), so worktree removal
// alone leaves it behind — closing many sessions over time would accumulate stale `spexcode-rv-*.sock` files.
// We unlink it here so no dead control endpoint lingers (rmSync force = no error if claude already removed it).
export async function closeSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await tmuxOk(['kill-session', '-t', id])
  launchedAt.delete(id)   // drop the boot-window stamp so the map never accretes closed ids
  try { rmSync(rvSock(id), { force: true }) } catch { /* best-effort sweep; tmpdir socket, claude/OS may already be gone */ }
  if (wt) {
    await gitA(['-C', mainRoot(), 'worktree', 'remove', '--force', wt.path])
    if (wt.branch) await gitA(['-C', mainRoot(), 'branch', '-D', wt.branch])
  }
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

// @@@ sendKeys - PROMPT control for a session, through the per-session rendezvous socket ONLY. The socket
// injects AND submits the prompt and confirms the agent ACCEPTED it (see replyViaSocket); there is NO
// send-keys fallback. A prompt that can't go through the socket — no socket (socketless/old session, or the
// agent is offline), a connect error, or no acceptance confirmation — FAILS LOUD: it returns ok:false with a
// reason that propagates to the caller (API non-2xx, `spex session send`, the merge dispatch), instead of
// silently degrading to typing into the pane and reporting a false success. The socket exists only for
// sessions WE launched the new way and its path is derived from the id, so we never address another
// session's socket. (The separate RAW nav-key channel keeps its own `tmux send-keys` path — see rawKey.)
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

// @@@ rawKey - the RAW-KEYSTROKE nav path, kept DELIBERATELY on `tmux send-keys` and NEVER the rendezvous
// socket. Two channels, two jobs: the socket INJECTS a whole prompt (text + submit), which can drive the
// agent's normal prompt but CANNOT navigate an interactive TUI select menu (e.g. `/model`'s list — ↑/↓ to
// move, ←/→ to adjust, Enter to set, `s` for this-session, Esc to cancel). When the agent is in that
// keystroke-navigation state its input box is replaced by the menu, so the dashboard's nav mode forwards
// each key here in real time. send-keys is exactly right for single raw keys: named keys map to tmux's own
// key names; a single printable char is sent literally (`-l`) so tmux doesn't reinterpret it. One key per
// call, no socket and no Enter-synthesis — this IS the send-keys channel. False if the tmux session is gone.
const TMUX_KEY: Record<string, string> = {
  Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Space: 'Space', Backspace: 'BSpace',
}
export async function rawKey(id: string, key: string): Promise<boolean> {
  if (!key || !(await alive(id))) return false
  const named = TMUX_KEY[key]
  if (named) { await tmux(['send-keys', '-t', id, named]); return true }
  if ([...key].length === 1) { await tmux(['send-keys', '-t', id, '-l', '--', key]); return true }  // single printable char
  return false
}
