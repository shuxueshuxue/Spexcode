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

// @@@ fileStatsFollow - per-commit numstat for ONE file, rename-followed. `git log --follow --numstat`
// tracks the file across the reparent's moves (which `git show -- <path>` cannot — it only knows a
// commit's then-current path). Returns hash -> {additions, deletions, files} for this file alone.
// A pure rename reports 0/0, so callers can tell "moved" (not a version) from "changed" (a version).
// This is the GENERAL per-file path, kept for files outside `.spec` (the lint coverage/drift checks
// ask for governed *code* histories); `.spec` files go through the bulk index below instead.
function fileStatsFollow(root: string, relPath: string): Map<string, DiffStat> {
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

function historyFollow(root: string, relPath: string): Version[] {
  let out = ''
  try {
    out = git(['-C', root, 'log', `--format=%H${US}%aI${US}%s${US}%b${RS}`, '--follow', '--', relPath])
  } catch {
    return []
  }
  const stats = fileStatsFollow(root, relPath)
  return out.split(RS).map((r) => r.trim()).filter(Boolean).map((rec) => {
    const [hash, date, reason, body = ''] = rec.split(US)
    const m = body.match(/Session:\s*(\S+)/)
    return { hash, date, reason, session: m ? m[1] : null }
  }).filter((v) => { const s = stats.get(v.hash); return s != null && s.additions + s.deletions > 0 })
}

// ---- bulk spec history index (one git walk for the whole .spec tree, cached on HEAD) ----

export type HistoryIndex = {
  versions: Map<string, Version[]>          // headPath -> rows newest-first (incl. pure-rename rows)
  stats: Map<string, Map<string, DiffStat>> // headPath -> (commit hash -> this file's diffstat there)
}

// @@@ parseStatPath - git --numstat renders a rename as `dir/{old => new}/file` (either side may be
// empty: `.spec/{ => x}/f`), and a top-level move as `old => new`. Recover BOTH endpoints so we can
// follow a spec.md across the reparents the project does. Spec paths are brace/space-free, so this
// textual parse is unambiguous here (we also pass core.quotePath=false so non-ASCII stays literal).
function parseStatPath(token: string): { from: string; to: string } {
  const b = token.indexOf('{')
  if (b >= 0) {
    const arrow = token.indexOf(' => ', b)
    const close = token.indexOf('}', arrow)
    if (arrow > b && close > arrow) {
      const pre = token.slice(0, b), post = token.slice(close + 1)
      const from = (pre + token.slice(b + 1, arrow) + post).replace(/\/\//g, '/')
      const to = (pre + token.slice(arrow + 4, close) + post).replace(/\/\//g, '/')
      return { from, to }
    }
  }
  const i = token.indexOf(' => ')
  if (i >= 0) return { from: token.slice(0, i), to: token.slice(i + 4) }
  return { from: token, to: token }
}

let indexCache: { head: string; idx: HistoryIndex } | null = null

// @@@ historyIndex - the ENTIRE spec timeline in ONE `git log` walk. The old path called
// `git log --follow` twice PER node; with --follow each call re-walks all of history doing rename
// detection, so loading every node was O(nodes × commits) — measurably quadratic (≈0.6s at 19 nodes,
// ~20s at 100, ~5min at 500). Here we walk history once, read every commit's spec.md numstat + rename
// status, and bucket rows by each file's CURRENT (head) path, following renames BACKWARD in-memory.
// Cached on HEAD: a node's committed history is immutable, so a warm hit costs just one rev-parse.
export function historyIndex(root: string): HistoryIndex {
  let head = ''
  try { head = git(['-C', root, 'rev-parse', 'HEAD']).trim() } catch { /* no commits yet */ }
  if (indexCache && head && indexCache.head === head) return indexCache.idx
  const idx = buildIndex(root)
  if (head) indexCache = { head, idx }
  return idx
}

function buildIndex(root: string): HistoryIndex {
  const versions = new Map<string, Version[]>()
  const stats = new Map<string, Map<string, DiffStat>>()
  let out = ''
  try {
    out = git(['-C', root, '-c', 'core.quotePath=false', 'log', '-M', '--numstat',
      `--format=${RS}%H${US}%aI${US}%s${US}%b`, '--', '.spec'])
  } catch {
    return { versions, stats }
  }
  // Walk newest -> oldest (git log default). `alias` maps a path as it exists at the current walk
  // point to its head (current) path; the first (newest) time we meet a file, that path IS its head.
  const alias = new Map<string, string>()
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const parts = r.split(US)
    const hash = parts[0], date = parts[1], reason = parts[2]
    const rest = parts.slice(3).join(US) // body (had no US) followed by the numstat block
    const sm = rest.match(/Session:\s*(\S+)/)
    const version: Version = { hash, date, reason, session: sm ? sm[1] : null }
    for (const line of rest.split('\n')) {
      const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
      if (!m) continue
      const add = m[1] === '-' ? 0 : +m[1]
      const del = m[2] === '-' ? 0 : +m[2]
      const { from, to } = parseStatPath(m[3])
      let head = alias.get(to)
      if (head === undefined) { head = to; alias.set(to, to) }
      if (!versions.has(head)) versions.set(head, [])
      versions.get(head)!.push(version)
      let hs = stats.get(head)
      if (!hs) { hs = new Map(); stats.set(head, hs) }
      const s = hs.get(hash) ?? { additions: 0, deletions: 0, files: 0 }
      s.additions += add; s.deletions += del; s.files += 1
      hs.set(hash, s)
      if (from !== to) { alias.set(from, head); alias.delete(to) } // older history calls it `from`
    }
  }
  return { versions, stats }
}

// reset the cache when a process knows HEAD will have moved out from under it (tests, hooks).
export function resetHistoryCache(): void { indexCache = null }

// @@@ pure lookups over a prebuilt index (NO git calls) - callers that resolve many nodes at once
// (loadSpecs, specHistory) fetch the index ONCE via historyIndex() and then resolve every node with
// these. Going through history()/specStats() per node instead would re-run `git rev-parse HEAD` (the
// cache key) once per node — 20 subprocesses for a 20-node load. `rowsFor` drops pure-rename rows
// (0/0 diff) just like the --follow path, so "moved" never reads as a new version.
export function rowsFor(idx: HistoryIndex, relPath: string): Version[] {
  const rows = idx.versions.get(relPath) ?? []
  const st = idx.stats.get(relPath)
  return rows.filter((v) => { const s = st?.get(v.hash); return s != null && s.additions + s.deletions > 0 })
}
export function statsFor(idx: HistoryIndex, relPath: string): Map<string, DiffStat> {
  return idx.stats.get(relPath) ?? new Map()
}

// @@@ history - a file's version timeline. `.spec` files are served from the bulk index (one walk,
// cached); anything else (governed *code* files, asked for by lint) keeps the per-file --follow path.
// For resolving MANY .spec nodes, prefer historyIndex()+rowsFor() to avoid a rev-parse per call.
export function history(root: string, relPath: string): Version[] {
  if (relPath.startsWith('.spec/')) return rowsFor(historyIndex(root), relPath)
  return historyFollow(root, relPath)
}

// per-commit stat for this node's spec.md (rename-followed), exposed so specHistory can add it to
// the governed-code stat for an accurate "this version touched N lines of THIS node" number.
export function specStats(root: string, relPath: string): Map<string, DiffStat> {
  if (relPath.startsWith('.spec/')) return statsFor(historyIndex(root), relPath)
  return fileStatsFollow(root, relPath)
}
