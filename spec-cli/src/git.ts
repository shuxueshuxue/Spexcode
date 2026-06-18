import { execFileSync } from 'node:child_process'

// @@@ git is the database - a spec's version history IS the git log of its spec.md.
// %s (subject) = the reason for change; a `Session:` trailer = the attribution.
const US = '\x1f', RS = '\x1e'

// @@@ clean git env - git hooks export GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE, and those override
// git's normal repo discovery. Inside a hook that makes `rev-parse --show-toplevel` resolve to the
// cwd instead of the real worktree root — so repoRoot() pointed at spec-cli/ and loaded zero specs.
// Strip them so EVERY git call we make discovers the repo from the filesystem, hook or not.
export function git(args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  return execFileSync('git', args, { encoding: 'utf8', env })
}

export function repoRoot(): string {
  try {
    return git(['rev-parse', '--show-toplevel']).trim()
  } catch {
    return process.cwd()
  }
}

export type Version = { hash: string; date: string; reason: string; session: string | null }
export type DiffStat = { additions: number; deletions: number; files: number }

// @@@ diffstat - lines added/removed by a commit, scoped to `paths` (a node's spec.md + the files
// it governs) so the number reflects THIS node's slice of the commit, not the whole repo-wide diff.
// A cross-cutting commit that only grazed this node's frontmatter then reads as the +2 it really
// was, not the 200 lines it touched elsewhere. --numstat: adds<TAB>dels<TAB>path; binary -> '-' -> 0.
export function diffstat(root: string, hash: string, paths: string[] = []): DiffStat {
  let out = ''
  try {
    const args = ['-C', root, 'show', hash, '--numstat', '--format=']
    if (paths.length) args.push('--', ...paths)
    out = git(args)
  } catch {
    return { additions: 0, deletions: 0, files: 0 }
  }
  let additions = 0, deletions = 0, files = 0
  for (const line of out.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/)
    if (!m) continue
    files++
    additions += m[1] === '-' ? 0 : Number(m[1])
    deletions += m[2] === '-' ? 0 : Number(m[2])
  }
  return { additions, deletions, files }
}

// @@@ fileStats - per-commit numstat for ONE file, rename-followed. `git log --follow --numstat`
// tracks the file across the reparent's moves (which `git show -- <path>` cannot — it only knows a
// commit's then-current path). Returns hash -> {additions, deletions, files} for this file alone.
// A pure rename reports 0/0, so callers can tell "moved" (not a version) from "changed" (a version).
function fileStats(root: string, relPath: string): Map<string, DiffStat> {
  const m = new Map<string, DiffStat>()
  let out = ''
  try {
    out = git(['-C', root, 'log', '--follow', '--format=%H', '--numstat', '--', relPath])
  } catch {
    return m
  }
  let cur = ''
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (/^[0-9a-f]{7,40}$/.test(t)) { cur = t; if (!m.has(cur)) m.set(cur, { additions: 0, deletions: 0, files: 0 }); continue }
    const n = line.match(/^(\d+|-)\t(\d+|-)\t/)
    if (n && cur) { const s = m.get(cur)!; s.files++; s.additions += n[1] === '-' ? 0 : +n[1]; s.deletions += n[2] === '-' ? 0 : +n[2] }
  }
  return m
}

export function history(root: string, relPath: string): Version[] {
  let out = ''
  try {
    out = git(['-C', root, 'log', `--format=%H${US}%aI${US}%s${US}%b${RS}`, '--follow', '--', relPath])
  } catch {
    return []
  }
  const stats = fileStats(root, relPath)
  return out.split(RS).map((r) => r.trim()).filter(Boolean).map((rec) => {
    const [hash, date, reason, body = ''] = rec.split(US)
    const m = body.match(/Session:\s*(\S+)/)
    return { hash, date, reason, session: m ? m[1] : null }
  }).filter((v) => { const s = stats.get(v.hash); return s != null && s.additions + s.deletions > 0 })
}

// per-commit stat for this node's spec.md (rename-followed), exposed so specHistory can add it to
// the governed-code stat for an accurate "this version touched N lines of THIS node" number.
export function specStats(root: string, relPath: string): Map<string, DiffStat> {
  return fileStats(root, relPath)
}
