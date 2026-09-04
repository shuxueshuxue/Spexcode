// @@@ import direction - this module reads sessions.ts; sessions.ts must never import it back. The one-way
// edge is what lets the eval package call reviewPayload without a cycle ([[review-payload]] has the rest).
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  git, gitA, gitTry, isGitObjectId, mergeBaseDiff, mergeConflicts, parseStatPath, repoRoot,
  mainBranch, mainRoot, type ReviewDiffFile,
} from '@spexcode/spec-core'
import { readLiveRecord, withRecordLock, writeRecord, type DiffComment, type SessRec } from './session-record.js'
import { ResourceConflict } from './host-resources.js'
import type { Proposal } from './sessions.js'
import { deriveLabel, drainSession, findWorktree, resumeSession, sendText } from './sessions.js'

export function mergeReadiness(proposal: 'merge' | 'nothing' = 'merge'): { ready: boolean; reason?: string } {
  let dirty: string[] = []
  try {
    dirty = git(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map(porcelainPath)
  } catch { /* git status failed — fall through to the ahead check, still a real guard */ }
  if (dirty.length) {
    const shown = dirty.slice(0, 8).join(', ') + (dirty.length > 8 ? ', …' : '')
    return { ready: false, reason: `uncommitted changes on your node branch (${shown}) — commit your spec+code first` }
  }
  // a `nothing` proposal makes no claim about having something to land, so the clean tree is the whole gate.
  if (proposal === 'nothing') return { ready: true }
  let ahead = 0
  const base = mainBranch()
  try { ahead = Number(git(['rev-list', '--count', `${base}..HEAD`]).trim()) || 0 } catch { ahead = 0 }
  if (ahead === 0) return { ready: false, reason: `your node branch is 0 commits ahead of ${base} — nothing is committed to merge (declaring \`done --propose nothing\` needs no commits ahead; use it to pause for the human)` }
  return { ready: true }
}

// the path a `git status --porcelain` line refers to: strip the `XY ` status, and for a rename keep the
// NEW path (after ` -> `). Shared by the dirty-file counters (mergeReadiness above, reviewPayload below).
function porcelainPath(line: string): string {
  let p = line.slice(3)
  const arrow = p.indexOf(' -> '); if (arrow >= 0) p = p.slice(arrow + 4)
  return p
}

export type ReviewEvalFacts = { freshPass: number; freshFail: number; needReview: number; blind: number }
export type ReviewEvalGate = ({ phase: 'ready' } & ReviewEvalFacts) | { phase: 'unavailable' | 'loading' | 'updating' | 'error' | 'dormant' }
// the session-side gates only. The measured-loss readout is composed ABOVE this layer ([[manager-cockpit]]'s
// cockpit.ts): the eval package imports this module, so reading it from here could only ever be a deferred
// import working around a cycle. The eval side never consumed this field — it reads lint/conflict/ahead/dirty.
export type ReviewGates = {
  conflictsWithMain: boolean                       // a dry-run merge into main would conflict (in-memory, safe)
  lint: { errorCount: number; warningCount: number } // the spec↔code graph lint
}
export type ReviewPayload = {
  id: string; branch: string | null
  label: string              // the session's identity, derived ONCE via deriveLabel — the review surface renders THIS, never its own branch||id chain
  ahead: number              // commits the session branch is ahead of main
  dirtyNonRuntime: number    // uncommitted files excluding SpexCode's own runtime files
  diff: ReviewDiffFile[]     // the worker's real changes, anchored at the merge-base
  gates: ReviewGates
  proposal: { kind: Proposal | null; note: string | null }   // the session's standing proposal + its note
}

export type SessionDiffFile = ReviewDiffFile & { patch: string; diffIdentity: string }
export type DiffScope = 'branch' | 'working'
// What is true of the branch's own commits, decided HERE so the reader never infers it from an empty list:
// 'no-commits' the branch head still stands at its fork point, 'merged' its head is contained in the base,
// 'open' it carries commits the base does not.
export type BranchState = 'no-commits' | 'merged' | 'open'
export type SessionDiffPayload = {
  id: string; scope: 'branch'; branch: string; baseRef: string; base: string; head: string; mergeBase: string
  branchState: BranchState; commitUrl: string | null
  files: SessionDiffFile[]
  // The uncommitted half of "what has this session changed". `readable` is false when the session's own
  // worktree directory is gone: an unknowable working tree, never a claim that it is clean.
  working: { readable: boolean; files: SessionDiffFile[] }
  comments: DiffComment[]
}

export function commitUrlForRemote(remote: string, commit: string): string | null {
  const raw = remote.trim()
  let host = '', path = ''
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ssh:') {
      host = url.host
      path = url.pathname
    }
  } catch {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw)
    if (scp) [, host, path] = scp
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  if (!host || !path) return null
  const commitPath = host.toLowerCase().includes('gitlab') ? '-/commit' : 'commit'
  return `https://${host}/${path}/${commitPath}/${commit}`
}

// The branch diff is a proof over commits, not over a working directory: refs and objects are shared with
// the main checkout, so a session whose worktree directory is gone (landed and cleaned, or reaped) keeps a
// provable diff for as long as its branch ref survives. Anchor git at the live worktree when it exists and
// at the main checkout otherwise; only a branch whose ref is gone everywhere is honestly unavailable, and
// that refusal is a structured conflict (409 {error, code}) — never a raw git ENOENT turned into a 500.
async function diffAnchorRoot(wt: { path: string; branch: string | null; rec: SessRec }): Promise<string> {
  if (!wt.branch) throw new ResourceConflict(`session ${wt.rec.session} has no branch to diff`, 'diff-unavailable')
  if (wt.path && existsSync(wt.path)) return wt.path
  const main = mainRoot()
  const proven = await gitTry(['-C', main, 'rev-parse', '--verify', `refs/heads/${wt.branch}^{commit}`])
  if (proven.ok) return main
  throw new ResourceConflict(`session ${wt.rec.session} has no worktree on disk and its branch ${wt.branch} no longer exists`, 'diff-unavailable')
}

// @@@ forkCommitOf - the commit the branch was created at, from the most authoritative source that has it.
// The record carries it for every session created since it was introduced. Older records recover the same
// commit from the branch ref's OLDEST reflog entry, which is where git itself wrote the `worktree add` start
// point. Neither available (reflog pruned, or a branch adopted from outside this flow) → null, and the caller
// falls back to what ancestry alone can prove.
async function forkCommitOf(root: string, wt: { branch: string | null; rec: SessRec }): Promise<string | null> {
  if (wt.rec.forkCommit && isGitObjectId(root, wt.rec.forkCommit)) return wt.rec.forkCommit
  if (!wt.branch) return null
  const log = await gitTry(['-C', root, 'reflog', 'show', '--no-abbrev', '--format=%H', `refs/heads/${wt.branch}`])
  if (!log.ok) return null
  const entries = log.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  const created = entries[entries.length - 1]
  return created && isGitObjectId(root, created) ? created : null
}

async function diffHeadPair(root: string, wt: { path: string; branch: string | null; rec: SessRec }): Promise<{ branch: string; baseRef: string; base: string; head: string; mergeBase: string; branchState: BranchState; commitUrl: string | null }> {
  if (!wt.branch) throw new ResourceConflict(`session ${wt.rec.session} has no branch to diff`, 'diff-unavailable')
  const baseRef = wt.rec.base || mainBranch()
  const [headOut, baseOut] = await Promise.all([
    gitTry(['-C', root, 'rev-parse', '--verify', `refs/heads/${wt.branch}^{commit}`]),
    gitTry(['-C', root, 'rev-parse', '--verify', `${baseRef}^{commit}`]),
  ])
  const head = headOut.ok ? headOut.stdout.trim() : '', resolvedBase = baseOut.ok ? baseOut.stdout.trim() : ''
  if (!head || !resolvedBase || !isGitObjectId(root, head) || !isGitObjectId(root, resolvedBase))
    throw new ResourceConflict(`session ${wt.rec.session} diff heads are unproven`, 'diff-unavailable')
  const mergeBaseOut = await gitTry(['-C', root, 'merge-base', resolvedBase, head])
  const mergeBase = mergeBaseOut.ok ? mergeBaseOut.stdout.trim() : ''
  if (!mergeBase || !isGitObjectId(root, mergeBase)) throw new ResourceConflict(`session ${wt.rec.session} diff merge-base is unproven`, 'diff-unavailable')
  const [ancestor, remote, forkCommit] = await Promise.all([
    gitTry(['-C', root, 'merge-base', '--is-ancestor', head, resolvedBase]),
    gitTry(['-C', root, 'remote', 'get-url', 'origin']),
    forkCommitOf(root, wt),
  ])
  // A branch that never authored a commit is ALSO an ancestor of its base, so ancestry must be asked second.
  // Without a fork commit the only provable form of "authored nothing" is a head that is still the base head.
  const authoredNothing = forkCommit ? head === forkCommit : head === resolvedBase
  return {
    branch: wt.branch, baseRef, base: resolvedBase, head, mergeBase,
    branchState: authoredNothing ? 'no-commits' : ancestor.ok ? 'merged' : 'open',
    commitUrl: remote.ok ? commitUrlForRemote(remote.stdout, head) : null,
  }
}

// @@@ workingFiles - the session's uncommitted changes, enumerated from ONE porcelain status plus ONE numstat.
// Untracked files count their own lines rather than spawning a git child each: the metadata call stays two
// processes however dirty the tree is, and nothing here touches the index — an `--intent-to-add` would mutate
// the worktree a live agent is working in.
const WORKING_STATUS: Record<string, string> = { '??': 'untracked', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' }
async function workingFiles(root: string): Promise<ReviewDiffFile[]> {
  const [statusOut, numstatOut] = await Promise.all([
    gitA(['-C', root, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all']),
    gitA(['-C', root, '-c', 'core.quotePath=false', 'diff', '--numstat', '-M', 'HEAD']),
  ])
  const counts = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstatOut.split('\n')) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
    if (!m) continue
    const { to } = parseStatPath(m[3])
    counts.set(to, { additions: m[1] === '-' ? 0 : +m[1], deletions: m[2] === '-' ? 0 : +m[2] })
  }
  const files: ReviewDiffFile[] = []
  for (const line of statusOut.split('\n')) {
    if (!line.trim()) continue
    const code = line.slice(0, 2)
    const path = porcelainPath(line)
    const arrow = line.indexOf(' -> ')
    const oldPath = arrow >= 0 ? line.slice(3, arrow) : ''
    const letter = code.trim().replace(/[^A-Z?]/g, '').slice(0, 1) || 'M'
    const status = WORKING_STATUS[code === '??' ? '??' : letter] ?? 'modified'
    files.push({
      path,
      ...(oldPath && oldPath !== path ? { oldPath } : {}),
      status,
      ...(counts.get(path) ?? (code === '??' ? untrackedCounts(join(root, path)) : { additions: 0, deletions: 0 })),
    })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

// An untracked file is entirely new, so its addition count is its line count. A NUL byte means git would
// print `-`/`-` for a binary blob; report the same nothing rather than a line count of bytes.
function untrackedCounts(absolute: string): { additions: number; deletions: number } {
  try {
    const body = readFileSync(absolute)
    if (body.includes(0)) return { additions: 0, deletions: 0 }
    const text = body.toString('utf8')
    return { additions: text.length ? text.replace(/\n$/, '').split('\n').length : 0, deletions: 0 }
  } catch { return { additions: 0, deletions: 0 } }
}

async function workingPatch(root: string, file: ReviewDiffFile, untracked: boolean): Promise<string> {
  if (untracked) {
    // --no-index against /dev/null renders a whole new file as one addition hunk. It exits 1 when the two
    // sides differ, which is the normal case here, so the patch is read off stdout rather than off `ok`.
    const out = await gitTry(['-C', root, '--no-pager', 'diff', '--no-ext-diff', '--unified=40', '--no-index', '--', '/dev/null', file.path])
    return out.stdout
  }
  return gitA(['-C', root, '--no-pager', 'diff', '--no-ext-diff', '--unified=40', 'HEAD', '--', ...(file.oldPath ? [file.oldPath, file.path] : [file.path])])
}

// A working file's identity must move when its CONTENT moves, or a stale editor and a stale comment anchor
// would survive an edit. Size and mtime are what change on every write, and they cost one stat.
function workingIdentity(root: string, file: ReviewDiffFile): string {
  let stamp = 'gone'
  try { const s = statSync(join(root, file.path)); stamp = `${s.size}:${s.mtimeMs}` } catch { /* deleted in the worktree */ }
  return createHash('sha256').update(`working\0${file.path}\0${file.oldPath || ''}\0${stamp}`).digest('hex')
}

export async function sessionDiff(id: string, filePath?: string, offset = 0, limit = 120_000, scope: DiffScope = 'branch'): Promise<SessionDiffPayload | null> {
  const wt = await findWorktree(id)
  if (!wt) return null
  const root = await diffAnchorRoot(wt)
  const pair = await diffHeadPair(root, wt)
  // The working tree is the session's OWN directory or it is not knowable. `root` falls back to the main
  // checkout once the worktree is gone ([[diff-document]]), and that checkout's dirty files belong to whoever
  // is working there — never to this session.
  const liveRoot = wt.path && existsSync(wt.path) ? wt.path : null
  const window = (patch: string) => patch.slice(offset, offset + limit)

  // A per-file fetch names its scope, so only that scope is enumerated: opening one file in a worktree with a
  // hundred dirty paths must not re-walk the other scope's git reads.
  const branch = scope === 'branch' || !filePath ? await mergeBaseDiff(root, pair.base, pair.head) : []
  const branchSelected = scope === 'branch' && filePath ? branch.filter((file) => file.path === filePath || file.oldPath === filePath) : (filePath ? [] : branch)
  const files = await Promise.all(branchSelected.map(async (file) => {
    const identity = createHash('sha256').update(`${pair.mergeBase}\0${pair.head}\0${file.path}\0${file.oldPath || ''}`).digest('hex')
    if (!filePath) return { ...file, patch: '', diffIdentity: identity }
    const patch = await gitA(['-C', root, '--no-pager', 'diff', '--no-ext-diff', '--unified=40', pair.mergeBase, pair.head, '--', ...(file.oldPath ? [file.oldPath, file.path] : [file.path])])
    return { ...file, patch: window(patch), diffIdentity: identity }
  }))

  const dirty = liveRoot && (scope === 'working' || !filePath) ? await workingFiles(liveRoot) : []
  const workingSelected = scope === 'working' && filePath ? dirty.filter((file) => file.path === filePath || file.oldPath === filePath) : (filePath ? [] : dirty)
  const working = await Promise.all(workingSelected.map(async (file) => {
    const identity = workingIdentity(liveRoot!, file)
    if (!filePath) return { ...file, patch: '', diffIdentity: identity }
    const patch = await workingPatch(liveRoot!, file, file.status === 'untracked')
    return { ...file, patch: window(patch), diffIdentity: identity }
  }))

  return {
    id, scope: 'branch', ...pair, files,
    working: { readable: !!liveRoot, files: working },
    comments: wt.rec.diffComments ?? [],
  }
}

export async function saveDiffComment(id: string, input: Omit<DiffComment, 'id' | 'sentAt'> & { id?: string }): Promise<DiffComment | null> {
  const body = input.body.trim()
  if (!input.filePath || !body || !Number.isInteger(input.lineStart) || input.lineStart < 1 || !Number.isInteger(input.lineEnd) || input.lineEnd < input.lineStart || !input.diffIdentity)
    throw new ResourceConflict('diff comment needs a file, line range, body, and diff identity')
  return withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return null
    const comment: DiffComment = { id: input.id || randomUUID(), filePath: input.filePath, lineStart: input.lineStart, lineEnd: input.lineEnd, body, diffIdentity: input.diffIdentity, sentAt: null }
    const comments = (rec.diffComments ?? []).filter((candidate) => candidate.id !== comment.id)
    writeRecord({ ...rec, diffComments: [...comments, comment] })
    return comment
  })
}

// A review conversation you can only append to is not a conversation. Saving, editing and sending all
// existed; nothing could take a row back, so a comment filed on the wrong line — or a probe left by a
// measurement — stayed on the record forever. Retract is the same shape as the other two `retract` verbs
// this product already has ([[session-files]], eval): it removes the row under the record lock and says
// which one it removed. Already-DELIVERED text is not recalled — the agent read it — so this retracts the
// record's row, never the message that was sent.
export async function retractDiffComment(id: string, commentId: string): Promise<DiffComment | null> {
  if (!commentId) throw new ResourceConflict('retracting a diff comment needs its id')
  return withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return null
    const comments = rec.diffComments ?? []
    const removed = comments.find((comment) => comment.id === commentId)
    if (!removed) return null
    writeRecord({ ...rec, diffComments: comments.filter((comment) => comment.id !== commentId) })
    return removed
  })
}

export async function sendDiffComments(id: string, ids?: string[]): Promise<{ ok: boolean; sentAt?: string; count?: number; error?: string }> {
  const selected = await withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return null
    const wanted = ids?.length ? new Set(ids) : null
    return (rec.diffComments ?? []).filter((comment) => !comment.sentAt && (!wanted || wanted.has(comment.id)))
  })
  if (!selected) return { ok: false, error: `no such session ${id}` }
  if (!selected.length) return { ok: false, error: 'no unsent diff comments' }
  const text = ['Review comments on the branch diff:', ...selected.map((comment) => {
    const lines = comment.lineStart === comment.lineEnd ? `L${comment.lineStart}` : `L${comment.lineStart}-L${comment.lineEnd}`
    return `- ${comment.filePath}:${lines}\n  ${comment.body.replace(/\n/g, '\n  ')}`
  })].join('\n')
  const sent = await sendText(id, text)
  if (!sent.ok) return { ok: false, error: sent.error || 'could not send diff comments' }
  const sentAt = new Date().toISOString()
  await withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return
    const selectedById = new Map(selected.map((comment) => [comment.id, comment]))
    writeRecord({ ...rec, diffComments: (rec.diffComments ?? []).map((comment) => {
      const before = selectedById.get(comment.id)
      const unchanged = before && !comment.sentAt && comment.body === before.body && comment.diffIdentity === before.diffIdentity
      return unchanged ? { ...comment, sentAt } : comment
    }) })
  })
  return { ok: true, sentAt, count: selected.length }
}

type ReviewHeadPair = { branchHead: string; baseHead: string }

async function reviewHeadPair(root: string, branch: string, base: string): Promise<ReviewHeadPair> {
  const branchRef = `refs/heads/${branch}`, baseRef = `refs/heads/${base}`
  const output = await gitA(['-C', root, 'for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)', branchRef, baseRef])
  const refs = new Map<string, string>()
  for (const line of output.split('\n')) {
    const at = line.indexOf('\0')
    if (at > 0) refs.set(line.slice(0, at), line.slice(at + 1).trim())
  }
  const branchHead = refs.get(branchRef), baseHead = refs.get(baseRef)
  if (!branchHead || !baseHead || !isGitObjectId(root, branchHead) || !isGitObjectId(root, baseHead)) {
    throw new ResourceConflict(`review head pair is unproven: ${branchRef} or ${baseRef} is missing or not a native Git object id`)
  }
  return { branchHead, baseHead }
}

// @@@ lintGate - the spec↔code graph lint is a LOCATION gate: a function of the backend checkout's tree ALONE
// (its .spec graph + governed files), not of which session is reviewed, and it costs a few seconds. Re-running
// it on every reviewPayload — i.e. on every [[session-eval]] Proof-tab open, and once per session — is
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
  if (!wt.rec.governed || !wt.branch) throw new ResourceConflict(`session ${id} has no governed branch to review`)
  const base = mainBranch()
  const { branchHead, baseHead } = await reviewHeadPair(wt.path, wt.branch, base)
  const [aheadOut, statusOut, diff, conflictsWithMain, lint] = await Promise.all([
    gitA(['-C', wt.path, 'rev-list', '--count', `${baseHead}..${branchHead}`]),
    gitA(['-C', wt.path, 'status', '--porcelain', '--untracked-files=all']),
    mergeBaseDiff(wt.path, baseHead, branchHead),
    mergeConflicts(wt.path, baseHead, branchHead),
    lintGate(),   // lint — memoized on the checkout fingerprint, not re-run per session/open
  ])
  const settledPair = await reviewHeadPair(wt.path, wt.branch, base)
  if (settledPair.branchHead !== branchHead || settledPair.baseHead !== baseHead) {
    throw new ResourceConflict(
      `review head pair changed while assembling: started branch ${branchHead} / base ${baseHead}, ended branch ${settledPair.branchHead} / base ${settledPair.baseHead}`,
      'session_review_head_changed',
    )
  }
  // the worktree carries no SpexCode runtime files any more (the store lives in ~/.spexcode), so every dirty
  // path is genuine work — this is just the total uncommitted count.
  const dirtyNonRuntime = statusOut.split('\n').filter(Boolean).map(porcelainPath).length
  return {
    id, branch: wt.branch,
    label: deriveLabel({ id, name: wt.rec.name, title: wt.rec.title, branch: wt.branch }),
    ahead: Number(aheadOut.trim()) || 0,
    dirtyNonRuntime, diff,
    gates: { conflictsWithMain, lint },
    proposal: { kind: wt.rec.proposal, note: wt.rec.note },
  }
}

const MERGE_PROMPT = `Merge your branch into main, then settle the session honestly.

1. In your own worktree, merge the latest main into your branch. Resolve any conflicts there and re-run the tests.
2. Atomic landing: main only receives the completed branch as one no-ff merge. Never resolve conflicts in the shared main checkout.
3. Verify main advanced cleanly with no merge left in progress. If this task is settled, run \`spex session done --propose close\` as your FINAL action; otherwise declare the state that is true.`

export type MergeSessionResult =
  | { dispatched: true }
  | { dispatched: false; reason: string }

export async function mergeSession(id: string): Promise<MergeSessionResult> {
  const wt = await findWorktree(id)
  if (!wt?.branch) return { dispatched: false, reason: 'no such mergeable session' }
  const r = await sendText(id, MERGE_PROMPT, undefined, {
    deferDrain: true,
  })
  if (!r.ok) return { dispatched: false, reason: r.error || 'could not dispatch merge prompt' }
  await resumeSession(id, { guard: false })
  await drainSession(id)
  return { dispatched: true }
}
