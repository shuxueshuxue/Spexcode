import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, gitA, repoRoot } from './git.js'

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
//              (offline = no tmux for the recorded id, or the pane fell back to a bare shell)
//   awaiting → the agent's PROPOSAL, awaiting a human:
//                proposal=merge   → shown "review"        ("ready, merge me")
//                proposal=nothing → shown "done"          ("finished, your call")
//                proposal=close   → shown "close-pending" ("I suggest discarding this worktree")
//   needs-input → the agent DELIBERATELY declared (via `spex session ask --note <question>`, typically at
//                the Stop gate) that it is pausing to ask the HUMAN a question. AGENT-AUTHORED, like
//                done/block — not inferred. Distinct from `blocked` (which waits on a background task/
//                schedule and self-resumes); a needs-input agent resumes only when a human sends it a prompt.
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

export type Lifecycle = 'active' | 'idle' | 'awaiting' | 'blocked' | 'error' | 'needs-input'
export type Proposal = 'merge' | 'nothing' | 'close'
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'review' | 'done' | 'close-pending' | 'blocked' | 'error' | 'needs-input'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; branch: string | null; path: string
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; note: string | null
}

async function tmux(args: string[]): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8' })
  return stdout
}
async function tmuxOk(args: string[]): Promise<boolean> { try { await tmux(args); return true } catch { return false } }
export async function alive(id: string): Promise<boolean> { return tmuxOk(['has-session', '-t', id]) }
// tmux's own per-session activity clock (epoch s) → no in-memory state, so liveness survives a restart.
async function activityAgeMs(id: string): Promise<number | null> {
  try {
    const out = (await tmux(['display-message', '-p', '-t', id, '-F', '#{session_activity}'])).trim()
    const epoch = Number(out)
    return epoch ? Date.now() - epoch * 1000 : null
  } catch { return null }
}

// worktrees + branches are created off MAIN even when the server runs inside a worktree.
function mainRoot(): string {
  try { return dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()) }
  catch { return repoRoot() }
}

type SessRec = { node: string | null; session: string | null; status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null }
function readSessionFile(dir: string): SessRec {
  const r: SessRec = { node: null, session: null, status: 'active', proposal: null, merges: 0, note: null }
  const p = join(dir, '.session')
  if (!existsSync(p)) return r
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (k === 'node') r.node = v || null
    else if (k === 'session') r.session = v || null
    else if (k === 'status' && (v === 'active' || v === 'idle' || v === 'awaiting' || v === 'blocked' || v === 'error' || v === 'needs-input')) r.status = v
    else if (k === 'proposal' && v) r.proposal = v as Proposal
    else if (k === 'merges') r.merges = Number(v) || 0
    else if (k === 'note') r.note = v || null
  }
  return r
}
function writeSessionFile(dir: string, rec: SessRec): void {
  const lines = [`node: ${rec.node || ''}`, `session: ${rec.session || ''}`, `status: ${rec.status}`]
  if (rec.status === 'awaiting' && rec.proposal) lines.push(`proposal: ${rec.proposal}`)
  if (rec.merges) lines.push(`merges: ${rec.merges}`)
  if (rec.note) lines.push(`note: ${rec.note}`)
  writeFileSync(join(dir, '.session'), lines.join('\n') + '\n')
}

async function listWorktrees(): Promise<{ path: string; branch: string | null }[]> {
  const out = await gitA(['-C', mainRoot(), 'worktree', 'list', '--porcelain'])
  const list: { path: string; branch: string | null }[] = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur) }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '')
  }
  return list
}

// @@@ reconcile - the shown status. awaiting → the proposal's label (review/done/close-pending),
// shown regardless of liveness. active/idle → their LIVENESS: offline if no tmux for the recorded id (or
// the pane fell back to a bare shell), else idle if the idle_prompt hook has fired since the last tool
// use, else working.
const SHELLISH = /^-?(zsh|bash|sh|fish|dash)$/  // pane sitting at a shell = claude exited/crashed
async function paneCmd(id: string): Promise<string> {
  try { return (await tmux(['display-message', '-p', '-t', id, '-F', '#{pane_current_command}'])).trim() } catch { return '' }
}
async function reconcile(rec: SessRec): Promise<DisplayStatus> {
  // agent-authored declarations win regardless of liveness; we never INFER these externally.
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (rec.status === 'blocked') return 'blocked'  // waiting on a background task/schedule; self-resumes
  if (rec.status === 'error') return 'error'      // turn died on an API error (StopFailure hook)
  if (rec.status === 'needs-input') return 'needs-input'  // agent declared (via `session ask`) it is asking the HUMAN a question; resumes on the next prompt
  // active/idle are the SAME live agent — claude is the pane's foreground process whether it is churning
  // OR waiting at its prompt, so a bare shell (claude exited/crashed) or a dead tmux is offline either way.
  // The only difference is whether the idle_prompt hook has marked it idle since the last tool use; the
  // mark-active hook flips idle → active again on the next real work, so this stays self-correcting.
  if (!rec.session || !(await alive(rec.session))) return 'offline'
  if (SHELLISH.test(await paneCmd(rec.session))) return 'offline'
  return rec.status === 'idle' ? 'idle' : 'working'
}

async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  for (const w of await listWorktrees()) {
    const rec = readSessionFile(w.path)
    if (rec.session === id) return { path: w.path, branch: w.branch, rec }
  }
  return null
}

function toSession(rec: SessRec, branch: string | null, path: string, status: DisplayStatus): Session {
  return { id: rec.session!, node: rec.node, branch, path, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status }
}

// @@@ listSessions - every worktree that IS a session (has a .session id), status reconciled. Offline
// and awaiting ones still appear (their .session persists), so a session is never lost from view.
export async function listSessions(): Promise<Session[]> {
  const out: Session[] = []
  for (const w of await listWorktrees()) {
    const rec = readSessionFile(w.path)
    if (!rec.session) continue
    out.push(toSession(rec, w.branch, w.path, await reconcile(rec)))
  }
  return out
}

const slugify = (node: string | null) => (node || 'session').replace(/[^a-zA-Z0-9_-]/g, '-')

// @@@ hideClaudeMd - CLAUDE.md isolation. A DISPATCHED agent should run with full SpexCode control over
// its own behavior, not be shaped by the project CLAUDE.md the way the managing session is (auto-discovery
// would inject it as system context). At launch we rename the worktree's CLAUDE.md → CLAUDE.spexhidden.md
// (still on disk, fully readable — NOT deleted, NOT --bare, so auth/hooks/repo stay intact) so Claude
// Code's auto-discovery no longer finds it, and `update-index --assume-unchanged CLAUDE.md` so the rename
// is invisible to git and can NEVER be staged/committed/merged back to main. Default ON; disable with
// SPEXCODE_HIDE_CLAUDE_MD=0. Best-effort: any failure here must never block the launch.
const HIDE_CLAUDE_MD = process.env.SPEXCODE_HIDE_CLAUDE_MD !== '0' && process.env.SPEXCODE_HIDE_CLAUDE_MD !== 'false'
async function hideClaudeMd(path: string): Promise<void> {
  if (!HIDE_CLAUDE_MD) return
  const src = join(path, 'CLAUDE.md')
  if (!existsSync(src)) return
  try {
    // pin the tracked path assume-unchanged FIRST, so the rename's deletion is never seen by git.
    await gitA(['-C', path, 'update-index', '--assume-unchanged', 'CLAUDE.md'])
    renameSync(src, join(path, 'CLAUDE.spexhidden.md'))
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
// still no global pollution. PreToolUse/UserPromptSubmit → `active` (freshness); Stop → the blocking
// gate (with a loop-break); StopFailure → `error`; Notification(idle_prompt) → `idle`. Hook commands use
// MAIN's tsx+cli by absolute path ($SPEX) since a fresh worktree has no node_modules and `spex` may be
// off the session's PATH.
// @@@ idle hook - the Notification hook fires `session idle` (guarded active-only) when claude sits
// WAITING at its prompt without having declared a state — the case the Stop gate misses: an API error
// killed the turn before the gate ran, or the brief window between stopping and declaring. (claude is
// the pane's foreground process whether churning or idle-waiting, so reconcile alone can't tell them
// apart — only idle_prompt can.) This is DISTINCT from `needs-input`, which is the agent DELIBERATELY
// asking the human a question via `spex session ask` at the Stop gate; idle is the inferred, undeclared
// stop. The active-only guard in `session idle` is what keeps the two from clobbering each other (a
// deliberate awaiting/needs-input/blocked/error declaration always survives). We use a catch-all hook +
// inline payload filter rather than relying on Notification-matcher semantics: it only acts when the
// notification is the idle_prompt one.
function settingsJson(): string {
  const gate = join(mainRoot(), 'spec-cli', 'hooks', 'stop-gate.sh')
  const markCmd = `bash ${join(mainRoot(), 'spec-cli', 'hooks', 'mark-active.sh')}`
  const spex = `${join(mainRoot(), 'spec-cli', 'node_modules', '.bin', 'tsx')} ${join(mainRoot(), 'spec-cli', 'src', 'cli.ts')}`
  const idleCmd = `p=$(cat); case "$p" in *idle_prompt*) ${spex} session idle ;; esac`
  const hooks: Record<string, unknown> = {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: markCmd }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: markCmd }] }],
    Stop: [{ hooks: [{ type: 'command', command: `SPEX='${spex}' bash ${gate}` }] }],
    StopFailure: [{ hooks: [{ type: 'command', command: `${spex} session fail` }] }],
    Notification: [{ hooks: [{ type: 'command', command: idleCmd }] }],
  }
  return JSON.stringify({ hooks }, null, 2)
}
// write the hooks file into the worktree and return the `--settings <file>` arg (no shell-quoting hazard).
function writeSettings(path: string): string {
  const file = join(path, '.spex-hooks.json')
  writeFileSync(file, settingsJson())
  return `--settings ${file}`
}
async function launch(id: string, path: string, tail: string): Promise<void> {
  await tmux(['new-session', '-d', '-s', id, '-x', String(COLS), '-y', String(ROWS), '-c', path])
  await tmux(['send-keys', '-t', id, '-l', '--', `${CLAUDE_CMD} ${writeSettings(path)} ${tail}`])
  await tmux(['send-keys', '-t', id, 'Enter'])
}

// @@@ newSession - durable worktree (branch node/<slug> off main) + .session label, then launch claude
// with the id we chose. Backs both the dashboard POST and `spex session new`.
export async function newSession(node: string | null, prompt: string): Promise<Session> {
  const id = randomUUID()
  const slug = `${slugify(node)}-${id.slice(0, 4)}`
  const branch = `node/${slug}`
  const path = join(mainRoot(), '.worktrees', slug)
  await gitA(['-C', mainRoot(), 'worktree', 'add', '-b', branch, path, 'main'])
  const rec: SessRec = { node: node || null, session: id, status: 'active', proposal: null, merges: 0, note: null }
  writeSessionFile(path, rec)
  await hideClaudeMd(path)   // isolate the dispatched agent from the project CLAUDE.md (before launch)
  const sq = `'${(prompt || '').replace(/'/g, `'\\''`)}'`
  await launch(id, path, `--session-id ${id} ${sq}`)
  return toSession(rec, branch, path, 'working')
}

// @@@ reopen - "back to working": clear any proposal → active, and if the tmux died, --resume the SAME
// conversation into a fresh window. Also serves the plain "relaunch" of an offline (already-active) one.
export async function reopen(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, status: 'active', proposal: null })
  const hasTmux = await alive(id)
  if (!hasTmux) {
    await launch(id, wt.path, `--resume ${id}`)               // no tmux → fresh window
  } else if (SHELLISH.test(await paneCmd(id))) {
    // tmux pane exists but claude exited to a shell → resume claude IN the existing pane
    await tmux(['send-keys', '-t', id, '-l', '--', `${CLAUDE_CMD} ${writeSettings(wt.path)} --resume ${id}`])
    await tmux(['send-keys', '-t', id, 'Enter'])
  }
  return true
}

// agent/human PROPOSAL → awaiting (review = propose merge, done = nothing, close-pending = propose close).
export async function propose(id: string, proposal: Proposal): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, status: 'awaiting', proposal })
  return true
}
// @@@ agent-authored state - the agent (forced by gates at boundaries) writes its OWN state to
// .session; it is the authority on what a stop MEANS (awaiting human vs blocked on a background task).
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
// prompt, and it may ONLY overwrite `active` → `idle`. A deliberate declaration (awaiting / needs-input /
// blocked / error) must survive — idle only fills the gap where the agent stopped WITHOUT declaring (e.g.
// an API error killed the turn before the Stop gate). The mark-active hook flips idle → active on resume.
export function markIdleFromCwd(): boolean {
  const rec = readSessionFile(process.cwd())
  if (!rec.session || rec.status !== 'active') return false  // active-only: never clobber a declaration
  writeSessionFile(process.cwd(), { ...rec, status: 'idle' })
  return true
}
// @@@ needs-input is AGENT-AUTHORED via markStateFromCwd('needs-input', { note }) — see `spex session ask`.
// The agent deliberately declares it is pausing to ask the human a question (the note carries the question),
// so it is NOT guarded active-only the way an inferred external signal would have to be. The mark-active path
// (PreToolUse/UserPromptSubmit) clears it back to active when the human sends the next prompt, same as it
// clears any other non-active state.

// @@@ mergePrompt - the INTENT the human clicks "merge" with, written as an instruction to the session's
// own agent. The agent (not the server) performs the merge, because only the agent knows the work's intent
// and can resolve conflicts; the server has no fixed `git merge` logic. branch/main are substituted live.
function mergePrompt(branch: string, main: string): string {
  return `Merge your branch ${branch} into main now. From the main checkout at ${main}, run: ` +
    `git -C ${main} merge --no-ff ${branch}. If it conflicts, resolve the conflicts yourself ` +
    `(you know the intent of this work), complete the merge, and verify \`git -C ${main} rev-parse HEAD\` ` +
    `actually advanced and that no merge is left in progress (no ${main}/.git/MERGE_HEAD present). If ` +
    `anything goes wrong and main is left half-merged, run git -C ${main} merge --abort to restore main ` +
    `and explain. After a verified successful merge, propose close (you're done).`
}

// @@@ mergeSession - the merge ACTION is now a DISPATCH, not a fixed server-side `git merge`. The human
// acts at the level of INTENT; the session's OWN agent performs the operation. We reopen the session
// (clear the proposal → active, and --resume the agent if its tmux died), then send-keys a merge prompt
// into it. The agent runs git, resolves any conflicts using its knowledge of the work, verifies main HEAD
// advanced (and that nothing is left mid-merge), and then re-proposes/closes. This is ASYNC: the server
// returns once the prompt is dispatched and never touches main's tree itself.
export async function mergeSession(id: string): Promise<{ ok: boolean; dispatched?: boolean; error?: string }> {
  const wt = await findWorktree(id)
  if (!wt || !wt.branch) return { ok: false, error: 'no such session' }
  await reopen(id)  // clear the proposal → active, and --resume the agent if its tmux died
  const dispatched = await sendKeys(id, mergePrompt(wt.branch, mainRoot()), true)
  return dispatched ? { ok: true, dispatched: true } : { ok: false, error: 'agent not reachable' }
}

// @@@ closeSession - the ONLY removal (human-confirmed): kills tmux, removes the worktree + branch.
export async function closeSession(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  await tmuxOk(['kill-session', '-t', id])
  if (wt) {
    await gitA(['-C', mainRoot(), 'worktree', 'remove', '--force', wt.path])
    if (wt.branch) await gitA(['-C', mainRoot(), 'branch', '-D', wt.branch])
  }
  return !!wt
}

// the session's live pane as a one-shot snapshot (output), for agents driving sessions via `spex capture`.
// The dashboard no longer uses this — its live terminal is a real tmux client (see pty-bridge.ts).
export async function captureSession(id: string): Promise<string> {
  if (!(await alive(id))) return ''
  try { return await tmux(['capture-pane', '-e', '-p', '-t', id]) } catch { return '' }
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
  working: '\u25cf', idle: '\u25cb', offline: '\u23fb', review: '\u25c6', done: '\u2713',
  'close-pending': '\u2715', blocked: '\u29d6', error: '\u2717', 'needs-input': '\u2370',
}
const ANSI: Record<DisplayStatus, string> = {
  working: '33', idle: '90', offline: '90', review: '35', done: '34', 'close-pending': '31', blocked: '36', error: '31', 'needs-input': '93',
}

// a session matches a selector if the selector is its id (or an id-prefix), its node, or its branch.
// no selectors (or '@all') = everything. Optional status filter on top. This IS the subscription.
export function selectSessions(all: Session[], selectors: string[], statuses?: string[]): Session[] {
  let out = all
  const sel = selectors.filter((x) => x && x !== '@all')
  if (sel.length) out = out.filter((s) => sel.some((q) => s.id === q || s.id.startsWith(q) || s.node === q || s.branch === q))
  if (statuses && statuses.length) out = out.filter((s) => statuses.includes(s.status))
  return out
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
  const header = c('90', `    ${'STATUS'.padEnd(13)} ${'NODE'.padEnd(22)} ${'ID'.padEnd(8)} ${'\u00d7'.padEnd(4)}NOTE`)
  const rows = sessions.map((s) => {
    const g = STATUS_GLYPH[s.status] ?? '\u00b7'
    const code = ANSI[s.status] ?? '0'
    const name = (s.node || s.branch || s.id).slice(0, 22).padEnd(22)
    const st = s.status.padEnd(13)
    const merges = (s.merges ? `\u00d7${s.merges}` : '').padEnd(4)
    const note = s.note ? c('90', trunc(s.note, 50)) : ''
    return `  ${c(code, g)} ${c(code, st)} ${name} ${c('90', s.id.slice(0, 8))} ${merges}${note}`
  })
  return [c('1', `SpexCode sessions (${sessions.length})`), header, ...rows, statusLegend(color)].join('\n')
}

const WATCH_ACTIONABLE = new Set<DisplayStatus>(['review', 'done', 'close-pending', 'offline', 'error', 'needs-input'])
const NEXT: Record<string, string> = {
  review: 'merge | reopen(back-to-working) | close',
  done: 'merge | reopen | close',
  'close-pending': 'close | reopen',
  offline: 'reopen (relaunch & resume)',
  error: 'reopen (relaunch & retry) | capture | close',
  'needs-input': 'send "<msg>" | capture',
  idle: 'send "<msg>" | capture',
}
export function sessionEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  return `[spex] ${s.status} · ${s.node || s.branch || s.id} — act: ${NEXT[s.status] || '—'}${note}  [id ${s.id}]`
}
// @@@ launchEvent - a session's FIRST sighting. A launch goes straight to 'working' (not actionable), so
// without this the watch feed would be blind to new sessions starting. Emitted ONCE per id, regardless of
// status, so `spex watch` is a complete lifecycle feed: launched → [actionable transitions] → closed.
export function launchEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  return `[spex] launched · ${s.node || s.branch || s.id} — act: capture | send "<msg>"${note}  [id ${s.id}]`
}
export type WatchOpts = { selectors?: string[]; statuses?: string[]; includeIdle?: boolean; intervalMs?: number; as?: string }
export async function watchSessions(emit: (line: string) => void, opts: WatchOpts = {}): Promise<void> {
  const { selectors = [], statuses, includeIdle = false, intervalMs = 5000, as } = opts
  const tag = as ? `[${as}] ` : ''
  const prev = new Map<string, DisplayStatus>()
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  for (;;) {
    try {
      const cur = selectSessions(await listSessions(), selectors, statuses)
      const ids = new Set(cur.map((s) => s.id))
      for (const s of cur) {
        if (!prev.has(s.id)) emit(tag + launchEvent(s)) // FIRST sighting → launched, any status (incl. 'working'), once
        if (s.status === prev.get(s.id)) continue // only on transition, not every tick
        prev.set(s.id, s.status)
        if (WATCH_ACTIONABLE.has(s.status) || (includeIdle && s.status === 'idle')) emit(tag + sessionEvent(s))
      }
      for (const id of [...prev.keys()]) if (!ids.has(id)) { prev.delete(id); emit(`${tag}[spex] closed \u00b7 removed  [id ${id}]`) }
    } catch { /* transient git/tmux hiccup; keep watching */ }
    await sleep(intervalMs)
  }
}
export async function sendKeys(id: string, text: string, enter: boolean): Promise<boolean> {
  if (!(await alive(id))) return false
  if (text) await tmux(['send-keys', '-t', id, '-l', '--', text])
  if (enter) await tmux(['send-keys', '-t', id, 'Enter'])
  return true
}
