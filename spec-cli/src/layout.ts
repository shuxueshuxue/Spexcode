import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { git, repoRoot, gitA, gitTry, headSha, worktreeSpecSig, worktreeSpecDelta, type NodeOp } from './git.js'
import { guardWorktree } from './resilience.js'

type Config = {
  main?: string                    // path to the source-of-truth checkout (default: the `main` worktree)
  mainBranch?: string              // source-of-truth BRANCH worktrees fork from (default: auto-detected — see mainBranch())
  branchPrefix?: string            // how a branch names its node (default: "node/")
  nodeFrom?: 'branch' | 'session'  // resolve a worktree's node id from its branch or its .session file
  dashboard?: {
    apiUrl?: string                // the per-project backend the board proxies to (read frontend-side; see api-endpoint)
    title?: string                 // override for the browser-tab name (default: the repo-root basename; see tab-title)
    icon?: string                  // the browser-tab favicon: an emoji ("🔭") or an Iconify name ("mdi:rocket-launch"); see tab-icon
  }
  sessions?: {
    maxActive?: number             // concurrency cap: max agents AUTONOMOUSLY PROGRESSING at once (default 6; see sessions.ts maxActive)
  }
  serve?: {
    // public-exposure config for `spex serve --public` (resolved gateway-side; see [[public-mode]] / gateway.ts).
    // The password is NEVER read from here — flag/env only — so this file stays committable.
    public?: {
      enabled?: boolean              // turn public mode on without the --public flag
      http?: boolean                 // drop TLS (the --http escape hatch) — password then travels in cleartext
      tls?: { cert?: string; key?: string }   // PATHS to your own cert/key; omit for a cached self-signed default
    }
  }
}
// the resolved LAYOUT convention — main/branchPrefix/nodeFrom filled to defaults. `dashboard`, `sessions`,
// and `serve` are frontend/runtime concerns (read separately; see api-endpoint / sessions.ts maxActive /
// gateway.ts), NOT layout fields, so they stay out of the convention rather than forcing a meaningless default.
type Convention = Required<Omit<Config, 'dashboard' | 'sessions' | 'serve'>>

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

// the shared git common dir (env-stripped git() so a hook's exported GIT_DIR can't misdirect it). Memoized:
// it's a process constant, but mainBranch()/mainRoot() resolve it per call (~60 git rev-parse forks per board build without the cache).
let commonDirCache: string | null = null
export function gitCommonDir(): string {
  if (commonDirCache === null) commonDirCache = git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  return commonDirCache
}

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

// COMPAT: readers fall back to the legacy flat `.session` dotfile layout while it's still a file; drop the
// fallbacks (here, sessions.ts, the hooks, .gitignore) once no pre-refactor worktree remains.
export const RUNTIME_DIR = '.session'
// the per-session state file. New layout: `.session/state`. Legacy: the flat `.session` FILE, detected
// because `.session` stat's as a file, not a directory (missing → new layout, the brand-new-session case).
export function statePath(dir: string): string {
  const base = join(dir, RUNTIME_DIR)
  try { if (statSync(base).isFile()) return base } catch { /* missing or a dir → folder layout */ }
  return join(base, 'state')
}
// a runtime sidecar (prompt / launch / …): prefer the new `.session/<name>`, fall back to the legacy flat
// name for an in-flight pre-refactor worktree. Returns the NEW path when neither exists, so writes adopt
// the folder. The dir is created by the writer (runtimeDir in sessions.ts), not here.
export function runtimePath(dir: string, name: string, legacy: string): string {
  const neu = join(dir, RUNTIME_DIR, name)
  if (existsSync(neu)) return neu
  const old = join(dir, legacy)
  if (existsSync(old)) return old
  return neu
}

// the untracked per-worktree linker: node / session / status (ephemeral runtime state).
function readSession(dir: string) {
  const r = { node: null as string | null, session: null as string | null, status: null as string | null }
  const p = statePath(dir)
  if (!existsSync(p)) return r
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim()
    if (k === 'node') r.node = v; else if (k === 'session') r.session = v; else if (k === 'status') r.status = v
  }
  return r
}

// memo the overlay (3 git diffs/worktree) keyed on fork-point merge-base + HEAD + spec sig — keying on the
// merge-base NOT main's HEAD means unrelated merges that don't move the fork point stay cache hits.
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
