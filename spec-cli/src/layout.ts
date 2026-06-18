import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot, git } from './git.js'

// @@@ portable layout - the ONE seam where "where things live" is policy, not hardcode.
// Mechanism (read .spec, git log) is fixed; this resolves: where is main, how to enumerate the
// other checkouts, how each declares its node. No spexcode.json => our convention. With it =>
// adapt to any layout (main in a different folder, a different branch naming, etc.).

type Config = {
  main?: string                    // path to the source-of-truth checkout (default: the `main` worktree)
  branchPrefix?: string            // how a branch names its node (default: "node/")
  nodeFrom?: 'branch' | 'session'  // resolve a worktree's node id from its branch or its .session file
}

export type Worktree = {
  path: string; branch: string | null; node: string | null
  session: string | null; status: string | null; isMain: boolean
}
export type Layout = { main: string; convention: Required<Config>; worktrees: Worktree[] }

function readConfig(root: string): Config {
  const p = join(root, 'spexcode.json')
  if (!existsSync(p)) return {}
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return {} }
}

function gitWorktrees(root: string): { path: string; branch: string | null }[] {
  let out = ''
  try { out = git(['-C', root, 'worktree', 'list', '--porcelain']) } catch { return [] }
  const list: { path: string; branch: string | null }[] = []
  let cur: { path: string; branch: string | null } | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) { cur = { path: line.slice(9), branch: null }; list.push(cur) }
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace('refs/heads/', '')
  }
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

export function resolveLayout(): Layout {
  const root = repoRoot()
  const cfg = readConfig(root)
  const convention: Required<Config> = {
    main: cfg.main || '',
    branchPrefix: cfg.branchPrefix ?? 'node/',
    nodeFrom: cfg.nodeFrom ?? 'branch',
  }
  const worktrees = gitWorktrees(root).map((w) => {
    const sess = readSession(w.path)
    const isMain = w.branch === 'main'
    const fromBranch = w.branch && w.branch.startsWith(convention.branchPrefix)
      ? w.branch.slice(convention.branchPrefix.length) : null
    const node = isMain ? null
      : convention.nodeFrom === 'session' ? sess.node : (fromBranch ?? sess.node)
    return { path: w.path, branch: w.branch, node, session: sess.session, status: sess.status, isMain }
  })
  const main = convention.main || worktrees.find((w) => w.isMain)?.path || root
  return { main, convention, worktrees }
}
