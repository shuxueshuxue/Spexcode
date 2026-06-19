import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'

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

// @@@ async git - same env-cleaning as git(), but non-blocking. The worktree-overlay diff runs many
// git calls per /api/layout request; doing them with the SYNC git() blocks Node's one event loop for
// the whole batch (~2s with several worktrees), starving every other request. gitA() + Promise.all
// keeps the loop free and lets the per-worktree diffs run in parallel. Returns '' on error.
const pexecFile = promisify(execFile)
export async function gitA(args: string[]): Promise<string> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    const { stdout } = await pexecFile('git', args, { encoding: 'utf8', env, maxBuffer: 1 << 24 })
    return stdout
  } catch { return '' }
}

// memoized: the repo root is constant for a process, but resolveLayout() calls this per request — without
// the cache that's a sync `git` fork() on every /api/layout & /api/board (slow on the server's big RSS).
let repoRootCache: string | null = null
export function repoRoot(): string {
  if (repoRootCache !== null) return repoRootCache
  try {
    repoRootCache = git(['rev-parse', '--show-toplevel']).trim()
  } catch {
    repoRootCache = process.cwd()
  }
  return repoRootCache
}

export type Version = { hash: string; date: string; reason: string; session: string | null }
export type DiffStat = { additions: number; deletions: number; files: number }

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
// @@@ async git on the serving path - rev-parse/buildIndex go through gitA (async), NOT sync git().
// execFileSync spawns via fork(), whose cost scales with the PARENT process's resident memory — in the
// long-running API server (large RSS) every sync git spawn is slow (~0.5s) and they degrade as RSS
// grows, so /api/specs and /history took >1s even warm. gitA uses libuv's posix_spawn (no page-table
// copy), staying flat regardless of RSS. The cache is unchanged: a warm hit is one async rev-parse.
export async function historyIndex(root: string): Promise<HistoryIndex> {
  const head = (await gitA(['-C', root, 'rev-parse', 'HEAD'])).trim()
  if (indexCache && head && indexCache.head === head) return indexCache.idx
  const idx = await buildIndex(root)
  if (head) indexCache = { head, idx }
  return idx
}

async function buildIndex(root: string): Promise<HistoryIndex> {
  const versions = new Map<string, Version[]>()
  const stats = new Map<string, Map<string, DiffStat>>()
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '-M', '--numstat',
    `--format=${RS}%H${US}%aI${US}%s${US}%b`, '--', '.spec'])
  if (!out) return { versions, stats }
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

// @@@ pathsStats - per-commit numstat summed over a SET of paths, gathered in ONE `git log` walk.
// Replaces specHistory's old per-version `git show <hash> -- <code>` loop: that spawned one git
// subprocess PER version, and SYNCHRONOUS subprocess spawning degrades badly inside the long-running
// API server (each spawn gets progressively slower — a 10-version node's /history took >1s). One walk,
// then a per-version map lookup, makes the whole request 2 spawns instead of ~N. No `--follow` (that
// only takes a single path) — same no-rename-tracking behaviour the old `git show -- paths` had, so the
// code-line numbers are identical; spec.md keeps its rename-followed stats via the bulk index above.
export async function pathsStats(root: string, paths: string[]): Promise<Map<string, DiffStat>> {
  const m = new Map<string, DiffStat>()
  if (!paths.length) return m
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '--format=%H', '--numstat', '--', ...paths])
  if (!out) return m
  let cur = ''
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (/^[0-9a-f]{7,40}$/.test(t)) { cur = t; continue }
    const n = line.match(/^(\d+|-)\t(\d+|-)\t/)
    if (n && cur) {
      const s = m.get(cur) ?? { additions: 0, deletions: 0, files: 0 }
      s.files++; s.additions += n[1] === '-' ? 0 : +n[1]; s.deletions += n[2] === '-' ? 0 : +n[2]
      m.set(cur, s)
    }
  }
  return m
}

// @@@ history - a file's version timeline. `.spec` files are served from the bulk index (one walk,
// cached); anything else (governed *code* files, asked for by lint) keeps the per-file --follow path.
// For resolving MANY .spec nodes, prefer historyIndex()+rowsFor() to avoid a rev-parse per call.
export async function history(root: string, relPath: string): Promise<Version[]> {
  if (relPath.startsWith('.spec/')) return rowsFor(await historyIndex(root), relPath)
  return historyFollow(root, relPath)
}

// per-commit stat for this node's spec.md (rename-followed), exposed so specHistory can add it to
// the governed-code stat for an accurate "this version touched N lines of THIS node" number.
export async function specStats(root: string, relPath: string): Promise<Map<string, DiffStat>> {
  if (relPath.startsWith('.spec/')) return statsFor(await historyIndex(root), relPath)
  return fileStatsFollow(root, relPath)
}

// ONE cached `git log` over HEAD (mirrors historyIndex): each commit's position (0 = newest) + per
// file the commits that touched it. driftFor() is then a pure lookup. The old per-file `git rev-list`
// spawned ~40 subprocesses per loadSpecs (~6s); this is a single walk, cached on HEAD.
// `acks` / `specNodes` carry the Spec-OK convention (see driftFor): acks[hash] = node ids this commit
// declared still-valid via `Spec-OK:` trailers; specNodes[hash] = node ids whose spec.md it touched.
export type DriftIndex = {
  pos: Map<string, number>
  fileCommits: Map<string, string[]>
  acks: Map<string, Set<string>>      // commit hash -> node ids acknowledged via `Spec-OK:` trailers
  specNodes: Map<string, Set<string>> // commit hash -> node ids whose spec.md it touched (its versions)
}
let driftIdxCache: { head: string; idx: DriftIndex } | null = null

async function buildDriftIndex(root: string): Promise<DriftIndex> {
  const pos = new Map<string, number>(), fileCommits = new Map<string, string[]>()
  const acks = new Map<string, Set<string>>(), specNodes = new Map<string, Set<string>>()
  // RS-delimited records: `<hash>US<comma-joined Spec-OK values>` on line 1, then the --name-only file
  // list. `valueonly,separator` collapses the trailer block to one line so it never collides with the
  // file names below it (a raw `%b` body would interleave with them and be unparseable).
  // gitA (async) not git(): keeps this off the fork()-on-a-big-RSS slow path — see historyIndex above.
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only',
    `--format=${RS}%H${US}%(trailers:key=Spec-OK,valueonly,separator=%x2C)`, 'HEAD'])
  if (!out) return { pos, fileCommits, acks, specNodes }
  let i = 0
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const lines = r.split('\n')
    const [hash, ackStr = ''] = lines[0].split(US)
    if (!hash) continue
    if (!pos.has(hash)) pos.set(hash, i++)
    const ackSet = new Set(ackStr.split(',').map((s) => s.trim()).filter(Boolean))
    if (ackSet.size) acks.set(hash, ackSet)
    for (const line of lines.slice(1)) {
      if (!line) continue
      let arr = fileCommits.get(line); if (!arr) { arr = []; fileCommits.set(line, arr) }
      arr.push(hash)
      if (isSpecMd(line)) {
        let ns = specNodes.get(hash); if (!ns) { ns = new Set(); specNodes.set(hash, ns) }
        ns.add(nodeIdOf(line))
      }
    }
  }
  return { pos, fileCommits, acks, specNodes }
}
export async function driftIndex(root: string): Promise<DriftIndex> {
  const head = (await gitA(['-C', root, 'rev-parse', 'HEAD'])).trim()
  if (driftIdxCache && driftIdxCache.head === head) return driftIdxCache.idx
  const idx = await buildDriftIndex(root)
  if (head) driftIdxCache = { head, idx }
  return idx
}
// pure lookup: how many commits to `path` are newer than `sinceHash` (the spec's last version). No git
// calls. @@@ Spec-OK ack - a code commit ahead of the spec can carry a `Spec-OK: <node>` trailer
// meaning "this change keeps <node>'s spec valid — no spec edit needed"; such a commit is skipped so an
// acknowledged implementation-only change isn't false drift. `sinceHash` is the node's OWN latest
// version commit, so the node(s) it's a version of (specNodes[sinceHash]) name the node being measured;
// a commit counts as acknowledged only if its `Spec-OK:` set names one of those — `Spec-OK: A` quiets
// A's drift, never B's.
export function driftFor(idx: DriftIndex, sinceHash: string, path: string): number {
  if (!sinceHash) return 0
  const sp = idx.pos.get(sinceHash)
  if (sp === undefined) return 0
  const targets = idx.specNodes.get(sinceHash)
  let n = 0
  for (const h of idx.fileCommits.get(path) ?? []) {
    const p = idx.pos.get(h)
    if (p === undefined || p >= sp) continue
    const ack = idx.acks.get(h)
    if (ack && targets && [...targets].some((t) => ack.has(t))) continue
    n++
  }
  return n
}

// ---- pending worktree changes (the board's runtime overlay) ----

// @@@ NodeOp - one pending change a worktree makes to a spec node, RELATIVE TO MAIN. `op` is the net
// effect on the node's spec.md; `committed` = the change is on the branch (a commit), `dirty` = there
// are still-uncommitted working-tree edits. The dashboard overlays these onto main's merged board so a
// human watching main sees in-flight work (a node about to be added/edited/deleted/moved) before merge.
export type NodeOp = {
  nodeId: string
  op: 'added' | 'edited' | 'deleted' | 'moved'
  path: string                         // the node's spec.md path (new path for moved/added, old for deleted)
  fromPath?: string; toPath?: string   // set for 'moved' (a reparent renames the spec.md path)
  committed: boolean; dirty: boolean
}

// node id = the directory holding the spec.md (basename of its parent dir). git always emits
// forward-slash paths, so split rather than node:path (which is backslash-y on Windows).
const nodeIdOf = (p: string): string => { const s = p.split('/'); return s[s.length - 2] ?? p }
const isSpecMd = (p: string): boolean => p.endsWith('/spec.md')

// `git ... --name-status -M` rows: `A\tpath`, `M\tpath`, `D\tpath`, `R100\told\tnew`. Recover the
// status letter plus from/to (to === from for non-renames) so callers map letter -> op uniformly.
function parseNameStatus(out: string): { code: string; from: string; to: string }[] {
  const rows: { code: string; from: string; to: string }[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const parts = line.split('\t')
    const code = parts[0][0]
    if ((code === 'R' || code === 'C') && parts.length >= 3) rows.push({ code, from: parts[1], to: parts[2] })
    else rows.push({ code, from: parts[1], to: parts[1] })
  }
  return rows
}

// @@@ worktreeSpecDelta - what this worktree changes about the spec tree vs `mainRef`. The op set is
// read from ONE diff of mainRef against the worktree's WORKING TREE (`git diff <ref>`), which already
// folds committed + staged + unstaged into the final state (an add-then-uncommitted-delete cancels
// out, etc.). Untracked new spec.md don't show in that diff, so a `status --porcelain` pass adds them
// as `added` and marks which paths are dirty; a third diff vs HEAD marks what's actually committed.
export async function worktreeSpecDelta(wtPath: string, mainRef: string): Promise<NodeOp[]> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  // the three queries are independent — run them in parallel.
  const [workOut, commOut, statusOut] = await Promise.all([
    run(['diff', '--name-status', '-M', mainRef, '--', '.spec']),
    run(['diff', '--name-status', '-M', `${mainRef}...HEAD`, '--', '.spec']),
    run(['status', '--porcelain', '--untracked-files=all', '--', '.spec']),
  ])
  const work = parseNameStatus(workOut)
  const committed = new Set(parseNameStatus(commOut).map((r) => r.to))
  // --untracked-files=all: list every untracked spec.md individually (the default collapses a wholly
  // new node's directory to `.spec/.../node/`, which we'd never recognise as a spec.md add).
  const dirty = new Set<string>(), untracked: string[] = []
  for (const line of statusOut.split('\n')) {
    if (!line) continue
    const xy = line.slice(0, 2)
    let path = line.slice(3)
    const arrow = path.indexOf(' -> '); if (arrow >= 0) path = path.slice(arrow + 4)
    dirty.add(path)
    if (xy === '??' && isSpecMd(path)) untracked.push(path)
  }

  const codeFor: Record<string, NodeOp['op']> = { A: 'added', M: 'edited', D: 'deleted', R: 'moved', C: 'added', T: 'edited' }
  const ops: NodeOp[] = [], seen = new Set<string>()
  for (const r of work) {
    const path = r.code === 'D' ? r.from : r.to
    if (!isSpecMd(path)) continue
    seen.add(path)
    const op = codeFor[r.code] ?? 'edited'
    ops.push({
      nodeId: nodeIdOf(path), op, path,
      ...(op === 'moved' ? { fromPath: r.from, toPath: r.to } : {}),
      committed: committed.has(r.to) || committed.has(r.from),
      dirty: dirty.has(path) || dirty.has(r.from),
    })
  }
  for (const path of untracked) {
    if (seen.has(path)) continue
    ops.push({ nodeId: nodeIdOf(path), op: 'added', path, committed: false, dirty: true })
  }
  return ops
}
