import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { git, repoRoot, gitA, headSha, worktreeSpecSig, worktreeSpecDelta, type NodeOp } from './git.js'
import { guardWorktree } from './resilience.js'

// @@@ portable layout - the ONE seam where "where things live" is policy, not hardcode.
// Mechanism (read .spec, git log) is fixed; this resolves: where is main, how to enumerate the
// other checkouts, how each declares its node. No spexcode.json => our convention. With it =>
// adapt to any layout (main in a different folder, a different branch naming, etc.).

type Config = {
  main?: string                    // path to the source-of-truth checkout (default: the `main` worktree)
  mainBranch?: string              // source-of-truth BRANCH worktrees fork from (default: auto-detected — see mainBranch())
  branchPrefix?: string            // how a branch names its node (default: "node/")
  dashboard?: {
    apiUrl?: string                // the per-project backend the board proxies to (read frontend-side; see api-endpoint)
    title?: string                 // override for the browser-tab name (default: the repo-root basename; see tab-title)
  }
  sessions?: {
    maxActive?: number             // concurrency cap: max agents AUTONOMOUSLY PROGRESSING at once (default 6; see sessions.ts maxActive)
  }
}
// the resolved LAYOUT convention — main/mainBranch/branchPrefix filled to defaults. `dashboard` and `sessions`
// are frontend/runtime concerns (read separately via readConfig; see api-endpoint / sessions.ts maxActive),
// NOT layout fields, so they stay out of the convention rather than forcing a meaningless default here.
type Convention = Required<Omit<Config, 'dashboard' | 'sessions'>>

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

// @@@ gitCommonDir - the SHARED git common dir (absolute), the one git directory every worktree of a
// repo points at. A "where things live" primitive: linked-worktree state (HEAD, index) is per-worktree,
// but the common dir is shared, so anything that must be ONE copy across all worktrees (and never end up
// committed) belongs under it — e.g. yatsu's content-addressed pixel cache. Same `git rev-parse` mainBranch
// uses, via the env-stripped git() so a hook's exported GIT_DIR can't misdirect it.
// memoized: the git common dir is a PROCESS CONSTANT (it never changes for a running backend), but
// mainBranch()/mainRoot() resolve it on every call — without the cache that was a `git rev-parse` fork
// per call, ~60 forks on a single board build (mainBranch is called per session/overlay). Cache it like
// [[source-of-truth]]'s repoRoot does. (HEAD/branch CAN move, so mainBranch still reads those live below;
// only the common-dir path itself is cached.)
let commonDirCache: string | null = null
export function gitCommonDir(): string {
  if (commonDirCache === null) commonDirCache = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  return commonDirCache
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
    const mainCheckout = dirname(gitCommonDir())
    const override = readConfig(mainCheckout).mainBranch?.trim()
    if (override) return override
    const cur = git(['-C', mainCheckout, 'symbolic-ref', '--short', 'HEAD']).trim()
    if (cur) return cur
  } catch { /* fall through to the conventional default */ }
  return 'main'
}

// @@@ global per-session store - Fork A: NO SpexCode files live in the worktree any more, so the worktree's
// spec/code tree is pristine (zero per-session pollution). Every per-session runtime artifact — the
// structured record (session.json) AND the launcher products (prompt, launch.sh, hooks.json, claude.md) AND
// the spec-discipline sentinels — lives in a per-USER GLOBAL store, keyed by the harness `session_id` so two
// agents in one folder never clobber, and grouped PER PROJECT (mirroring Claude's ~/.claude/projects/<enc>/)
// so the board enumerates ONE directory. This is the single seam that knows where the store sits; sessions.ts
// and the shell hooks resolve through the SAME scheme (the hooks reimplement it in bash, so any change here
// must be mirrored in .config/core/*/). SPEXCODE_HOME overrides the root for test isolation.
export function spexcodeHome(): string {
  return process.env.SPEXCODE_HOME || join(homedir(), '.spexcode')
}
// encode a project-root path into ONE safe directory segment (Claude's scheme: path separators → '-'). The
// SAME transform runs in TS and in the shell hooks, so a board read and a hook write land on the SAME dir.
export function encodeProject(root: string): string {
  return root.replace(/[/.]/g, '-')
}
// the project a store groups by = the MAIN checkout root (dirname of the shared git common dir). It resolves
// IDENTICALLY from the main checkout OR any linked worktree, so the board (running at main) and a hook
// (running in a worktree) agree on the key — unlike `git rev-parse --show-toplevel`, which in a worktree is
// the worktree path and would scatter a session under a per-worktree key the board never reads.
export function projectKey(): string {
  return encodeProject(dirname(gitCommonDir()))
}
// this project's per-session records dir, one session's dir, its structured record, and a sibling artifact —
// all keyed by session_id under <home>/projects/<enc>/sessions/.
export function sessionsRoot(): string { return join(spexcodeHome(), 'projects', projectKey(), 'sessions') }
export function sessionStoreDir(id: string): string { return join(sessionsRoot(), id) }
export function sessionRecordPath(id: string): string { return join(sessionStoreDir(id), 'session.json') }
export function sessionArtifactPath(id: string, name: string): string { return join(sessionStoreDir(id), name) }

// the structured per-session record, as it sits on disk. Written one-field-per-line with EVERY key present
// (see sessions.ts writeRecord) so the hot-path mark-active shell hook can value-replace status/proposal/note
// with sed and never needs jq. Read here for the overlay; sessions.ts owns the full typed read/write.
export type RawRecord = {
  session_id: string; governed: boolean; worktree_path: string; branch: string | null
  node: string | null; title: string | null; name: string | null
  status: string; proposal: string | null; merges: number; note: string | null
  sortkey: number | null; createdAt: number
}
// the agent's OWN harness session id from the environment — the only locator now that the record left the
// worktree. Claude Code sets CLAUDE_CODE_SESSION_ID in every agent/hook subprocess; SPEXCODE_SESSION_ID is a
// portable override (Codex self-launch, tests). No worktree fallback. (sessions.ts re-exports this as ownSessionId.)
export function envSessionId(): string | null {
  const e = process.env.CLAUDE_CODE_SESSION_ID || process.env.SPEXCODE_SESSION_ID
  return e && e.trim() ? e.trim() : null
}
export function readRawRecord(id: string): RawRecord | null {
  try {
    const raw = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    return raw && typeof raw === 'object' && raw.session_id ? raw as RawRecord : null
  } catch { return null }
}
// every session_id this project has a record for (the board's enumeration source — replaces `git worktree
// list`). A MISSING store dir means no session ever launched → []. But any OTHER readdir failure THROWS
// (preserving the fail-loud-enumeration invariant `git worktree list` had): a transient FS error must never
// read as "every session vanished" — the watch poll skips the tick on a throw, never emitting a false mass-close.
export function listSessionIds(): string[] {
  let ents
  try { ents = readdirSync(sessionsRoot(), { withFileTypes: true }) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
  return ents.filter((d) => d.isDirectory()).map((d) => d.name)
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
  const main = dirname(gitCommonDir())   // the main checkout — same answer from main OR any linked worktree
  const cfg = readConfig(main)
  const base = mainBranch()
  const convention: Convention = {
    main: cfg.main || '',
    mainBranch: base,
    branchPrefix: cfg.branchPrefix ?? 'node/',
  }
  const mainRef = base
  // the board enumerates the GLOBAL per-session store (NOT `git worktree list`): every GOVERNED record this
  // project owns, each carrying the worktree_path its spec-delta is computed from. Non-governed (user-self-
  // launched) records are excluded — board state is a managed-session concern ([[state]]). Each delta is
  // independent → compute (or cache-hit) in parallel, keyed by worktree path as before. guardWorktree wraps
  // each: a worktree whose dir was genuinely removed mid-read (a worker self-merged + retired it) is OMITTED;
  // one that still exists but hit a transient detail failure is kept as a DEGRADED row from the last cached delta.
  const records = listSessionIds().map(readRawRecord).filter((r): r is RawRecord => !!r && r.governed)
  const rows = await Promise.all(records.map((r) => {
    const node = r.node ?? (r.branch && r.branch.startsWith(convention.branchPrefix) ? r.branch.slice(convention.branchPrefix.length) : null)
    const base: Worktree = { path: r.worktree_path, branch: r.branch, node, session: r.session_id, status: r.status, isMain: false, ops: [] }
    return guardWorktree<Worktree>(r.worktree_path,
      async (): Promise<Worktree> => ({ ...base, ops: await cachedDelta(r.worktree_path, mainRef) }),
      (): Worktree => ({ ...base, ops: deltaCache.get(r.worktree_path)?.ops ?? [] }))
  }))
  const sessionWorktrees = rows.filter((w): w is Worktree => w !== null)
  // the main checkout row (isMain) — always present, carries no overlay; it anchors the merged tree the board draws.
  const mainRow: Worktree = { path: main, branch: base, node: null, session: null, status: null, isMain: true, ops: [] }
  const worktrees = [mainRow, ...sessionWorktrees]
  // drop cache entries for worktrees no longer in the store (closed sessions), so the map stays bounded.
  const live = new Set(sessionWorktrees.map((w) => w.path))
  for (const k of [...deltaCache.keys()]) if (!live.has(k)) deltaCache.delete(k)
  return { main: convention.main || main || root, convention, worktrees }
}
