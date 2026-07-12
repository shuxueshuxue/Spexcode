import { execFileSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'

const US = '\x1f', RS = '\x1e'

// @@@ bounded git children - a git child that never exits (wedged fs, a hijacked PATH git, a dead network
// mount) must not pin its awaiter forever: [[graph-cache]]'s settle guarantee starts at this seam. Every
// shared helper passes a generous timeout (an order of magnitude above the slowest legitimate full-history
// walk) with SIGKILL — same pattern sessions.ts's tmux/ps probes already use — so a hung child dies and the
// call fails like any other git failure instead of hanging its caller's promise. The kill is warned loudly:
// gitA maps failure to '', which would otherwise hide the pathology as an innocently-empty result.
const GIT_TIMEOUT_MS = Number(process.env.SPEXCODE_GIT_TIMEOUT_MS || 120000)
function warnIfTimedOut(e: any, args: string[]): void {
  if (e?.signal === 'SIGKILL') console.warn(`spec-cli: git ${args.slice(0, 6).join(' ')}… killed after ${GIT_TIMEOUT_MS}ms — child never exited`)
}

// strip git's hook-exported env (GIT_DIR etc.) so every call discovers the repo from the filesystem.
export function git(args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    return execFileSync('git', args, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e: any) { warnIfTimedOut(e, args); throw e }
}

const pexecFile = promisify(execFile)
export async function gitA(args: string[]): Promise<string> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    const { stdout } = await pexecFile('git', args, { encoding: 'utf8', env, maxBuffer: 1 << 24, timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' })
    return stdout
  } catch (e: any) { warnIfTimedOut(e, args); return '' }
}

export async function gitTry(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    const { stdout, stderr } = await pexecFile('git', args, { encoding: 'utf8', env, maxBuffer: 1 << 24, timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' })
    return { ok: true, stdout, stderr }
  } catch (e: any) {
    warnIfTimedOut(e, args)
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
  // an UNBORN HEAD — a fresh `git init` with no commits — points at a branch ref that doesn't exist yet.
  // That is a valid EMPTY-HISTORY state, not a failure: the board renders fine from the working tree. Return
  // a stable, truthy sentinel so historyIndex/driftIndex/safeHead MEMOIZE it (the head value is only ever a
  // cache key, never a git ref) instead of re-forking git on every read; headOrEmpty's warning is then
  // reserved for a genuinely unreadable HEAD and never fires for this routine first-run state.
  return `unborn:${name}`
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

// Both bulk indices are pure functions of a checkout's HEAD, and they are read for SEVERAL roots at
// once — the backend checkout (board, loadSpecs) plus every session worktree ([[session-eval]]'s eval
// tab roots its readings at the session's branch). A single-slot cache thrashes between those roots:
// each eval-tab request evicts the board's entry and vice versa, so every request re-runs a full-history
// `git log` and re-parses it on the event loop — which is what starves every other request (the board,
// remark posts) under load. So the cache is a small LRU keyed by HEAD (same head ⇒ same index, whatever
// the root), holding the in-flight PROMISE so concurrent requests for one head share a single build.
const INDEX_SLOTS = 16
function lruGet<V>(m: Map<string, V>, k: string): V | undefined {
  const v = m.get(k)
  if (v !== undefined) { m.delete(k); m.set(k, v) }   // refresh recency
  return v
}
function lruPut<V>(m: Map<string, V>, k: string, v: V): void {
  m.set(k, v)
  while (m.size > INDEX_SLOTS) m.delete(m.keys().next().value!)
}

const indexCache = new Map<string, Promise<HistoryIndex>>()

export function historyIndex(root: string): Promise<HistoryIndex> {
  const head = headOrEmpty(root)
  if (!head) return buildIndex(root)
  const hit = lruGet(indexCache, head)
  if (hit) return hit
  const p = buildIndex(root)
  p.catch(() => { indexCache.delete(head) })   // don't pin a failed build
  lruPut(indexCache, head, p)
  return p
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

// the patch a spec.md got in one commit (vs parent); resolve its path AT that commit (reparents move it)
// via the stable leaf dir `…/<id>/spec.md`, then `git show` that path. `-M` keeps a rename+edit's body. '' on error.
export async function fileDiffAt(root: string, relPath: string, hash: string): Promise<string> {
  if (!hash || !relPath.endsWith('/spec.md')) return ''
  const leaf = relPath.slice(relPath.lastIndexOf('/', relPath.length - '/spec.md'.length - 1) + 1) // `<id>/spec.md`
  const names = await gitA(['-C', root, '-c', 'core.quotePath=false', 'show', '--name-only', '--format=', '-M', hash])
  const at = names.split('\n').map((s) => s.trim()).find((p) => p.endsWith('/' + leaf) || p === leaf) ?? relPath
  return gitA(['-C', root, '-c', 'core.quotePath=false', 'show', '-M', '--format=', hash, '--', at])
}

// A cached `git log` over HEAD (HEAD-keyed like historyIndex), enriched with parent edges so "newer than
// the spec" is answered by true DAG reachability, never by a log-position/date compare (a linear
// order can't encode a branching history's partial order and silently under-reports — back-dated
// branches, adoption). driftFor()/ancestorsOf() are then pure in-memory lookups. `acks`/`specNodes`
// carry the Spec-OK convention (see driftFor): acks[hash] = node ids declared still-valid via
// `Spec-OK:` trailers; specNodes[hash] = node ids whose spec.md it touched.
export type DriftIndex = {
  ord: Map<string, number>            // hash -> dense id from the walk: a bitset slot, NEVER an order to compare
  parents: Map<string, string[]>      // hash -> parent hashes (the DAG edges, from the same walk)
  fileCommits: Map<string, string[]>
  acks: Map<string, Set<string>>      // commit hash -> node ids acknowledged via `Spec-OK:` trailers
  specNodes: Map<string, Set<string>> // commit hash -> node ids whose spec.md it touched (its versions)
  anc: Map<string, Uint8Array>        // memoized reachability bitsets, lazily built per queried sha
}
const driftIdxCache = new Map<string, Promise<DriftIndex>>()   // HEAD-keyed LRU, same shape as indexCache above

async function buildDriftIndex(root: string): Promise<DriftIndex> {
  const ord = new Map<string, number>(), parents = new Map<string, string[]>()
  const fileCommits = new Map<string, string[]>()
  const acks = new Map<string, Set<string>>(), specNodes = new Map<string, Set<string>>()
  const idx: DriftIndex = { ord, parents, fileCommits, acks, specNodes, anc: new Map() }
  // RS-delimited records: `<hash>US<parents>US<comma-joined Spec-OK values>` on line 1, then the
  // --name-only file list. `valueonly,separator` collapses the trailer block to one line so it never
  // collides with the file names below it (a raw `%b` body would interleave and be unparseable).
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only',
    `--format=${RS}%H${US}%P${US}%(trailers:key=Spec-OK,valueonly,separator=%x2C)`, 'HEAD'])
  if (!out) return idx
  let i = 0
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const lines = r.split('\n')
    const [hash, parentStr = '', ackStr = ''] = lines[0].split(US)
    if (!hash) continue
    if (!ord.has(hash)) {
      ord.set(hash, i++)
      parents.set(hash, parentStr.split(' ').filter(Boolean))
    }
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
  return idx
}
export function driftIndex(root: string): Promise<DriftIndex> {
  const head = headOrEmpty(root) // filesystem HEAD, no subprocess — see historyIndex
  if (!head) return buildDriftIndex(root)
  const hit = lruGet(driftIdxCache, head)
  if (hit) return hit
  const p = buildDriftIndex(root)
  p.catch(() => { driftIdxCache.delete(head) })
  lruPut(driftIdxCache, head, p)
  return p
}
// the reachability set of `sha` — itself plus every ancestor — as a bitset over the walk's dense ids.
// Built once per queried sha by following parent edges in memory (no git fork), memoized on the index;
// a bitset costs history-length BITS, so hundreds of cached shas stay cheap on the board hot path.
// undefined when `sha` is not reachable from HEAD (rebased away, an unmerged branch, or never on any
// ref) — callers apply their own conservative rule to that "can't prove" case.
export function ancestorsOf(idx: DriftIndex, sha: string): Uint8Array | undefined {
  const hit = idx.anc.get(sha)
  if (hit) return hit
  const start = idx.ord.get(sha)
  if (start === undefined) return undefined
  const bits = new Uint8Array((idx.ord.size + 7) >> 3)
  bits[start >> 3] |= 1 << (start & 7)
  const stack = [sha]
  while (stack.length) {
    for (const p of idx.parents.get(stack.pop()!) ?? []) {
      const o = idx.ord.get(p)
      if (o === undefined) continue // shallow-clone boundary: an unwalked parent ends the chain
      const m = 1 << (o & 7)
      if (bits[o >> 3] & m) continue
      bits[o >> 3] |= m
      stack.push(p)
    }
  }
  idx.anc.set(sha, bits)
  return bits
}
export function inAncestors(idx: DriftIndex, bits: Uint8Array, sha: string): boolean {
  const o = idx.ord.get(sha)
  return o !== undefined && (bits[o >> 3] & (1 << (o & 7))) !== 0
}

// the valid Spec-OK coverage for a node's version commit: `sinceHash` is the node's OWN latest version,
// so the node(s) it's a version of (specNodes[sinceHash]) name the node being measured; an ack counts
// only if its `Spec-OK:` set names one of those — `Spec-OK: A` quiets A's drift, never B's. An ack that
// is itself an ancestor of the version can't speak for it (a re-version invalidates older acks); a valid
// ack quiets exactly the commits reachable from it. Shared by driftFor (the count) and the anchor
// engine's windowCommits (the commit set) so both read ONE ack rule.
export function ackCoverFor(idx: DriftIndex, sinceHash: string): Uint8Array[] {
  const base = ancestorsOf(idx, sinceHash)
  if (!base) return []
  const targets = idx.specNodes.get(sinceHash)
  const cover: Uint8Array[] = []
  if (targets) {
    for (const [h, ackSet] of idx.acks) {
      if (inAncestors(idx, base, h)) continue
      if (![...targets].some((t) => ackSet.has(t))) continue
      const a = ancestorsOf(idx, h)
      if (a) cover.push(a)
    }
  }
  return cover
}

// pure lookup, no git: a commit to `path` is drift iff it is NOT an ancestor of `sinceHash` — it lies
// in `sinceHash..HEAD` by true DAG reachability, wherever a date-ordered log happens to place it.
// An off-history `sinceHash` → 0: no basis on HEAD to measure from.
export function driftFor(idx: DriftIndex, sinceHash: string, path: string): number {
  if (!sinceHash) return 0
  const base = ancestorsOf(idx, sinceHash)
  if (!base) return 0
  const ackCover = ackCoverFor(idx, sinceHash)
  let n = 0
  for (const h of idx.fileCommits.get(path) ?? []) {
    if (inAncestors(idx, base, h)) continue           // reachable from the version → not drift
    if (ackCover.some((a) => inAncestors(idx, a, h))) continue // covered by an ack → acknowledged
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
