// @@@ host gateway ([[host-gateway]]) - the host-level face of every SpexCode project this user runs.
// Each `spex serve` stays scoped to ONE repo, loopback-only and auth-unaware; what it contributes to the
// host is a single instance-validated endpoint record in the per-user global store. THIS module is the
// other half: the durable known-project catalog, the reconciler that turns records into a validated live
// project list, portable-config editor, and host operations (register/init/doctor/start) — mounted as [[gateway-hub]]'s
// extension by `spex dashboard` (startHostDashboard below), so routing, /p/:projectId proxying, and
// authorization ([[gateway-auth]]) stay the hub's single seam and are never duplicated here. Backends
// never depend on the gateway: they publish records and serve loopback whether or not a gateway is
// running, and direct CLI discovery (sessions.ts's ladder) keeps reading the same records.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync, openSync, closeSync, existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spexcodeHome, encodeProject, readJsonConfig, templateConfigPath } from '@spexcode/spec-core'
import { git } from '@spexcode/spec-core'
import { serveStatic, resolveDistDir } from './gateway.js'
import { endpointRecordPath, readEndpointRecord, type EndpointRecord } from './endpoint-record.js'
import { startHubGateway, type HubExtensions } from './gateway-hub.js'
import { MachinePeerGateway } from './machine-peer.js'
import { DEFAULT_PROJECT_ICON, requireIdentityChoice } from '@spexcode/spec-core/identity'
import {
  resolveProjectIdentity, writeGatewayIcon, type ResolvedIdentity,
} from '@spexcode/spec-core'
import { cliEntrypointArgs } from './tsx-bin.js'
import { clearProjectPassword } from './gateway-auth.js'
import { resolveHarnessTargets } from './harness-select.js'
import { collectHostFacts, isWsl } from './host-facts.js'
import { dropOwnHostRecord, newHostRecord, publishHostRecord, type HostRecord } from './host-record.js'

const here = dirname(fileURLToPath(import.meta.url))
// ── the endpoint record ──────────────────────────────────────────────────────────────────────────────
// The record itself lives in [[endpoint-record]] — the backend half, which must not depend on the gateway.
// Re-exported here because this module is where the host's readers already look for it.
export { endpointRecordPath, publishEndpoint, dropOwnEndpoint, readEndpointRecord } from './endpoint-record.js'
export type { EndpointRecord } from './endpoint-record.js'
export { hostRecordPath, readHostRecord, publishHostRecord, dropOwnHostRecord } from './host-record.js'
export type { HostRecord } from './host-record.js'
// ── the durable known-project catalog ────────────────────────────────────────────────────────────────
// ~/.spexcode/projects.json — the host's memory of which projects exist, so /projects can list a project
// whose backend is OFFLINE (records vanish with their serve; the catalog does not). It is populated only
// by the explicit add operation: a live record may appear in this pass, but an ad-hoc worktree must not
// turn into a permanent offline menu entry merely because it was served once.
export type CatalogEntry = { root: string; addedAt: string }
export const catalogPath = (): string => join(spexcodeHome(), 'projects.json')

let catalogWarned = false
export function readCatalog(): CatalogEntry[] {
  let raw: string
  try { raw = readFileSync(catalogPath(), 'utf8') } catch { return [] }
  try {
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed?.projects) ? parsed.projects : []
    return list.filter((e: any): e is CatalogEntry => e && typeof e.root === 'string')
  } catch (e) {
    // reads degrade loud-but-alive (the reconciler must keep serving live records); WRITES refuse below,
    // so a malformed catalog is never silently clobbered.
    if (!catalogWarned) { catalogWarned = true; console.error(`[host] malformed ${catalogPath()} (${(e as Error).message}) — known-project catalog ignored until fixed`) }
    return []
  }
}

function writeCatalog(entries: CatalogEntry[]): void {
  if (existsSync(catalogPath())) {
    try { JSON.parse(readFileSync(catalogPath(), 'utf8')) }
    catch { throw new Error(`refusing to overwrite malformed ${catalogPath()} — fix or remove it first`) }
  }
  mkdirSync(dirname(catalogPath()), { recursive: true })
  const tmp = join(dirname(catalogPath()), `.projects.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify({ projects: entries }, null, 2) + '\n')
  renameSync(tmp, catalogPath())
}

function existingDirectory(dir: string): string {
  let path: string
  try { path = realpathSync(resolve(dir)) }
  catch { throw new Error(`${dir} is not an existing directory`) }
  try { if (!statSync(path).isDirectory()) throw new Error('not a directory') }
  catch { throw new Error(`${dir} is not an existing directory`) }
  return path
}

function gitProjectRoot(dir: string): string | null {
  try { return dirname(git(['-C', dir, 'rev-parse', '--path-format=absolute', '--git-common-dir']).trim()) }
  catch { return null }
}

const WINDOWS_DRIVE_PROJECT_MESSAGE = 'Projects on Windows drives reach WSL through 9p, where git and inotify are slow or unreliable; choose a folder under \\\\wsl$\\<distro>\\home instead.'
export function rejectWindowsDriveProjectPath(dir: string, runningInWsl = isWsl()): void {
  if (!runningInWsl) return
  if (/^[A-Za-z]:[\\/]/.test(dir) || /^\/mnt\/[A-Za-z](?:\/|$)/i.test(dir)) {
    throw new Error(WINDOWS_DRIVE_PROJECT_MESSAGE)
  }
}

// The admin folder picker reads directory NAMES only. An absent typed path is a read-only candidate, so
// the UI can offer an explicit new-project transaction instead of making a failed browse do that work.
export type ProjectDirectoryListing = {
  path: string; exists: boolean; parent: string | null; home: string; gitRoot: string | null
  initialized: boolean; cataloged: boolean
  entries: Array<{ name: string; path: string; git: boolean; initialized: boolean }>
}
export function browseProjectDirectories(dir?: string): ProjectDirectoryListing {
  const requested = (dir ?? '').trim() || homedir()
  if (!existsSync(resolve(requested))) {
    const path = resolve(requested)
    return {
      path, exists: false, parent: dirname(path) === path ? null : dirname(path), home: homedir(),
      gitRoot: null, initialized: false, cataloged: false, entries: [],
    }
  }
  const path = existingDirectory(requested)
  const gitRoot = gitProjectRoot(path)
  const entries = readdirSync(path, { withFileTypes: true })
    .filter((entry) => {
      if (entry.isDirectory()) return true
      if (!entry.isSymbolicLink()) return false
      try { return statSync(join(path, entry.name)).isDirectory() } catch { return false }
    })
    .map((entry) => {
      const child = join(path, entry.name)
      const isGit = existsSync(join(child, '.git'))
      return {
        name: entry.name,
        path: child,
        git: isGit,
        initialized: isGit && existsSync(join(child, '.spec')),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    path, exists: true,
    parent: dirname(path) === path ? null : dirname(path),
    home: homedir(),
    gitRoot,
    initialized: !!gitRoot && existsSync(join(gitRoot, '.spec')),
    cataloged: !!gitRoot && readCatalog().some((entry) => entry.root === gitRoot),
    entries,
  }
}

// Register a repo by normalizing any path inside it to its MAIN checkout (the identity every record and
// store key uses), then dedupe + persist it.
export function addKnownProject(dir: string): string {
  const path = existingDirectory(dir)
  const root = gitProjectRoot(path)
  if (!root) throw new Error(`${dir} is not a git repository — SpexCode projects are git-backed (run \`git init\` there first)`)
  catalogAdd(root)
  return root
}
function catalogAdd(root: string): void {
  const entries = readCatalog()
  if (entries.some((e) => e.root === root)) return
  writeCatalog([...entries, { root, addedAt: new Date().toISOString() }])
}

// Removal is deliberately narrower than deletion: it forgets the host registration and its gateway
// credential, while never touching the checkout. The caller supplies a UI confirmation phrase, but the
// host repeats every safety check so a direct HTTP client cannot turn this into an easy destructive verb.
export type RemoveProjectResult = {
  root: string; projectId: string; sessions: number; runtimeRecordRemoved: boolean
}

function activeProjectSessions(root: string): number {
  const dir = join(spexcodeHome(), 'projects', encodeProject(root), 'sessions')
  let entries: string[]
  try { entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name) }
  catch { return 0 }
  let active = 0
  for (const id of entries) {
    try {
      // `runtime.json` is the current record name/shape; the legacy `session.json` and camelCase close
      // field are still understood so an old retained session cannot either disappear from the guard or
      // make a safely closed project impossible to remove forever.
      let record: any
      try { record = JSON.parse(readFileSync(join(dir, id, 'runtime.json'), 'utf8')) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        record = JSON.parse(readFileSync(join(dir, id, 'session.json'), 'utf8'))
      }
      const closedAt = record?.closed_at ?? record?.closedAt
      if (record?.archived !== true && record?.stopped !== true && closedAt == null) active++
    } catch {
      // An unreadable record is not safe to classify as inactive. It stays a loud blocker for removal.
      active++
    }
  }
  return active
}

export function removeKnownProject(root: string, confirmation: string): RemoveProjectResult {
  const entries = readCatalog()
  const entry = entries.find((e) => e.root === root)
  const projectId = encodeProject(root)
  if (!entry) throw Object.assign(new Error(`project '${projectId}' is not in the catalog`), { status: 404 })

  const sessions = activeProjectSessions(root)
  if (sessions) throw Object.assign(new Error(`project has ${sessions} active session record(s); stop or close them before removing the registration`), { status: 409 })

  const snapshotEntry = snapshot.find((p) => p.root === root)
  if (snapshotEntry?.online) throw Object.assign(new Error('project backend is online; stop it before removing the registration'), { status: 409 })

  const expected = `REMOVE ${snapshotEntry?.identity.title || basename(root)}`
  if (confirmation !== expected) throw Object.assign(new Error(`confirmation must exactly equal '${expected}'`), { status: 400 })

  let runtimeRecordRemoved = false
  const recordFile = endpointRecordPath(root)
  const record = readEndpointRecord(recordFile)
  if (record) {
    let alive = false
    try { process.kill(record.pid, 0); alive = true } catch { /* no process at that pid */ }
    if (alive) {
      throw Object.assign(new Error('backend runtime could not be proven stopped; registration was preserved'), { status: 409 })
    }
  }
  writeCatalog(entries.filter((e) => e.root !== root))
  clearProjectPassword(projectId)
  if (record) {
    try { rmSync(recordFile); runtimeRecordRemoved = true } catch { /* already gone */ }
  }
  snapshot = snapshot.filter((p) => p.root !== root)
  return { root, projectId, sessions, runtimeRecordRemoved }
}

// ── the reconciler ───────────────────────────────────────────────────────────────────────────────────
// Turn the global store's endpoint records + the catalog into ONE validated project list. A record counts
// as ONLINE only when (a) it sits in the store slot its own root encodes to, and (b) the live backend at
// its url answers /api/instance with the SAME instanceId and root — anything else (dead process, recycled
// port, copied record, another project's serve) is just an offline project, never a proxy target.
export type ProjectEntry = {
  projectId: string; root: string; identity: ResolvedIdentity; configRevision: string
  online: boolean; url: string | null; pid?: number; startedAt?: string
}

type LiveInstance = { instanceId?: string; root?: string; identity?: ResolvedIdentity }
async function fetchInstance(url: string): Promise<LiveInstance | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 900)
  try {
    const r = await fetch(`${url}/api/instance`, { signal: ctrl.signal })
    if (!r.ok) return null
    return await r.json() as LiveInstance
  } catch { return null }
  finally { clearTimeout(t) }
}

export async function reconcileProjects(): Promise<ProjectEntry[]> {
  const projectsDir = join(spexcodeHome(), 'projects')
  let dirs: string[] = []
  try { dirs = readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }

  const live = new Map<string, { rec: EndpointRecord; identity: ResolvedIdentity }>()
  const claimed = new Set<string>()                  // roots with a slot-matched record, validated or not
  await Promise.all(dirs.map(async (d) => {
    const rec = readEndpointRecord(join(projectsDir, d, 'backend.json'))
    if (!rec) return
    if (encodeProject(rec.root) !== d) return
    claimed.add(rec.root)                       // a dead/mismatched record still NAMES a project — listed offline
    const inst = await fetchInstance(rec.url)
    if (inst && inst.instanceId === rec.instanceId && inst.root === rec.root &&
      typeof inst.identity?.title === 'string' && typeof inst.identity?.icon === 'string') {
      live.set(rec.root, { rec, identity: inst.identity })
    }
  }))

  const byId = new Map<string, ProjectEntry>()
  const push = (root: string) => {
    if (!existsSync(root)) return
    const projectId = encodeProject(root)
    if (byId.has(projectId)) return   // encodeProject is lossy; first root wins a (pathological) collision
    const active = live.get(root) ?? null
    const source = readProjectConfig(root)
    let identity: ResolvedIdentity
    try { identity = active?.identity ?? resolveProjectIdentity(root, root) }
    catch (e) {
      console.error(`[host] cannot resolve identity for ${root}: ${(e as Error).message}`)
      identity = { title: basename(root), icon: DEFAULT_PROJECT_ICON }
    }
    byId.set(projectId, {
      projectId, root, identity, configRevision: source.revision,
      online: !!active, url: active?.rec.url ?? null,
      ...(active ? { pid: active.rec.pid, startedAt: active.rec.startedAt } : {}),
    })
  }
  for (const e of readCatalog()) push(e.root)
  for (const root of claimed) push(root)
  return [...byId.values()].sort((a, b) => a.identity.title.localeCompare(b.identity.title) || a.root.localeCompare(b.root))
}

// single-flight + last-snapshot: every reader (GET, the stream loop, the per-request proxy resolution)
// shares one in-flight reconcile instead of stampeding probes.
let snapshot: ProjectEntry[] = []
let inflight: Promise<ProjectEntry[]> | null = null
export function reconcileNow(): Promise<ProjectEntry[]> {
  return (inflight ??= reconcileProjects()
    .then((list) => { snapshot = list; return list })
    .finally(() => { inflight = null }))
}

// ── host operations (spawned `spex`, never forked logic) ─────────────────────────────────────────────
// init / doctor / serve run the EXISTING CLI implementations as child processes with cwd = the project
// root: the same git/harness/additive guarantees `spex init` gives at a terminal, the same doctor report,
// the same supervisor `spex serve` boots — no second implementation of any domain semantics. The spawned
// env is scrubbed of routing state (SPEXCODE_API_URL/PORT/session/instance ids) so a child never inherits
// the gateway's — or another project's — backend routing.
const cliArgs = cliEntrypointArgs(join(here, '..'), here)
function scrubbedEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.SPEXCODE_API_URL; delete env.PORT
  delete env.SPEXCODE_SESSION_ID; delete env.SPEXCODE_INSTANCE_ID
  return env
}

export function runSpex(root: string, args: string[], timeoutMs = 120_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...cliArgs, ...args], { cwd: root, env: scrubbedEnv() })
    let output = ''
    child.stdout.on('data', (d) => { output += d })
    child.stderr.on('data', (d) => { output += d })
    const t = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } }, timeoutMs)
    child.on('close', (code) => { clearTimeout(t); resolve({ code, output }) })
    child.on('error', (e) => { clearTimeout(t); resolve({ code: null, output: `${output}\nspawn failed: ${e.message}` }) })
  })
}

export type AddProjectSetup = {
  createDir?: boolean
  initGit?: boolean
  init?: { harness: string; preset?: string }
}
export type AddProjectSetupResult = {
  ok: boolean; root: string; directoryCreated: boolean; gitInitialized: boolean
  initialCommitCreated: boolean
  init?: { code: number | null; output: string }
}

const INITIAL_PROJECT_COMMIT_MESSAGE = 'chore: 初始化项目'
const BOOTSTRAP_COMMIT_AUTHOR = 'SpexCode <spexcode@spexcode.invalid>'
type SeedState = { spec: boolean; config: boolean; ignore: boolean }

function gitErrorOutput(error: unknown): string {
  const candidate = error as { stdout?: unknown; stderr?: unknown }
  const text = (value: unknown): string => Buffer.isBuffer(value) ? value.toString('utf8').trim() : typeof value === 'string' ? value.trim() : ''
  return [text(candidate?.stdout), text(candidate?.stderr)].filter(Boolean).join('\n')
}

function gitRequired(args: string[], operation: string): string {
  try { return git(args) }
  catch (error) {
    const detail = gitErrorOutput(error) || (error instanceof Error ? error.message : String(error))
    throw new Error(`${operation}: ${detail}`)
  }
}

function hasGitCommit(root: string): boolean {
  try { return !!git(['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}']).trim() }
  catch { return false }
}

function bootstrapSeedState(root: string): SeedState {
  return {
    spec: existsSync(join(root, '.spec')),
    config: existsSync(join(root, '.spec', 'spexcode.json')),
    ignore: existsSync(join(root, '.gitignore')),
  }
}

function bootstrapSeedPaths(root: string, before: SeedState): string[] {
  const candidates: Array<[string, boolean]> = [
    // An interrupted adoption can leave the SpexCode seed on disk while HEAD is still unborn. Those
    // paths are the project's source of truth even when they predate this add attempt, so recover them
    // into the bootstrap commit; `--only` below still keeps every user source path out.
    ['.spec', true],
    ['.spec/spexcode.json', true],
    ['.gitignore', !before.ignore],
  ]
  return candidates.filter(([path, shouldStage]) => shouldStage && existsSync(join(root, path))).map(([path]) => path)
}

// The host owns this one topology commit. It is deliberately path-scoped: pre-staged user files stay out of
// it, while the newly planted SpexCode source and ignore policy become the branchable source of truth.
function createInitialProjectCommit(root: string, before: SeedState): void {
  const paths = bootstrapSeedPaths(root, before)
  try {
    if (paths.length) gitRequired(['-C', root, 'add', '-f', '--', ...paths], `cannot stage the SpexCode seed in ${root}`)
    const commit = [
      '-C', root,
      '-c', 'user.name=SpexCode',
      '-c', 'user.email=spexcode@spexcode.invalid',
      'commit', '--quiet', '--no-verify', '--allow-empty', '--only',
      '--author', BOOTSTRAP_COMMIT_AUTHOR, '-m', INITIAL_PROJECT_COMMIT_MESSAGE,
    ]
    if (paths.length) commit.push('--', ...paths)
    gitRequired(commit, `cannot create the initial Git commit in ${root}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('cannot ')) throw error
    const detail = gitErrorOutput(error) || (error instanceof Error ? error.message : String(error))
    throw new Error(`cannot create the initial Git commit in ${root}: ${detail}`)
  }
}

// One ordered add transaction: select an existing directory or explicitly create one with Git, establish a
// branchable base, run the real CLI initializer when requested, and only then claim catalog success. A path
// created by this transaction gets the neutral `--harness none` foundation so the scoped New Session picker
// can add its first target later.
export async function addKnownProjectWithSetup(dir: string, setup: AddProjectSetup = {}): Promise<AddProjectSetupResult> {
  if (setup.createDir && !setup.initGit) throw new Error('creating a project directory requires Git initialization')
  rejectWindowsDriveProjectPath(dir)
  let directoryCreated = false
  let path: string
  try { path = existingDirectory(dir) }
  catch (e) {
    if (!setup.createDir) throw e
    mkdirSync(resolve(dir), { recursive: true })
    directoryCreated = true
    path = existingDirectory(dir)
  }
  let root = gitProjectRoot(path)
  let gitInitialized = false
  if (!root || directoryCreated) {
    if (!setup.initGit) throw new Error(`${dir} is not a git repository — enable Git initialization to add it`)
    gitRequired(['init', '--quiet', '--', path], `git init failed for ${path}`)
    gitInitialized = true
    root = gitProjectRoot(path)
    if (!root) throw new Error(`git init completed but ${path} is still not a Git repository`)
    if (directoryCreated && root !== path) throw new Error(`git init did not create an independent repository at ${path}`)
    // A repository created by the host must agree with SpexCode's conventional fallback (`main`) even when
    // the user's global Git defaults still say `master`. Existing repositories keep their current branch.
    if (gitInitialized && !hasGitCommit(root)) {
      gitRequired(['-C', root, 'symbolic-ref', 'HEAD', 'refs/heads/main'], `cannot select the initial main branch in ${root}`)
    }
  }

  const needsInitialCommit = !hasGitCommit(root)
  const seedBefore = bootstrapSeedState(root)
  const requestedInit = setup.init ?? (directoryCreated ? { harness: 'none' } : undefined)
  let init: AddProjectSetupResult['init']
  if (requestedInit) {
    const harness = typeof requestedInit.harness === 'string' ? requestedInit.harness.trim() : ''
    if (!harness) throw new Error('SpexCode initialization requires at least one explicit harness target')
    const preset = typeof requestedInit.preset === 'string' ? requestedInit.preset.trim() : ''
    const result = await runSpex(root, ['init', '--harness', harness, ...(preset ? ['--preset', preset] : [])])
    init = result
    if (result.code !== 0) return { ok: false, root, directoryCreated, gitInitialized, initialCommitCreated: false, init }
  }

  let initialCommitCreated = false
  if (needsInitialCommit && !hasGitCommit(root)) {
    createInitialProjectCommit(root, seedBefore)
    initialCommitCreated = true
  }

  catalogAdd(root)
  return { ok: true, root, directoryCreated, gitInitialized, initialCommitCreated, ...(init ? { init } : {}) }
}

// The dashboard edits the committed, portable source file verbatim. The host fixes the filename (there
// is no browser-supplied path), works for offline projects, and uses a content revision so a save cannot
// clobber a concurrent agent/user edit. .spec/spexcode.local.json stays outside this surface by contract.
type ProjectConfigSource = { content: string; revision: string }
let configWriteSeq = 0
const configRevision = (raw: string | null): string => createHash('sha256').update(raw === null ? 'missing' : `present\0${raw}`).digest('hex')

function readProjectConfig(root: string): ProjectConfigSource {
  const preferred = join(root, '.spec', 'spexcode.json')
  try {
    const content = readFileSync(preferred, 'utf8')
    return { content, revision: configRevision(content) }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    const legacy = join(root, 'spexcode.json')
    try {
      const content = readFileSync(legacy, 'utf8')
      console.error(`配置已迁到 .spec/，请移动（git mv spexcode.json .spec/；本机的 spexcode.local.json 手动移）：${legacy}`)
      return { content, revision: configRevision(content) }
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code === 'ENOENT') return { content: '{}\n', revision: configRevision(null) }
      throw legacyError
    }
  }
}

function writeProjectConfig(root: string, content: string, revision: string): ProjectConfigSource {
  const current = readProjectConfig(root)
  if (revision !== current.revision) {
    const e = new Error('.spec/spexcode.json changed on disk — reload before saving') as Error & { status?: number }
    e.status = 409
    throw e
  }
  let parsed: unknown
  try { parsed = JSON.parse(content) }
  catch (e) {
    const err = new Error(`.spec/spexcode.json is not valid JSON: ${(e as Error).message}`) as Error & { status?: number }
    err.status = 400
    throw err
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const e = new Error('.spec/spexcode.json must contain one top-level JSON object') as Error & { status?: number }
    e.status = 400
    throw e
  }

  const normalized = content.endsWith('\n') ? content : `${content}\n`
  const file = join(root, '.spec', 'spexcode.json')
  const tmp = join(dirname(file), `.spexcode.json.${process.pid}.${++configWriteSeq}.tmp`)
  mkdirSync(dirname(file), { recursive: true })
  try {
    writeFileSync(tmp, normalized)
    renameSync(tmp, file)
  } finally {
    try { rmSync(tmp) } catch { /* rename consumed it / write never created it */ }
  }
  return { content: normalized, revision: configRevision(normalized) }
}

type HarnessTargetInput = string | { plugin?: unknown }
type AddedHarnessLauncher = { name: string; harness: string; cmd: string }
export type AddHarnessTargetResult = {
  ok: boolean
  target: string | { plugin: string }
  harnesses: Array<string | { plugin: string }>
  launcher?: AddedHarnessLauncher
  content: string
  revision: string
  materialize: { code: number | null; output: string }
}

const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)

function normalizedHarnessTarget(value: unknown): string | { plugin: string } {
  if (typeof value === 'string') {
    const id = value.trim()
    if (!id) throw Object.assign(new Error('target must be a non-empty harness id'), { status: 400 })
    return id
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const folder = (value as HarnessTargetInput & { plugin?: unknown }).plugin
    if (typeof folder !== 'string' || !folder.trim()) {
      throw Object.assign(new Error('target plugin must be an explicit, non-empty folder string'), { status: 400 })
    }
    return { plugin: folder.trim() }
  }
  throw Object.assign(new Error('target must be a native harness id string or {"plugin":"<folder>"}'), { status: 400 })
}

function sameHarnessTarget(left: unknown, right: string | { plugin: string }): boolean {
  if (typeof left === 'string' && typeof right === 'string') return left.trim() === right
  if (left && typeof left === 'object' && !Array.isArray(left) && typeof right === 'object') {
    return typeof (left as any).plugin === 'string' && (left as any).plugin.trim() === right.plugin
  }
  return false
}

function objectConfig(value: unknown, message: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error(message), { status: 400 })
  }
  return value as Record<string, any>
}

// The template is the one source for the safe, portable command paired with a newly selected native
// target. It keeps this host operation aligned with `spex init` (including the headless exceptions) without
// restating a second command table here.
function templateLauncherForHarness(harness: string): { harness: string; cmd: string } | undefined {
  const template = readJsonConfig(templateConfigPath)
  const launchers = template?.sessions?.launchers
  if (!launchers || typeof launchers !== 'object' || Array.isArray(launchers)) return undefined
  const match = Object.values(launchers).find((entry: any) => entry?.harness === harness && typeof entry?.cmd === 'string' && entry.cmd.trim()) as any
  return match ? { harness, cmd: match.cmd } : undefined
}

function launcherForHarness(launchers: Record<string, any>, harness: string): AddedHarnessLauncher | undefined {
  for (const [name, value] of Object.entries(launchers)) {
    const id = typeof value?.harness === 'string' ? value.harness : 'claude'
    if (id === harness && typeof value?.cmd === 'string' && value.cmd.trim()) return { name, harness: id, cmd: value.cmd }
  }
  return undefined
}

function freeLauncherName(launchers: Record<string, any>, preferred: string): string {
  if (!own(launchers, preferred)) return preferred
  let i = 2
  while (own(launchers, `${preferred}-${i}`)) i++
  return `${preferred}-${i}`
}

// Add one persistent delivery target through the same source/config seam used by the Projects editor.
// The operation is idempotent for an already-present target, but still re-runs materialize so a failed
// previous attempt can be retried after its generated footprint was repaired.
export async function addHarnessTarget(root: string, input: unknown, expectedRevision?: string): Promise<AddHarnessTargetResult> {
  const current = readProjectConfig(root)
  const revision = expectedRevision ?? current.revision
  if (revision !== current.revision) {
    throw Object.assign(new Error('.spec/spexcode.json changed on disk — reload before adding a harness target'), { status: 409 })
  }

  let cfg: Record<string, any>
  try { cfg = objectConfig(JSON.parse(current.content), '.spec/spexcode.json must contain one top-level JSON object') }
  catch (e) {
    if ((e as any)?.status) throw e
    throw Object.assign(new Error(`.spec/spexcode.json is not valid JSON: ${(e as Error).message}`), { status: 400 })
  }

  // A local harness selection changes the effective policy and cannot be silently shadowed by a portable
  // write. Existing local launcher definitions are fine when they already cover the target; otherwise the
  // operation refuses and points at the intentional host-specific edit surface.
  const local = readJsonConfig(join(root, '.spec', 'spexcode.local.json'))
  if (!local || typeof local !== 'object' || Array.isArray(local)) {
    throw Object.assign(new Error('.spec/spexcode.local.json must contain one top-level JSON object'), { status: 400 })
  }
  if (own(local, 'harnesses')) {
    throw Object.assign(new Error('.spec/spexcode.local.json overrides harnesses — edit that host-specific selection explicitly before adding a portable target'), { status: 409 })
  }
  if (own(local, 'sessions') && (!local.sessions || typeof local.sessions !== 'object' || Array.isArray(local.sessions))) {
    throw Object.assign(new Error('.spec/spexcode.local.json sessions must be an object'), { status: 400 })
  }
  const localSessions = local?.sessions && typeof local.sessions === 'object' && !Array.isArray(local.sessions) ? local.sessions : null
  const localLaunchersOverride = !!localSessions && own(localSessions, 'launchers')
  // The policy field is required. This action extends an explicit selection, but never turns an
  // unadopted project into an implicitly selected one and bypasses the init repair gate.
  const portableRaw = own(cfg, 'harnesses') ? cfg.harnesses : undefined
  try { resolveHarnessTargets(portableRaw) }
  catch (e) { throw Object.assign(new Error((e as Error).message), { status: 400 }) }
  if (!Array.isArray(portableRaw)) {
    throw Object.assign(new Error('.spec/spexcode.json "harnesses" must be an ARRAY before a target can be added'), { status: 400 })
  }
  const target = normalizedHarnessTarget(input)
  const present = portableRaw.some((entry: unknown) => sameHarnessTarget(entry, target))
  const nextRaw = present ? [...portableRaw] : [...portableRaw, target]
  try { resolveHarnessTargets(nextRaw) }
  catch (e) { throw Object.assign(new Error((e as Error).message), { status: 400 }) }

  const sessions = cfg.sessions === undefined ? {} : objectConfig(cfg.sessions, '.spec/spexcode.json sessions must be an object')
  const portableLaunchers = sessions.launchers === undefined ? {} : objectConfig(sessions.launchers, '.spec/spexcode.json sessions.launchers must be an object')
  const effectiveLaunchers = localLaunchersOverride
    ? objectConfig(localSessions!.launchers, '.spec/spexcode.local.json sessions.launchers must be an object')
    : portableLaunchers
  let launcher: AddedHarnessLauncher | undefined
  if (typeof target === 'string') {
    launcher = launcherForHarness(effectiveLaunchers, target)
    if (!launcher && localLaunchersOverride) {
      throw Object.assign(new Error(`.spec/spexcode.local.json overrides sessions.launchers and has no launcher for '${target}' — add that launcher in the local config first`), { status: 409 })
    }
    if (!launcher) {
      const template = templateLauncherForHarness(target)
      // zcode is a valid delivery adapter but has no safe launcher template; materialize its files without
      // inventing a command that may not exist on the adopter's machine.
      if (template) {
        const name = freeLauncherName(portableLaunchers, target)
        portableLaunchers[name] = { harness: template.harness, cmd: template.cmd }
        launcher = { name, harness: template.harness, cmd: template.cmd }
        sessions.launchers = portableLaunchers
        // A new profile becomes the default only when neither config layer has one. Existing defaults are a
        // deliberate project choice and must keep their semantics.
        if (!own(sessions, 'defaultLauncher') && !(localSessions && own(localSessions, 'defaultLauncher'))) sessions.defaultLauncher = name
      }
    }
  }

  cfg.harnesses = nextRaw
  if (Object.keys(sessions).length) cfg.sessions = sessions
  const saved = writeProjectConfig(root, `${JSON.stringify(cfg, null, 2)}\n`, revision)
  const materialized = await runSpex(root, ['materialize'])
  return {
    ok: materialized.code === 0,
    target,
    harnesses: nextRaw as Array<string | { plugin: string }>,
    ...(launcher ? { launcher } : {}),
    content: saved.content,
    revision: saved.revision,
    materialize: materialized,
  }
}

function writeProjectIcon(root: string, icon: unknown, revision: string): ProjectConfigSource & { identity: ResolvedIdentity } {
  const canonical = requireIdentityChoice(icon)
  const current = readProjectConfig(root)
  let config: Record<string, any>
  try { config = JSON.parse(current.content) }
  catch (e) {
    const error = new Error(`.spec/spexcode.json is not valid JSON: ${(e as Error).message}`) as Error & { status?: number }
    error.status = 400
    throw error
  }
  const dashboard = config.dashboard === undefined
    ? {}
    : config.dashboard && typeof config.dashboard === 'object' && !Array.isArray(config.dashboard)
      ? config.dashboard
      : null
  if (!dashboard) {
    const error = new Error('.spec/spexcode.json dashboard must be an object before its icon can be changed') as Error & { status?: number }
    error.status = 400
    throw error
  }
  const saved = writeProjectConfig(root, `${JSON.stringify({ ...config, dashboard: { ...dashboard, icon: canonical } }, null, 2)}\n`, revision)
  return { ...saved, identity: resolveProjectIdentity(root, root) }
}

function freeTcpPort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = net.createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) })
  })
}

// start an OFFLINE project's backend: spawn a detached `spex serve --port <free>` whose lifetime is
// independent of the gateway (it owns its record exactly like a hand-run serve), log to the project's
// runtime tier, and wait for its instance-validated record to reconcile online.
export async function startBackend(root: string, waitMs = 45_000): Promise<ProjectEntry> {
  const port = await freeTcpPort()
  const logDir = join(spexcodeHome(), 'projects', encodeProject(root))
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, 'serve.log')
  const log = openSync(logFile, 'a')
  const child = spawn(process.execPath, [...cliArgs, 'serve', '--port', String(port)],
    { cwd: root, env: scrubbedEnv(), detached: true, stdio: ['ignore', log, log] })
  child.unref()
  closeSync(log)   // the child holds its own copy; keep no fd open in the gateway
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500))
    const entry = (await reconcileNow()).find((p) => p.root === root && p.online)
    if (entry) return entry
  }
  throw new Error(`backend for ${root} did not come online within ${Math.round(waitMs / 1000)}s — see ${logFile}`)
}


// ── the operator verb: `spex dashboard` = the hub + the host extensions ─────────────────────────────
// The hub ([[gateway-hub]]) is the ONE routing + authorization server; this layer never runs a second
// gateway or a second auth check beside it. What the host adds rides the hub's extension seam:
//   listProjects — GET /projects rows come from the instance-validated reconciler + the durable catalog
//                  (online/offline/root), each carrying the hub's gating state.
//   adminRoute   — /projects/stream (SSE), GET /projects/browse + POST /projects (select/setup/register), DELETE /projects/:id
//                  (high-friction catalog removal), raw .spec/spexcode.json
//                  GET|PUT /projects/:id/config, POST /projects/:id/harnesses, and POST /projects/:id/(init|doctor|serve) — all
//                  behind the hub's admin scope
//                  ([[gateway-auth]]: implicit from loopback until an admin password exists).
//   fallback     — the dashboard SPA shell + assets for paths the hub doesn't own.
// /p/:projectId/* routing (HTTP, SSE, WS; prefix strip; cookie strip) belongs entirely to the hub.

// tls is the HUB's transport option passed through unchanged ([[gateway-hub]] terminates HTTPS itself),
// so an operator deployment runs the ONE host gateway directly over TLS — no second proxy in front.
// Absent tls = the default plain-HTTP loopback `spex dashboard` serves.
export type HostDashboardOpts = { port: number; host?: string; distDir?: string; tls?: { cert: string; key: string } | null }
export type HostDashboard = { server: http.Server; close: () => Promise<void>; hostRecord: HostRecord }

const json = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy() })
    req.on('end', () => resolve(body))
  })
}

export function startHostDashboard(opts: HostDashboardOpts): HostDashboard {
  const distDir = opts.distDir ?? resolveDistDir()

  const peers = new MachinePeerGateway()
  // a refused control socket is reclaimed inside start(); only a LIVE owner rejects, and that is fatal for a host
  void peers.start().catch((error: unknown) => {
    console.error(`spex dashboard: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  })

  const sseClients = new Set<http.ServerResponse>()
  let lastBroadcast = ''
  // reconcile → push the fresh list to every /projects/stream subscriber when it changed.
  async function tick(): Promise<ProjectEntry[]> {
    const list = await reconcileNow()
    const j = JSON.stringify(list)
    if (j !== lastBroadcast) { lastBroadcast = j; for (const c of sseClients) c.write(`data: ${j}\n\n`) }
    return list
  }

  const extensions: HubExtensions = {
    hostRoute: (req, res, path) => {
      if (path === '/host' && req.method === 'GET') { json(res, 200, collectHostFacts()); return true }
      if (path === '/host/doctor' && req.method === 'POST') {
        void runSpex(process.cwd(), ['doctor', '--host']).then((r) => json(res, 200, { ok: r.code === 0, code: r.code, output: r.output }))
        return true
      }
      return false
    },
    // the hub's GET /projects rows, host-enriched: every cataloged/claimed project (not only live
    // records), instance-validated online state, and the hub's own gating flag per row. `id` mirrors
    // projectId — the hub's documented row key, kept so both shapes read the same list.
    listProjects: async (store) => (await tick()).map((p) => ({ id: p.projectId, ...p, gated: !!store.projects[p.projectId] })),

    adminRoute: async (req, res, path) => {
      if (path === '/projects/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(`data: ${JSON.stringify(await tick())}\n\n`)
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return true
      }
      if (path === '/projects/browse' && req.method === 'GET') {
        const requested = new URL(req.url ?? path, 'http://localhost').searchParams.get('path') ?? ''
        try { json(res, 200, browseProjectDirectories(requested)) }
        catch (e) { json(res, 400, { error: (e as Error).message }) }
        return true
      }
      if (path === '/projects' && req.method === 'POST') {
        let body: any = {}
        try { body = JSON.parse(await readBody(req) || '{}') } catch { /* malformed body */ }
        const root = String(body?.root ?? '').trim()
        if (!root) { json(res, 400, { error: 'body must be {"root": "/abs/path/to/repo"}' }); return true }
        if (body.init !== undefined && (!body.init || typeof body.init !== 'object' || Array.isArray(body.init))) {
          json(res, 400, { error: 'init must be {"harness":"<ids>","preset":"<optional>"}' })
          return true
        }
        try {
          const setup = await addKnownProjectWithSetup(root, {
            createDir: body.createDir === true,
            initGit: body.initGit === true,
            ...(body.init ? { init: { harness: body.init.harness, ...(body.init.preset !== undefined ? { preset: body.init.preset } : {}) } } : {}),
          })
          if (!setup.ok) {
            json(res, 422, { error: 'spex init failed', ...setup })
            return true
          }
          const entry = (await tick()).find((p) => p.root === setup.root)
          json(res, 200, { ...(entry ?? {
            projectId: encodeProject(setup.root), root: setup.root,
            identity: resolveProjectIdentity(setup.root, setup.root), configRevision: readProjectConfig(setup.root).revision,
            online: false, url: null,
          }), setup })
        } catch (e) { json(res, 400, { error: (e as Error).message }) }
        return true
      }
      const remove = path.match(/^\/projects\/([^/]+)$/)
      if (remove && req.method === 'DELETE') {
        const projectId = decodeURIComponent(remove[1])
        if (!projectId) {
          json(res, 404, { error: 'unknown project' }); return true
        }
        let body: any = {}
        try { body = JSON.parse(await readBody(req) || '{}') } catch { /* validation below is the answer */ }
        try {
          const list = await reconcileNow()
          const entry = list.find((p) => p.projectId === projectId)
          if (!entry) { json(res, 404, { error: `unknown project '${projectId}'` }); return true }
          const removed = removeKnownProject(entry.root, typeof body?.confirmation === 'string' ? body.confirmation : '')
          json(res, 200, { ok: true, ...removed })
        } catch (e) {
          const error = e as Error & { status?: number }
          json(res, error.status ?? 400, { error: error.message })
        }
        return true
      }
      if (path === '/projects/icon' && req.method === 'PUT') {
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' }); return true }
        if (typeof body?.icon !== 'string' || typeof body?.revision !== 'string') {
          json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' })
          return true
        }
        try { json(res, 200, { ok: true, gateway: writeGatewayIcon(body.icon, body.revision) }) }
        catch (e) { json(res, (e as any).status ?? 400, { error: (e as Error).message }) }
        return true
      }
      const icon = path.match(/^\/projects\/([^/]+)\/icon$/)
      if (icon && req.method === 'PUT') {
        const projectId = decodeURIComponent(icon[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' }); return true }
        if (typeof body?.icon !== 'string' || typeof body?.revision !== 'string') {
          json(res, 400, { error: 'body must be {"icon":"<choice>","revision":"..."}' })
          return true
        }
        try { json(res, 200, { ok: true, ...writeProjectIcon(entry.root, body.icon, body.revision) }) }
        catch (e) { json(res, (e as any).status ?? 400, { error: (e as Error).message }) }
        return true
      }
      const config = path.match(/^\/projects\/([^/]+)\/config$/)
      if (config && (req.method === 'GET' || req.method === 'PUT')) {
        const projectId = decodeURIComponent(config[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        if (req.method === 'GET') {
          try { json(res, 200, readProjectConfig(entry.root)) }
          catch (e) { json(res, 500, { error: `cannot read .spec/spexcode.json: ${(e as Error).message}` }) }
          return true
        }
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"content":"...","revision":"..."}' }); return true }
        if (typeof body?.content !== 'string' || typeof body?.revision !== 'string') {
          json(res, 400, { error: 'body must be {"content":"...","revision":"..."}' })
          return true
        }
        try { json(res, 200, { ok: true, ...writeProjectConfig(entry.root, body.content, body.revision) }) }
        catch (e) { json(res, (e as any).status ?? 500, { error: (e as Error).message }) }
        return true
      }
      const harnesses = path.match(/^\/projects\/([^/]+)\/harnesses$/)
      if (harnesses && req.method === 'POST') {
        const projectId = decodeURIComponent(harnesses[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        let body: any
        try { body = JSON.parse(await readBody(req) || '{}') }
        catch { json(res, 400, { error: 'body must be {"target":"<harness id>","revision":"..."}' }); return true }
        if (typeof body?.revision !== 'string' || !body.revision) {
          json(res, 400, { error: 'body must include a non-empty "revision" from GET /projects/:id/config' }); return true
        }
        if (body?.target === undefined) {
          json(res, 400, { error: 'body must include "target" (a native harness id or {"plugin":"<folder>"})' }); return true
        }
        try {
          const result = await addHarnessTarget(entry.root, body.target, body.revision)
          if (!result.ok) {
            json(res, 422, { error: 'spex materialize failed', ...result })
            return true
          }
          json(res, 200, result)
        } catch (e) {
          const error = e as Error & { status?: number }
          json(res, error.status ?? 400, { error: error.message })
        }
        return true
      }
      const op = path.match(/^\/projects\/([^/]+)\/(init|doctor|serve)$/)
      if (op && req.method === 'POST') {
        const projectId = decodeURIComponent(op[1])
        const entry = (await reconcileNow()).find((p) => p.projectId === projectId)
        if (!entry) { json(res, 404, { error: `unknown project '${projectId}' — add it first (POST /projects)` }); return true }
        if (op[2] === 'serve') {
          if (entry.online) { json(res, 409, { error: `backend already online at ${entry.url}`, project: entry }); return true }
          try { json(res, 200, { ok: true, project: await startBackend(entry.root) }) }
          catch (e) { json(res, 502, { error: (e as Error).message }) }
          return true
        }
        let body: any = {}
        try { body = JSON.parse(await readBody(req) || '{}') } catch { /* malformed body → defaults */ }
        const args = op[2] === 'init'
          ? ['init', ...(body?.harness ? ['--harness', String(body.harness)] : []), ...(body?.preset ? ['--preset', String(body.preset)] : [])]
          : ['doctor']
        const r = await runSpex(entry.root, args)
        json(res, 200, { ok: r.code === 0, code: r.code, output: r.output })
        return true
      }
      return false
    },

    fallback: (req, res, path) => serveStatic(req, res, distDir, path),
  }

  const hostRecord = newHostRecord(`${opts.tls ? 'https' : 'http'}://${opts.host && opts.host !== '0.0.0.0' ? opts.host : '127.0.0.1'}:${opts.port}`)
  const server = startHubGateway({
    port: opts.port, host: opts.host ?? '127.0.0.1', tls: opts.tls ?? null, extensions,
    onListen: (actualPort) => {
      hostRecord.url = `${opts.tls ? 'https' : 'http'}://${opts.host && opts.host !== '0.0.0.0' ? opts.host : '127.0.0.1'}:${actualPort}`
      publishHostRecord(hostRecord)
    },
    onBindFail: () => dropOwnHostRecord(hostRecord.instanceId),
  })

  // continuous reconciliation: the stream stays live without a client-side poll and the list the hub
  // serves stays fresh. Heartbeat comments keep intermediaries from timing the stream out. Both timers
  // unref'd — the SERVER holds the process open, not the loops.
  const loop = setInterval(() => void tick().catch((e) => console.error(`[host] reconcile failed: ${(e as Error).message}`)), 2500)
  loop.unref()
  const ping = setInterval(() => { for (const c of sseClients) c.write(': ping\n\n') }, 10_000)
  ping.unref()

  return {
    server,
    close: async () => {
      clearInterval(loop); clearInterval(ping)
      for (const c of sseClients) c.destroy()
      sseClients.clear()
      await peers.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections?.()
      dropOwnHostRecord(hostRecord.instanceId)
    },
    hostRecord,
  }
}
