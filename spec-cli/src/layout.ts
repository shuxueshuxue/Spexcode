import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, repoRoot, gitA, gitTry, headSha, worktreeSpecSig, worktreeSpecDelta, type NodeOp } from './git.js'
import { guardWorktree } from './resilience.js'

// @@@ portable layout - the ONE seam where "where things live" is policy, not hardcode.
// Mechanism (read .spec, git log) is fixed; this resolves: where is main, how to enumerate the
// other checkouts, how each declares its node. No spexcode.json => our convention. With it =>
// adapt to any layout (main in a different folder, a different branch naming, etc.).

type Config = {
  main?: string                    // path to the source-of-truth checkout (default: the `main` worktree)
  mainBranch?: string              // source-of-truth BRANCH worktrees fork from (default: auto-detected — see mainBranch())
  branchPrefix?: string            // how a branch names its node (default: "node/")
  nodeFrom?: 'branch' | 'session'  // resolve a worktree's node id from its branch or its .session file
  dashboard?: {
    apiUrl?: string                // the per-project backend the board proxies to (read frontend-side; see api-endpoint)
    title?: string                 // override for the browser-tab name (default: the repo-root basename; see tab-title)
  }
}
// the resolved LAYOUT convention — main/branchPrefix/nodeFrom filled to defaults. `dashboard` is a
// frontend/board concern (read separately via readConfig; see api-endpoint), NOT a layout field, so it
// stays out of the convention rather than forcing a meaningless default here.
type Convention = Required<Omit<Config, 'dashboard'>>

export type Worktree = {
  path: string; branch: string | null; node: string | null
  session: string | null; status: string | null; isMain: boolean
  ops: NodeOp[]   // pending spec-node changes this worktree makes vs main (the board's overlay)
}
export type Layout = { main: string; convention: Convention; worktrees: Worktree[] }

export function readConfig(root: string): Config {
  const p = join(root, 'spexcode.json')
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
}

// @@@ mainBranch - the source-of-truth BRANCH: what worktrees fork from, what merges land on, what review
// diffs against. NOT hardcoded 'main' — that assumption broke every adopted repo whose default branch is
// named otherwise (e.g. a project on `staging` or `feat/x`). Resolved from the MAIN checkout (the parent of
// the shared git *common* dir, so the answer is the same whether called from the main checkout, a linked
// worktree, or a commit hook), in order: (1) a `spexcode.json` `mainBranch` override; (2) auto-detect — the
// branch that main checkout is currently on, so an adopted repo on its own default branch just works with no
// config; (3) 'main' as the last resort. Sync (via git(), which strips a hook's GIT_DIR) so the Stop-gate's
// commit-gate can call it too.
export function mainBranch(): string {
  try {
    const mainCheckout = dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim())
    const override = readConfig(mainCheckout).mainBranch?.trim()
    if (override) return override
    const cur = git(['-C', mainCheckout, 'symbolic-ref', '--short', 'HEAD']).trim()
    if (cur) return cur
  } catch { /* fall through to the conventional default */ }
  return 'main'
}

// the worktree set is the board's EXISTENCE truth — a FAILED enumeration must never read as an empty repo.
// `git worktree list` always lists at least main, so a git error OR a zero-row parse is a failure: THROW
// rather than return [] (which resolveLayout would render as "every worktree vanished"). gitTry, async like
// gitA, keeps it off the sync fork() path. The caller surfaces the failure (a 502) instead of a false board.
async function gitWorktrees(root: string): Promise<{ path: string; branch: string | null }[]> {
  const r = await gitTry(['-C', root, 'worktree', 'list', '--porcelain'])
  if (!r.ok) throw new Error(`git worktree list failed: ${r.stderr.trim() || 'unknown error'}`)
  const list: { path: string; branch: string | null }[] = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur) }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '')
  }
  if (!list.length) throw new Error('git worktree list returned no worktrees (enumeration failed; main is always present)')
  return list
}

// the untracked per-worktree linker: node / session / status (ephemeral runtime state).
function readSession(dir: string) {
  const r = { node: null as string | null, session: null as string | null, status: null as string | null }
  const p = join(dir, '.session')
  if (!existsSync(p)) return r
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (k === 'node') r.node = v; else if (k === 'session') r.session = v; else if (k === 'status') r.status = v
  }
  return r
}

// @@@ overlay cache - the board overlay (each managed worktree's spec-delta vs main) is the expensive
// part of /api/layout: `worktreeSpecDelta` spawns 3 git diffs PER worktree, and warm that WAS the whole
// cost (the result is ~2KB, so the ~230ms was pure spawn overhead). The delta is anchored at the worktree's
// FORK POINT — `git merge-base main HEAD`, NOT main's HEAD — so it shows strictly what THIS worktree changed
// and never a phantom for files it never touched when main advances (see git.worktreeSpecDelta). The ops are
// therefore a pure function of that merge-base, the worktree's HEAD, and its `.spec` working-tree state, so
// we memo `ops` per worktree keyed on those three. The merge-base (not main's HEAD) is the right key field:
// when main advances on UNRELATED branches the fork point is unchanged, so the overlay is a cache HIT — keying
// on main's raw HEAD would needlessly recompute every worktree's 3 diffs on every merge. The trade is one cheap
// `git merge-base` per managed worktree to compute the key (its result is reused as the diff base on a miss, so
// no redundant subprocess); HEAD + sig come from the FILESYSTEM (headSha + worktreeSpecSig). A worktree's diffs
// re-run ONLY when its key changes (its branch advances, main moves the fork point, or a spec edit / new
// untracked spec.md moves the sig). Correctness over speed: the key reflects every real change — never stale;
// the cheap fields (node/session/status from `.session`) are re-read fresh, never cached.
const deltaCache = new Map<string, { key: string; ops: NodeOp[] }>()
const safeHead = (p: string): string => { try { return headSha(p) } catch { return '' } }
const safeMergeBase = async (wtPath: string, mainRef: string): Promise<string> => {
  try { return (await gitA(['-C', wtPath, 'merge-base', mainRef, 'HEAD'])).trim() } catch { return '' }
}
let layoutHeadWarned = false
async function cachedDelta(wtPath: string, mainRef: string): Promise<NodeOp[]> {
  const wtHead = safeHead(wtPath)
  const base = await safeMergeBase(wtPath, mainRef)
  // fail loud, never stale: if the merge-base or HEAD can't be read the key is untrustworthy — bypass the
  // cache and recompute (warn once) rather than risk serving a delta keyed on an empty sha across a real change.
  if (!base || !wtHead) {
    if (!layoutHeadWarned) { layoutHeadWarned = true; console.warn('spec-cli: layout overlay cache bypassed (unreadable merge-base/HEAD), recomputing every read') }
    return worktreeSpecDelta(wtPath, mainRef)
  }
  const key = `${base}\0${wtHead}\0${worktreeSpecSig(wtPath)}`
  const hit = deltaCache.get(wtPath)
  if (hit && hit.key === key) return hit.ops
  const ops = await worktreeSpecDelta(wtPath, mainRef, base)
  deltaCache.set(wtPath, { key, ops })
  return ops
}

export async function resolveLayout(): Promise<Layout> {
  const root = repoRoot()
  const cfg = readConfig(root)
  const base = mainBranch()
  const convention: Convention = {
    main: cfg.main || '',
    mainBranch: base,
    branchPrefix: cfg.branchPrefix ?? 'node/',
    nodeFrom: cfg.nodeFrom ?? 'branch',
  }
  const raw = await gitWorktrees(root)
  const mainWt = raw.find((w) => w.branch === base)
  const mainRef = mainWt?.branch ?? base
  // each worktree's spec delta is independent — compute (or cache-hit) them all in parallel. Each read is
  // wrapped: a worktree whose directory was genuinely removed mid-read (a worker self-merged and retired it)
  // is OMITTED, but one whose directory still exists and merely hit a transient DETAIL failure (a git index/
  // ref lock under a concurrent merge) is kept as a DEGRADED row — never dropped. See resilience.guardWorktree.
  const rows = await Promise.all(raw.map((w) => {
    const isMain = w.branch === base
    const fromBranch = w.branch && w.branch.startsWith(convention.branchPrefix)
      ? w.branch.slice(convention.branchPrefix.length) : null
    return guardWorktree<Worktree>(w.path, async (): Promise<Worktree> => {
      const sess = readSession(w.path)
      const node = isMain ? null
        : convention.nodeFrom === 'session' ? sess.node : (fromBranch ?? sess.node)
      // only MANAGED SpexCode worktrees (a .session label, or a node/* branch) get a spec delta — harness
      // scratch worktrees (e.g. agent-*) are skipped, both to keep them off the board AND to avoid their
      // (often large) diffs dominating /api/layout latency.
      const managed = !!sess.session || (!!w.branch && w.branch.startsWith(convention.branchPrefix))
      const ops = isMain || !managed ? [] : await cachedDelta(w.path, mainRef)
      return { path: w.path, branch: w.branch, node, session: sess.session, status: sess.status, isMain, ops }
    }, (): Worktree => {
      // DEGRADED: the directory still exists but a detail read failed (git lock under a concurrent merge, or
      // a file-read hiccup). The worktree EXISTS, so it stays on the board. Built from RAW facts: node from
      // the branch, ops from the last cached delta (or none), session/status best-effort from a cheap re-read.
      const sess = (() => { try { return readSession(w.path) } catch { return { node: null, session: null, status: null } } })()
      const node = isMain ? null : (fromBranch ?? sess.node)
      return { path: w.path, branch: w.branch, node, session: sess.session, status: sess.status, isMain, ops: deltaCache.get(w.path)?.ops ?? [] }
    })
  }))
  const worktrees = rows.filter((w): w is Worktree => w !== null)
  // drop cache entries for worktrees that no longer exist (a closed session), so the map stays bounded.
  const live = new Set(raw.map((w) => w.path))
  for (const k of [...deltaCache.keys()]) if (!live.has(k)) deltaCache.delete(k)
  const main = convention.main || worktrees.find((w) => w.isMain)?.path || root
  return { main, convention, worktrees }
}
