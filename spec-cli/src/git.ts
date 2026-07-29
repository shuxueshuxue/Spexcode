import { execFileSync, execFile, spawn } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, rmSync, renameSync, openSync, closeSync } from 'node:fs'
import { join, isAbsolute, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { projectRuntimeRoot } from './project-store.js'

const US = '\x1f', RS = '\x1e'

// @@@ bounded graph git children - a git child that never exits (wedged fs, a hijacked PATH git, a dead
// network mount) must not pin its awaiter forever: [[graph-cache]]'s settle guarantee starts at this seam.
// Every shared helper passes a generous timeout with SIGKILL. A graph build additionally carries one fixed
// permit pool through AsyncLocalStorage, so corpus-wide Promise.all fanout queues here before spawn rather
// than materializing one process per worktree/eval. Calls outside that build context remain unconstrained.
const GIT_TIMEOUT_MS = Number(process.env.SPEXCODE_GIT_TIMEOUT_MS || 120000)
export const BOARD_GIT_CONCURRENCY = 4
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

function gitBuffer(args: string[], input?: string): Buffer {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try {
    return execFileSync('git', withBuildLimits(args), {
      input,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 1 << 27,
    })
  } catch (e: any) { warnIfTimedOut(e, args); throw e }
}

export type GitObjectFormat = 'sha1' | 'sha256'
const gitObjectFormatMemo = new Map<string, GitObjectFormat>()
export function gitObjectFormat(root: string): GitObjectFormat {
  const key = rootKey(root)
  const hit = gitObjectFormatMemo.get(key)
  if (hit) return hit
  const format = git(['-C', root, 'rev-parse', '--show-object-format=storage']).trim()
  if (format !== 'sha1' && format !== 'sha256') throw new Error(`unsupported Git object format '${format || 'empty'}' at ${root}`)
  gitObjectFormatMemo.set(key, format)
  return format
}
export function isGitObjectId(root: string, value: string): boolean {
  const length = gitObjectFormat(root) === 'sha256' ? 64 : 40
  return value.length === length && /^[0-9a-f]+$/.test(value)
}

// Batch immutable object lookups used by the shared anchor/index path. Git accepts revision:path queries on
// batch-check, so dozens of rev-parse + cat-file children collapse into two bounded processes without
// changing the returned bytes or object ids.
export function batchRevisionOids(root: string, revisions: string[]): (string | null)[] {
  if (!revisions.length) return []
  const out = gitBuffer(['-C', root, 'cat-file', '--batch-check=%(objectname)'], revisions.join('\n') + '\n').toString('utf8')
  const lines = out.split('\n')
  if (lines.length - 1 !== revisions.length) throw new Error(`git cat-file --batch-check returned ${lines.length - 1} rows for ${revisions.length} revisions`)
  return revisions.map((revision, index) => {
    const value = lines[index].trim()
    if (isGitObjectId(root, value)) return value
    if (value === `${revision} missing`) return null
    throw new Error(`git cat-file --batch-check returned '${value}' for ${revision}`)
  })
}
export function batchBlobTexts(root: string, oids: string[]): Map<string, string> {
  const unique = [...new Set(oids.filter(Boolean))]
  const files = new Map<string, string>()
  if (!unique.length) return files
  for (const oid of unique) if (!isGitObjectId(root, oid)) throw new Error(`invalid object id '${oid}'`)
  const out = gitBuffer(['-C', root, 'cat-file', '--batch'], unique.join('\n') + '\n')
  let offset = 0
  for (const oid of unique) {
    const newline = out.indexOf(10, offset)
    if (newline < 0) throw new Error(`git cat-file --batch ended before ${oid}`)
    const header = out.subarray(offset, newline).toString('utf8')
    const size = Number(header.match(/ blob (\d+)$/)?.[1])
    if (!header.startsWith(`${oid} blob `) || !Number.isFinite(size)) throw new Error(`git cat-file --batch returned '${header}' for ${oid}`) // dead-words-ok: Git object protocol type
    const start = newline + 1, end = start + size
    if (end >= out.length || out[end] !== 0x0a) throw new Error(`git cat-file --batch truncated object ${oid}`)
    files.set(oid, out.subarray(start, end).toString('utf8'))
    offset = end + 1
  }
  if (offset !== out.length) throw new Error(`git cat-file --batch returned ${out.length - offset} unexpected trailing bytes`)
  return files
}

type TreeBlob = { oid: string; path: string }
function treeBlobs(root: string, tip: string, pathspec = '.'): TreeBlob[] {
  const out = git(['-C', root, '-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', tip, '--', pathspec])
  const blobs: TreeBlob[] = []
  for (const record of out.split('\0')) {
    if (!record) continue
    const m = record.match(/^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/)
    if (m) blobs.push({ oid: m[1], path: m[2] })
  }
  return blobs
}

// Read a tree slice in two Git calls regardless of file count: ls-tree names immutable blob oids, then
// cat-file --batch returns their exact bytes. Pending lint uses this for .spec so commit --only/partial
// staging can never be judged through unrelated working-tree prose.
export function treeTextFiles(root: string, tip: string, pathspec = '.'): Map<string, string> {
  const blobs = treeBlobs(root, tip, pathspec)
  const files = new Map<string, string>()
  if (!blobs.length) return files
  const out = gitBuffer(['-C', root, 'cat-file', '--batch'], blobs.map((b) => b.oid).join('\n') + '\n')
  let offset = 0
  for (const blob of blobs) {
    const newline = out.indexOf(10, offset)
    if (newline < 0) throw new Error(`git cat-file --batch ended before ${blob.path}`)
    const header = out.subarray(offset, newline).toString('utf8')
    const size = Number(header.match(/ blob (\d+)$/)?.[1])
    if (!Number.isFinite(size)) throw new Error(`git cat-file --batch returned '${header}' for ${blob.path}`)
    const start = newline + 1, end = start + size
    files.set(blob.path, out.subarray(start, end).toString('utf8'))
    offset = end + 1 // one LF follows each payload
  }
  return files
}

export function treeFilePaths(root: string, tip: string): Set<string> {
  return new Set(treeBlobs(root, tip).map((b) => b.path))
}

export function treeFileText(root: string, tip: string, path: string): string | null {
  try { return gitBuffer(['-C', root, 'cat-file', 'blob', `${tip}:${path}`]).toString('utf8') } // dead-words-ok: git plumbing
  catch { return null }
}

type GitExec = { stdout: string; stderr: string }

// execFile's AbortSignal kills only its direct child. A wedged adapter may have descendants (the
// deterministic tests use a shell + sleep), so async git runs in their own process group and abort/timeout
// kills the whole group. The callback still carries the same stdout/stderr/error shape to gitA/gitTry.
const GIT_MAX_BUFFER = 1 << 24
function execGit(args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal, maxBuffer = GIT_MAX_BUFFER): Promise<GitExec> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(gitAbortError()); return }
    const child = spawn('git', args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let stdoutBytes = 0, stderrBytes = 0, aborted = false, timedOut = false, overflow = false
    let spawnError: Error | null = null
    const killTree = () => {
      if (!child.pid) return
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* group may already be gone */ }
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }
    const onAbort = () => { aborted = true; killTree() }
    const append = (chunks: Buffer[], chunk: Buffer, stream: 'stdout' | 'stderr') => {
      const total = stream === 'stdout' ? (stdoutBytes += chunk.length) : (stderrBytes += chunk.length)
      if (total > maxBuffer) { overflow = true; killTree(); return }
      chunks.push(chunk)
    }
    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk, 'stderr'))
    child.once('error', (error) => { spawnError = error })
    child.once('close', (code, childSignal) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const result = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
      if (code === 0 && !aborted && !timedOut && !overflow && !spawnError) { resolve(result); return }
      const error: any = spawnError ?? new Error(overflow
        ? `git output exceeded ${maxBuffer} bytes`
        : `git exited with ${code ?? childSignal ?? 'unknown status'}`)
      error.code = overflow ? 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' : code
      error.signal = childSignal
      error.stdout = result.stdout
      error.stderr = result.stderr
      if (aborted) error.name = 'AbortError'
      if (timedOut) error.spexcodeGitTimeout = true
      reject(error)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    const timer = setTimeout(() => { timedOut = true; killTree() }, GIT_TIMEOUT_MS)
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

// Event streams are the index input itself and may legitimately exceed execFile's fixed maxBuffer. Read
// them through spawn so the only bound is the index the caller is intentionally constructing; timeout,
// cancellation, process-group cleanup and build permits remain identical to the ordinary async transport.
function execGitStream(args: string[], env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<GitExec> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(gitAbortError()); return }
    const child = spawn('git', args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    let settled = false, aborted = false, timedOut = false
    const killTree = () => {
      if (!child.pid) return
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* group may already be gone */ }
      try { child.kill('SIGKILL') } catch { /* already exited */ }
    }
    const onAbort = () => { aborted = true; killTree() }
    const timer = setTimeout(() => { timedOut = true; killTree() }, GIT_TIMEOUT_MS)
    timer.unref?.()
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', (error: any) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      if (aborted) error.name = 'AbortError'
      if (timedOut) error.spexcodeGitTimeout = true
      reject(error)
    })
    child.on('close', (code, childSignal) => {
      if (settled) return
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort)
      const result = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') }
      if (code === 0 && !aborted && !timedOut) { resolve(result); return }
      const error: any = new Error(`git exited with ${code ?? childSignal ?? 'unknown status'}`)
      error.code = code
      error.signal = childSignal
      error.stdout = result.stdout
      error.stderr = result.stderr
      if (aborted) error.name = 'AbortError'
      if (timedOut) error.spexcodeGitTimeout = true
      reject(error)
    })
  })
}
async function execGitStreamForCaller(args: string[], env: NodeJS.ProcessEnv): Promise<GitExec> {
  const context = inheritedContext()
  if (!context) return execGitStream(args, env)
  const release = await context.permits.acquire(context.signal)
  try { return await execGitStream(withBuildLimits(args), env, context.signal) }
  finally { release() }
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

type EventRecord = { hash: string; raw: string }
type EventCache = { streams: Map<EventStreamKind, Map<string, EventRecord>>; streamTips: Map<EventStreamKind, string[]> }
const EVENT_CACHE_SCHEMA = 'history-events-v7'
const EVENT_STREAM_KINDS = ['numstat', 'merge', 'drift-numstat'] as const
type EventStreamKind = typeof EVENT_STREAM_KINDS[number]
type EventCacheLocation = { path: string; identity: string; objectFormat: GitObjectFormat }
type EventLedgerSnapshot = {
  payload: Buffer
  state: EventCache
}
type EventStreamRequest = {
  kind: EventStreamKind
  argsFor: (base: string) => string[]
  order: Map<string, number>
  reachable: Set<string>
}

type EventPathMemo = EventCacheLocation & {
  common: string; shallowPath: string; grafts: string; shallow: string
  replacementStorage: string; replacements: string
}
const eventPathMemo = new Map<string, EventPathMemo>()
function replacementStorageIdentity(common: string): string {
  const hash = createHash('sha256')
  const addTree = (root: string, rel: string) => {
    if (!existsSync(root)) return
    const stack = [{ dir: root, rel }]
    while (stack.length) {
      const current = stack.pop()!
      const entries = readdirSync(current.dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
      for (const entry of entries) {
        const path = join(current.dir, entry.name)
        const name = `${current.rel}/${entry.name}`
        if (entry.isDirectory()) stack.push({ dir: path, rel: name })
        else hash.update(`\0${name}\0`).update(readFileSync(path))
      }
    }
  }
  addTree(join(common, 'refs', 'replace'), 'refs/replace')
  for (const name of ['packed-refs']) {
    const path = join(common, name)
    if (existsSync(path)) hash.update(`\0${name}\0`).update(readFileSync(path))
  }
  // Reftable is opaque here by design: its bytes are only an invalidation signal. Git remains the one
  // parser and supplies the canonical refs/replace targets when those bytes change.
  addTree(join(common, 'reftable'), 'reftable')
  return hash.digest('hex')
}
function eventCacheLocation(root: string): EventCacheLocation {
  const rootId = rootKey(root), old = eventPathMemo.get(rootId)
  const common = old?.common ?? git(['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  const shallowPath = old?.shallowPath ?? git(['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', 'shallow']).trim()
  const shallow = existsSync(shallowPath) ? readFileSync(shallowPath, 'utf8') : 'unshallow'
  const graftsPath = join(common, 'info', 'grafts')
  const grafts = existsSync(graftsPath) ? readFileSync(graftsPath, 'utf8') : ''
  const replacementStorage = replacementStorageIdentity(common)
  const replacements = old?.replacementStorage === replacementStorage
    ? old.replacements
    : git(['-C', root, 'for-each-ref', 'refs/replace', '--format=%(refname) %(objectname)'])
  const objectFormat = gitObjectFormat(root)
  if (old && old.shallow === shallow && old.grafts === grafts && old.replacements === replacements && old.objectFormat === objectFormat)
    return { path: old.path, identity: old.identity, objectFormat }
  const identity = createHash('sha256')
    .update(`${EVENT_CACHE_SCHEMA}\0${objectFormat}\0${shallow}\0${grafts}\0${replacements}`)
    .digest('hex').slice(0, 16)
  // projectRuntimeRoot derives checkout identity from dirname(common). A bare repository is its own common
  // dir, so a synthetic `.git` suffix preserves the repository path instead of collapsing sibling bares.
  const gitDir = gitDirOf(root)
  const storeIdentity = gitDir === root && common === root ? join(common, '.git') : common
  const path = join(projectRuntimeRoot(storeIdentity), `${EVENT_CACHE_SCHEMA}-${identity}.ndjson`)
  eventPathMemo.set(rootId, { common, shallowPath, grafts, shallow, replacementStorage, replacements, path, identity, objectFormat })
  return { path, identity, objectFormat }
}
function emptyEventCache(): EventCache {
  return { streams: new Map(), streamTips: new Map() }
}
function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}
function isGitObjectIdForFormat(format: GitObjectFormat, value: string): boolean {
  return value.length === (format === 'sha256' ? 64 : 40) && /^[0-9a-f]+$/.test(value)
}
function eventPayloadDigest(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}
function eventIntegrityFooter(payload: Buffer, addition: Buffer): Buffer {
  const footer = {
    k: 'integrity',
    bytes: payload.length + addition.length,
    sha256: createHash('sha256').update(payload).update(addition).digest('hex'),
  }
  return Buffer.from(`${JSON.stringify(footer)}\n`)
}
function eventStreamKind(value: unknown): EventStreamKind | null {
  return typeof value === 'string' && (EVENT_STREAM_KINDS as readonly string[]).includes(value)
    ? value as EventStreamKind
    : null
}
function decodeEventPayload(payload: Buffer, location: EventCacheLocation): EventCache | null {
  const state = emptyEventCache()
  const text = payload.toString('utf8')
  for (let start = 0; start < text.length;) {
    const newline = text.indexOf('\n', start)
    const end = newline < 0 ? text.length : newline
    const line = text.slice(start, end)
    start = end + 1
    if (!line) continue
    let value: unknown
    try { value = JSON.parse(line) } catch { return null }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const row = value as Record<string, unknown>
    if (exactKeys(row, ['k', 'tip'])) {
      const kind = typeof row.k === 'string' && row.k.startsWith('tip:') ? eventStreamKind(row.k.slice(4)) : null
      if (!kind || typeof row.tip !== 'string' || !isGitObjectIdForFormat(location.objectFormat, row.tip)) return null
      const tips = state.streamTips.get(kind) ?? []
      if (tips.includes(row.tip)) return null
      tips.push(row.tip)
      state.streamTips.set(kind, tips)
      continue
    }
    const kind = eventStreamKind(row.k)
    if (!exactKeys(row, ['h', 'k', 'r']) || !kind
      || typeof row.h !== 'string' || !isGitObjectIdForFormat(location.objectFormat, row.h)
      || typeof row.r !== 'string' || !row.r) return null
    const rawHash = row.r.split(US, 1)[0].split('\n', 1)[0].trim()
    if (rawHash !== row.h) return null
    let stream = state.streams.get(kind)
    if (!stream) { stream = new Map(); state.streams.set(kind, stream) }
    if (stream.has(row.h)) return null
    stream.set(row.h, { hash: row.h, raw: row.r })
  }
  return state
}
function loadEventLedger(location: EventCacheLocation): EventLedgerSnapshot {
  let file: Buffer
  try { file = readFileSync(location.path) }
  catch (error: any) {
    if (error?.code !== 'ENOENT') throw error
    return { payload: Buffer.alloc(0), state: emptyEventCache() }
  }
  if (!file.length || file[file.length - 1] !== 0x0a)
    return { payload: Buffer.alloc(0), state: emptyEventCache() }
  const body = file.subarray(0, file.length - 1)
  const footerBreak = body.lastIndexOf(0x0a)
  const footerStart = footerBreak + 1
  const payload = file.subarray(0, footerStart)
  try {
    const value = JSON.parse(body.subarray(footerStart).toString('utf8')) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid integrity row')
    const row = value as Record<string, unknown>
    if (!exactKeys(row, ['bytes', 'k', 'sha256']) || row.k !== 'integrity' || row.bytes !== payload.length
      || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)
      || row.sha256 !== eventPayloadDigest(payload)) throw new Error('invalid integrity row')
    const state = decodeEventPayload(payload, location)
    if (!state) throw new Error('invalid event row')
    return { payload, state }
  } catch {
    return { payload: Buffer.alloc(0), state: emptyEventCache() }
  }
}

type EventLockOwner = { pid: number; token: string }
function readEventLockOwner(lock: string): EventLockOwner | null {
  try {
    const value = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as { pid?: unknown; token?: unknown }
    return Number.isInteger(value.pid) && (value.pid as number) > 0 && typeof value.token === 'string'
      ? { pid: value.pid as number, token: value.token }
      : null
  } catch { return null }
}
function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (error: any) { return error?.code !== 'ESRCH' }
}
function retireLockPath(active: string): boolean {
  const inert = `${active}.inert.${process.pid}.${randomBytes(8).toString('hex')}`
  try { renameSync(active, inert) }
  catch (error: any) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
  try { rmSync(inert, { recursive: true, force: true }) } catch { /* no longer arbitrates ownership */ }
  return true
}
function reclaimDeadEventLock(lock: string, held: EventLockOwner, claimant: EventLockOwner): boolean {
  if (processAlive(held.pid)) return false
  const reclaim = join(lock, 'reclaim')
  if (existsSync(reclaim)) {
    const reclaimer = readEventLockOwner(reclaim)
    if (!reclaimer || processAlive(reclaimer.pid)) return false
    retireLockPath(reclaim)
  }
  const prepared = join(lock, `reclaim-${claimant.pid}-${claimant.token}`)
  try {
    mkdirSync(prepared)
    writeFileSync(join(prepared, 'owner.json'), JSON.stringify(claimant))
    renameSync(prepared, reclaim)
  } catch (error: any) {
    rmSync(prepared, { recursive: true, force: true })
    if (error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY' || error?.code === 'ENOENT') return false
    throw error
  }
  const current = readEventLockOwner(lock)
  if (current?.pid !== held.pid || current.token !== held.token || processAlive(current.pid)) {
    retireLockPath(reclaim)
    return false
  }
  return retireLockPath(lock)
}
async function withEventCacheLock<T>(path: string, run: () => Promise<T> | T): Promise<T> {
  const lock = `${path}.lock`
  mkdirSync(join(path, '..'), { recursive: true })
  const owner: EventLockOwner = { pid: process.pid, token: randomBytes(16).toString('hex') }
  const attempts = Math.max(1, Math.ceil(GIT_TIMEOUT_MS / 5))
  const signal = inheritedContext()?.signal
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw gitAbortError()
    const claimant = `${lock}.claim.${owner.pid}.${owner.token}`
    try {
      mkdirSync(claimant)
      writeFileSync(join(claimant, 'owner.json'), JSON.stringify(owner))
      renameSync(claimant, lock)
      break
    } catch (error: any) {
      rmSync(claimant, { recursive: true, force: true })
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error
      const held = readEventLockOwner(lock)
      if (held && reclaimDeadEventLock(lock, held, owner)) continue
      if (attempt >= attempts) {
        const heldBy = readEventLockOwner(lock)?.pid
        throw new Error(`timed out waiting for history event cache lock held by ${heldBy ? `pid ${heldBy}` : 'unknown owner'}: ${path}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  try { return await run() } finally {
    if (readEventLockOwner(lock)?.token === owner.token) retireLockPath(lock)
  }
}
function removeEventTemps(path: string): void {
  const dir = join(path, '..'), base = path.split('/').pop() ?? ''
  try {
    for (const name of readdirSync(dir)) if (name.startsWith(`${base}.`) && name.endsWith('.tmp'))
      rmSync(join(dir, name), { force: true })
  } catch { /* the writer creates the directory immediately below */ }
}
function replaceEventLedger(path: string, payload: Buffer, additions: string[]): void {
  const addition = Buffer.from(additions.join(''))
  const tmp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  let fd: number | null = null
  try {
    fd = openSync(tmp, 'wx', 0o600)
    writeFileSync(fd, payload)
    writeFileSync(fd, addition)
    writeFileSync(fd, eventIntegrityFooter(payload, addition))
    const written = fd; fd = null; closeSync(written)
    renameSync(tmp, path)
  } catch (error) {
    if (fd !== null) closeSync(fd)
    rmSync(tmp, { force: true })
    throw error
  }
}
function renderEventStream(state: EventCache, request: EventStreamRequest): string {
  const stream = state.streams.get(request.kind) ?? new Map<string, EventRecord>()
  return [...stream.values()].filter((record) => request.reachable.has(record.hash)).sort((a, b) => {
    if (request.kind === 'numstat') {
      const ad = Date.parse(a.raw.split(US)[1] ?? ''), bd = Date.parse(b.raw.split(US)[1] ?? '')
      if (Number.isFinite(ad) && Number.isFinite(bd) && ad !== bd) return bd - ad
    }
    return (request.order.get(a.hash) ?? Number.MAX_SAFE_INTEGER) - (request.order.get(b.hash) ?? Number.MAX_SAFE_INTEGER)
  }).map((record) => RS + record.raw).join('')
}
function appendEventRecord(state: EventCache, kind: EventStreamKind, record: EventRecord, additions: string[]): void {
  let stream = state.streams.get(kind)
  if (!stream) { stream = new Map(); state.streams.set(kind, stream) }
  if (stream.has(record.hash)) return
  stream.set(record.hash, record)
  additions.push(JSON.stringify({ k: kind, h: record.hash, r: record.raw }) + '\n')
}
function appendEventTip(state: EventCache, kind: EventStreamKind, tip: string, additions: string[]): void {
  const tips = state.streamTips.get(kind) ?? []
  if (tips.includes(tip)) return
  tips.push(tip)
  state.streamTips.set(kind, tips)
  additions.push(JSON.stringify({ k: `tip:${kind}`, tip }) + '\n')
}
function parseEventRecords(out: string, kind: EventStreamKind, location: EventCacheLocation): EventRecord[] {
  const records: EventRecord[] = []
  for (const rec of out.split(RS)) {
    const raw = rec.replace(/^\n/, '')
    if (!raw) continue
    const hash = raw.split(US, 1)[0].split('\n', 1)[0].trim()
    if (!isGitObjectIdForFormat(location.objectFormat, hash))
      throw new Error(`history event stream '${kind}' returned malformed object id '${hash || 'empty'}'`)
    records.push({ hash, raw })
  }
  return records
}
function indexEventRequests(
  root: string,
  tip: string,
  order: Map<string, number>,
  reachable: Set<string>,
): Record<EventStreamKind, EventStreamRequest> {
  return {
    numstat: {
      kind: 'numstat', order, reachable,
      argsFor: (base) => ['-C', root, '-c', 'core.quotePath=false',
        'log', '--full-history', '--date-order', '--no-diff-merges', '-M', '--numstat',
        `--format=${RS}%H${US}%aI${US}%s${US}%b`, ...(base ? [`^${base}`] : []), tip, '--', '.spec'],
    },
    'drift-numstat': {
      kind: 'drift-numstat', order, reachable,
      argsFor: (base) => ['-C', root, '-c', 'core.quotePath=false',
        'log', '--full-history', '--date-order', '--no-diff-merges', '-M', '--numstat',
        `--format=${RS}%H${US}%P${US}%T${US}%(trailers:key=Spec-OK,valueonly,separator=%x2C)`,
        ...(base ? [`^${base}`] : []), tip],
    },
    merge: {
      kind: 'merge', order, reachable,
      argsFor: (base) => ['-C', root, '-c', 'core.quotePath=false',
        'log', '--merges', '--raw', '--patch', '--cc', '--combined-all-paths', '--unified=0', '--no-color', '--no-ext-diff', '-M',
        `--format=${RS}%H`, ...(base ? [`^${base}`] : []), tip],
    },
  }
}

async function strictEventGit(args: string[]): Promise<string> {
  return gitRequiredA(args, 'cannot derive history events')
}
async function deriveEventStreams(
  root: string,
  tip: string,
  requests: EventStreamRequest[],
  persist = true,
  cache = true,
): Promise<Map<EventStreamKind, string>> {
  if (!cache) {
    const outputs = await Promise.all(requests.map((request) => strictEventGit(request.argsFor(''))))
    return new Map(requests.map((request, index) => [request.kind, outputs[index]]))
  }
  if (new Set(requests.map((request) => request.kind)).size !== requests.length)
    throw new Error('one event-ledger transaction cannot request the same stream twice')

  const run = async (location: EventCacheLocation): Promise<Map<EventStreamKind, string> | null> => {
    const snapshot = loadEventLedger(location)
    const missing = requests.filter((request) => !(snapshot.state.streamTips.get(request.kind) ?? []).includes(tip))
    const outputs = await Promise.all(missing.map((request) => {
      const base = [...(snapshot.state.streamTips.get(request.kind) ?? [])].reverse()
        .find((candidate) => request.reachable.has(candidate)) ?? ''
      return strictEventGit(request.argsFor(base))
    }))
    if (eventCacheLocation(root).identity !== location.identity) return null

    const additions: string[] = []
    for (let index = 0; index < missing.length; index++) {
      const request = missing[index]
      for (const record of parseEventRecords(outputs[index], request.kind, location))
        appendEventRecord(snapshot.state, request.kind, record, additions)
      if (persist) appendEventTip(snapshot.state, request.kind, tip, additions)
    }
    if (persist && additions.length) {
      removeEventTemps(location.path)
      mkdirSync(join(location.path, '..'), { recursive: true })
      replaceEventLedger(location.path, snapshot.payload, additions)
    }
    return new Map(requests.map((request) => [request.kind, renderEventStream(snapshot.state, request)]))
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const location = eventCacheLocation(root)
    const result = persist ? await withEventCacheLock(location.path, () => run(location)) : await run(location)
    if (result) return result
  }
  throw new Error(`history event cache identity changed repeatedly while deriving ${tip}`)
}
async function eventStream(
  root: string,
  tip: string,
  request: EventStreamRequest,
  persist = true,
  cache = true,
): Promise<string> {
  return (await deriveEventStreams(root, tip, [request], persist, cache)).get(request.kind) ?? ''
}
export type GitTryFailure = 'exit' | 'spawn' | 'timeout'
export async function gitTry(args: string[], options: { indexFile?: string } = {}): Promise<{ ok: boolean; stdout: string; stderr: string; failure?: GitTryFailure }> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  if (options.indexFile) env.GIT_INDEX_FILE = options.indexFile
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

export async function gitRequiredA(args: string[], purpose: string): Promise<string> {
  const env = { ...process.env }
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
  try { return (await execGitStreamForCaller(args, env)).stdout }
  catch (error: any) {
    if (error?.name === 'AbortError') throw error
    warnIfTimedOut(error, args)
    throw new Error(`${purpose}: git ${args.slice(2).join(' ')} failed: ${String(error?.stderr || error?.message || 'unknown git error').trim()}`)
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
  if (!existsSync(dotgit)) {
    try {
      if (git(['-C', root, 'rev-parse', '--is-bare-repository']).trim() === 'true') return root
    } catch { /* the caller will receive the same loud path error as a malformed checkout */ }
    throw new Error(`headSha: no .git directory at ${dotgit}`)
  }
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
  mergeVersions?: Set<string>               // path\0hash pairs with an all-parent combined-diff line
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
// remark posts) under load. So the cache is a small LRU keyed by interpretation identity + HEAD, holding
// the in-flight PROMISE so concurrent requests for one immutable view share a single build.
const indexCache = new Map<string, Promise<HistoryIndex>>()
const indexRoots = new Map<string, string>()
const driftRoots = new Map<string, string>()
const driftIdxCache = new Map<string, Promise<DriftIndex>>()
const INDEX_ROOT_SLOTS = Math.max(4, Number(process.env.SPEXCODE_INDEX_CACHE_ROOTS || 32))

function rootKey(root: string): string { return resolve(root) }

function gitInterpretationKey(root: string): string { return eventCacheLocation(root).identity }

// HEAD plus Git's object-interpretation state identifies the immutable index contents; the root owns which
// view is still useful. Moving a checkout or changing replace/shallow/graft state drops its old history,
// while equal views across live roots share one promise. The root bound keeps closed worktrees from leaking.
function touchRoot(roots: Map<string, string>, cache: Map<string, Promise<unknown>>, root: string, cacheKey: string): void {
  const key = rootKey(root)
  const previous = roots.get(key)
  if (previous !== cacheKey) {
    roots.set(key, cacheKey)
    if (previous && ![...roots.values()].includes(previous)) cache.delete(previous)
  } else {
    roots.delete(key)
    roots.set(key, cacheKey)
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

function pendingOnlyIssues(root: string, tip: string): boolean {
  try {
    const parents = git(['-C', root, 'rev-list', '--parents', '-n1', tip]).trim().split(/\s+/).filter(Boolean)
    // A first-parent issue diff can hide side-branch code debt in an ours merge. Only a single-parent
    // candidate may reuse its parent's indexes; every merge must build the candidate's full reachable view.
    if (parents.length !== 2) return false
    const parent = git(['-C', root, 'rev-parse', `${tip}^`]).trim()
    const paths = git(['-C', root, 'diff-tree', '--no-commit-id', '--name-only', '-r', parent, tip])
      .split('\n').map((p) => p.trim()).filter(Boolean)
    return paths.length > 0 && paths.every((p) => p.startsWith('.spec/.issues/'))
  } catch { return false }
}
function pendingParent(root: string, tip: string): string | null {
  try {
    const parent = git(['-C', root, 'rev-parse', `${tip}^`]).trim()
    return isGitObjectId(root, parent) ? parent : null
  } catch { return null }
}

export function historyIndex(root: string, tip = 'HEAD'): Promise<HistoryIndex> {
  if (tip !== 'HEAD') {
    const resolved = git(['-C', root, 'rev-parse', `${tip}^{commit}`]).trim()
    // An issue-only candidate changes no governed content, but its lint result still includes the
    // parent's existing drift/related-drift warnings. Reuse that immutable parent index instead of
    // manufacturing an empty one (which silently dropped warnings at golden depths).
    if (pendingOnlyIssues(root, resolved)) {
      const parent = pendingParent(root, resolved)
      if (parent) {
        const head = headOrEmpty(root)
        if (head === parent) return historyIndex(root)
        return buildIndex(root, parent, true, true)
      }
    }
    return buildIndex(root, resolved, true, true)
  }
  const head = headOrEmpty(root)
  if (!head) return buildIndex(root, 'HEAD', false, true)
  const cacheKey = `${rootKey(root)}\0${head}\0${gitInterpretationKey(root)}`
  touchRoot(indexRoots, indexCache, root, cacheKey)
  const hit = indexCache.get(cacheKey)
  if (hit) return hit
  const p = buildIndex(root, head.startsWith('unborn:') ? 'HEAD' : head, false, true)
  p.catch(() => { dropFailed(indexCache, cacheKey, p) })   // don't pin a failed build
  indexCache.set(cacheKey, p)
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

// @@@ reachability memoized on the rename side, never the event side - every comparison the projector makes
// has a RENAME commit on one end, and a history holds far fewer renames than file events. Keying the memo on
// the OTHER end rebuilds a history-wide ancestor set per distinct event commit: 2.3M parent-edge visits and
// 1,219 retained bitsets served 9k one-bit questions on this repository. That end builds one closure per
// distinct event commit actually compared against a rename — C of them, O(C(H+G)) construction and Θ(CH) bits
// — which a linear history whose events all sit on one renamed path drives to Θ(H²). Asking the rename end
// instead — its descendants when it is the older commit, its ancestors when it is the newer one — moves ONLY
// the closure term onto the rename count K: at most 2K full-size closures, O(K(H+G)) construction over H
// reachable commits and G parent edges, O(KH) bits. That 2K ceiling bounds closure buffers, count and bytes,
// against C; it does NOT bound runtime or edge visits, since a rename with many unrelated descendants
// traverses ground the event-side ancestor walk never touched. The projector's own work is unchanged and is
// NOT covered by that term: one scan of the N events, plus a lineage walk whose frontier compares each step's
// applicable renames pairwise — Σ d(candidate)² O(1) queries, worst case Θ(NK²) when one path carries K
// mutually incomparable renames. So: no linear-in-history promise — the closure term is quadratic once K
// approaches H, and the untouched frontier term is cubic when N, K and H grow together. It is also why a
// reachability matrix over the rename commits is not worth it: same O(KH) bits, but eagerly.
function renameSideReachability(
  renameCommits: Set<string>,
  topology: TopologyProjection,
): (older: string, newer: string) => boolean {
  const { order, parents } = topology
  const size = (order.size + 7) >> 3
  let childEdges: Map<string, string[]> | null = null
  const children = (): Map<string, string[]> => {
    if (childEdges) return childEdges
    childEdges = new Map()
    for (const [hash] of order) for (const parent of parents.get(hash) ?? []) {
      if (!order.has(parent)) continue // shallow boundary: an unwalked parent ends the chain
      const kids = childEdges.get(parent)
      if (kids) kids.push(hash)
      else childEdges.set(parent, [hash])
    }
    return childEdges
  }
  const closure = (start: string, edges: Map<string, string[]>, memo: Map<string, Uint8Array>): Uint8Array => {
    const hit = memo.get(start)
    if (hit) return hit
    const bits = new Uint8Array(size)
    const at = order.get(start)!
    bits[at >> 3] |= 1 << (at & 7)
    const stack = [start]
    while (stack.length) for (const next of edges.get(stack.pop()!) ?? []) {
      const position = order.get(next)
      if (position === undefined) continue
      const mask = 1 << (position & 7)
      if (bits[position >> 3] & mask) continue
      bits[position >> 3] |= mask
      stack.push(next)
    }
    memo.set(start, bits)
    return bits
  }
  const ancestors = new Map<string, Uint8Array>(), descendants = new Map<string, Uint8Array>()
  return (older, newer) => {
    const from = order.get(older), to = order.get(newer)
    if (from === undefined || to === undefined)
      throw new Error(`rename projection cannot place ${older} against ${newer} in the current topology`)
    // Whichever end is the rename owns the closure; the projector always puts one there.
    return renameCommits.has(older)
      ? (closure(older, children(), descendants)[to >> 3] & (1 << (to & 7))) !== 0
      : (closure(newer, parents, ancestors)[from >> 3] & (1 << (from & 7))) !== 0
  }
}

type RenameProjectionEvent = { hash: string; to: string }
function canonicalPathProjector(
  renamesByFrom: Map<string, RenameProjectionEvent[]>,
  topology: TopologyProjection,
): (path: string, event: string) => string[] {
  const renameCommits = new Set<string>()
  for (const renames of renamesByFrom.values()) for (const rename of renames) renameCommits.add(rename.hash)
  const precedes = renameSideReachability(renameCommits, topology)
  return (path, event) => {
    // A path no rename ever left keeps its own identity at every event; there is no lineage to walk.
    if (!renamesByFrom.has(path)) return [path]
    const pending = [path], resolved = new Set<string>(), seen = new Set<string>()
    while (pending.length) {
      const candidate = pending.pop()!
      if (seen.has(candidate)) { resolved.add(candidate); continue }
      seen.add(candidate)
      const unique = new Map<string, RenameProjectionEvent>()
      for (const rename of renamesByFrom.get(candidate) ?? []) {
        if (!precedes(rename.hash, event)) unique.set(`${rename.hash}\0${rename.to}`, rename)
      }
      const applicable = [...unique.values()]
      if (!applicable.length) { resolved.add(candidate); continue }
      // The earliest applicable rename starts this path's next lineage epoch. Later renames from the same
      // path belong to a recreated path, not to an event that predates the first boundary. Incomparable
      // rename branches are both frontier members, so their identities still fork at the merge. A merge can
      // expose the same rename once per parent; equal-commit rows are peers, never ancestors of one another.
      const frontier = applicable.filter((rename, index) =>
        !applicable.some((other, otherIndex) => otherIndex !== index
          && other.hash !== rename.hash && precedes(other.hash, rename.hash)))
      if (frontier.some((rename) => !precedes(event, rename.hash))) resolved.add(candidate)
      for (const rename of frontier) pending.push(rename.to)
    }
    return [...resolved]
  }
}

type SharedIndexInputs = {
  allPaths: Set<string>
  specPaths: Set<string>
  topology: TopologyProjection
  historyOut: string
  driftOut: string
  mergeIndex: MergeHistoryEvents
}

type TopologyProjection = {
  order: Map<string, number>
  parents: Map<string, string[]>
  reachable: Set<string>
}

async function buildIndex(root: string, tip: string, transient: boolean, useCache = true, shared?: SharedIndexInputs): Promise<HistoryIndex> {
  const versions = new Map<string, Version[]>()
  const stats = new Map<string, Map<string, DiffStat>>()
  const mergeVersions = new Set<string>()
  const commitVersions = new Map<string, Version>()
  const commitOrder = new Map<string, number>()
  const rawVersions = new Map<string, Version[]>()
  const rawStats = new Map<string, Map<string, DiffStat>>()
  let currentPaths: Set<string>
  let topology: TopologyProjection
  if (shared) {
    currentPaths = shared.specPaths
    topology = shared.topology
  } else {
    const [tipPathsOut, topologyOut] = await Promise.all([
      strictEventGit(['-C', root, '-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', tip, '--', '.spec']),
      strictEventGit(['-C', root, 'rev-list', '--parents', tip]),
    ])
    currentPaths = new Set(tipPathsOut.split('\0').filter((path) => path.startsWith('.spec/')))
    topology = topologyProjection(topologyOut)
  }
  const renamesByFrom = new Map<string, { hash: string; to: string }[]>()
  const topologyOrd = topology.order
  const topologyParents = topology.parents
  const topologyReachable = topology.reachable
  const out = shared?.historyOut ?? await eventStream(root, tip,
    indexEventRequests(root, tip, topologyOrd, topologyReachable).numstat, !transient, useCache)
  if (!out) return { versions, stats, mergeVersions }
  let commitPosition = 0
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const parts = r.split(US)
    const hash = parts[0], date = parts[1], reason = parts[2]
    const rest = parts.slice(3).join(US) // body (had no US) followed by the numstat block
    const sm = rest.match(/Session:\s*(\S+)/)
    const version: Version = { hash, date, reason, session: sm ? sm[1] : null }
    commitVersions.set(hash, version)
    if (!commitOrder.has(hash)) commitOrder.set(hash, commitPosition++)
    for (const line of rest.split('\n')) {
      const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
      if (!m) continue
      const add = m[1] === '-' ? 0 : +m[1]
      const del = m[2] === '-' ? 0 : +m[2]
      const { from, to } = parseStatPath(m[3])
      if (!rawVersions.has(to)) rawVersions.set(to, [])
      rawVersions.get(to)!.push(version)
      let hs = rawStats.get(to)
      if (!hs) { hs = new Map(); rawStats.set(to, hs) }
      const s = hs.get(hash) ?? { additions: 0, deletions: 0, files: 0 }
      s.additions += add; s.deletions += del; s.files += 1
      hs.set(hash, s)
      if (from !== to) {
        const renames = renamesByFrom.get(from) ?? []
        renames.push({ hash, to })
        renamesByFrom.set(from, renames)
      }
    }
  }

  // Re-establish Git's date-order contract after records are parsed from a stream. An independent commit
  // can appear before its child in a date-ordered result; repair that partial-order constraint with a stable
  // topological pass. A comparator that
  // materializes an ancestor Set/bitset for every sort comparison turns a 4k-commit history into an
  // accidental quadratic walk; this queue visits each commit and parent edge once.
  const originalOrder = new Map(commitOrder)
  const childrenLeft = new Map<string, number>()
  for (const hash of commitVersions.keys()) childrenLeft.set(hash, 0)
  for (const hash of commitVersions.keys()) for (const parent of topologyParents.get(hash) ?? [])
    if (childrenLeft.has(parent)) childrenLeft.set(parent, childrenLeft.get(parent)! + 1)
  const heap: string[] = []
  const before = (a: string, b: string) => (originalOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (originalOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
  const push = (hash: string) => {
    let i = heap.push(hash) - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (before(heap[parent], hash) <= 0) break
      heap[i] = heap[parent]; i = parent
    }
    heap[i] = hash
  }
  const pop = (): string => {
    const first = heap[0], last = heap.pop()!
    if (heap.length) {
      let i = 0
      while (true) {
        const left = i * 2 + 1
        if (left >= heap.length) break
        let child = left
        const right = left + 1
        if (right < heap.length && before(heap[right], heap[left]) < 0) child = right
        if (before(heap[child], last) >= 0) break
        heap[i] = heap[child]; i = child
      }
      heap[i] = last
    }
    return first
  }
  for (const [hash, left] of childrenLeft) if (left === 0) push(hash)
  const ordered: string[] = []
  while (heap.length) {
    const hash = pop(); ordered.push(hash)
    for (const parent of topologyParents.get(hash) ?? []) {
      if (!childrenLeft.has(parent)) continue
      const left = childrenLeft.get(parent)! - 1
      childrenLeft.set(parent, left)
      if (left === 0) push(parent)
    }
  }
  // A shallow or malformed topology should fail closed rather than silently dropping a version row.
  if (ordered.length !== commitVersions.size)
    for (const hash of commitVersions.keys()) if (!ordered.includes(hash)) ordered.push(hash)
  commitOrder.clear(); ordered.forEach((hash, i) => commitOrder.set(hash, i))

  const mergeIndex = shared?.mergeIndex
    ?? await mergeHistoryEvents(root, tip, transient, topologyOrd, topologyReachable, useCache)
  for (const rename of mergeIndex.renames) {
    const renames = renamesByFrom.get(rename.from) ?? []
    renames.push({ hash: rename.hash, to: rename.to })
    renamesByFrom.set(rename.from, renames)
  }
  const canonical = canonicalPathProjector(renamesByFrom, topology)
  for (const [path, pathRows] of rawVersions) {
    for (const row of pathRows) for (const head of canonical(path, row.hash).filter((candidate) => currentPaths.has(candidate))) {
      const rows = versions.get(head) ?? []
      if (!rows.some((existing) => existing.hash === row.hash)) rows.push(row)
      versions.set(head, rows)
      const hs = stats.get(head) ?? new Map<string, DiffStat>()
      const value = rawStats.get(path)?.get(row.hash)
      if (value) {
        const existing = hs.get(row.hash)
        hs.set(row.hash, existing ? {
          additions: existing.additions + value.additions,
          deletions: existing.deletions + value.deletions,
          files: existing.files + value.files,
        } : value)
      }
      stats.set(head, hs)
    }
  }
  for (const [path, mergeEvents] of mergeIndex.resolutions) {
    if (!isSpecMd(path)) continue
    for (const { hash } of mergeEvents) for (const head of canonical(path, hash)) {
      const rows = versions.get(head) ?? []
      const hs = stats.get(head) ?? new Map<string, DiffStat>()
      const version = commitVersions.get(hash)
      if (!version || rows.some((row) => row.hash === hash)) continue
      rows.push(version)
      hs.set(hash, { additions: 0, deletions: 0, files: 1 })
      mergeVersions.add(`${head}\0${hash}`)
      versions.set(head, rows)
      stats.set(head, hs)
    }
  }
  for (const rows of versions.values()) {
    rows.sort((a, b) => (commitOrder.get(a.hash) ?? Number.MAX_SAFE_INTEGER) - (commitOrder.get(b.hash) ?? Number.MAX_SAFE_INTEGER))
  }
  return { versions, stats, mergeVersions }
}

// pure lookups over a prebuilt index (no git). rowsFor drops pure-rename rows (0/0) so a move isn't a version.
export function rowsFor(idx: HistoryIndex, relPath: string): Version[] {
  const rows = idx.versions.get(relPath) ?? []
  const st = idx.stats.get(relPath)
  return rows.filter((v) => {
    const s = st?.get(v.hash)
    return s != null && (s.additions + s.deletions > 0 || idx.mergeVersions?.has(`${relPath}\0${v.hash}`))
  })
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
    if (isGitObjectId(root, t)) { cur = t; continue }
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

// A `git log` over HEAD, enriched with parent edges so "newer than
// the spec" is answered by true DAG reachability, never by a log-position/date compare (a linear
// order can't encode a branching history's partial order and silently under-reports — back-dated
// branches, adoption). driftFor()/ancestorsOf() are then pure in-memory lookups. `acks`/`specNodes`
// carry the Spec-OK convention (see driftFor): acks[hash] = node ids declared still-valid via
// `Spec-OK:` trailers; specNodes[hash] = node ids whose spec.md it touched.
export type DriftIndex = {
  tip?: string
  ord: Map<string, number>            // hash -> dense id from the walk: a bitset slot, NEVER an order to compare
  parents: Map<string, string[]>      // hash -> parent hashes (the DAG edges, from the same walk)
  fileEvents: Map<string, DriftPathEvent[]>
  lineageEvents: Map<string, DriftPathEvent[]> // immutable events keyed by terminal rename identity, present or deleted
  lineageKeys: (path: string, revision: string) => string[]
  resolutionEvents?: Map<string, DriftPathEvent[]> // merge-authored all-parent lines projected to this path
  acks: Map<string, Set<string>>      // tree-unchanged checkpoint hash -> node ids acknowledged via `Spec-OK:`
  selfAcks?: Map<string, Set<string>> // content commit hash -> node ids acknowledged for that commit only
  specNodes: Map<string, Set<string>> // commit hash -> node ids whose spec.md it touched (its versions)
  anc: Map<string, Uint8Array>        // memoized reachability bitsets, lazily built per queried sha
}
export type DriftPathEvent = {
  commit: string
  historicalPath: string
  parents: { commit: string; historicalPath: string }[]
}

export type DiffLineRange = [number, number]
export type CombinedDiffOwnedChanges = { after: DiffLineRange[]; before: DiffLineRange[][]; parentPaths: string[] }

// Dense combined diff prefixes have one column per parent. Ownership is a LINE fact, not a hunk fact:
// all `+` means the result authored a line absent from every parent; all `-` means it deleted a line present
// in every parent. Mixed columns inherit from at least one parent. Track every cursor through all displayed
// lines so adjacent mixed/owned rows never widen one another.
export function combinedDiffOwnedChanges(patch: string): Map<string, CombinedDiffOwnedChanges> {
  const byPath = new Map<string, CombinedDiffOwnedChanges>()
  let path: string | null = null
  let parents = 0
  let parentLines: number[] = []
  let parentPaths: string[] = []
  let resultLine = 0
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --cc ')) {
      path = line.slice('diff --cc '.length)
      parents = 0
      parentPaths = []
      inHunk = false
      continue
    }
    if (!inHunk && path !== null && line.startsWith('--- ')) {
      const raw = line.slice(4)
      parentPaths.push(raw === '/dev/null' ? path : raw.replace(/^a\//, ''))
      continue
    }
    const header = line.match(/^(@{3,}) ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,\d+)? @+/)
    if (header) {
      parents = header[1].length - 1
      parentLines = [...header[2].matchAll(/-(\d+)/g)].map((match) => Number(match[1]))
      resultLine = Number(header[3])
      inHunk = path !== null && parents >= 2 && parentLines.length === parents
      continue
    }
    if (!inHunk || path === null || line.startsWith('\\ No newline at end of file')) continue
    const prefix = line.slice(0, parents)
    if (prefix.length !== parents || !/^[ +\-]+$/.test(prefix)) {
      inHunk = false
      continue
    }

    const authoredAfter = [...prefix].every((c) => c === '+')
    const authoredBefore = [...prefix].every((c) => c === '-')
    if ((authoredAfter || authoredBefore) && parentPaths.length !== parents)
      throw new Error(`combined diff for '${path}' declared ${parents} parents but exposed ${parentPaths.length} parent paths`)
    const changes = byPath.get(path) ?? {
      after: [],
      before: Array.from({ length: parents }, () => []),
      parentPaths: [...parentPaths],
    }
    if (authoredAfter) changes.after.push([Math.max(1, resultLine), Math.max(1, resultLine)])
    if (authoredBefore) {
      for (let parent = 0; parent < parents; parent++) {
        const point = Math.max(1, parentLines[parent])
        changes.before[parent].push([point, point])
      }
    }
    if (authoredAfter || authoredBefore) byPath.set(path, changes)
    const resultExists = prefix.includes('+') || [...prefix].every((c) => c === ' ')
    for (let parent = 0; parent < parents; parent++)
      if (prefix[parent] === '-' || (prefix[parent] === ' ' && resultExists)) parentLines[parent]++
    if (resultExists) resultLine++
  }
  return byPath
}
type MergeResolutionEvent = { hash: string; parentPaths: string[] }
type MergeRenameEvent = { hash: string; from: string; to: string }
type MergeHistoryEvents = { resolutions: Map<string, MergeResolutionEvent[]>; renames: MergeRenameEvent[] }
function parseMergeHistoryEvents(out: string): MergeHistoryEvents {
  const resolutions = new Map<string, MergeResolutionEvent[]>()
  const renames: MergeRenameEvent[] = []
  for (const rec of out.split(RS)) {
    const normalized = rec.replace(/^\n/, '')
    const newline = normalized.indexOf('\n')
    const hash = (newline < 0 ? normalized : normalized.slice(0, newline)).trim()
    if (!hash) continue
    const patch = newline < 0 ? '' : normalized.slice(newline + 1)
    for (const line of patch.split('\n')) {
      const raw = line.match(/^(:{2,})[0-7]{6}(?: [0-7]{6})+ (?:[0-9a-f]+ )+[A-Z]+\t/)
      if (!raw) continue
      const parentCount = raw[1].length
      const fields = line.split('\t')
      const status = fields[0].trim().split(/\s+/).at(-1) ?? ''
      const paths = fields.slice(1)
      if (status.length !== parentCount || paths.length !== parentCount + 1)
        throw new Error(`combined raw diff for ${hash} exposed ${status.length} statuses and ${paths.length} paths for ${parentCount} parents`)
      const resultPath = paths[parentCount]
      for (let parent = 0; parent < parentCount; parent++) {
        if (status[parent] !== 'R' || paths[parent] === resultPath) continue
        renames.push({ hash, from: paths[parent], to: resultPath })
      }
    }
    for (const [path, changes] of combinedDiffOwnedChanges(patch)) {
      const events = resolutions.get(path) ?? []
      events.push({ hash, parentPaths: changes.parentPaths })
      resolutions.set(path, events)
    }
  }
  return { resolutions, renames }
}

async function mergeHistoryEvents(
  root: string,
  tip: string,
  transient: boolean,
  order: Map<string, number>,
  reachable: Set<string>,
  useCache = true,
): Promise<MergeHistoryEvents> {
  if (!useCache) return parseMergeHistoryEvents(await strictEventGit(['-C', root, '-c', 'core.quotePath=false',
    'log', '--merges', '--raw', '--patch', '--cc', '--combined-all-paths', '--unified=0', '--no-color', '--no-ext-diff', '-M', `--format=${RS}%H`, tip]))
  return parseMergeHistoryEvents(await eventStream(root, tip,
    indexEventRequests(root, tip, order, reachable).merge, !transient, useCache))
}

async function buildDriftIndex(root: string, tip: string, transient: boolean, useCache = true, shared?: SharedIndexInputs): Promise<DriftIndex> {
  const ord = new Map<string, number>(), parents = new Map<string, string[]>()
  const fileEvents = new Map<string, DriftPathEvent[]>()
  const lineageEvents = new Map<string, DriftPathEvent[]>()
  const acks = new Map<string, Set<string>>(), selfAcks = new Map<string, Set<string>>(), specNodes = new Map<string, Set<string>>()
  const ackCandidates = new Map<string, Set<string>>(), trees = new Map<string, string>()
  const idx: DriftIndex = { tip, ord, parents, fileEvents, lineageEvents, lineageKeys: (path) => [path], resolutionEvents: new Map(), acks, selfAcks, specNodes, anc: new Map() }
  let currentPaths: Set<string>
  let topology: TopologyProjection
  if (shared) {
    currentPaths = shared.allPaths
    topology = shared.topology
  } else {
    const [tipPathsOut, topologyOut] = await Promise.all([
      strictEventGit(['-C', root, 'ls-tree', '-r', '-z', '--name-only', tip]),
      strictEventGit(['-C', root, 'rev-list', '--parents', tip]),
    ])
    currentPaths = new Set(tipPathsOut.split('\0').filter(Boolean))
    topology = topologyProjection(topologyOut)
  }
  const topologyOrder = topology.order
  const topologyParents = topology.parents
  const topologyReachable = topology.reachable
  // Numstat is the immutable identity event: unlike a name-only stream it records both sides of a rename,
  // allowing the same event-scoped projection used by spec history to follow forks and reject path reuse.
  const out = shared?.driftOut ?? await eventStream(root, tip,
    indexEventRequests(root, tip, topologyOrder, topologyReachable)['drift-numstat'], !transient, useCache)
  if (!out) return idx
  const rawFileEvents = new Map<string, DriftPathEvent[]>()
  const renamesByFrom = new Map<string, RenameProjectionEvent[]>()
  let i = 0
  for (const rec of out.split(RS)) {
    const r = rec.replace(/^\n/, '')
    if (!r) continue
    const lines = r.split('\n')
    const [hash, parentStr = '', tree = '', ackStr = ''] = lines[0].split(US)
    if (!hash) continue
    trees.set(hash, tree)
    if (!ord.has(hash)) {
      ord.set(hash, i++)
      parents.set(hash, parentStr.split(' ').filter(Boolean))
    }
    const ackSet = new Set(ackStr.split(',').map((s) => s.trim()).filter(Boolean))
    if (ackSet.size) ackCandidates.set(hash, ackSet)
    const merge = parentStr.split(' ').filter(Boolean).length > 1
    for (const line of lines.slice(1)) {
      const stat = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
      if (!stat) continue
      const { from, to } = parseStatPath(stat[3])
      if (!merge) {
        const events = rawFileEvents.get(to) ?? []
        const event: DriftPathEvent = {
          commit: hash,
          historicalPath: to,
          parents: (parents.get(hash) ?? []).slice(0, 1).map((commit) => ({ commit, historicalPath: from })),
        }
        events.push(event)
        rawFileEvents.set(to, events)
      }
      if (from !== to) {
        const renames = renamesByFrom.get(from) ?? []
        renames.push({ hash, to })
        renamesByFrom.set(from, renames)
      }
    }
  }
  const mergeIndex = shared?.mergeIndex
    ?? await mergeHistoryEvents(root, tip, transient, topologyOrder, topologyReachable, useCache)
  for (const rename of mergeIndex.renames) {
    const renames = renamesByFrom.get(rename.from) ?? []
    renames.push({ hash: rename.hash, to: rename.to })
    renamesByFrom.set(rename.from, renames)
  }
  const canonical = canonicalPathProjector(renamesByFrom, topology)
  idx.lineageKeys = canonical
  // One projection per event serves both the lineage index and the current-path index; asking the
  // projector the same question twice per event only pays for it twice.
  const addEvent = (keys: string[], event: DriftPathEvent, target: Map<string, DriftPathEvent[]>) => {
    for (const key of keys) {
      const events = target.get(key) ?? []
      if (!events.some((existing) => existing.commit === event.commit && existing.historicalPath === event.historicalPath)) events.push(event)
      target.set(key, events)
    }
  }
  for (const [path, rawEvents] of rawFileEvents) for (const event of rawEvents) {
    const keys = canonical(path, event.commit)
    addEvent(keys, event, lineageEvents)
    for (const head of keys.filter((candidate) => currentPaths.has(candidate))) {
      const events = fileEvents.get(head) ?? []
      if (!events.some((existing) => existing.commit === event.commit && existing.historicalPath === event.historicalPath)) events.push(event)
      fileEvents.set(head, events)
      if (isSpecMd(head)) {
        const nodes = specNodes.get(event.commit) ?? new Set<string>()
        nodes.add(nodeIdOf(head))
        specNodes.set(event.commit, nodes)
      }
    }
  }
  for (const [hash, nodes] of ackCandidates) {
    const parentList = parents.get(hash) ?? []
    const firstParent = parentList[0]
    const checkpoint = parentList.length === 1 && !!firstParent && trees.get(hash) === trees.get(firstParent)
    ;(checkpoint ? acks : selfAcks).set(hash, nodes)
  }
  for (const [path, mergeEvents] of mergeIndex.resolutions) for (const mergeEvent of mergeEvents) {
    const mergeParents = topologyParents.get(mergeEvent.hash) ?? []
    if (mergeParents.length !== mergeEvent.parentPaths.length)
      throw new Error(`merge ${mergeEvent.hash} has ${mergeParents.length} topology parents but ${mergeEvent.parentPaths.length} combined parent paths`)
    const event: DriftPathEvent = {
      commit: mergeEvent.hash,
      historicalPath: path,
      parents: mergeParents.map((commit, index) => ({ commit, historicalPath: mergeEvent.parentPaths[index] })),
    }
    const keys = canonical(path, mergeEvent.hash)
    addEvent(keys, event, lineageEvents)
    for (const head of keys.filter((candidate) => currentPaths.has(candidate))) {
      const events = idx.resolutionEvents!.get(head) ?? []
      if (!events.some((existing) => existing.commit === event.commit && existing.historicalPath === event.historicalPath)) events.push(event)
      idx.resolutionEvents!.set(head, events)
      if (isSpecMd(head)) {
        const nodes = specNodes.get(mergeEvent.hash) ?? new Set<string>()
        nodes.add(nodeIdOf(head))
        specNodes.set(mergeEvent.hash, nodes)
      }
    }
  }
  return idx
}
export function driftIndex(root: string, tip = 'HEAD'): Promise<DriftIndex> {
  if (tip !== 'HEAD') {
    const resolved = git(['-C', root, 'rev-parse', `${tip}^{commit}`]).trim()
    if (pendingOnlyIssues(root, resolved)) {
      const parent = pendingParent(root, resolved)
      if (parent) {
        const head = headOrEmpty(root)
        if (head === parent) return driftIndex(root)
        return buildDriftIndex(root, parent, true, true)
      }
    }
    return buildDriftIndex(root, resolved, true, true)
  }
  const head = headOrEmpty(root) // filesystem HEAD, no subprocess — see historyIndex
  if (!head) return buildDriftIndex(root, 'HEAD', false, true)
  const cacheKey = `${rootKey(root)}\0${head}\0${gitInterpretationKey(root)}`
  touchRoot(driftRoots, driftIdxCache, root, cacheKey)
  const hit = driftIdxCache.get(cacheKey)
  if (hit) return hit
  const p = buildDriftIndex(root, head.startsWith('unborn:') ? 'HEAD' : head, false, true)
  p.catch(() => { dropFailed(driftIdxCache, cacheKey, p) })
  driftIdxCache.set(cacheKey, p)
  return p
}

function topologyProjection(out: string): TopologyProjection {
  const order = new Map<string, number>(), parents = new Map<string, string[]>(), reachable = new Set<string>()
  let position = 0
  for (const line of out.trim().split('\n')) {
    const [hash, ...parentList] = line.split(' ')
    if (!hash) continue
    order.set(hash, position++)
    parents.set(hash, parentList)
    reachable.add(hash)
  }
  return { order, parents, reachable }
}

async function buildIndexPair(root: string, tip: string, transient: boolean, useCache = true): Promise<[HistoryIndex, DriftIndex]> {
  const [allPathsOut, topologyOut] = await Promise.all([
    strictEventGit(['-C', root, '-c', 'core.quotePath=false', 'ls-tree', '-r', '-z', '--name-only', tip]),
    strictEventGit(['-C', root, 'rev-list', '--parents', tip]),
  ])
  const topology = topologyProjection(topologyOut)
  const allPaths = new Set(allPathsOut.split('\0').filter(Boolean))
  const specPaths = new Set([...allPaths].filter((path) => path.startsWith('.spec/')))
  const requests = indexEventRequests(root, tip, topology.order, topology.reachable)
  const streams = await deriveEventStreams(root, tip, EVENT_STREAM_KINDS.map((kind) => requests[kind]), !transient, useCache)
  const shared: SharedIndexInputs = {
    allPaths,
    specPaths,
    topology,
    historyOut: streams.get('numstat') ?? '',
    driftOut: streams.get('drift-numstat') ?? '',
    mergeIndex: parseMergeHistoryEvents(streams.get('merge') ?? ''),
  }
  streams.clear()
  return Promise.all([
    buildIndex(root, tip, transient, useCache, shared),
    buildDriftIndex(root, tip, transient, useCache, shared),
  ])
}

// Standing correctness oracle: same projection, but every immutable stream comes from Git root history.
export function sourceIndexesFull(root: string, tip = 'HEAD'): Promise<[HistoryIndex, DriftIndex]> {
  const head = tip === 'HEAD' ? headOrEmpty(root) : ''
  const resolved = tip === 'HEAD'
    ? (!head || head.startsWith('unborn:') ? 'HEAD' : head)
    : git(['-C', root, 'rev-parse', `${tip}^{commit}`]).trim()
  return buildIndexPair(root, resolved, true, false)
}

// History and drift are one product projection. Building them together is what gives one lint one ledger
// transaction; the public single-index functions remain for consumers that genuinely need only one side.
export function sourceIndexes(root: string, tip = 'HEAD'): Promise<[HistoryIndex, DriftIndex]> {
  if (tip !== 'HEAD') {
    const resolved = git(['-C', root, 'rev-parse', `${tip}^{commit}`]).trim()
    if (pendingOnlyIssues(root, resolved)) {
      const parent = pendingParent(root, resolved)
      if (parent) return headOrEmpty(root) === parent
        ? sourceIndexes(root)
        : buildIndexPair(root, parent, true, true)
    }
    return buildIndexPair(root, resolved, true, true)
  }
  const head = headOrEmpty(root)
  if (!head) return buildIndexPair(root, 'HEAD', false, true)
  const cacheKey = `${rootKey(root)}\0${head}\0${gitInterpretationKey(root)}`
  touchRoot(indexRoots, indexCache, root, cacheKey)
  touchRoot(driftRoots, driftIdxCache, root, cacheKey)
  const historyHit = indexCache.get(cacheKey), driftHit = driftIdxCache.get(cacheKey)
  if (historyHit && driftHit) return Promise.all([historyHit, driftHit])

  const pair = buildIndexPair(root, head.startsWith('unborn:') ? 'HEAD' : head, false, true)
  const historyPromise = pair.then(([history]) => history)
  const driftPromise = pair.then(([, drift]) => drift)
  historyPromise.catch(() => { dropFailed(indexCache, cacheKey, historyPromise) })
  driftPromise.catch(() => { dropFailed(driftIdxCache, cacheKey, driftPromise) })
  indexCache.set(cacheKey, historyPromise)
  driftIdxCache.set(cacheKey, driftPromise)
  return pair
}

export function historyCacheStats(): { historyHeads: number; driftHeads: number; historyRoots: number; driftRoots: number } {
  return { historyHeads: indexCache.size, driftHeads: driftIdxCache.size, historyRoots: indexRoots.size, driftRoots: driftRoots.size }
}
// Tests deliberately clear process-local promises and path identity to exercise both cold and read-back paths.
// Production callers retain the bounded index caches; this is not a correctness escape hatch.
export function resetHistoryCachesForTests(): void {
  indexCache.clear(); driftIdxCache.clear(); indexRoots.clear(); driftRoots.clear()
  eventPathMemo.clear(); gitObjectFormatMemo.clear()
}
export function historyEventCachePathForTests(root: string): string { return eventCacheLocation(root).path }
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

export function commitReachable(idx: DriftIndex, sha: string): boolean {
  return ancestorsOf(idx, sha) !== undefined
}

// the valid Spec-OK coverage for a node's version commit: `sinceHash` is the node's OWN latest version,
// so the node(s) it's a version of (specNodes[sinceHash]) name the node being measured; an ack counts
// only if its `Spec-OK:` set names one of those — `Spec-OK: A` quiets A's drift, never B's. An ack that
// is itself an ancestor of the version can't speak for it (a re-version invalidates older acks); a valid
// ack quiets exactly the commits reachable from it. Shared by driftFor (the count) and the anchor
// engine's windowCommits (the commit set) so both read ONE ack rule.
function targetNodes(idx: DriftIndex, sinceHash: string, nodeId?: string): Set<string> | undefined {
  return nodeId ? new Set([nodeId]) : idx.specNodes.get(sinceHash)
}

export function ackCoverFor(idx: DriftIndex, sinceHash: string, nodeId?: string): Uint8Array[] {
  const base = ancestorsOf(idx, sinceHash)
  if (!base) return []
  const targets = targetNodes(idx, sinceHash, nodeId)
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

export function selfAckCovers(idx: DriftIndex, sinceHash: string, hash: string, nodeId?: string): boolean {
  const targets = targetNodes(idx, sinceHash, nodeId)
  const declared = idx.selfAcks?.get(hash)
  return !!targets && !!declared && [...targets].some((node) => declared.has(node))
}

export function pathEvents(idx: DriftIndex, path: string): DriftPathEvent[] {
  return [...(idx.fileEvents.get(path) ?? []), ...(idx.resolutionEvents?.get(path) ?? [])]
}

// Exact base..tip window for consumers whose subject is not a spec version. The path is an identity at
// `identityRevision`; projecting it and every immutable event to the same terminal lineage keys preserves
// rename chains, parallel forks, path reuse, and lineages deleted before the tip.
export function pathRangeEvents(idx: DriftIndex, sinceHash: string, path: string, identityRevision = idx.tip ?? sinceHash): DriftPathEvent[] | null {
  const base = ancestorsOf(idx, sinceHash)
  if (!base) return null
  const seen = new Set<string>()
  const events = idx.lineageKeys(path, identityRevision).flatMap((key) => idx.lineageEvents.get(key) ?? [])
  return events.filter((event) => {
    const key = `${event.commit}\0${event.historicalPath}\0${event.parents.map((parent) => `${parent.commit}:${parent.historicalPath}`).join('\x1e')}`
    if (seen.has(key) || inAncestors(idx, base, event.commit)) return false
    seen.add(key)
    return true
  })
}

export function driftPathWindow(idx: DriftIndex, sinceHash: string, path: string, nodeId?: string): DriftPathEvent[] | null {
  const base = ancestorsOf(idx, sinceHash)
  if (!base) return null
  const events = pathEvents(idx, path).filter((event) => !inAncestors(idx, base, event.commit))
  const cover = ackCoverFor(idx, sinceHash, nodeId)
  return events.filter((event) => !cover.some((a) => inAncestors(idx, a, event.commit))
      && !selfAckCovers(idx, sinceHash, event.commit, nodeId))
}

// pure lookup, no git: a commit to `path` is drift iff it is NOT an ancestor of `sinceHash` — it lies
// in `sinceHash..HEAD` by true DAG reachability, wherever a date-ordered log happens to place it.
// An off-history `sinceHash` → 0: no basis on HEAD to measure from.
export function driftFor(idx: DriftIndex, sinceHash: string, path: string, nodeId?: string): number {
  if (!sinceHash) return 0
  return new Set(driftPathWindow(idx, sinceHash, path, nodeId)?.map((event) => event.commit) ?? []).size
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
