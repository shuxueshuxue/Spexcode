import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, gitA, repoRoot } from './git.js'

// @@@ sessions - the WORKTREE is the durable unit; tmux is a disposable runtime handle. Each session
// worktree carries an untracked `.session` file (the source of truth) that survives a kill / reboot /
// moving the folder. We launch claude with `--session-id <id>` (id we choose) so the SAME conversation
// can be `--resume`d into a fresh tmux. NO in-memory map: listSessions() reads worktrees every time.
//
// STATE MACHINE (only two real states; merge is an action, not a state):
//   active   → liveness: working | idle | offline        (offline = no tmux for the recorded id)
//   awaiting → the agent's PROPOSAL, awaiting a human:
//                proposal=merge   → shown "review"        ("ready, merge me")
//                proposal=nothing → shown "done"          ("finished, your call")
//                proposal=close   → shown "close-pending" ("I suggest discarding this worktree")
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

export type Lifecycle = 'active' | 'awaiting'
export type Proposal = 'merge' | 'nothing' | 'close'
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'review' | 'done' | 'close-pending'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; branch: string | null; path: string
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus
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

type SessRec = { node: string | null; session: string | null; status: Lifecycle; proposal: Proposal | null; merges: number }
function readSessionFile(dir: string): SessRec {
  const r: SessRec = { node: null, session: null, status: 'active', proposal: null, merges: 0 }
  const p = join(dir, '.session')
  if (!existsSync(p)) return r
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (k === 'node') r.node = v || null
    else if (k === 'session') r.session = v || null
    else if (k === 'status' && (v === 'active' || v === 'awaiting')) r.status = v
    else if (k === 'proposal' && v) r.proposal = v as Proposal
    else if (k === 'merges') r.merges = Number(v) || 0
  }
  return r
}
function writeSessionFile(dir: string, rec: SessRec): void {
  const lines = [`node: ${rec.node || ''}`, `session: ${rec.session || ''}`, `status: ${rec.status}`]
  if (rec.status === 'awaiting' && rec.proposal) lines.push(`proposal: ${rec.proposal}`)
  if (rec.merges) lines.push(`merges: ${rec.merges}`)
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
// shown regardless of liveness. active → its LIVENESS: offline if no tmux for the recorded id, else
// working/idle by activity.
async function reconcile(rec: SessRec): Promise<DisplayStatus> {
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (!rec.session || !(await alive(rec.session))) return 'offline'
  const age = await activityAgeMs(rec.session)
  return age != null && age < 3000 ? 'working' : 'idle'
}

async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  for (const w of await listWorktrees()) {
    const rec = readSessionFile(w.path)
    if (rec.session === id) return { path: w.path, branch: w.branch, rec }
  }
  return null
}

function toSession(rec: SessRec, branch: string | null, path: string, status: DisplayStatus): Session {
  return { id: rec.session!, node: rec.node, branch, path, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, status }
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

async function launch(id: string, path: string, tail: string): Promise<void> {
  await tmux(['new-session', '-d', '-s', id, '-x', String(COLS), '-y', String(ROWS), '-c', path])
  await tmux(['send-keys', '-t', id, '-l', '--', `${CLAUDE_CMD} ${tail}`])
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
  const rec: SessRec = { node: node || null, session: id, status: 'active', proposal: null, merges: 0 }
  writeSessionFile(path, rec)
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
  if (!(await alive(id))) await launch(id, wt.path, `--resume ${id}`)
  return true
}

// agent/human PROPOSAL → awaiting (review = propose merge, done = nothing, close-pending = propose close).
export async function propose(id: string, proposal: Proposal): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  writeSessionFile(wt.path, { ...wt.rec, status: 'awaiting', proposal })
  return true
}
// an agent marks ITS OWN worktree (from its cwd) as awaiting, with a proposed disposition.
export function markDoneFromCwd(proposal: Proposal = 'nothing'): boolean {
  const rec = readSessionFile(process.cwd())
  if (!rec.session) return false
  writeSessionFile(process.cwd(), { ...rec, status: 'awaiting', proposal })
  return true
}

// @@@ mergeSession - the dogfood merge ACTION (not a state): --no-ff the branch into main, bump the
// `merges` count, return the worktree to active. On conflict/dirty it fails and the proposal stands.
export async function mergeSession(id: string): Promise<{ ok: boolean; merges?: number; error?: string }> {
  const wt = await findWorktree(id)
  if (!wt || !wt.branch) return { ok: false, error: 'no such session' }
  try {
    await gitA(['-C', mainRoot(), 'merge', '--no-ff', '-m', `merge ${wt.branch}: review-approved`, wt.branch])
  } catch (e) { return { ok: false, error: String(e) } }
  const merges = wt.rec.merges + 1
  writeSessionFile(wt.path, { ...wt.rec, status: 'active', proposal: null, merges })
  return { ok: true, merges }
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

export async function captureSession(id: string): Promise<string> {
  if (!(await alive(id))) return ''
  try { return await tmux(['capture-pane', '-e', '-p', '-t', id]) } catch { return '' }
}
export async function sendKeys(id: string, text: string, enter: boolean): Promise<boolean> {
  if (!(await alive(id))) return false
  if (text) await tmux(['send-keys', '-t', id, '-l', '--', text])
  if (enter) await tmux(['send-keys', '-t', id, 'Enter'])
  return true
}
