import { execFileSync, execFile } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'

const US = '\x1f', RS = '\x1e'

// @@@ bounded graph git children - a git child that never exits (wedged fs, a hijacked PATH git, a dead
// network mount) must not pin its awaiter forever: [[graph-cache]]'s settle guarantee starts at this seam.
// Every shared helper passes a generous timeout with SIGKILL. A graph build additionally carries one fixed
// permit pool through AsyncLocalStorage, so corpus-wide Promise.all fanout queues here before spawn rather
// than materializing one process per worktree/eval. Calls outside that build context remain unconstrained.
const GIT_TIMEOUT_MS = Number(process.env.SPEXCODE_GIT_TIMEOUT_MS || 120000)
export const BOARD_GIT_CONCURRENCY = 4
// A complete commit/parent/file map is useful for ordinary repositories, but its JS object overhead is
// unbounded in a production monorepo. Large histories use the path-scoped rev-list representation below;
// this is a size policy, never a product/path exception.
const DRIFT_LAZY_COMMIT_THRESHOLD = Math.max(10_000, Number(process.env.SPEXCODE_DRIFT_LAZY_THRESHOLD || 100_000))
const DRIFT_LAZY_OUTPUT_BYTES = Math.max(1_000_000, Number(process.env.SPEXCODE_DRIFT_LAZY_OUTPUT_BYTES || 1_000_000))
type GitPermitPool = { acquire: (signal: AbortSignal) => Promise<() => void> }
type GitBuildContext = { signal: AbortSignal; permits: GitPermitPool }
const gitBuild = new AsyncLocalStorage<GitBuildContext>()

// @@@ a build's git children run on a bounded pack footprint - git sizes its mmap window, its mmap ceiling
// and its delta-base cache for a process that owns the machine. A graph build's heaviest walks each mapped
// well over a hundred megabytes of pack for output measured in kilobytes, and those children land inside the
// build's own memory platform. Capping the three makes the same walks run in a fraction of the resident set
// for a fraction of a second more. This is a RESOURCE boundary, never a semantic one — output, exit status
// and stderr are byte-identical under every setting — and it is scoped to the build context, so ordinary
// CLI/API git keeps git's defaults. It is also content-blind: the transport knows pack sizing, never which
// walk a caller is doing.
const BUILD_GIT_LIMITS = [
  '-c', 'core.packedGitWindowSize=1m',
  '-c', 'core.packedGitLimit=32m',
  '-c', 'core.deltaBaseCacheLimit=1m',
]
const withBuildLimits = (args: string[]): string[] => (gitBuild.getStore() ? [...BUILD_GIT_LIMITS, ...args] : args)

export function gitAbortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
}

function gitPermitPool(limit: number): GitPermitPool {
  type Waiter = {
    signal: AbortSignal
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    onAbort: () => void
  }
  let active = 0
  const waiting: Waiter[] = []

  const releasePermit = (): (() => void) => {
    let released = false
    return () => {
      if (released) return
      released = true
      active--
      drain()
    }
  }
  const drain = () => {
    while (active < limit && waiting.length) {
      const waiter = waiting.shift()!
      waiter.signal.removeEventListener('abort', waiter.onAbort)
      if (waiter.signal.aborted) {
        waiter.reject(gitAbortError())
        continue
      }
      active++
      waiter.resolve(releasePermit())
    }
  }

  return {
    acquire(signal) {
      if (signal.aborted) return Promise.reject(gitAbortError())
      if (active < limit) {
        active++
        return Promise.resolve(releasePermit())
      }
      return new Promise((resolve, reject) => {
        const waiter: Waiter = {
          signal,
          resolve,
          reject,
          onAbort: () => {
            const index = waiting.indexOf(waiter)
            if (index >= 0) waiting.splice(index, 1)
            reject(gitAbortError())
          },
        }
        waiting.push(waiter)
        signal.addEventListener('abort', waiter.onAbort, { once: true })
      })
    },
  }
}

// A board build owns one abort signal. Async git calls inherit it without every graph layer growing a
// cancellation parameter; aborting the build therefore reaches every active child and queued permit below
// the graph seam. The pool is created here, so ordinary CLI/API git calls never share or wait on it.
export function withGitAbortSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return gitBuild.run({ signal, permits: gitPermitPool(BOARD_GIT_CONCURRENCY) }, run)
}

const inheritedContext = (): GitBuildContext | undefined => gitBuild.getStore()
export function currentGitBuildAbortSignal(): AbortSignal | undefined {
  return inheritedContext()?.signal
}
function warnIfTimedOut(e: any, args: string[]): void {
  if (e?.signal === 'SIGKILL') console.warn(`spec-cli: git ${args.slice(0, 6).join(' ')}… killed after ${GIT_TIMEOUT_MS}ms — child never exited`)
}

// strip git's hook-exported env (GIT_DIR etc.) so every call discovers the repo from the filesystem.
export function git(args: string[]): string {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    return execFileSync('git', withBuildLimits(args), { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'], timeout: GIT_TIMEOUT_MS, killSignal: 'SIGKILL' })
  } catch (e: any) { warnIfTimedOut(e, args); throw e }
}

type GitExec = { stdout: string; stderr: string }

// execFile's AbortSignal kills only its direct child. A wedged adapter may have descendants (the
// deterministic tests use a shell + sleep), so async git runs in their own process group and abort/timeout
// kills the whole group. The callback still carries the same stdout/stderr/error shape to gitA/gitTry.
const GIT_MAX_BUFFER = 1 << 24
function execGit(args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal, maxBuffer = GIT_MAX_BUFFER): Promise<GitExec> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof execFile> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let aborted = false
    let timedOut = false
    const killTree = () => {
      if (!child?.pid) return
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* group may already be gone */ }
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }
    const onAbort = () => { aborted = true; killTree() }
    child = execFile('git', args, {
      encoding: 'utf8', env, maxBuffer, detached: true,
      ...(signal ? { signal, killSignal: 'SIGKILL' } : {}),
    } as any, (error: any, stdout: string, stderr: string) => {
      if (timer) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) {
        error.stdout = stdout ?? ''
        error.stderr = stderr ?? ''
        if (aborted) error.name = 'AbortError'
        if (timedOut) error.spexcodeGitTimeout = true
        reject(error)
      } else resolve({ stdout, stderr })
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { timedOut = true; killTree() }, GIT_TIMEOUT_MS)
    timer.unref?.()
  })
}

async function execGitForCaller(args: string[], env: NodeJS.ProcessEnv, maxBuffer?: number): Promise<GitExec> {
  const context = inheritedContext()
  if (!context) return execGit(args, env, undefined, maxBuffer)
  const release = await context.permits.acquire(context.signal)
  try {
    return await execGit(withBuildLimits(args), env, context.signal, maxBuffer)
  } finally {
    release()
  }
}

export async function gitA(args: string[]): Promise<string> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  const context = inheritedContext()
  try {
    const { stdout } = await execGitForCaller(args, env)
    return stdout
  } catch (e: any) {
    if (context?.signal.aborted || e?.name === 'AbortError') throw e
    warnIfTimedOut(e, args); return ''
  }
}

// @@@ a read with a byte budget - the fourth call shape, for a caller that needs only a bounded PREFIX of
// a stream. The transport stops the child the moment the budget is exceeded and SAYS SO, so measuring "is
// this stream at least N bytes" costs N bytes instead of the whole walk. Truncation must be its own answer:
// a fail-soft read would report an overflowing stream as EMPTY, which reads as 'small' — the exact
// inversion of the truth. Content-blind by construction: it counts bytes and knows nothing about them.
export type GitPrefix = { text: string; truncated: boolean }
export async function gitPrefixA(args: string[], maxBytes: number): Promise<GitPrefix> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  const context = inheritedContext()
  try {
    const { stdout } = await execGitForCaller(args, env, maxBytes)
    return { text: stdout, truncated: false }
  } catch (e: any) {
    if (context?.signal.aborted || e?.name === 'AbortError') throw e
    if (e?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { text: e.stdout ?? '', truncated: true }
    warnIfTimedOut(e, args)
    return { text: '', truncated: false }
  }
}

export type GitTryFailure = 'exit' | 'spawn' | 'timeout'
export async function gitTry(args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string; failure?: GitTryFailure }> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  const context = inheritedContext()
  try {
    const { stdout, stderr } = await execGitForCaller(args, env)
    return { ok: true, stdout, stderr }
  } catch (e: any) {
    if (context?.signal.aborted || e?.name === 'AbortError') throw e
    warnIfTimedOut(e, args)
    const failure: GitTryFailure = e?.spexcodeGitTimeout ? 'timeout' : typeof e?.code === 'number' ? 'exit' : 'spawn'
    return { ok: false, stdout: e?.stdout ?? '', stderr: e?.stderr ?? String(e?.message ?? e), failure }
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
const indexCache = new Map<string, Promise<HistoryIndex>>()
const indexRoots = new Map<string, string>()
const driftRoots = new Map<string, string>()
const driftIdxCache = new Map<string, Promise<DriftIndex>>()   // HEAD-keyed, referenced by current roots
const INDEX_ROOT_SLOTS = Math.max(4, Number(process.env.SPEXCODE_INDEX_CACHE_ROOTS || 32))

function rootKey(root: string): string { return resolve(root) }

// HEAD identifies the immutable index contents; the root owns which HEAD is still useful. Moving one
// checkout therefore drops its old history immediately, while equal HEADs across live roots still share
// one promise/index. The bounded root map prevents closed/demand-only worktrees from becoming a leak.
function touchRoot(roots: Map<string, string>, cache: Map<string, Promise<unknown>>, root: string, head: string): void {
  const key = rootKey(root)
  const previous = roots.get(key)
  if (previous !== head) {
    roots.set(key, head)
    if (previous && ![...roots.values()].includes(previous)) cache.delete(previous)
  } else {
    roots.delete(key)
    roots.set(key, head)
  }
  while (roots.size > INDEX_ROOT_SLOTS) {
    const oldest = roots.keys().next().value as string | undefined
    if (oldest === undefined) break
    const oldHead = roots.get(oldest)
    roots.delete(oldest)
    if (oldHead && ![...roots.values()].includes(oldHead)) cache.delete(oldHead)
  }
}

function dropFailed(cache: Map<string, Promise<unknown>>, head: string, promise: Promise<unknown>): void {
  if (cache.get(head) !== promise) return
  // A rejected index is never reusable, even when its root still points at that HEAD. The next read must
  // start a fresh walk after a watchdog abort or transient git failure.
  cache.delete(head)
}

export function historyIndex(root: string): Promise<HistoryIndex> {
  const head = headOrEmpty(root)
  if (!head) return buildIndex(root)
  touchRoot(indexRoots, indexCache, root, head)
  const hit = indexCache.get(head)
  if (hit) return hit
  const p = buildIndex(root)
  p.catch(() => { dropFailed(indexCache, head, p) })   // don't pin a failed build
  indexCache.set(head, p)
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
  lazy?: LazyDriftIndex
}
type LazyDriftIndex = {
  root: string
  specNodes: Map<string, Set<string>>
  ackByNode: Map<string, string[]>
  counts: Map<string, number>
  windows: Map<string, string[]>
  rawWindows: Map<string, string[]>
  reachable: Set<string>
}

function lazySpecNode(path: string): string | null {
  const m = path.replaceAll('\\', '/').match(/\/([^/]+)\/spec\.md$/)
  return m?.[1] ?? null
}

function parseLazySpecNodes(out: string): Map<string, Set<string>> {
  const specNodes = new Map<string, Set<string>>()
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const lines = r.split('\n')
    const hash = lines[0].split(US)[0]
    if (!hash) continue
    for (const path of lines.slice(1)) {
      const node = lazySpecNode(path.trim())
      if (!node) continue
      let nodes = specNodes.get(hash)
      if (!nodes) { nodes = new Set(); specNodes.set(hash, nodes) }
      nodes.add(node)
    }
  }
  return specNodes
}

async function buildLazyDriftIndex(root: string): Promise<DriftIndex> {
  // Version commits are the only source of node ownership; ack stamps are empty commits whose subject is
  // stable (`ack: Spec-OK …`). Both walks are tiny compared with the all-files commit graph and retain only
  // the hashes needed to form rev-list exclusions later.
  // Every reading anchor asks reachability against this same immutable HEAD. Read that commit set once as
  // part of the HEAD-keyed drift-index flight; per-reading membership is then a Set lookup, not one
  // merge-base child per anchor. Run the three large-history walks sequentially so index construction itself
  // cannot stack several pack-heavy git processes inside the broader board child budget.
  const reachableResult = await gitTry(['-C', root, 'rev-list', 'HEAD'])
  if (!reachableResult.ok)
    throw new Error(`git rev-list HEAD failed while building lazy reachability: ${reachableResult.stderr.trim() || 'unknown git error'}`)
  const reachable = new Set(reachableResult.stdout.split('\n').map((s) => s.trim()).filter(Boolean))
  const specOut = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only', `--format=${RS}%H`, 'HEAD', '--', '.spec'])
  const ackOut = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '--format=' + RS + '%H' + US + '%s', '--grep=^ack: Spec-OK', 'HEAD'])
  const specNodes = parseLazySpecNodes(specOut)
  const ackByNode = new Map<string, string[]>()
  for (const rec of ackOut.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const [hash, subject = ''] = r.split(US)
    const m = subject.match(/^ack: Spec-OK\s+(.+)$/)
    if (!hash || !m) continue
    for (const node of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const hashes = ackByNode.get(node) ?? []
      hashes.push(hash)
      ackByNode.set(node, hashes)
    }
  }
  return {
    ord: new Map(), parents: new Map(), fileCommits: new Map(), acks: new Map(), specNodes, anc: new Map(),
    lazy: { root, specNodes, ackByNode, counts: new Map(), windows: new Map(), rawWindows: new Map(), reachable },
  }
}
async function buildDriftIndex(root: string): Promise<DriftIndex> {
  // File fan-out, not just commit count, determines the object-graph size: a ten-thousand-commit fixture can
  // still touch millions of paths. The switch asks whether the raw name stream REACHES the byte budget, and
  // that question is settled by the first budget-worth of bytes — so read exactly that prefix and let
  // truncation be the verdict (a stream that overflows the budget is by definition at least that big).
  // Reading the whole stream to measure it made every index build pay a full-history walk, and a stream past
  // the transport's buffer came back EMPTY, flipping the large-history switch off exactly where it matters.
  const probe = await gitPrefixA(['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only', '--format=', 'HEAD'], DRIFT_LAZY_OUTPUT_BYTES)
  if (probe.truncated || probe.text.length >= DRIFT_LAZY_OUTPUT_BYTES) return buildLazyDriftIndex(root)
  const count = Number((await gitA(['-C', root, 'rev-list', '--count', 'HEAD'])).trim())
  if (count >= DRIFT_LAZY_COMMIT_THRESHOLD) return buildLazyDriftIndex(root)
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
  touchRoot(driftRoots, driftIdxCache, root, head)
  const hit = driftIdxCache.get(head)
  if (hit) return hit
  const p = buildDriftIndex(root)
  p.catch(() => { dropFailed(driftIdxCache, head, p) })
  driftIdxCache.set(head, p)
  return p
}

export function historyCacheStats(): { historyHeads: number; driftHeads: number; historyRoots: number; driftRoots: number } {
  return { historyHeads: indexCache.size, driftHeads: driftIdxCache.size, historyRoots: indexRoots.size, driftRoots: driftRoots.size }
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

// The large-history representation keeps one compact HEAD commit-id set and delegates path windows to Git's
// commit graph instead of materializing every commit/file edge as JS Maps. `null` means the anchor is off
// HEAD history; callers retain their existing content-based conservative fallback for that case.
export function commitReachable(idx: DriftIndex, sha: string): boolean {
  if (!idx.lazy) return ancestorsOf(idx, sha) !== undefined
  return idx.lazy.reachable.has(sha)
}

export function pathCommitsSince(idx: DriftIndex, sinceHash: string, path: string): string[] | null {
  if (!idx.lazy) {
    const base = ancestorsOf(idx, sinceHash)
    return base ? (idx.fileCommits.get(path) ?? []).filter((hash) => !inAncestors(idx, base, hash)) : null
  }
  if (!commitReachable(idx, sinceHash)) return null
  const key = `${sinceHash}\0${path}`
  const hit = idx.lazy.rawWindows.get(key)
  if (hit) return hit
  let commits: string[]
  try {
    commits = git(['-C', idx.lazy.root, 'rev-list', `${sinceHash}..HEAD`, '--', path])
      .split('\n').map((s) => s.trim()).filter(Boolean)
  } catch { commits = [] }
  idx.lazy.rawWindows.set(key, commits)
  return commits
}

async function commitReachableAsync(idx: DriftIndex, sha: string): Promise<boolean> {
  if (!idx.lazy) return ancestorsOf(idx, sha) !== undefined
  return idx.lazy.reachable.has(sha)
}

async function pathCommitsSinceAsync(idx: DriftIndex, sinceHash: string, path: string): Promise<string[] | null> {
  if (!idx.lazy) return pathCommitsSince(idx, sinceHash, path)
  if (!await commitReachableAsync(idx, sinceHash)) return null
  const key = `${sinceHash}\0${path}`
  const hit = idx.lazy.rawWindows.get(key)
  if (hit) return hit
  const commits = (await gitA(['-C', idx.lazy.root, 'rev-list', `${sinceHash}..HEAD`, '--', path]))
    .split('\n').map((s) => s.trim()).filter(Boolean)
  idx.lazy.rawWindows.set(key, commits)
  return commits
}

// Prime the lazy representation through async Git before a synchronous freshness verdict reads it. The
// verdict functions remain pure/cache-backed while production HTTP keeps accepting work during child I/O.
export async function primeLazyPathWindows(idx: DriftIndex, sinceHash: string, paths: string[]): Promise<boolean> {
  if (!idx.lazy) return true
  if (!await commitReachableAsync(idx, sinceHash)) return false
  for (const path of new Set(paths)) await pathCommitsSinceAsync(idx, sinceHash, path)
  return true
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
  if (idx.lazy) {
    if (!sinceHash) return 0
    const key = `${sinceHash}\0${path}`
    const hit = idx.lazy.counts.get(key)
    if (hit !== undefined) return hit
    const targets = idx.lazy.specNodes.get(sinceHash) ?? new Set<string>()
    const excludes = [...new Set([...targets].flatMap((node) => idx.lazy!.ackByNode.get(node) ?? []))]
    const args = ['-C', idx.lazy.root, 'rev-list', '--count', `${sinceHash}..HEAD`, ...excludes.map((hash) => `^${hash}`), '--', path]
    let count = 0
    try { count = Number(git(args).trim()) || 0 } catch { count = 0 }
    idx.lazy.counts.set(key, count)
    return count
  }
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

export async function driftForAsync(idx: DriftIndex, sinceHash: string, path: string): Promise<number> {
  if (!idx.lazy) return driftFor(idx, sinceHash, path)
  if (!sinceHash) return 0
  const key = `${sinceHash}\0${path}`
  const hit = idx.lazy.counts.get(key)
  if (hit !== undefined) return hit
  const targets = idx.lazy.specNodes.get(sinceHash) ?? new Set<string>()
  const excludes = [...new Set([...targets].flatMap((node) => idx.lazy!.ackByNode.get(node) ?? []))]
  const args = ['-C', idx.lazy.root, 'rev-list', '--count', `${sinceHash}..HEAD`, ...excludes.map((hash) => `^${hash}`), '--', path]
  const count = Number((await gitA(args)).trim()) || 0
  idx.lazy.counts.set(key, count)
  return count
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

export type ReviewDiffFile = { path: string; oldPath?: string; status: string; additions: number; deletions: number }
const DIFF_STATUS: Record<string, string> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' }
export async function mergeBaseDiff(wtPath: string, mainRef = 'main'): Promise<ReviewDiffFile[]> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  const base = (await run(['merge-base', mainRef, 'HEAD'])).trim()
  if (!base) return []
  const [numstatOut, statusOut] = await Promise.all([
    run(['diff', '--numstat', '-M', `${base}..HEAD`]),
    run(['diff', '--name-status', '-M', `${base}..HEAD`]),
  ])
  const status = new Map<string, { status: string; from: string }>()
  for (const r of parseNameStatus(statusOut)) status.set(r.to, { status: DIFF_STATUS[r.code] ?? r.code, from: r.from })
  const files: ReviewDiffFile[] = []
  for (const line of numstatOut.split('\n')) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
    if (!m) continue
    const { from, to } = parseStatPath(m[3])
    const detail = status.get(to)
    files.push({
      path: to,
      ...(from !== to ? { oldPath: detail?.from ?? from } : {}),
      status: detail?.status ?? 'modified',
      additions: m[1] === '-' ? 0 : +m[1],
      deletions: m[2] === '-' ? 0 : +m[2],
    })
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

// this worktree's spec ops vs main ([[worktree-linker]]): an op must BOTH differ from main's current tip
// (the proposal — the vs-main working diff supplies the op set and each op's TYPE, so merge terms are
// spoken: content equal to main is no op, an existing node reads `edited` never `added`) AND have been
// touched by this branch since its fork point (attribution — main's own post-fork movement is not this
// worktree's op). A `status --porcelain` pass adds untracked spec.md, a third diff vs HEAD marks committed.
export async function worktreeSpecDelta(wtPath: string, mainRef: string, baseHint?: string): Promise<NodeOp[]> {
  const run = (args: string[]) => gitA(['-C', wtPath, '-c', 'core.quotePath=false', ...args])
  // fork point = where this worktree branched from main; '' (no common ancestor / unreadable ref) falls
  // back to mainRef so we still surface changes rather than going silent. The caller (cachedDelta) already
  // computes this same merge-base to key its cache, so it passes it in to avoid a redundant subprocess.
  const base = baseHint || (await run(['merge-base', mainRef, 'HEAD'])).trim() || mainRef
  // the four queries are independent — run them in parallel.
  const [mainOut, workOut, commOut, statusOut] = await Promise.all([
    run(['diff', '--name-status', '-M', mainRef, '--', '.spec']),
    run(['diff', '--name-status', '-M', base, '--', '.spec']),
    run(['diff', '--name-status', '-M', `${base}...HEAD`, '--', '.spec']),
    run(['status', '--porcelain', '--untracked-files=all', '--', '.spec']),
  ])
  const proposals = parseNameStatus(mainOut)
  // the branch's own footprint since its fork point — both sides of every row, so a rename matches
  // whichever side the vs-main diff names.
  const touched = new Set<string>()
  for (const r of parseNameStatus(workOut)) { touched.add(r.to); if (r.from) touched.add(r.from) }
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
  for (const r of proposals) {
    const path = r.code === 'D' ? r.from : r.to
    if (!isSpecMd(path)) continue
    if (!touched.has(r.to) && !touched.has(r.from)) continue   // main moved it, not this branch → no op
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
