import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
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

// @@@ rendezvous control socket - the DETERMINISTIC input path for sessions WE launch. We start `claude`
// with CLAUDE_BG_BACKEND=daemon + CLAUDE_BG_RENDEZVOUS_SOCK=<per-session sock> set ONLY on that one
// spawned command (env prefix on the launch line — never global/exported, never a plugin or global
// setting). claude opens a unix socket at that path; writing one line `{"type":"reply","text":"…"}\n` to
// it injects the text as a prompt and submits it — no PTY typing, so multi-line input and Enters can't be
// corrupted the way `tmux send-keys` was. The path is uniquely derived from the session id, so we only
// ever address OUR OWN sockets (HARD ethics rule: never touch a Claude Code session outside this product).
// tmux stays the VISIBLE stream (pty-bridge); the socket is CONTROL (input) only. The socket lives in
// tmpdir tied to the claude process, so no extra lifecycle — claude/the OS owns it. Best-effort: if the
// socket is absent (older/socketless session, or not yet up) or errors, sendKeys FALLS BACK to send-keys.
const rvSock = (id: string) => join(tmpdir(), `spexcode-rv-${id}.sock`)
// env prefix put in front of the spawned `claude` so it creates this session's rendezvous control socket.
const rvEnv = (id: string) => `CLAUDE_BG_BACKEND=daemon CLAUDE_BG_RENDEZVOUS_SOCK=${rvSock(id)}`
// inject `text` as a prompt by writing one reply line to the session's rendezvous socket. Resolves true
// only on a clean connect+write; ANY error (or a 1s stall) resolves false so the caller falls back to
// send-keys. Never throws — the socket path is strictly best-effort control.
function replyViaSocket(sock: string, text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok) } }
    try {
      const c = createConnection({ path: sock })
      const t = setTimeout(() => { try { c.destroy() } catch { /* */ } done(false) }, 1000)
      c.on('error', () => { clearTimeout(t); done(false) })
      c.on('connect', () => {
        c.write(JSON.stringify({ type: 'reply', text }) + '\n', () => { clearTimeout(t); c.end(); done(true) })
      })
    } catch { done(false) }
  })
}

export type Lifecycle = 'active' | 'idle' | 'awaiting' | 'blocked' | 'error' | 'needs-input'
export type Proposal = 'merge' | 'nothing' | 'close'
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'review' | 'done' | 'close-pending' | 'blocked' | 'error' | 'needs-input'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; title: string | null; branch: string | null; path: string
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; note: string | null
}

// the human label for a session row: the spec node it references, else a prompt-derived title (node-
// agnostic sessions), else the branch, else the id. Used everywhere a session is named for a human.
export const sessionLabel = (s: Session): string => s.node || s.title || s.branch || s.id

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

type SessRec = { node: string | null; title: string | null; session: string | null; status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null }
function readSessionFile(dir: string): SessRec {
  const r: SessRec = { node: null, title: null, session: null, status: 'active', proposal: null, merges: 0, note: null }
  const p = join(dir, '.session')
  if (!existsSync(p)) return r
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (k === 'node') r.node = v || null
    else if (k === 'title') r.title = v || null
    else if (k === 'session') r.session = v || null
    else if (k === 'status' && (v === 'active' || v === 'idle' || v === 'awaiting' || v === 'blocked' || v === 'error' || v === 'needs-input')) r.status = v
    else if (k === 'proposal' && v) r.proposal = v as Proposal
    else if (k === 'merges') r.merges = Number(v) || 0
    else if (k === 'note') r.note = v || null
  }
  return r
}
function writeSessionFile(dir: string, rec: SessRec): void {
  const lines = [`node: ${rec.node || ''}`]
  if (rec.title) lines.push(`title: ${rec.title}`)
  lines.push(`session: ${rec.session || ''}`, `status: ${rec.status}`)
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
  return { id: rec.session!, node: rec.node, title: rec.title, branch, path, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status }
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

const slugify = (s: string | null) => (s || 'session').replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'session'

// @@@ node + title from the prompt - the spec node a session works on is whatever it @-mentions, NOT a UI
// "focused node": the dashboard prefills `@<focused> ` as a deletable convenience, so the node the user
// actually left in the prompt (changed it, or deleted it for a node-agnostic prompt) is the truth. We read
// the FIRST `@<id>` that begins a word (same positional rule the dashboard's mention menu uses). When there
// is none, the session is node-agnostic and we label it by the first few words of the prompt instead.
const MENTION = /(?:^|\s)@([A-Za-z0-9_-]+)/
const mentionedNode = (prompt: string): string | null => prompt.match(MENTION)?.[1] ?? null
function titleFromPrompt(prompt: string): string | null {
  const first = (prompt || '').trim().split('\n')[0].trim()
  const words = first.split(/\s+/).filter(Boolean).slice(0, 7).join(' ')
  if (!words) return null
  return words.length > 50 ? words.slice(0, 49).trimEnd() + '…' : words
}

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
  await tmux(['send-keys', '-t', id, '-l', '--', `${rvEnv(id)} ${CLAUDE_CMD} ${writeSettings(path)} ${tail}`])
  await tmux(['send-keys', '-t', id, 'Enter'])
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
function newNodePrompt(placeholderId: string, parentId: string, relPath: string, rest: string): string {
  return `A placeholder spec node \`${placeholderId}\` was created under parent \`${parentId}\` at ${relPath} in this worktree. ` +
    `Turn it into a real node and build it, per this request:\n\n${rest || '(no extra description — infer the intent from the parent and the codebase)'}\n\n` +
    `1. Choose a good kebab-case id reflecting the intent (node id = its directory basename) and \`git mv\` the directory \`${dirname(relPath)}\` to it, keeping it under \`${parentId}\`. ` +
    `2. Rewrite spec.md at contract altitude: real title/desc, the two-part body (raw source = human intent · expanded spec = behavioral contract), and a \`code:\` list of the files it will govern — NO current-state/verdict sections. ` +
    `3. Implement the code the spec describes. 4. Keep \`spex lint\` at 0 errors and the build green. ` +
    `Commit on this node branch (\`spec: <id> — <reason>\`, with a Session: trailer), then declare at the Stop gate (session done --propose merge). Do NOT merge.`
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
    `Commit the removal + refactor on this node branch (\`spec: remove ${nodeId} — <reason>\`, with a Session: trailer), then declare at the Stop gate (session done --propose merge). Do NOT merge.`
}

// @@@ newSession - durable worktree (branch node/<slug> off main) + .session label, then launch claude
// with the id we chose. Backs both the dashboard POST and `spex session new`. A board directive (nn/dd)
// additionally mutates the worktree's spec tree up front and hands the agent a finish-the-op prompt.
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
  await gitA(['-C', mainRoot(), 'worktree', 'add', '-b', branch, path, 'main'])
  const rec: SessRec = { node: ref || null, title, session: id, status: 'active', proposal: null, merges: 0, note: null }
  writeSessionFile(path, rec)
  await hideClaudeMd(path)   // isolate the dispatched agent from the project CLAUDE.md (before launch)
  // perform the directive's spec-tree mutation in the worktree, then dispatch the finish-the-op prompt.
  // the mutation is uncommitted, so the board's overlay shows it instantly (added ghost / deleted mark).
  let launchPrompt = prompt
  if (directive?.kind === 'new') {
    const placeholderId = `untitled-${id.slice(0, 4)}`
    const relPath = createPlaceholder(path, directive.targetId, placeholderId, id)
    launchPrompt = newNodePrompt(placeholderId, directive.targetId, relPath, directive.rest)
  } else if (directive?.kind === 'delete') {
    launchPrompt = deleteNodePrompt(directive.targetId, removeNode(path, directive.targetId), directive.rest)
  }
  const sq = `'${launchPrompt.replace(/'/g, `'\\''`)}'`
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
    // tmux pane exists but claude exited to a shell → resume claude IN the existing pane (with its socket)
    await tmux(['send-keys', '-t', id, '-l', '--', `${rvEnv(id)} ${CLAUDE_CMD} ${writeSettings(wt.path)} --resume ${id}`])
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
    const name = sessionLabel(s).slice(0, 22).padEnd(22)
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
  return `[spex] ${s.status} · ${sessionLabel(s)} — act: ${NEXT[s.status] || '—'}${note}  [id ${s.id}]`
}
// @@@ launchEvent - a session's FIRST sighting. A launch goes straight to 'working' (not actionable), so
// without this the watch feed would be blind to new sessions starting. Emitted ONCE per id, regardless of
// status, so `spex watch` is a complete lifecycle feed: launched → [actionable transitions] → closed.
export function launchEvent(s: Session): string {
  const note = s.note ? ` — note: ${s.note}` : ''
  return `[spex] launched · ${sessionLabel(s)} — act: capture | send "<msg>"${note}  [id ${s.id}]`
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
// @@@ sendKeys - CONTROL (input) for a session. Prefer the per-session rendezvous socket (deterministic,
// no PTY typing): if it exists and we have text, write one reply line — the socket path injects AND submits,
// so no separate Enter. The socket only exists for sessions WE launched the new way, and its path is
// derived from the id, so we never address another session's socket. Any socket miss/error (or an empty
// text-only Enter, which has nothing to inject) FALLS BACK to the unchanged `tmux send-keys` behavior.
export async function sendKeys(id: string, text: string, enter: boolean): Promise<boolean> {
  const sock = rvSock(id)
  if (text && existsSync(sock) && await replyViaSocket(sock, text)) return true  // injected + submitted
  if (!(await alive(id))) return false
  if (text) await tmux(['send-keys', '-t', id, '-l', '--', text])
  if (enter) await tmux(['send-keys', '-t', id, 'Enter'])
  return true
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
