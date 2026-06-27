import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'

const US = '\x1f', RS = '\x1e'

// strip git's hook-exported env (GIT_DIR etc.) so every call discovers the repo from the filesystem.
export function git(args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  return execFileSync('git', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] })
}

const pexecFile = promisify(execFile)
export async function gitA(args: string[]): Promise<string> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    const { stdout } = await pexecFile('git', args, { encoding: 'utf8', env, maxBuffer: 1 << 24 })
    return stdout
  } catch { return '' }
}

export async function gitTry(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    const { stdout, stderr } = await pexecFile('git', args, { encoding: 'utf8', env, maxBuffer: 1 << 24 })
    return { ok: true, stdout, stderr }
  } catch (e: any) {
    return { ok: false, stdout: e?.stdout ?? '', stderr: e?.stderr ?? String(e?.message ?? e) }
  }
}

// memoized: repoRoot is constant per process, but resolveLayout() calls it per request — avoid a git fork each time.
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

function gitDirOf(root: string): string {
  // a normal checkout has a `.git` DIRECTORY; a linked worktree has a `.git` FILE: `gitdir: <path>`.
  const dotgit = join(root, '.git')
  if (statSync(dotgit).isDirectory()) return dotgit
  const m = readFileSync(dotgit, 'utf8').match(/^gitdir:\s*(.+)$/m)
  if (!m) throw new Error(`headSha: unparseable .git file at ${dotgit}`)
  const dir = m[1].trim()
  return isAbsolute(dir) ? dir : resolve(root, dir)
}
function commonDirOf(gitDir: string): string {
  // a worktree's gitdir holds per-worktree state (HEAD); SHARED refs (refs/heads/*, packed-refs) live
  // in the common dir, named by the `commondir` pointer. A plain checkout IS its own common dir.
  const p = join(gitDir, 'commondir')
  if (!existsSync(p)) return gitDir
  const c = readFileSync(p, 'utf8').trim()
  return isAbsolute(c) ? c : resolve(gitDir, c)
}
export function headSha(root: string): string {
  const gitDir = gitDirOf(root)
  const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()
  const ref = head.match(/^ref:\s*(.+)$/)
  if (!ref) return head // detached HEAD: the file already holds the sha
  const name = ref[1].trim()
  // a loose ref wins over packed; per-worktree HEAD points at a branch whose ref lives in the common dir.
  const looseWt = join(gitDir, name)
  if (existsSync(looseWt)) return readFileSync(looseWt, 'utf8').trim()
  const common = commonDirOf(gitDir)
  const loose = join(common, name)
  if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
  const packed = join(common, 'packed-refs')
  if (existsSync(packed)) {
    for (const line of readFileSync(packed, 'utf8').split('\n')) {
      if (!line || line[0] === '#' || line[0] === '^') continue
      const sp = line.indexOf(' ')
      if (sp > 0 && line.slice(sp + 1).trim() === name) return line.slice(0, sp).trim()
    }
  }
  throw new Error(`headSha: cannot resolve ${name}`)
}

// fingerprint of a worktree's `.spec` working tree by path + mtimeMs + size (no git); the overlay-cache
// key for its working-tree state. '' when `.spec` is absent.
export function worktreeSpecSig(wtPath: string): string {
  const root = join(wtPath, '.spec')
  if (!existsSync(root)) return ''
  const parts: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let ents
    try { ents = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of ents) {
      const p = join(dir, e.name)
      if (e.isDirectory()) { stack.push(p); continue }
      try { const st = statSync(p); parts.push(`${p}:${st.mtimeMs}:${st.size}`) } catch { /* vanished mid-walk */ }
    }
  }
  return parts.sort().join('\n')
}

export type Version = { hash: string; date: string; reason: string; session: string | null }
export type DiffStat = { additions: number; deletions: number; files: number }

// per-commit numstat for one file, rename-followed; a pure rename is 0/0 so callers tell "moved" from
// "changed". The per-file path for files outside `.spec` (`.spec` goes through the bulk index below).
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

// ---- bulk spec history index ----

export type HistoryIndex = {
  versions: Map<string, Version[]>          // headPath -> rows newest-first (incl. pure-rename rows)
  stats: Map<string, Map<string, DiffStat>> // headPath -> (commit hash -> this file's diffstat there)
}

// git numstat encodes a rename as `dir/{old => new}/file` (either side may be empty) or `old => new`;
// recover both endpoints. Spec paths are brace/space-free here, so the textual parse is unambiguous.
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

export async function historyIndex(root: string): Promise<HistoryIndex> {
  const head = headOrEmpty(root)
  if (indexCache && head && indexCache.head === head) return indexCache.idx
  const idx = await buildIndex(root)
  if (head) indexCache = { head, idx }
  return idx
}

// resolve HEAD for cache-keying, '' if unreadable (fails the cache test → recompute); warns once.
let headWarned = false
function headOrEmpty(root: string): string {
  try { return headSha(root) }
  catch (e) {
    if (!headWarned) { headWarned = true; console.warn(`spec-cli: headSha failed, recomputing every read: ${(e as Error).message}`) }
    return ''
  }
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

// pure lookups over a prebuilt index (no git). rowsFor drops pure-rename rows (0/0) so a move isn't a version.
export function rowsFor(idx: HistoryIndex, relPath: string): Version[] {
  const rows = idx.versions.get(relPath) ?? []
  const st = idx.stats.get(relPath)
  return rows.filter((v) => { const s = st?.get(v.hash); return s != null && s.additions + s.deletions > 0 })
}
export function statsFor(idx: HistoryIndex, relPath: string): Map<string, DiffStat> {
  return idx.stats.get(relPath) ?? new Map()
}

// per-commit numstat summed over a SET of paths in one `git log` walk. No `--follow` (it takes a single
// path), so no rename-tracking — same as the old `git show -- paths`; spec.md gets renames via the bulk index.
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

// a file's version timeline: `.spec` from the bulk index, anything else (governed code) via per-file --follow.
export async function history(root: string, relPath: string): Promise<Version[]> {
  if (relPath.startsWith('.spec/')) return rowsFor(await historyIndex(root), relPath)
  return historyFollow(root, relPath)
}

// per-commit stat for this node's spec.md (rename-followed), summed with governed-code stats by specHistory.
export async function specStats(root: string, relPath: string): Promise<Map<string, DiffStat>> {
  if (relPath.startsWith('.spec/')) return statsFor(await historyIndex(root), relPath)
  return fileStatsFollow(root, relPath)
}

// the patch a spec.md got in one commit (vs parent); resolve its path AT that commit (reparents move it)
// via the stable leaf dir `…/<id>/spec.md`, then `git show` that path. `-M` keeps a rename+edit's body. '' on error.
export async function fileDiffAt(root: string, relPath: string, hash: string): Promise<string> {
  if (!hash || !relPath.endsWith('/spec.md')) return ''
  const leaf = relPath.slice(relPath.lastIndexOf('/', relPath.length - '/spec.md'.length - 1) + 1) // `<id>/spec.md`
  const names = await gitA(['-C', root, '-c', 'core.quotePath=false', 'show', '--name-only', '--format=', '-M', hash])
  const at = names.split('\n').map((s) => s.trim()).find((p) => p.endsWith('/' + leaf) || p === leaf) ?? relPath
  return gitA(['-C', root, '-c', 'core.quotePath=false', 'show', '-M', '--format=', hash, '--', at])
}

// ONE cached `git log` over HEAD (mirrors historyIndex): each commit's position (0 = newest) + per
// file the commits that touched it; driftFor() is then a pure lookup. `acks`/`specNodes` carry the
// Spec-OK convention (see driftFor): acks[hash] = node ids declared still-valid via `Spec-OK:` trailers;
// specNodes[hash] = node ids whose spec.md it touched.
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
  const head = headOrEmpty(root) // filesystem HEAD, no subprocess — see historyIndex
  if (driftIdxCache && head && driftIdxCache.head === head) return driftIdxCache.idx
  const idx = await buildDriftIndex(root)
  if (head) driftIdxCache = { head, idx }
  return idx
}
// pure lookup: how many commits to `path` are newer than `sinceHash` (the spec's last version) and not
// yet acknowledged. No git calls.
//
// `sinceHash` is the node's OWN latest version commit, so the node(s) it's a version of
// (specNodes[sinceHash]) name the node being measured; an ack counts only if its `Spec-OK:` set names one
// of those — `Spec-OK: A` quiets A's drift, never B's.
export function driftFor(idx: DriftIndex, sinceHash: string, path: string): number {
  if (!sinceHash) return 0
  const sp = idx.pos.get(sinceHash)
  if (sp === undefined) return 0
  const targets = idx.specNodes.get(sinceHash)
  // the newest commit that acks a target (smallest pos = closest to HEAD) is the floor at/below which all
  // drift is acknowledged. No target / no matching ack → Infinity, so nothing is quieted. An ack at or
  // before the version (p >= sp) can't speak for it — a re-version invalidates older acks.
  let ackPos = Infinity
  if (targets) {
    for (const [h, ackSet] of idx.acks) {
      const p = idx.pos.get(h)
      if (p === undefined || p >= sp) continue
      if ([...targets].some((t) => ackSet.has(t))) ackPos = Math.min(ackPos, p)
    }
  }
  let n = 0
  for (const h of idx.fileCommits.get(path) ?? []) {
    const p = idx.pos.get(h)
    if (p === undefined || p >= sp) continue   // older than / at the version → not drift
    if (p >= ackPos) continue                  // at or below the newest covering ack → acknowledged
    n++
  }
  return n
}

// the paths git is about to commit (index vs HEAD), scoping the pre-commit drift gate to this commit's files.
export function stagedFiles(root: string): string[] {
  try {
    return git(['-C', root, '-c', 'core.quotePath=false', 'diff', '--cached', '--name-only'])
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { return [] }
}

// ---- pending worktree changes (the board's runtime overlay) ----

// one pending change a worktree makes to a spec node vs main; committed = on the branch, dirty = uncommitted edits.
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

export type ReviewDiffFile = { path: string; status: string; additions: number; deletions: number }
const DIFF_STATUS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' }
export async function mergeBaseDiff(wtPath: string, mainRef = 'main'): Promise<ReviewDiffFile[]> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  const base = (await run(['merge-base', mainRef, 'HEAD'])).trim()
  if (!base) return []
  const [numstatOut, statusOut] = await Promise.all([
    run(['diff', '--numstat', '-M', `${base}..HEAD`]),
    run(['diff', '--name-status', '-M', `${base}..HEAD`]),
  ])
  const status = new Map<string, string>()
  for (const r of parseNameStatus(statusOut)) status.set(r.to, DIFF_STATUS[r.code] ?? r.code)
  const files: ReviewDiffFile[] = []
  for (const line of numstatOut.split('\n')) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
    if (!m) continue
    const { to } = parseStatPath(m[3])   // numstat renders a rename as `{old => new}`; keep the final path
    files.push({ path: to, status: status.get(to) ?? 'modified', additions: m[1] === '-' ? 0 : +m[1], deletions: m[2] === '-' ? 0 : +m[2] })
  }
  return files
}

export function mergeConflicts(wtPath: string, mainRef = 'main'): Promise<boolean> {
  return new Promise((resolve) => {
    const env = { ...process.env }
    delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
    execFile('git', ['-C', wtPath, 'merge-tree', '--write-tree', '--no-messages', mainRef, 'HEAD'],
      { encoding: 'utf8', env, maxBuffer: 1 << 24 },
      // execFile sets err.code to the numeric EXIT code on a non-zero exit (1 = conflicts), or a string
      // errno (e.g. 'ENOENT') if git can't be spawned — only the exit-1 case is a real conflict verdict.
      (err) => resolve(!!err && err.code === 1))
  })
}

// this worktree's spec ops vs main: one working-tree diff off the fork point (folds committed+staged+unstaged),
// a `status --porcelain` pass to add untracked spec.md, a third diff vs HEAD to mark what's committed.
export async function worktreeSpecDelta(wtPath: string, mainRef: string, baseHint?: string): Promise<NodeOp[]> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  // fork point = where this worktree branched from main; '' (no common ancestor / unreadable ref) falls
  // back to mainRef so we still surface changes rather than going silent. The caller (cachedDelta) already
  // computes this same merge-base to key its cache, so it passes it in to avoid a redundant subprocess.
  const base = baseHint || (await run(['merge-base', mainRef, 'HEAD'])).trim() || mainRef
  // the three queries are independent — run them in parallel.
  const [workOut, commOut, statusOut] = await Promise.all([
    run(['diff', '--name-status', '-M', base, '--', '.spec']),
    run(['diff', '--name-status', '-M', `${base}...HEAD`, '--', '.spec']),
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
