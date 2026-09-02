import { execFileSync, spawn } from 'node:child_process'
import { createConnection } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync, linkSync, mkdirSync, rmSync, readdirSync, realpathSync, statSync, unlinkSync, type Dirent } from 'node:fs'
import { join, dirname, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rm as rmAsync, readdir as readdirAsync } from 'node:fs/promises'
import { seedWorktreeHostState } from './worktree-sources.js'
import { git, gitA, gitTry, repoRoot, mergeBaseDiff, mergeConflicts, parseStatPath, withGitAbortSignal, isGitObjectId, type ReviewDiffFile } from '@spexcode/spec-core'
import { loadConfig, loadSpecs, loadSpecsLite, type ConfigPreset, type SpecLite } from '@spexcode/spec-core'
import { adapterLoadedReferenceState, assertRvSockPath, defaultHarness, sessionIdentityEnvVars, defaultLauncher, harnessById, procSnapshot, resolveLauncher, rendezvousListening, stampRvSock, type AdapterLoadedReferenceState, type Harness, type HarnessLaunchReadinessFence, type TurnFailure, type FailureSubscription, type DispatchResult, type PaneProbe, type ProcTable } from './harness.js'
import { materialize } from './materialize.js'
import { mainBranch, mainRoot, gitCommonDir, readConfig, runtimeRoot, treeSlotDir, sessionStoreDir, sessionArtifactPath, listSessionIds, readRecordEntry, readPublicRecordEntry, envSessionId, type PublicRecordEntry, type SessionLifecycle, type SessionProposal } from '@spexcode/spec-core'
import { readSessionFiles } from './session-files.js'
import { readSessionWebs, type SessionWeb } from './session-web.js'
import { acquireFreshSessionApplicationForCreate, configuredSessionApplicationIfCutover, initializeFreshSessionApplication, releaseFreshSessionApplicationForCreate, sessionApplicationCutoverState, setSessionApplicationCommitWake } from './session-application.js'
import { type ProductionSessionApplication } from '@spexcode/session-application'
import { decodeEventJson } from '@spexcode/session-events'
import { withDeliveryLocks } from './delivery-lock.js'
import { withRecordLock, withRecordLockSync, readRecord, readLiveRecord, writeRecord, fromRaw, hasValidColdProof, coldProofFor, launchReadinessPending, restoreLaunchReadinessOriginal, retirementReason, corruptReason, assertLegacyJsonWritesAllowed, type SessRec, type DiffComment, SessionRecordUnusable, setRecordTransitionNotifier, setRecordTransitionWrapper, backendLaunchAuthority, canDrainQueued } from './session-record.js'
import { stripRefSigil } from './mentions.js'
import { shQuote } from './sh.js'
import { assertSessionOwnerSafe, assertSessionStopSafe, collectResourceReport, ResourceConflict } from './host-resources.js'
import { processStartToken } from '@spexcode/spec-core'
import { bindCodexGeneration, codexGenerationBindingForSession, commitCodexGenerationRegistration, prepareCodexGenerationRegistration, readCodexGenerationLedger } from './codex-runtime-generations.js'
import { cliEntrypointArgs } from './tsx-bin.js'
import { lastHumanSendVia } from './session-timeline.js'
import { TMUX_PROBE_TIMEOUT_MS, TARGET_PROBE_TIMEOUT_MS, TARGET_TMUX_CLOSE_SETTLE_MS, sessionHost, probeTimedOut } from './session-host.js'

const DEFER_FOOTPRINT_REFRESH = { SPEXCODE_DEFER_FOOTPRINT_REFRESH: 'session-create' }
const HARNESS = defaultHarness
const COLS = 120, ROWS = 32
const DEFAULT_MAX_ACTIVE = 8

const worktreeTrashDir = (root: string): string => join(root, '.worktrees', '.trash')
const pendingTrashDeletes: string[] = []
let trashDeleteRunning = false
let trashDeleteScheduled = false

async function drainWorktreeTrash(): Promise<void> {
  while (pendingTrashDeletes.length) {
    const path = pendingTrashDeletes.shift()!
    try {
      await rmAsync(path, { recursive: true, force: true })
      if (existsSync(path)) throw new Error('path remains after recursive removal')
    } catch (error) {
      console.error(`spex: deferred worktree deletion failed for ${path}; retained for next backend startup: ${error instanceof Error ? error.message : error}`)
    }
  }
  trashDeleteRunning = false
}

function queueWorktreeTrash(path: string): void {
  pendingTrashDeletes.push(path)
  if (trashDeleteRunning || trashDeleteScheduled) return
  trashDeleteScheduled = true
  setImmediate(() => {
    trashDeleteScheduled = false
    trashDeleteRunning = true
    void drainWorktreeTrash()
  })
}

/** Start the one process-local serial reaper and resume any crash leftovers. */
export function startWorktreeTrashReaper(): void {
  const dir = worktreeTrashDir(mainRoot())
  readdirAsync(dir, { withFileTypes: true }).then((entries) => {
    for (const entry of entries) queueWorktreeTrash(join(dir, entry.name))
  }).catch((error: NodeJS.ErrnoException) => {
    if (error?.code !== 'ENOENT') console.error(`spex: deferred worktree trash cleanup failed for ${dir}; retrying next startup: ${error instanceof Error ? error.message : error}`)
  })
}

function moveWorktreeToTrash(root: string, path: string): string {
  const worktrees = resolve(join(root, '.worktrees'))
  const source = resolve(path)
  // Session creation uses <root>/.worktrees/<name>. Keep an adjacent trash for legacy/manual records whose
  // recorded path predates that layout; the normal product path always lands in the governed .worktrees/.trash.
  const parent = dirname(source)
  const dir = parent === worktrees ? worktreeTrashDir(root) : join(parent, '.trash')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `wt-${Date.now()}-${randomUUID().slice(0, 12)}`)
  renameSync(source, target)
  return target
}
function maxActive(): number {
  let v: number | undefined
  try {
    const fromJson = readConfig(mainRoot()).sessions?.maxActive
    if (typeof fromJson === 'number' && Number.isFinite(fromJson)) v = fromJson
  } catch { /* config unreadable — fall through to env/default */ }
  if (v === undefined) { const e = Number(process.env.SPEXCODE_MAX_ACTIVE); if (Number.isFinite(e) && e > 0) v = e }
  return Math.max(1, Math.floor(v ?? DEFAULT_MAX_ACTIVE))
}

// The adapter owns any transport bootstrap env (rendezvous daemon + socket); product launch only composes it
// with the governed session id and home vars. This env prefix also ensures hooks + materialize write to the
// SAME store the backend uses. SPEXCODE_HOME/CODEX_HOME are
// propagated when set, because the session inherits the tmux SERVER's env (not the backend's), so without this
// an overridden home would silently leak the session's hook-state + codex-trust to the default ~/.spexcode /
// ~/.codex. Deterministic: the session's store = the backend's store, never the ambient env's.
const rvEnv = (id: string, harness = HARNESS, nativeStartToken?: string | null) => {
  // SPEXCODE_SESSION_ID is the governed record id, and it is the SESSION'S OWN — so the launch STRIPS every
  // session-identity variable it may have inherited (the pane inherits the tmux SERVER's env, which may carry
  // a foreign session's ids from whoever started it) before setting this one. Identity is established HERE,
  // once, at the boundary; nothing downstream re-verifies it, because after this a session-identity variable
  // exists in a process only if that process belongs to that session — either set right here, or stamped by
  // the harness itself for its own acting conversation ([[harness-adapter]]). The same strip runs on the one
  // other process we own that is NOT a session's own — codex's shared app-server, whose leaked inherited id
  // was github#76.
  const scrub = sessionIdentityEnvVars().map((v) => `-u ${v}`)
  const homeVars = ['SPEXCODE_HOME', 'CODEX_HOME'].flatMap((v) => {
    const value = process.env[v]
    return value ? [`${v}=${value}`] : []
  })
  return [...scrub,
    `SPEXCODE_SESSION_ID=${id}`,
    `SPEXCODE_SESSION_IDENTITY_VARS=${shQuote(sessionIdentityEnvVars().join(','))}`,
    `SPEXCODE_PROJECT_ROOT=${shQuote(mainRoot())}`,
    ...(nativeStartToken ? [`SPEXCODE_NATIVE_START_TOKEN=${shQuote(nativeStartToken)}`] : []),
    ...harness.launchEnv(id), ...homeVars].join(' ')
}

// Re-exported for existing importers.
export type { DispatchResult }

type Lifecycle = SessionLifecycle
type Proposal = SessionProposal
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'starting' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued' | 'unknown' | 'corrupt' | 'retired'
export type Liveness = 'online' | 'starting' | 'offline' | 'unknown'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

// Awaiting is the durable lifecycle row; its proposal selects the user-facing display status. Keep this
// projection in the session package so backend reconciliation and offline client reads cannot drift apart.
export function displayStatusForProposal(proposal: Proposal | null | undefined): DisplayStatus {
  return PROPOSAL_STATUS[proposal ?? 'nothing']
}

export type Session = {
  id: string; branch: string | null; path: string
  label: string; title: string   // `label` remains the stable search handle; `title` is the one visible session name
  raw: { name: string | null; title: string | null }   // the bare parts, for explicit consumers only (rename prefill)
  parent: string | null   // the SPAWNING session's id ([[session-nesting]]) — set once at creation when `spex session new` ran inside another session, else null; the frontend folds a child under it at read time
  harness: string   // which harness (claude|codex) runs this session — carried so liveness/occupancy route through its adapter
  capabilities: { headless: boolean }   // stable adapter projection; console surfaces consume data, never harness ids
  launcher: string | null   // the launcher profile this session launched under ([[launcher-select]]); null only for old records predating launchers
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; liveness: Liveness; note: string | null
  archived: boolean   // cold storage ([[archive]]) — successful records are offline; default views exclude them
  closedAt: string | null // exact close publication time; null on working and pre-field archived records
  archiveHazard?: string | null // explicit legacy/invariant violation; never hidden as a clean archive
  prompt: string | null; promptPreview: string | null; created: number; activity: string | null
  sortKey: number | null   // manual drag-reorder override ([[session-reorder]]); null = sort by `created`
  files?: string[]         // live posted paths ([[files]]), read from the session store with the rest of the projection
  web?: SessionWeb[]       // live posted loopback services ([[web]]), read from the session store with the rest of the projection
  zcodeChildSessionIds?: string[] // explicit ZCode worker identities; absent means this SpexCode session has no asserted worker association
}

// HTTP carries no authenticated session identity. A CLI may report its environment id, but that remains
// evidence supplied by the caller rather than authority over the target or a fact about who performed close.
export type CloseSource = { kind: 'unverified-session-claim'; id: string } | { kind: 'user' }

function normalizeCloseSource(raw: unknown): CloseSource {
  if (raw == null) return { kind: 'user' }
  if (!raw || typeof raw !== 'object') throw new ResourceConflict('refusing session close: source must be user or an unverified session claim')
  const source = raw as { kind?: unknown; id?: unknown }
  if (source.kind === 'user') return { kind: 'user' }
  if (source.kind === 'unverified-session-claim' && typeof source.id === 'string' && source.id.trim())
    return { kind: 'unverified-session-claim', id: source.id.trim() }
  throw new ResourceConflict('refusing session close: source must be user or an unverified session claim')
}

function storeDir(id: string): string { const d = sessionStoreDir(id); mkdirSync(d, { recursive: true }); return d }

function readPromptFile(id: string): string | null {
  try {
    const p = sessionArtifactPath(id, 'prompt')
    if (!existsSync(p)) return null
    const s = readFileSync(p, 'utf8')
    return s.trim() ? s : null
  } catch { return null }
}
// The resolved first-turn payload is authoritative across queue drain and recovery. Adapters that mint native
// identity keep it until they prove identity + first-turn durability; other adapters consume on submission.
function readLaunchFile(id: string): string | null {
  try { const p = sessionArtifactPath(id, 'launch'); return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null }
}
function removeLaunchFile(id: string): void {
  try { rmSync(sessionArtifactPath(id, 'launch'), { force: true }) } catch { /* best-effort */ }
}

// One line, bounded — the launch prompt's shape when it enters a compact headline.
export const HEADLINE_PREVIEW_COLUMNS = 60
function isBareUrl(text: string): boolean {
  return /^(?:https?|git|ssh):\/\/\S+$/i.test(text)
}
function oneLinePreview(text: string, n = HEADLINE_PREVIEW_COLUMNS): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const first = lines.find((line) => !isBareUrl(line)) || lines[0] || ''
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

export const deriveLabel = (r: { name?: string | null; title?: string | null; branch?: string | null; id: string }): string =>
  r.name || r.title || r.branch || r.id
export const deriveTitle = (r: { name?: string | null; activity?: string | null; note?: string | null; promptPreview?: string | null; title?: string | null; branch?: string | null; id: string }): string =>
  r.name || r.activity || (r.note ? oneLinePreview(r.note) : '') || (r.promptPreview ? oneLinePreview(r.promptPreview) : '') || r.title || r.branch || r.id
// Compatibility for package consumers that still import the old name.
export const deriveHeadline = deriveTitle

export const sessionLabel = (s: Session): string => s.label
export const sessionTitle = (s: Session): string => s.title
// Compatibility for older callers; all visible surfaces now resolve through `title`.
export const sessionHeadline = sessionTitle

async function hostOk(args: string[]): Promise<boolean> { try { await sessionHost().command(args); return true } catch { return false } }
export async function alive(id: string): Promise<boolean> { return hostOk(['has-session', '-t', id]) }

function pkgRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

export type WatchSource = 'manual' | 'parent'
type WatchEntry = { watcher: string; createdAt: string; sources: WatchSource[] }
export type SessionWatch = { target: string; createdAt: string }
function canonicalWatchEntries(target: string): WatchEntry[] | null {
  const application = configuredSessionApplicationIfCutover()
  if (!application) return null
  if (!application.readState(target)) return []
  const seen = new Map<string, WatchEntry>()
  for (const edge of application.topology.parents(target)) {
    if (edge.relationType !== 'parent' && !edge.relationType.startsWith('watch')) continue
    const source: WatchSource = edge.relationType === 'parent' || edge.relationType === 'watch:parent' ? 'parent' : 'manual'
    const current = seen.get(edge.fromSessionId)
    if (current) {
      if (!current.sources.includes(source)) current.sources.push(source)
      continue
    }
    seen.set(edge.fromSessionId, {
      watcher: edge.fromSessionId,
      createdAt: new Date(edge.createdAtMs).toISOString(),
      sources: [source],
    })
  }
  return [...seen.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.watcher.localeCompare(b.watcher))
}

function readWatchEntries(target: string): WatchEntry[] {
  const canonical = canonicalWatchEntries(target)
  if (canonical) return canonical
  throw new ResourceConflict('session application is unavailable; refusing the legacy watcher path')
}

function managedWatchRecord(id: string): SessRec {
  const rec = readRecord(id)
  if (!rec?.governed) throw new ResourceConflict(`session ${id} is not a governed session and cannot participate in a durable watch`)
  return rec
}

function watchMessage(target: SessRec): string {
  const status = target.status === 'awaiting'
    ? displayStatusForProposal(target.proposal)
    : target.status === 'active' ? 'working' : target.status
  const note = target.note ? ` — ${target.note}` : ''
  return `[spex watch] ${target.session} is ${status}${note}`
}

function shouldDeliverWatchTransition(target: SessRec, sources: readonly WatchSource[]): boolean {
  // @@@watch-delivery-policy - Relationship setup sends current state; manual opts into working changes.
  return target.status !== 'active' || sources.includes('manual')
}

function scheduleWatchNotifications(target: SessRec): void {
  const watchers = readWatchEntries(target.session)
    .filter((entry) => shouldDeliverWatchTransition(target, entry.sources))
    .map((entry) => entry.watcher)
  if (!watchers.length) return
  queueMicrotask(() => {
    for (const watcher of watchers) {
      void sendText(watcher, watchMessage(target), target.session, { allowStranded: true }).then((result) => {
        if (!result.ok) console.error(`spex session watch: could not deliver ${target.session} state to ${watcher}: ${result.error}`)
      })
    }
  })
}
setRecordTransitionNotifier(scheduleWatchNotifications)

export async function subscribeSessionWatch(watcher: string, targets: string[], source: WatchSource = 'manual'): Promise<{ watched: string[] }> {
  managedWatchRecord(watcher)
  const application = configuredSessionApplicationIfCutover()
  if (!application) throw new ResourceConflict('session application is unavailable; refusing the legacy watcher path')
  const watched: string[] = []
  const channel = source === 'parent' ? 'watch:parent' : 'watch:manual'
  for (const target of [...new Set(targets)]) {
    if (target === watcher) throw new ResourceConflict('a session cannot watch itself')
    const targetRecord = managedWatchRecord(target)
    try { application.attachWatcher(watcher, target, channel) }
    catch (error) {
      if (!(error instanceof Error) || !/already exists|duplicate|active topology edge/i.test(error.message)) throw error
    }
    const message = watchMessage(targetRecord)
    application.enqueueMessage(watcher, {
      kind: 'session.prompt.v1',
      body: Buffer.from(message, 'utf8'),
      senderSessionId: target,
      idempotencyKey: digest(`watch-initial-snapshot\0${watcher}\0${target}\0${source}\0${message}`),
    })
    watched.push(target)
  }
  return { watched }
}

export function listSessionWatches(watcher: string): SessionWatch[] {
  managedWatchRecord(watcher)
  const application = configuredSessionApplicationIfCutover()
  if (!application) throw new ResourceConflict('session application is unavailable; refusing the legacy watcher path')
  // `listWatchers` defaults to the bare `watch` channel. Canonical policy stores the source
  // (`watch:parent`/`watch:manual`) in the relation type, so listing must inspect every watch
  // channel or a valid parent watch appears to have disappeared.
  const edges = ['watch', 'watch:parent', 'watch:manual']
    .flatMap(channel => application.listWatchers(watcher, channel))
    .filter((edge, index, all) => all.findIndex(other => other.toSessionId === edge.toSessionId) === index)
  return edges
    .map(edge => ({ target: edge.toSessionId, createdAt: new Date(edge.createdAtMs).toISOString() }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.target.localeCompare(b.target))
}

export function cancelSessionWatch(watcher: string, targets: string[]): number {
  managedWatchRecord(watcher)
  const application = configuredSessionApplicationIfCutover()
  if (!application) throw new ResourceConflict('session application is unavailable; refusing the legacy watcher path')
  let cancelled = 0
  for (const target of [...new Set(targets)]) {
    for (const channel of ['watch:manual', 'watch']) {
      try { application.detachWatcher(watcher, target, channel); cancelled++; break }
      catch (error) {
        if (!(error instanceof Error) || !/does not exist|unknown/i.test(error.message)) throw error
      }
    }
  }
  return cancelled
}

export type SessionReparentResult = { children: string[]; parent: string | null; notified: string[] }

async function withRecordLocks<T>(ids: string[], body: () => Promise<T>, index = 0): Promise<T> {
  if (index >= ids.length) return body()
  return withRecordLock(ids[index], () => withRecordLocks(ids, body, index + 1))
}

function assertReparentable(children: string[], parent: string | null, records: Map<string, SessRec>): void {
  if (!children.length) throw new ResourceConflict('reparent needs at least one child session')
  if (parent) managedWatchRecord(parent)
  for (const id of children) {
    const child = records.get(id)
    if (!child?.governed) throw new ResourceConflict(`session ${id} is not a governed child session`)
    if (id === parent) throw new ResourceConflict('a session cannot be its own parent')
  }
  const childIds = new Set(children)
  const seen = new Set<string>()
  for (let current: string | null = parent; current; ) {
    if (childIds.has(current)) throw new ResourceConflict(`reparent would create a parent cycle through ${current}`)
    if (seen.has(current)) throw new ResourceConflict(`cannot reparent through malformed parent cycle at ${current}`)
    seen.add(current)
    current = readRecord(current)?.parent ?? null
  }
}

export async function reparentSessionRecords(rawChildren: string[], parent: string | null): Promise<SessionReparentResult> {
  const children = [...new Set(rawChildren)].sort()
  const application = configuredSessionApplicationIfCutover()
  if (!application) throw new ResourceConflict('session application is unavailable; refusing the legacy reparent path')
  const notify: SessRec[] = []
  await withRecordLock('session-reparent-transaction', async () => {
    const before = new Map(children.map((id) => [id, managedWatchRecord(id)]))
    assertReparentable(children, parent, before)
    const formerParents = [...new Set([...before.values()].flatMap((record) => record.parent ? [record.parent] : []))]
    await withRecordLocks([...children, ...formerParents].sort(), () => withDeliveryLocks(children, async () => {
      const current = new Map(children.map((id) => [id, managedWatchRecord(id)]))
      assertReparentable(children, parent, current)
      for (const [id, record] of current) {
        const state = application.readState(id)
        if (!state) throw new ResourceConflict(`session ${id} has no canonical application state during reparent`)
        if (state.parentSessionId !== record.parent) {
          throw new ResourceConflict(`session ${id} canonical/record parent mismatch: record=${record.parent ?? 'null'} canonical=${state.parentSessionId ?? 'null'}`)
        }
      }
      for (const [id, record] of current) {
        if (record.parent === parent) continue
        const change = application.transitionSession(id, { parentSessionId: parent, reason: 'reparent' })
        if (record.parent) {
          try { application.detachWatcher(record.parent, id, 'watch:parent') }
          catch (error) {
            if (!(error instanceof Error) || !/does not exist|unknown/i.test(error.message)) throw error
          }
          for (const message of application.readPendingMessages(id)) {
            if (message.senderSessionId === record.parent) application.dequeuePendingMessage(id, message.messageId)
          }
        }
        if (parent) {
          try { application.attachWatcher(parent, id, 'watch:parent') }
          catch (error) {
            if (!(error instanceof Error) || !/already exists|duplicate|active topology edge/i.test(error.message)) throw error
          }
          // The transition above published to the OLD watcher set. The new supervisor learns the child's current
          // state here, keyed by that transition's own event so a retried rewrite never sends it twice.
          const moved = { ...record, parent }
          application.enqueueMessage(parent, {
            kind: 'session.prompt.v1',
            body: Buffer.from(watchMessage(moved), 'utf8'),
            senderSessionId: id,
            idempotencyKey: digest(`reparent-snapshot\0${change.event.eventId}`),
          })
          notify.push(moved)
        }
      }
    }))
  })
  const notified = notify.map((child) => child.session)
  return { children, parent, notified }
}

// Share one liveness snapshot rather than spawning tmux for every displayed session.
export type LiveSnap = { probeFailed: boolean; windows: Map<string, PaneProbe>; titles: Map<string, string>; sockets: Set<string>; unproven: Set<string> }

// tmux rewrites CONTROL characters in a format string before printing them — 3.6a turns both a tab and a raw
// 0x1f into `_`, while 3.4 turns a raw 0x1f into the printable escape `\037`. So the field separator is ASKED
// FOR as that printable text, which every supported version passes through untouched, and the format is built
// from the same constant the parser splits on: the two can no longer disagree about what tmux actually emits.
const TMUX_PANE_SEPARATOR = '\\037'
export const TMUX_PANE_FORMAT = `#{session_name}${TMUX_PANE_SEPARATOR}#{pane_pid}${TMUX_PANE_SEPARATOR}#{pane_title}`

// First pane per session wins; split only twice so titles may contain the field separator.
export function parseLivePanes(out: string): Map<string, { panePid?: number; title?: string }> {
  const m = new Map<string, { panePid?: number; title?: string }>()
  for (const line of out.split('\n')) {
    if (!line) continue
    // Accept the former tab shape for callers replaying old snapshots; tmux itself emits TMUX_PANE_SEPARATOR.
    const separator = line.includes(TMUX_PANE_SEPARATOR) ? TMUX_PANE_SEPARATOR : '\t'
    const t1 = line.indexOf(separator)
    const name = (t1 < 0 ? line : line.slice(0, t1)).trim()
    if (!name || m.has(name)) continue   // first pane per session wins
    if (t1 < 0) { m.set(name, {}); continue }
    const rest = line.slice(t1 + separator.length)
    const t2 = rest.indexOf(separator)
    const pid = Number((t2 < 0 ? rest : rest.slice(0, t2)).trim())
    const title = t2 < 0 ? '' : rest.slice(t2 + separator.length)
    m.set(name, { panePid: Number.isFinite(pid) && pid > 0 ? pid : undefined, title: title || undefined })
  }
  return m
}

// Latch ESRCH per pid-file mtime so a recycled OS PID cannot revive an old session.
type PidEntry = { mtimeMs: number; pid: number; deadLatched: boolean }
const pidRegistry = new Map<string, PidEntry>()
function readAgentPid(p: string): number { try { return Number(readFileSync(p, 'utf8').trim()) } catch { return NaN } }
function agentAlive(id: string): boolean | undefined {
  const pidPath = sessionArtifactPath(id, 'agent.pid')
  let mtimeMs: number
  try { mtimeMs = statSync(pidPath).mtimeMs } catch { pidRegistry.delete(id); return undefined }   // no pid file → pre-registration
  let e = pidRegistry.get(id)
  if (!e || e.mtimeMs !== mtimeMs) { e = { mtimeMs, pid: readAgentPid(pidPath), deadLatched: false }; pidRegistry.set(id, e) }
  if (e.deadLatched) return false                                     // latched dead stays dead until a new write (fresh mtime)
  if (!Number.isFinite(e.pid) || e.pid <= 0) return false
  try { process.kill(e.pid, 0); return true }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true  // alive but not ours to signal
    e.deadLatched = true                                             // ESRCH → proven dead, latch it permanently
    return false
  }
}

// Only pre-agent.pid Codex sessions need the legacy whole-process scan.
export function needsCodexProcScan(windowed: { harness: string; hasPid: boolean }[]): boolean {
  return windowed.some((w) => (w.harness || 'claude') === 'codex' && !w.hasPid)
}

async function liveSnapshot(targetId?: string): Promise<LiveSnap> {
  const windows = new Map<string, PaneProbe>()
  const titles = new Map<string, string>()
  let out: string
  try {
    // ONE merged spawn replaces the old two (list-sessions + list-panes): window presence + pane pid + title.
    // A target-scoped close probe avoids unrelated panes turning a safe close into a global timeout.
    const args = targetId
      ? ['list-panes', '-t', targetId, '-F', TMUX_PANE_FORMAT]
      : ['list-panes', '-a', '-F', TMUX_PANE_FORMAT]
    out = await sessionHost().command(args, targetId ? TARGET_PROBE_TIMEOUT_MS : TMUX_PROBE_TIMEOUT_MS)
  } catch (e) {
    // a TIMEOUT/kill is a probe FAILURE (we can't tell who's alive → unknown, never a false graveyard). A clean
    // non-zero exit ("no server running" — genuinely zero sessions) is authoritative → the empty map = offline.
    return { probeFailed: probeTimedOut(e), windows, titles, sockets: new Set(), unproven: new Set() }
  }
  // the hot-tier pid verdict per windowed session (latch-consistent with hotSignature) + the legacy-scan gate.
  const legacy: { harness: string; hasPid: boolean }[] = []
  for (const [id, p] of parseLivePanes(out)) {
    windows.set(id, { panePid: p.panePid, pidAlive: agentAlive(id) })
    if (p.title) titles.set(id, p.title)
    if (windows.get(id)!.pidAlive === undefined) {
      // A corrupt row has no trustworthy harness to scan and renders liveness=unknown on its own. Letting this
      // optional legacy enrichment throw would turn one diagnosable row into a 409 for the entire board.
      try { const rec = readRecord(id); if (rec) legacy.push({ harness: rec.harness, hasPid: false }) }
      catch (e) { if (!(e instanceof SessionRecordUnusable)) throw e }
    }
  }
  // the whole-box ps table is gathered ONCE, and ONLY for the legacy pid-less-codex fallback (paneTreeRunsCodex).
  if (needsCodexProcScan(legacy)) {
    const procs = await procSnapshot().catch(() => undefined)   // codex-only, auxiliary; its failure isn't a liveness failure
    if (procs) for (const probe of windows.values()) probe.procs = procs
  }
  // LISTENER probe for every windowed session, once, in parallel (a live listener, not a lingering socket
  // file). A codex session has no rvSock → instant ENOENT → proven dead for the socket axis (codex ignores it).
  // The tri-state matters: 'unproven' (timeout/EAGAIN — a wedged or thrashed but possibly-alive listener) lands
  // in `unproven`, never silently not-live, so liveness() renders `unknown` not a false `offline` (issue #40).
  const ids = [...windows.keys()]
  // A burst of simultaneous Unix-socket connects can fill a Claude listener's accept backlog on macOS and
  // turn every healthy socket into `unproven`. Keep the probe bounded while preserving the tri-state result.
  const listening: Awaited<ReturnType<typeof rendezvousListening>>[] = []
  for (let start = 0; start < ids.length; start += 2) {
    listening.push(...await Promise.all(ids.slice(start, start + 2).map((id) => rendezvousListening(id))))
  }
  const sockets = new Set<string>()
  const unproven = new Set<string>()
  ids.forEach((id, i) => {
    if (listening[i] === 'live') sockets.add(id)
    else if (listening[i] === 'unproven') unproven.add(id)
  })
  return { probeFailed: false, windows, titles, sockets, unproven }
}

async function assertTargetTmuxAbsent(id: string, phase: string): Promise<void> {
  const deadline = Date.now() + TARGET_TMUX_CLOSE_SETTLE_MS
  let probeFailed = false
  do {
    const snap = await liveSnapshot(id)
    if (!snap.probeFailed && !snap.windows.has(id)) return
    probeFailed ||= snap.probeFailed
    if (Date.now() >= deadline) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  } while (true)
  throw new ResourceConflict(probeFailed
    ? `refusing to stop ${id}: target tmux absence is unproven ${phase}`
    : `refusing to stop ${id}: target tmux session remains ${phase}`)
}

// Avoid process spawns on the hot path; old sessions without agent.pid remain warm-tier only.
let hotIds: string[] = []
let hotIdsAt = 0
export async function hotSignature(): Promise<string> {
  const now = Date.now()
  if (now - hotIdsAt >= 1000) { hotIds = listSessionIds(); hotIdsAt = now }
  const pairs: string[] = []
  const present: string[] = []
  for (const id of hotIds) {
    const alive = agentAlive(id)
    if (alive === undefined) continue   // no agent.pid → the warm tier's concern, not the hot death detector
    present.push(id)
    pairs.push(`${id}:${alive ? 1 : 0}`)
  }
  // prune latch entries for ids no longer registered (closed sessions), keeping the registry bounded.
  const live = new Set(hotIds)
  for (const k of [...pidRegistry.keys()]) if (!live.has(k)) pidRegistry.delete(k)
  return pairs.sort().join(',') + '|' + present.sort().join(',')
}

// Include listener and title changes so watchers refresh without another store read.
export async function warmSignature(): Promise<string> {
  const snap = await liveSnapshot()
  return (snap.probeFailed ? 'PROBEFAIL|' : '') + [...snap.windows.keys()].sort().join(',') + '#' +
    [...snap.sockets].sort().join(',') + '~' + [...snap.unproven].sort().join(',') + '|' +
    [...snap.titles].sort().map(([k, v]) => `${k}=${v}`).join(',')
}

// @@@ paneActivity - the harness-aware live self-summary: the SINGLE place a raw pane title becomes (or does
// NOT become) a session's headline activity. The board headline derives from the pane title ONLY for a
// harness whose pane title is its own task self-summary (`paneTitleIsSelfSummary`, an adapter capability —
// [[harness-adapter]]). claude qualifies (it writes its task summary into the OSC title), so we parse it with
// selfSummary (glyph-gated). codex does NOT — its pane title is a spinner glyph + the cwd FOLDER name, so
// returning it would headline the worktree folder, not the task; we refuse it (→ null) and sessionHeadline
// falls through to promptPreview (the launch prompt). The ONLY harness branch is the capability read here —
// no `if (codex)`, no glyph special-case; selfSummary stays the pure claude-title parser.
export function paneActivity(harness: Harness, paneTitle: string | null | undefined): string | null {
  if (paneTitle == null || !harness.paneTitleIsSelfSummary) return null
  return selfSummary(paneTitle)
}

// @@@ selfSummary - the agent's OWN live one-line description, parsed from its tmux pane title — the SINGLE
// place the "is this the agent speaking?" rule lives, exported so it is unit-auditable. Claude Code sets that
// title via an OSC escape and ALWAYS leads it with a status glyph: ✳ (and its ✶✻✽✢ blink frames) when idle, a
// braille spinner frame (U+2800–U+28FF) while working. That leading glyph is the only reliable proof the
// title is the agent and not tmux's default — which, from pane birth until the first turn, is the HOST NAME
// (e.g. `ser581555022561`) or a bare `Claude Code` splash. So the glyph is REQUIRED: no leading glyph → null,
// and the caller keeps showing the launch-prompt placeholder instead of flickering through the host name and
// splash. The leading glyph run (with the spaces/`·` between and after) is stripped — the dashboard draws its
// own status dot, a frozen spinner frame is just noise — leaving only the summary text (null if it is empty).
// ONE regex is the single source of the glyph rule: it gates (requires ≥1 glyph) and strips in one match.
// The glyph gate alone is not enough: Claude Code emits a glyph-led SPLASH of its own app name (`✳ Claude
// Code`) between pane birth and its first real task summary — it CLEARS the glyph gate yet is the app naming
// itself, not the task. GENERIC_SUMMARY rejects that stripped splash too, so the row keeps its launch-prompt
// placeholder instead of flashing "Claude Code" for a tick (the glyph-LESS `Claude Code` splash was already
// rejected by the gate; this catches its glyph-led twin).
const GENERIC_SUMMARY = /^claude code$/i
export function selfSummary(paneTitle: string): string | null {
  const m = /^[\s·]*(?:[✳✶✻✽✢⠀-⣿][\s·]*)+(.*)$/u.exec(paneTitle)
  if (!m) return null
  const text = m[1].trim()
  return text && !GENERIC_SUMMARY.test(text) ? text : null
}

// @@@ launchedAt - when we last started a tmux window for an id (set in launch()). claude needs ~15-20s
// after the window appears to recreate its rendezvous socket; in that window the socket is absent but the
// session is booting, NOT dead. reconcile consults this to report 'starting' (a distinct transient state)
// instead of 'offline' for BOOT_GRACE_MS after launch — so 'offline' only ever means genuinely dead. In-
// memory in the single server process (lost on restart, which is fine: a restart has nothing in flight).
const launchedAt = new Map<string, number>()
export const BOOT_GRACE_MS = 45000   // > SOCKET_READY_TIMEOUT_MS, and spans launchScript's bounded fast-fail retry
                              // window (~3 attempts) so a relaunching session reads 'starting', not 'offline'
const LAUNCH_FAST_FAIL_S = 12 // launchScript retries the agent command when it exits faster than this: fast
                              // exit before readiness is retryable, but it is not proof of one specific cause

export function liveness(rec: SessRec, snap: LiveSnap): Liveness {
  if (!rec.session || rec.stopped || rec.archived) return 'offline'
  // Ask the resolved ADAPTER ([[harness-adapter]]): claude/pi/opencode prove their rendezvous listener;
  // codex proves its launch-registered pid (with the legacy descendant-tree fallback). The 'starting' grace
  // stays here: a just-launched agent whose online signal has not appeared yet reads 'starting', only past it
  // 'offline'.
  const h = harnessById(rec.harness || defaultHarness.id)
  if (h.liveness(rec, snap.windows.has(rec.session), runtimeRoot(), snap.windows.get(rec.session), snap.sockets.has(rec.session)) === 'online') return 'online'
  if (snap.probeFailed) return 'unknown'   // the probe failed — we can't tell, and MUST NOT guess offline
  // not provably online — but if this session's LISTENER probe couldn't conclude (timeout under load / EAGAIN
  // off a full-but-alive backlog), death is UNPROVEN: `unknown`, never a false `offline` a supervisor would
  // act on (issue #40 — a wedged-but-alive worker must not read as an actionable corpse).
  if (snap.unproven.has(rec.session)) return 'unknown'
  const at = launchedAt.get(rec.session)
  if (at && Date.now() - at < BOOT_GRACE_MS) return 'starting'
  // A dead TRANSPORT is not a dead AGENT. The socket path is keyed by session id alone, so a foreign teardown
  // (or a stray rm) can unlink it out from under its own live listener: the agent keeps working, unreachable,
  // and every path-connect ENOENTs — which the adapter axis above reports as proven death. The registered
  // agent.pid is a SECOND, independent witness, and while it still answers, death is UNPROVEN: `unknown`, not
  // the `offline` that disarms the relaunch guard and invites a human to kill a working agent. Same rule as
  // the probe-failure branch (issue #40), one layer down: only a corpse both witnesses agree on is actionable.
  if (agentAlive(rec.session) === true) return 'unknown'
  return 'offline'
}

function reconcile(rec: SessRec, snap: LiveSnap, residentLiveness?: Liveness): DisplayStatus {
  // record integrity outranks both axes: a session whose worktree is gone has no work to be in any state
  // about. It reads `retired` — a terminal, human-closable row, never a lifecycle a hook can write back over.
  if (rec.archived) return 'offline'
  if (retirementReason(rec)) return 'retired'
  if (rec.status === 'awaiting') return displayStatusForProposal(rec.proposal)
  if (rec.status !== 'active' && rec.status !== 'idle') return rec.status  // parked | error | asking | queued (no tmux yet)
  const lv = residentLiveness ?? liveness(rec, snap)
  if (lv !== 'online') return lv  // 'offline' | 'starting' | 'unknown'
  return rec.status === 'idle' ? 'idle' : 'working'
}

// resolve a session id to its record + worktree. Now a DIRECT store read (the record carries worktree_path),
// not a scan of every worktree reading its `.session` — O(1) and exact. null when the id has no governed-or-not
// record. Shape kept ({path, branch, rec}) so the many callers (rename/propose/resume/merge/close/…) are unchanged.
async function findWorktree(id: string): Promise<{ path: string; branch: string | null; rec: SessRec } | null> {
  const rec = readRecord(id)
  if (!rec) return null
  return { path: rec.worktreePath, branch: rec.branch, rec }
}

// @@@ identity WITHOUT the gates - reviewPayload answers two different questions at once: who is this
// session (a store read, free) and how does its branch stand against main (ahead count, dirty scan, a
// merge-tree conflict probe — 646 ms and 8 git children on a far-diverged branch). A consumer that renders
// no gates strip should not buy the second one. The record already holds the identity half.
export type ReviewIdentity = { id: string; branch: string | null; label: string }
export function reviewIdentity(id: string): ReviewIdentity | null {
  const rec = readRecord(id)
  if (!rec) return null
  return {
    id,
    branch: rec.branch,
    label: deriveLabel({ id, name: rec.name, title: rec.title, branch: rec.branch }),
  }
}

// Hook plumbing needs the canonical lifecycle claim without paying for the full public projection
// (which probes liveness, activity, files, and web artifacts). The runtime envelope contributes only
// governed identity; after cutover the application row owns status, proposal, and note.
export type SessionHookState = {
  governed: boolean
  status: Lifecycle
  proposal: Proposal | null
  note: string | null
}

export function sessionHookState(id: string): SessionHookState | null {
  const rec = readRecord(id)
  if (!rec) return null
  const application = configuredSessionApplicationIfCutover()
  const state = application?.readState(id)
  return {
    governed: rec.governed,
    status: (state?.status ?? rec.status) as Lifecycle,
    proposal: (state?.proposal || rec.proposal || null) as Proposal | null,
    note: state?.note ?? (rec.note || null),
  }
}

function corruptSession(id: string, entry: { path: string; error: string }): Session {
  const label = `${id.slice(0, 8)} (unreadable record)`
  return {
    id, branch: null, path: '', label, title: label, raw: { name: null, title: null },
    parent: null, harness: defaultHarness.id, capabilities: { headless: false }, launcher: null,
    lifecycle: 'active', proposal: null, merges: 0, status: 'corrupt', liveness: 'unknown',
    note: corruptReason(entry), archived: false, closedAt: null, prompt: null, promptPreview: null, created: 0,
    activity: null, sortKey: null, archiveHazard: null, files: [], web: [],
  }
}

export function toSession(rec: SessRec, status: DisplayStatus, lv: Liveness, activity: string | null = null): Session {
  const prompt = readPromptFile(rec.session)   // the originating ask, captured at launch (store artifact; null for old sessions)
  // activity is the LIVE pane title; it only means anything while the worker is genuinely up — a
  // dead/booting session would show a stale or absent title, so it's suppressed unless liveness is online.
  const showActivity = lv === 'online'
  const act = showActivity ? activity : null
  const pp = prompt ? oneLinePreview(prompt) : null
  const parts = { id: rec.session, name: rec.name, title: rec.title, branch: rec.branch, activity: act, note: rec.note, promptPreview: pp }
  const harness = harnessById(rec.harness || defaultHarness.id)
  return { id: rec.session, branch: rec.branch, label: deriveLabel(parts), title: deriveTitle(parts), raw: { name: rec.name, title: rec.title }, path: rec.worktreePath, parent: rec.parent, harness: harness.id, capabilities: { headless: harness.headless }, launcher: rec.launcher, lifecycle: rec.closedAt ? 'archived' as Lifecycle : rec.status, proposal: rec.closedAt ? null : rec.proposal, merges: rec.merges, note: rec.note, status, liveness: lv, archived: rec.archived || !!rec.closedAt, closedAt: rec.closedAt, archiveHazard: null, prompt, promptPreview: pp, created: rec.createdAt, activity: act, sortKey: rec.sortKey, files: readSessionFiles(rec.session), web: readSessionWebs(rec.session), ...(rec.zcodeChildSessionIds?.length ? { zcodeChildSessionIds: [...rec.zcodeChildSessionIds] } : {}) }
}

export type ZCodeChildSessionLink = { sessionId: string; childSessionId: string; alreadyLinked: boolean }

// @@@zcode child identity - ZCode owns the child id and SpexCode owns the session record. The writer accepts
// only their exact declared pair; names, worktrees, branches, and timestamps are deliberately not candidates.
// One hash-derived lock serializes every claim for one opaque child id across all records, while the target's
// ordinary record lock preserves its lifecycle write discipline. Closing the target removes this field with
// its record, so the association lasts exactly as long as the SpexCode session/eval projection it names.
export async function linkZCodeChildSession(sessionId: string, childSessionId: unknown): Promise<ZCodeChildSessionLink | null> {
  if (typeof childSessionId !== 'string' || !childSessionId || childSessionId.trim() !== childSessionId)
    throw new ResourceConflict('z-code child session link needs a non-empty, whitespace-free childSessionId')
  const child = childSessionId
  const childLock = `zcode-child-link-${createHash('sha256').update(child).digest('hex')}`
  return withRecordLock(childLock, () => withRecordLock(sessionId, async () => {
    const target = readRecord(sessionId)
    if (!target || !target.governed) return null
    for (const id of listSessionIds()) {
      const candidate = readRecord(id)
      if (!candidate?.zcodeChildSessionIds?.includes(child)) continue
      if (candidate.session !== target.session)
        throw new ResourceConflict(`z-code child session ${child} is already linked to SpexCode session ${candidate.session}`)
      return { sessionId: target.session, childSessionId: child, alreadyLinked: true }
    }
    writeRecord({ ...target, zcodeChildSessionIds: [...(target.zcodeChildSessionIds ?? []), child] })
    return { sessionId: target.session, childSessionId: child, alreadyLinked: false }
  }))
}

export async function renameSession(id: string, name: string): Promise<boolean> {
  return withRecordLock(id, async () => {
    const wt = await findWorktree(id)
    if (!wt) return false
    writeRecord({ ...wt.rec, name: name.trim() || null })
    return true
  })
}

export async function setSessionSort(id: string, key: number | null): Promise<boolean> {
  return withRecordLock(id, async () => {
    const wt = await findWorktree(id)
    if (!wt) return false
    writeRecord({ ...wt.rec, sortKey: key != null && Number.isFinite(key) ? key : null })
    return true
  })
}

// the session's full ORIGINATING prompt (what it was asked to do), or null if none was recorded. A record we
// cannot read simply has no prompt to report — a READ accessor must not turn an unreadable record into an
// error for the surface asking about it; the row itself already carries the diagnosis.
export async function sessionPrompt(id: string): Promise<string | null> {
  try { return readRecord(id) ? readPromptFile(id) : null }
  catch (e) { if (e instanceof SessionRecordUnusable) return null; throw e }
}

export type ArchiveSessionIndexRow = {
  id: string; title: string; label: string; closedAt: string | null
}
export type ArchiveSessionIndexProbe = { promptReads?: number }

// The archive overlay has no reader for the session model. Keep this projection separate from listSessions so
// opening it skips the live tmux census, resident adapter probes, and files/web reads, and carries no full prompt bytes.
export async function listArchivedSessionIndex(probe?: ArchiveSessionIndexProbe): Promise<ArchiveSessionIndexRow[]> {
  const rows: ArchiveSessionIndexRow[] = []
  for (const id of listSessionIds()) {
    let entry: PublicRecordEntry
    try { entry = readPublicRecordEntry(id) } catch { continue }
    if (entry.kind !== 'ok') continue
    const rec = fromRaw(entry.raw)
    if (!rec.governed || (!rec.archived && !rec.closedAt)) continue
    const parts = {
      id: rec.session, name: rec.name, title: rec.title, branch: rec.branch,
      activity: null, note: rec.note, promptPreview: null as string | null,
    }
    // Name and note are ahead of the prompt in deriveTitle's precedence. Avoid touching the prompt artifact
    // unless both are absent; only then can its preview change the visible title.
    if (!rec.name && !rec.note?.trim()) {
      probe && (probe.promptReads = (probe.promptReads || 0) + 1)
      const prompt = readPromptFile(id)
      parts.promptPreview = prompt ? oneLinePreview(prompt) : null
    }
    rows.push({
      id: rec.session,
      title: deriveTitle(parts),
      label: deriveLabel(parts),
      closedAt: rec.closedAt,
    })
  }
  return rows
}

// Preserve rows through a transient record-read failure; prune after the store entry disappears.
const lastKnownSession = new Map<string, Session>()

// A BOARD row carries the launch ask only as its one-line preview. The full text is served by the
// id-addressed record detail, which reads the stored prompt itself and overrides this field — so the list
// never had a reader for it. Shipping it made the body grow with total ask LENGTH instead of session count
// (measured on the adopter-a board: 2192 KB of a 2218 KB default body, 27 KB of which was actual board data)
// and pinned the same bytes in `lastKnownSession` for the life of the process. The CREATE response keeps the
// full text: it is a receipt for one ask the caller just made, not a row in a list of many.
const boardRow = (s: Session): Session => { s.prompt = null; return s }

export async function listSessions(includeArchived = false): Promise<Session[]> {
  // ONE store enumeration + ONE tmux snapshot (windows + pane pids + titles, merged) for the whole list, then
  // every session reconciles by a pure set lookup + one existsSync — no per-session tmux spawn.
  const [ids, snap] = await Promise.all([
    Promise.resolve(listSessionIds()), liveSnapshot(),
  ])
  // Freeze one record snapshot for both the census join and row projection. A second full read after an awaited
  // probe could pair record A with thread identity B and accidentally treat a missing census entry as clean.
  const snapshots = new Map<string, { entry: PublicRecordEntry; rec: SessRec | null }>()
  for (const id of ids) {
    try {
      const entry = readPublicRecordEntry(id)
      snapshots.set(id, { entry, rec: entry.kind === 'ok' ? fromRaw(entry.raw) : null })
    } catch { /* guardSession below preserves the last-known row for a transient read failure */ }
  }
  const canonical = configuredSessionApplicationIfCutover()
  const canonicalStates = new Map<string, ReturnType<NonNullable<typeof canonical>['readState']>>()
  if (canonical) {
    for (const [id, snapshot] of snapshots) {
      if (!snapshot.rec?.governed) continue
      const state = canonical.readState(id)
      if (!state) throw new ResourceConflict(`session ${id} has no canonical application state after JSON cutover`)
      canonicalStates.set(id, state)
    }
  }
  // Adapter-owned records have no pane witness. Join one project-wide resident-ID census to every exact
  // bound target, including live rows; otherwise a dead shared app-server could leave a stale headless record
  // online indefinitely. The descriptor probe remains one-per-generation, not one RPC per session.
  const censusRecords = [...snapshots.values()].flatMap(({ entry, rec }) => entry.kind === 'ok' && rec && rec.governed
    && rec.harnessSessionId && harnessById(rec.harness || defaultHarness.id).runtimeOwnership === 'adapter'
    ? [{ ...rec, harness: rec.harness || defaultHarness.id }]
    : [])
  const residentCensus = censusRecords.length ? await adapterLoadedReferenceState(censusRecords) : new Map()
  // A record can change while the one census is in flight. Mark such rows conservatively; never let the stale
  // proof hide them. This is a bounded storage read, not another adapter RPC.
  const changedDuringCensus = new Set<string>()
  for (const rec of censusRecords) {
    try {
      const current = readPublicRecordEntry(rec.session)
      const before = snapshots.get(rec.session)?.entry
      if (current.kind !== 'ok' || before?.kind !== 'ok' || JSON.stringify(current.raw) !== JSON.stringify(before.raw)) changedDuringCensus.add(rec.session)
    } catch { changedDuringCensus.add(rec.session) }
  }
  const rows = ids.map((id) => guardSession(id, () => {
    // a record we cannot READ still has a row: it is a session that exists and whose state is unknowable, which
    // is a thing to act on, not a thing to hide. It carries its own status and names the file, so the human can
    // see the file and close it — the alternative (dropping it) is what made a live session read as gone.
    const snapshot = snapshots.get(id)
    if (!snapshot) throw new Error(`session ${id} record snapshot unavailable`)
    const { entry } = snapshot
    // The corrupt row becomes the LAST-KNOWN row, never a deletion. Dropping it would mean the next poll that
    // hits a transient read failure has nothing to fall back on and the row vanishes — re-opening the exact
    // hole this branch closes, one poll later. `corrupt` is a true reading, so it is worth remembering.
    if (entry.kind === 'corrupt') { const c = corruptSession(id, entry); lastKnownSession.set(id, c); return c }
    const rec = snapshot.rec
    if (!rec || !rec.governed) { lastKnownSession.delete(id); return null }   // no record, or a self-launched (non-board) one
    const projectedRecord = canonicalRecordProjection(rec, canonicalStates.get(id))
    // A forced public liveness comes only from the shared record projection. Do not let live process/thread
    // evidence punch through it (including archive hazard repair).
    if (entry.kind === 'ok' && entry.liveness === 'offline') {
      const pending = boardRow(toSession(projectedRecord, 'offline', 'offline'))
      lastKnownSession.set(id, pending)
      return pending
    }
    // the pane title → headline activity, gated by THIS session's harness ([[harness-adapter]]): claude's title
    // is its task self-summary (used); codex's is the cwd folder name (refused → headline falls to the prompt).
    const activity = paneActivity(harnessById(rec.harness || defaultHarness.id), snap.titles.get(id))
    const sessionHarness = harnessById(projectedRecord.harness || defaultHarness.id)
    const resident = projectedRecord.harnessSessionId
      ? residentCensus.get(`${projectedRecord.harness || defaultHarness.id}:${projectedRecord.harnessSessionId}`)
      : undefined
    const residentRequired = sessionHarness.runtimeOwnership === 'adapter' && !!projectedRecord.harnessSessionId && !!sessionHarness.sharedRuntimes?.(runtimeRoot()).length
    const physical = projectedRecord.archived
      ? (sessionHarness.runtimeOwnership === 'adapter'
        ? (resident && !resident.healthy ? 'unknown' : resident?.loaded ? 'online' : snap.windows.has(id) ? 'online' : 'offline')
        : liveness({ ...projectedRecord, archived: false, stopped: false }, snap))
      : null
    // Only a physically-offline record projects as archived. A legacy archived+live/unknown record is exposed
    // as ordinary working-set state with its real liveness/status and one backend-owned hazard marker. A
    // missing durable cold proof is also legacy: leaf liveness alone cannot prove a Codex loaded thread was
    // unloaded, so it remains visible until an explicit archive repair.
    const cleanCold = projectedRecord.archived && !changedDuringCensus.has(id) && hasValidColdProof(projectedRecord) && physical === 'offline' && (!residentRequired || resident?.healthy === true)
    // A published close is terminal public history even if a later census cannot prove the old adapter fully
    // unloaded. Only legacy archived rows without closedAt may be exposed as a working hazard for repair.
    const projected = projectedRecord.archived && !cleanCold && !projectedRecord.closedAt
      ? { ...projectedRecord, archived: false, stopped: false }
      : projectedRecord
    const projectedLv = projected === projectedRecord
      ? sessionHarness.runtimeOwnership === 'adapter'
        ? adapterResidentLiveness(projectedRecord, resident)
        : liveness(projectedRecord, snap)
      : physical!
    const s = boardRow(toSession(projected, reconcile(projected, snap, projectedLv), projectedLv, activity))
    // Canonical projection deliberately creates a fresh object for every governed row. That identity change is not
    // an archive failure: a hazard belongs only to a record that was actually archived and then had its cold proof
    // rejected. Otherwise every live row would inherit the missing-cold-witness message after cutover.
    if (projectedRecord.archived && !cleanCold) s.archiveHazard = changedDuringCensus.has(id)
      ? 'archived runtime hazard: record changed while adapter residency was being reconciled; retry exact archive'
      : hasValidColdProof(rec)
        ? residentRequired && !resident
          ? 'archived runtime hazard: adapter resident-reference census missing; exact unload is unproven'
          : resident && !resident.healthy
        ? `archived runtime hazard: adapter resident-reference census is unknown (${resident.error || 'probe failed'})`
        : resident?.loaded
          ? 'archived runtime hazard: target adapter thread is still loaded'
          : `archived runtime hazard: record says archived but physical liveness is ${physical}`
      : 'archived runtime hazard: record has no durable cold witness; exact adapter unload is unproven'
    if (rec.adapterRecovery) s.archiveHazard = `archive adapter recovery required: ${rec.adapterRecovery}`
    lastKnownSession.set(id, s)
    return s
  }, () => {
    // DEGRADED: the record dir still exists but reading runtime.json failed transiently. NEVER drop a live
    // session — serve its last-known row. (No last-known means a first sighting raced a failure; nothing to
    // show yet, and it reappears on the next build.)
    return lastKnownSession.get(id) ?? null
  }))
  // prune last-known entries for ids that no longer appear at all (genuinely removed), keeping it bounded.
  const liveIds = new Set(ids)
  for (const k of [...lastKnownSession.keys()]) if (!liveIds.has(k)) lastKnownSession.delete(k)
  return rows.filter((s): s is Session => s != null && (includeArchived || !s.archived))
    .sort((a, b) => (a.sortKey ?? a.created) - (b.sortKey ?? b.created) || a.id.localeCompare(b.id))
}

// a per-session read guard mirroring resilience.guardWorktree but keyed on the store record (not a worktree
// path): run `primary`; if it throws AND the record dir still exists, the failure is transient → serve the
// `degraded` fallback; if the dir is gone (a genuine close), return null (omit). No async git, so it's sync.
function guardSession(id: string, primary: () => Session | null, degraded: () => Session | null): Session | null {
  try { return primary() }
  catch { return existsSync(sessionStoreDir(id)) ? degraded() : null }
}

export type ApiBaseSource = 'flag' | 'worker-env' | 'record' | 'env-fallback' | 'default'
export type ApiBaseInfo = { url: string; source: ApiBaseSource }
const usageError = (msg: string): Error => { const e = new Error(msg); e.name = 'UsageError'; return e }

export function optionArgv(argv: readonly string[] = process.argv): readonly string[] {
  const delimiter = argv.indexOf('--')
  return delimiter < 0 ? argv : argv.slice(0, delimiter)
}

// the explicit routing flag, read from THIS process's argv (never the environment — that's the point).
// `--port` doubles as a BIND port for serve/dashboard, so the sugar is skipped for those verbs.
function explicitApiFlag(): string | null {
  const argv = optionArgv()
  const ai = argv.indexOf('--api')
  if (ai >= 0) {
    const v = argv[ai + 1]
    if (!v || v.startsWith('--')) throw usageError('--api expects a URL (e.g. --api http://127.0.0.1:8901)')
    const withScheme = v.includes('://') ? v : `http://${v}`
    try { new URL(withScheme) } catch { throw usageError(`--api: not a URL: ${v}`) }
    return withScheme.replace(/\/+$/, '')
  }
  if (argv[2] === 'serve' || argv[2] === 'dashboard') return null   // their --port is a bind port, not routing
  const pi = argv.indexOf('--port')
  if (pi >= 0) {
    const v = argv[pi + 1]
    if (!v || !Number.isInteger(Number(v))) throw usageError('--port expects an integer (localhost sugar for --api http://127.0.0.1:<n>)')
    return `http://127.0.0.1:${v}`
  }
  return null
}
// the cwd project's recorded backend ({url,pid}, written by `spex serve` at bind time into the per-project
// runtime tier), trusted only after a live /health probe — a stale record must never swallow a command.
async function liveRecordUrl(): Promise<string | null> {
  let file: string
  try { file = join(runtimeRoot(), 'backend.json') } catch { return null }   // cwd not in a git repo → nothing to discover
  let url = ''
  try { const rec = JSON.parse(readFileSync(file, 'utf8')); if (typeof rec?.url === 'string') url = rec.url.trim() } catch { return null }
  if (!url) return null
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 600)
  try { return (await fetch(`${url}/health`, { signal: ctrl.signal })).ok ? url : null }
  catch { return null }
  finally { clearTimeout(t) }
}
async function resolveApiBase(): Promise<ApiBaseInfo> {
  const flag = explicitApiFlag()
  if (flag) return { url: flag, source: 'flag' }
  const env = process.env.SPEXCODE_API_URL?.trim() || null
  if (process.env.SPEXCODE_SESSION_ID?.trim()) {
    if (env) return { url: env, source: 'worker-env' }
    const rec = await liveRecordUrl()
    if (rec) return { url: rec, source: 'record' }
  } else {
    const rec = await liveRecordUrl()
    if (rec) return { url: rec, source: 'record' }
    if (env) return { url: env, source: 'env-fallback' }
  }
  return { url: `http://127.0.0.1:${process.env.PORT || 8787}`, source: 'default' }
}
let apiBaseMemo: Promise<ApiBaseInfo> | null = null
export const apiBaseInfo = (): Promise<ApiBaseInfo> => (apiBaseMemo ??= resolveApiBase())
export const apiBase = async (): Promise<string> => (await apiBaseInfo()).url

export const ownSessionId = envSessionId

export type MsgSender = { id: string; label: string | null }
export function withSenderHint(text: string, sender: MsgSender | null): string {
  if (!sender) return text
  const who = sender.label && sender.label !== sender.id ? `session "${sender.label}" (${sender.id})` : `session ${sender.id}`
  return `${text}\n\n— from ${who}. To reply: spex session send ${sender.id} "<your reply>"`
}
export function withPeerSenderHint(text: string, sender: MsgSender | null, sshAddress: string, machineId: string): string {
  if (!sender) return text
  const who = sender.label && sender.label !== sender.id ? `session "${sender.label}" (${sender.id})` : `session ${sender.id}`
  return `${text}\n\n— from ${who} on machine ${machineId}. To reply: spex session send --ssh ${sshAddress} ${sender.id} "<your reply>"`
}
export const withNoteReplyHint = (text: string): string =>
  `${text}\n\n— REPLY TRANSPORT: This sender cannot read normal assistant output. Before ending this turn, make your FINAL tool call a Spex declaration carrying the COMPLETE reply in --note: use \`session ask\` when waiting for a human reply; use \`done\` or \`park\` when that is the truthful state. This rule applies even when asked to only print/reply or make no tool calls.\n\nFor multi-line replies, preserve real LF characters. \`functions.exec\` runs a shell command through bash, so never interpolate \`JSON.stringify(note)\` into it; use stdin, a heredoc, or base64, then pass \`--note \"$note\"\`. Never use \`String.raw\` or literal backslash+n. Do not call any tool after the declaration.`
export const withTerminalReplyHint = (text: string): string =>
  `${text}\n\n— sent from a terminal-attached client: the sender now reads your terminal output directly. Reply in your normal conversation output from here on — stop putting replies in declaration --notes (the earlier terminal-free notices no longer apply; a --note can go back to being a short status line).`
export const slugify = (s: string | null) =>
  (s || 'session').normalize('NFC').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'session'

const MENTION = /\[\[(\.?[\p{L}\p{N}_-]+)\]\]/u
export const nodeFromPrompt = (prompt: string): string | null => prompt.match(MENTION)?.[1] ?? null

type CommandPreset = Pick<ConfigPreset, 'name' | 'body'>
type CommandSpec = Pick<SpecLite, 'id' | 'path'>

export function composeCommandPrompt(raw: string, presets: CommandPreset[], specs: CommandSpec[]): string {
  const match = raw.match(/^\/(\S+)\s*([\s\S]*)$/)
  if (!match) return raw
  const preset = presets.find((p) => p.name === match[1])
  if (!preset) return raw

  const ids: string[] = []
  const allMentions = new RegExp(MENTION.source, 'gu')
  const free = match[2].replace(allMentions, (_, id: string) => { ids.push(id); return '' }).trim()
  const targets = ids.length
    ? ids.map((id) => {
        const spec = specs.find((s) => s.id === id)
        const path = spec?.path.replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')
        return path ? `- [[${id}]] — ${path}` : `- [[${id}]]`
      }).join('\n')
    : '(No target was mentioned. If the prompt names the scope, use it; otherwise ask the human to define the scope before proceeding — unless this task needs no scope, in which case proceed.)'
  const body = preset.body.includes('{{targets}}')
    ? preset.body.replace('{{targets}}', targets)
    : ids.length ? `${preset.body}\n\n${targets}` : preset.body
  return free ? `${body}\n\n${free}` : body
}

// Load only the one live preset named by the raw invocation. Both session creation and sendText call this seam, so
// launch and an existing session's inbox resolve identical plugin data with identical target semantics.
export async function resolveCommandPrompt(raw: string, loadedSpecs?: CommandSpec[]): Promise<string> {
  const commandName = raw.match(/^\/(\S+)/)?.[1]
  const preset = commandName ? loadConfig().find((p) => p.name === commandName) : undefined
  if (!preset) return raw
  const specs = loadedSpecs ?? (nodeFromPrompt(raw) ? await loadSpecs() : [])
  return composeCommandPrompt(raw, [preset], specs)
}

type SessionPromptTarget = Pick<SessRec, 'session' | 'harness'>
type SessionPromptOptions = {
  from?: string
  replyVia?: 'note'
  loadedSpecs?: CommandSpec[]
  suffix?: string
}
export type ComposedSessionPrompt = { text: string; replyVia?: 'note' }

// @@@ composeSessionPrompt - the ONE prompt-delivery seam: raw caller text + target session become the
// exact text handed to an adapter. Launch, ordinary input, CLI send, issue dispatch, watch greetings, and
// merge all enter here (directly or through sendText). `replyVia` is target readability: an explicit note
// request wins; otherwise a headless adapter defaults to note. This function alone decides and appends the
// note/terminal inserts, so clients never own the policy or duplicate the phrase.
export async function composeSessionPrompt(raw: string, target: SessionPromptTarget, opts: SessionPromptOptions = {}): Promise<ComposedSessionPrompt> {
  const resolved = await resolveCommandPrompt(raw, opts.loadedSpecs)
  const prompt = opts.suffix ? `${resolved}${opts.suffix}` : resolved
  const h = harnessById(target.harness || defaultHarness.id)
  const replyVia = opts.replyVia ?? (h.headless ? 'note' : undefined)
  const text = replyVia === 'note' ? withNoteReplyHint(prompt)
    : !opts.from && lastHumanSendVia(target.session) === 'note' ? withTerminalReplyHint(prompt) : prompt
  return { text: optionSafe(text), ...(replyVia ? { replyVia } : {}) }
}
const optionSafe = (text: string) => text.startsWith('-') ? ` ${text}` : text
const UUID_TOKEN = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g
const stripIdentityTokens = (s: string) => s.replace(/(^|\s)@[\p{L}\p{N}_-]+/gu, '$1').replace(UUID_TOKEN, ' ')
export function titleFromPrompt(prompt: string): string | null {
  const first = stripIdentityTokens(prompt || '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  const words = first.split(/\s+/).filter(Boolean).slice(0, 7).join(' ')
  if (!words) return null
  return words.length > 50 ? words.slice(0, 49).trimEnd() + '…' : words
}

// @@@ launchScript - the WHOLE launch invocation (rendezvous env prefix + harness command + the human prompt)
// is written to an ephemeral `launch.sh` in the session's GLOBAL store and
// run via `bash <file>`, NOT typed inline. Inline send-keys TRUNCATES past ~2KB (the launch-prompt-limit trap),
// and a long human prompt + spec pointer can exceed it; a file has no length limit
// and the only thing send-keys types is the short `bash <file>` line. It's the SAME command the inline path
// ran (env prefix exports the rendezvous vars to the claude child), just relocated to a file. Liveness no
// longer cares what the pane's foreground command is: claude runs as a child of bash (and, via the
// `reclaude` wrapper, a grandchild), so the pane command is the wrapper/shell — reconcile reads claude's
// rendezvous socket instead (present while claude is alive, gone once it exits). The file lives OUTSIDE the
// worktree (in the store, keyed by session_id), so it never pollutes the spec/code work.
// the launch command for THIS session ([[launcher-select]] resume-launcher-pin): the RESOLVED base command
// PINNED on the record at creation wins — so a (re)launch replays the EXACT launcher that made the conversation
// (and its config-dir env), never re-resolving against a since-changed default that would send `--resume` to the
// wrong config dir and lose the transcript. Fall back to the named-launcher resolution (an old record with a
// launcher name but no pinned cmd; fail-loud on a since-removed launcher), then undefined (truly old record →
// the harness adapter's ambient resolution, best-effort).
export function launcherCmd(rec: SessRec): string | undefined {
  if (rec.launchCmd) return rec.launchCmd
  return rec.launcher ? resolveLauncher(rec.launcher).cmd : undefined
}
// @@@ launch preflight - the launch transport's OWN settled failures, checked before a tmux window is ever
// opened. Each is a fact about this machine right now that no number of attempts can change: the worktree the
// agent would run in, the branch it would commit to, the command that would start it. Answering them here is
// what turns a certain failure into ONE loud, named refusal instead of a launch that fast-exits and is retried
// on a wall clock. Everything the transport CANNOT settle (a launcher that races its own daemon) still reaches
// the bounded retry, and the harness's own settled failures are the adapter's to name (fatalLaunchOutput).
export type LaunchBlock = { code: 'no-worktree' | 'no-branch' | 'no-launcher'; message: string }
// does this ref resolve to a commit? Through git.ts's git() so a hook's exported GIT_DIR can't misdirect
// discovery. `--verify --quiet` answers a MISSING ref with a bare non-zero exit and no stderr, while a broken
// repo/timeout writes stderr — so only the silent failure is read as absence. A probe that could not answer
// reads as "exists": the preflight refuses on a PROVEN absence, never on a failed probe ([[state]]'s board
// honesty rule applied to launch).
function refExists(cwd: string, ref: string): boolean {
  try { return !!git(['-C', cwd, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim() }
  catch (e) { return String((e as { stderr?: string })?.stderr ?? '').trim() !== '' }
}
export function launchPreflight(rec: SessRec): LaunchBlock | null {
  if (!rec.worktreePath || !existsSync(rec.worktreePath))
    return { code: 'no-worktree', message: `session ${rec.session.slice(0, 8)}: its worktree ${rec.worktreePath || '(unrecorded)'} does not exist — there is nothing to launch in. If the work merged and the worktree was removed, close the session; otherwise restore the worktree first.` }
  if (rec.branch && !refExists(rec.worktreePath, rec.branch))
    return { code: 'no-branch', message: `session ${rec.session.slice(0, 8)}: its branch ${rec.branch} no longer exists — a relaunch would put the agent on a detached or wrong ref. Restore the branch, or close the session.` }
  let cmd: string | undefined
  try { cmd = launcherCmd(rec) }
  catch (e) { return { code: 'no-launcher', message: `session ${rec.session.slice(0, 8)}: its launcher cannot be resolved — ${e instanceof Error ? e.message : e}` } }
  // only an ABSOLUTE command is checkable here; a bare name is the shell's PATH lookup at launch time, and
  // guessing at it would refuse launches that work. Certainty is the whole point of a preflight.
  const bin = (cmd ?? '').trim().split(/\s+/)[0]
  if (bin && isAbsolute(bin) && !existsSync(bin))
    return { code: 'no-launcher', message: `session ${rec.session.slice(0, 8)}: its pinned launcher command ${bin} is not on this machine — every launch of it will fail until the path is restored or the session is re-dispatched under a launcher that exists.` }
  return null
}

// @@@ launch quoting - single-quote a string for a POSIX shell, `'` → `'\''`. Used to nest the whole agent
// invocation inside the birth-registration `sh -c '…'` wrapper without any segment double-expanding.
// 后端把这条命令输入交互式 shell，脚本路径必须作为一个 shell 参数传递。
export function launchShellCommand(file: string): string {
  return `bash ${shQuote(file)}`
}
export function launchScript(id: string, tail: string, harness: Harness = HARNESS, cmd?: string): string {
  const file = join(storeDir(id), 'launch.sh')
  // NO --append-system-prompt / --settings: the contract + hooks are materialized into the worktree at
  // createSession ([[harness-delivery]]) and the agent auto-discovers them — the SAME path as a self-launched
  // agent. The launch line is just the rendezvous env + the harness command + the session-id/spec-pointer/prompt tail.
  // `cmd` is the session's persisted launcher command ([[launcher-select]]); when set it OVERRIDES the harness's
  // ambient default so resume reuses the same auth. Undefined is only for old records before launch_cmd existed.
  const invocation = `${rvEnv(id, harness, readRecord(id)?.runtimeStartToken)} ${harness.launchCmd(id, runtimeRoot(), cmd)} ${tail}`
  // @@@ birth registration - record the AGENT's real pid BEFORE exec, the anchor of the 100ms hot death tier
  // ([[state]]). Each attempt runs `sh -c '<pid-write>; exec env <invocation>'`: the sh writes its own `$$` to
  // agent.pid, then `exec env` REPLACES that sh in place — so the pid persists down the whole command chain
  // (claude: env→(reclaude→)claude; codex: env→bash -lc <script> whose last line is `exec codex … resume`), and
  // `$$` therefore IS the launched agent's pid. `env` carries the leading `VAR=val` assignments (an env prefix
  // can't lead an `exec`), and the whole payload is single-quoted for the outer shell (shQuote) so the
  // invocation's own single-quoted segments — the codex `$@`/`$tid` script, the prompt — reach sh verbatim,
  // parsed exactly ONCE, never double-expanded. Each retry attempt rewrites agent.pid with a fresh `$$`.
  const pidPath = join(storeDir(id), 'agent.pid')
  const receiptPath = join(storeDir(id), 'agent.identity.json')
  const born = `sh -c ${shQuote(`rm -f ${shQuote(receiptPath)}; printf %s "$$" > ${shQuote(pidPath)}; exec env ${invocation}`)}`
  // Bounded relaunch on a FAST exit: the agent launcher can exit within seconds before the rendezvous socket
  // ever appears. That is enough evidence to retry, but not enough evidence to name the cause. Once the agent
  // has run past LAUNCH_FAST_FAIL_S it has genuinely started; its eventual (much later) exit is a normal
  // session end and is NEVER retried — the loop exits. BOOT_GRACE_MS and SOCKET_READY_TIMEOUT_MS both span this
  // retry window, so liveness stays 'starting' and waitForReady keeps holding the slot across retries. This
  // only closes startup unready failures — it adds no fallback and never masks a genuinely dead agent (3
  // attempts, then give up).
  // A one-shot adapter (currently codex-headless) deliberately exits after its first turn while the shared
  // app-server stays alive. Retrying that successful fast exit would mint a duplicate thread/prompt, so the
  // retry loop is a runtime capability rather than a harness-id branch.
  // @@@ retry only what retrying can fix - a fast exit says the launcher stopped before readiness, which is
  // reason enough to try again but never a diagnosis. So after a fast exit the script reads what the harness
  // actually SAID and matches it against the ADAPTER's own settled-failure patterns ([[harness-adapter]]
  // fatalLaunchOutput). A match means this command cannot succeed however many times we run it: stop at one
  // attempt and let the harness's own line be the last thing on the pane, instead of spending a certain failure
  // three times and burying the reason. No match keeps the plain bounded retry.
  //
  // It reads the PANE, not the agent's streams. Capturing stderr through a pipe missed the answer entirely —
  // measured against real reclaude, "No conversation found with session ID" arrives on STDOUT, so a
  // stderr-only capture classified nothing and retried a certain failure three times (the unit test passed
  // only because its stub printed to the stream the implementation happened to watch). Redirecting stdout too
  // would be worse: a TUI that finds stdout is not a terminal stops being a TUI. The pane already holds both
  // streams exactly as the human sees them, and the script runs inside that pane — so it just asks tmux.
  const fatal = (harness.fatalLaunchOutput ?? []).join('|')
  const launchBody = harness.launchOneShot ? [born, ''] : [
    `for __spex_try in 1 2 3; do`,
    `  __spex_t0=$SECONDS`,
    // @@@ classify THIS attempt only - the pane is a scrollback, so it also holds every earlier attempt and
    // every earlier launch that ever ran in this window. Matching the whole capture would let a stale
    // settled-failure line from minutes ago condemn an unrelated fast exit and cut a launch that retrying
    // WOULD have recovered — the exact mirror of the miss this classifier exists to fix. So each attempt
    // stamps a line unique to (this run, this attempt) and the match starts after it. The run's pid is what
    // makes it unique across relaunches, which reuse the session id.
    `  __spex_mark="attempt $__spex_try start $$"`,
    `  printf '[spex launch] %s\\n' "$__spex_mark"`,
    `  ${born}`,
    `  __spex_rc=$?`,
    `  [ $(( SECONDS - __spex_t0 )) -ge ${LAUNCH_FAST_FAIL_S} ] && exit $__spex_rc`,
    ...(fatal ? [
      // -t "$TMUX_PANE" names THIS pane explicitly (tmux still resolves the server from $TMUX), so the capture
      // can never land on a neighbouring pane; run outside tmux the call fails, nothing matches, and the plain
      // bounded retry stands.
      `  if tmux capture-pane -p -S -400 -t "\${TMUX_PANE:-.}" 2>/dev/null | sed -n "/$__spex_mark/,\\$p" | grep -Eq ${shQuote(fatal)}; then`,
      `    printf '[spex launch] attempt %s exited in %ss (rc=%s) - the launcher reported a failure retrying cannot fix (see above); not retrying\\n' "$__spex_try" "$(( SECONDS - __spex_t0 ))" "$__spex_rc" >&2`,
      `    exit $__spex_rc`,
      `  fi`,
    ] : []),
    `  printf '[spex launch] attempt %s exited in %ss (rc=%s) - fast launcher exit before readiness; retrying\\n' "$__spex_try" "$(( SECONDS - __spex_t0 ))" "$__spex_rc" >&2`,
    `  sleep 2`,
    `done`,
    `exit $__spex_rc`,
    ``,
  ]
  writeFileSync(file, launchBody.join('\n'))
  return file
}
async function launch(id: string, path: string, tail: string, harness: Harness = HARNESS, cmd?: string): Promise<void> {
  // record the transport path THIS runtime hands the agent, before anything reads it (launchScript bakes it
  // into the launch env). Same kind of launch-time fact as agent.pid, and the reason a session's socket is
  // reachable only from the world it belongs to ([[harness-adapter]] rendezvous socket).
  if (harness.ownsRendezvous) stampRvSock(id)
  const file = launchScript(id, tail, harness, cmd)
  await sessionHost().launch(id, launchShellCommand(file), path)
  launchedAt.set(id, Date.now())   // stamp the boot window so reconcile reads 'starting', not 'offline', until the socket is up
}


const OCCUPIES_SLOT = new Set<DisplayStatus>(['working', 'parked', 'starting'])  // starting's boot window is also held via `launching`
function isOccupying(s: Session, _snap: LiveSnap): boolean {
  if (!OCCUPIES_SLOT.has(s.status)) return false                          // waiting-on-human / proposed / queued / dead → free
  // `listSessions` already joined the adapter resident census and projected the resulting liveness. Re-reading
  // the harness here would resurrect the old record-backed codex-headless shortcut and disagree with the row.
  return s.liveness === 'online'
}
// sessions we've JUST launched whose agent hasn't come online yet. During that boot window reconcile reads them
// `offline` (the adapter's online-signal not up yet) and isOccupying would miss them, so the drainer would
// over-launch and blow past the cap. We hold the slot here from launch until the agent is online (waitForReady)
// or it times out.
// In-memory in the single server process (the only drainer) — lost on restart, which is fine: a restart drains
// the durable `queued` worktrees fresh with nothing in flight.
const launching = new Set<string>()
// A queued launch and a cold archive must not cross between their final read and record write. This is a
// narrow per-session intent latch, not a second cleanup primitive; the launch path simply leaves an archiving id
// alone and the archive path re-probes before filing.
const archiving = new Set<string>()
const transitionTails = new Map<string, Promise<void>>()
async function withSessionTransition<T>(id: string, body: () => Promise<T>): Promise<T> {
  const previous = transitionTails.get(id) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  transitionTails.set(id, current)
  await previous
  try { return await body() }
  finally {
    release()
    if (transitionTails.get(id) === current) transitionTails.delete(id)
  }
}
setRecordTransitionWrapper(withSessionTransition)
let draining = false   // re-entrancy guard: only one drain pass runs at a time (no double-launch)
// A native receipt is bound before the readiness fence validates it. Suppress only that immediate wake so
// queued prompts cannot drain during the candidate window; the successful publication path drains normally.
const readinessWakeSuppressed = new Set<string>()

// A readiness timeout is launch-phase evidence only until the session produces another durable event. The
// first event at/after the readiness marker is the launch transition itself; anything after that proves the
// worker progressed (including a declaration), so a late diagnostic is moot and must not replace its note.
function hasLaterLaunchReadinessEvent(rec: SessRec): boolean {
  const startedAt = rec.launchReadinessStartedAt
  if (!Number.isFinite(startedAt)) return false
  const application = configuredSessionApplicationIfCutover()
  if (!application?.readState(rec.session)) return false
  const events = application.readEvents(rec.session)
  const statusPayload = (event: (typeof events)[number]): Record<string, unknown> | null => {
    const payload = decodeEventJson(event.payload)
    return payload && typeof payload === 'object' && !Array.isArray(payload) && 'status' in payload
      ? payload as Record<string, unknown> : null
  }
  const baseline = events.find((event) => {
    if (event.occurredAtMs < Number(startedAt)) return false
    const payload = statusPayload(event)
    return payload?.status === 'active'
  })
  return baseline ? events.some((event) => {
    if (event.eventSeq <= baseline.eventSeq) return false
    const payload = statusPayload(event)
    if (!payload) return false
    const note = payload.note
    return !(typeof note === 'string' && /^(?:queued launch readiness failed|launch readiness warning):/.test(note))
  }) : false
}

function noteQueuedLaunchFailureUnlocked(id: string, error: unknown, terminal = true, label?: string, live = false): void {
  const rec = readRecord(id)
  if (rec && (terminal || label === 'launch readiness warning') && hasLaterLaunchReadinessEvent(rec)) return
  const reason = error instanceof Error ? error.message : String(error)
  const note = `${label ?? (terminal ? 'queued launch readiness failed' : 'launch readiness warning')}: ${reason}`
  console.error(`spex: session ${id}: ${note}`)
  if (rec && !retirementReason(rec) && (rec.note !== note
    || (terminal && (rec.status !== 'error' || !rec.stopped || rec.launchReadinessStartedAt != null))
    || (!terminal && live && (rec.status === 'error' || rec.stopped)))) {
    // Readiness failure is terminal for this launch attempt. Keep the exact reason on the record,
    // publish an offline/error transition, and clear every durable/in-memory ownership marker so close
    // and a later explicit resume have an honest starting point.
    if (terminal) {
      publishCanonicalLifecycle(rec, 'error', null, note)
      writeRecord({ ...rec, status: 'error', proposal: null, stopped: true, note, launchOwner: null, launchReadinessStartedAt: null })
    } else {
      const status = live && (rec.status === 'error' || rec.stopped) ? 'active' : rec.status
      const stopped = live ? false : rec.stopped
      const restored = { ...rec, status, stopped, note, launchOwner: null, launchReadinessStartedAt: null }
      // A live post-receipt timeout is a diagnostic, not a new parent-watch transition. If an older failed
      // attempt already published `error`, however, the canonical row must be repaired to the live status or
      // the JSON write below would leave the sole lifecycle authority disagreeing with the runtime witness.
      // Publish even when status is unchanged: the warning note is canonical too. Active recipients exclude
      // the parent, so this diagnostic cannot manufacture a parent-watch transition.
      publishCanonicalLifecycle(restored, status, restored.proposal, note)
      writeRecord(restored)
    }
  }
}

function clearReadinessResidueUnlocked(rec: SessRec, clearDiagnostic: boolean): void {
  const application = configuredSessionApplicationIfCutover()
  const next = {
    ...rec,
    status: 'active' as const,
    stopped: false,
    note: clearDiagnostic ? null : rec.note,
    launchReadinessStartedAt: null,
  }
  if (application?.readState(rec.session) && (clearDiagnostic || rec.status !== 'active' || rec.stopped)) {
    application.transitionSession(rec.session, {
      status: 'active',
      proposal: rec.proposal,
      note: next.note,
      parentSessionId: rec.parent,
      recipientSessionIds: [],
    })
  }
  writeRecord(next)
}

export function canonicalWatchRecipients(
  application: Pick<ProductionSessionApplication, 'topology'>,
  sessionId: string,
  status: string,
): string[] {
  const recipients = new Set<string>()
  for (const edge of application.topology.parents(sessionId)) {
    // The canonical topology stores the structural parent edge as the durable parent-watch source. Older
    // migrated rows may also have an explicit watch:parent edge; both represent the same policy source.
    if (edge.relationType !== 'parent' && !edge.relationType.startsWith('watch')) continue
    if (status === 'active' && (edge.relationType === 'parent' || edge.relationType === 'watch:parent')) continue
    recipients.add(edge.fromSessionId)
  }
  return [...recipients]
}

export function sessionHasPendingDelivery(
  id: string,
  application: Pick<ProductionSessionApplication, 'readPendingMessages'>
    & Partial<Pick<ProductionSessionApplication, 'resolveRuntime'>>
    | null = configuredSessionApplicationIfCutover() ?? null,
): boolean {
  if (!application) throw new ResourceConflict(`session application is unavailable for ${id}`)
  const runtime = application.resolveRuntime?.(id, 'spex-governed')
  if (runtime === null) return false
  try {
    return application.readPendingMessages(id).length > 0
  } catch (error) {
    // A legacy record can outlive its migrated protocol address. It has no canonical queue to drain;
    // treating that address as owed makes the supervisor retry the same impossible lookup forever.
    if ((error as { code?: string })?.code === 'PROTOCOL_SESSION_UNKNOWN'
      || /unknown protocol address/i.test(error instanceof Error ? error.message : String(error))) return false
    throw error
  }
}

export function canonicalRecordProjection<T extends Pick<SessRec, 'status' | 'stopped' | 'archived'>>(
  rec: T,
  canonical: { status: string; proposal: string | null; note: string | null; parentSessionId: string | null } | null | undefined,
): T & { status: Lifecycle; proposal: Proposal | null; note: string | null; parent: string | null } {
  // The application row is the only lifecycle fact after cutover. A JSON status is historical envelope data,
  // so it must not win merely because it says waiting/error/archived while the canonical row says otherwise.
  if (!canonical) {
    return ('closedAt' in rec && rec.closedAt
      ? { ...rec, archived: true }
      : rec) as T & { status: Lifecycle; proposal: Proposal | null; note: string | null; parent: string | null }
  }
  const closed = 'closedAt' in rec && !!rec.closedAt
  return {
    ...rec,
    archived: closed ? true : rec.archived,
    status: (closed ? 'archived' : canonical.status) as Lifecycle,
    proposal: (closed ? null : canonical.proposal) as Proposal | null,
    note: canonical.note,
    parent: canonical.parentSessionId,
  }
}

function publishCanonicalLifecycle(rec: SessRec, status: Lifecycle, proposal: Proposal | null, note: string | null): void {
  const application = configuredSessionApplicationIfCutover()
  if (!application) return
  if (!application.readState(rec.session)) {
    application.createSession({ sessionId: rec.session, status, proposal, note, parentSessionId: rec.parent })
    if (rec.parent) application.attachWatcher(rec.parent, rec.session, 'watch:parent')
    return
  }
  application.transitionSession(rec.session, {
    status,
    proposal,
    note,
    parentSessionId: rec.parent,
    recipientSessionIds: canonicalWatchRecipients(application, rec.session, status),
  })
}

async function launchReadinessWitnessAlive(id: string, harness: Harness, current: SessRec): Promise<boolean> {
  if (harness.runtimeOwnership === 'adapter') {
    const state = await adapterRuntimeLiveness({ ...current, stopped: false, archived: false })
    return state === 'online'
  }
  if (agentAlive(id) === true) return true
  try {
    const snap = await liveSnapshot(id)
    return harness.liveness(current, snap.windows.has(id), runtimeRoot(), snap.windows.get(id), snap.sockets.has(id)) === 'online'
  } catch {
    return false
  }
}

export function adapterResidentLiveness(rec: SessRec, resident: AdapterLoadedReferenceState | undefined): Liveness {
  if (rec.stopped || rec.archived) return 'offline'
  if (!rec.harnessSessionId) return 'offline'
  if (!resident) return 'unknown'
  if (!resident.healthy) return 'unknown'
  return resident.loaded ? 'online' : 'offline'
}

async function adapterRuntimeLiveness(rec: SessRec): Promise<Liveness> {
  if (rec.stopped || rec.archived) return 'offline'
  const harness = harnessById(rec.harness || defaultHarness.id)
  if (harness.runtimeOwnership !== 'adapter') return liveness(rec, await liveSnapshot())
  if (!rec.harnessSessionId) return 'offline'
  const states = await adapterLoadedReferenceState([{ ...rec, harness: harness.id }], runtimeRoot())
  return adapterResidentLiveness(rec, states.get(`${harness.id}:${rec.harnessSessionId}`))
}

// A bounded readiness wait has two stages with different natures: binding the adapter's native identity
// (model-paced) and confirming runtime liveness (transport-paced). It either hands back a revalidatable fence
// or names the stage that did not complete, so no caller has to re-derive the cause from record state read
// after the fact — a read that can name a stage which never ran.
type LaunchReadinessStage = 'identity' | 'liveness'
type LaunchReadinessOutcome =
  | { ok: true; fence: HarnessLaunchReadinessFence }
  | { ok: false; stage: LaunchReadinessStage }

// An expired readiness window is recognized by type. Matching the words back out of a message would let a
// harness's own English decide lifecycle, which only the transport and the adapter may do.
class LaunchReadinessTimeout extends ResourceConflict {
  constructor(readonly stage: LaunchReadinessStage, message: string) { super(message) }
}

const launchReadinessTimeoutReason = (harness: Harness, stage: LaunchReadinessStage): string =>
  stage === 'identity'
    ? 'native identity and first-turn rollout receipt did not arrive before launch readiness timed out'
    : harness.launchPayloadProof
      ? 'post-receipt adapter liveness did not become ready before launch readiness timed out'
      : 'adapter liveness did not become ready before launch readiness timed out'

function observeQueuedLaunchReadiness(id: string, harness: Harness, timeoutMs = SOCKET_READY_TIMEOUT_MS): void {
  void waitForReady(id, harness, undefined, timeoutMs)
    .then(async (outcome) => {
      if (!outcome.ok) throw new LaunchReadinessTimeout(outcome.stage, launchReadinessTimeoutReason(harness, outcome.stage))
      let readyToPublish = false
      await withRecordLock(id, async () => {
        const candidate = readRecord(id)
        if (!candidate) return
        const stillReady = await outcome.fence.validate(() => {
          const current = readRecord(id)
          return current ? { ...current, runtimeDir: runtimeRoot() } : null
        })
        if (!stillReady) throw new ResourceConflict('launch readiness changed before queued publication')
        const current = readRecord(id)
        if (!current) return
        if (current.status === 'queued') {
          publishCanonicalLifecycle(current, 'active', null, null)
          writeRecord({ ...current, status: 'active', proposal: null, note: null, stopped: false, launchOwner: null, launchReadinessStartedAt: null })
        } else if (current.launchReadinessStartedAt != null) writeRecord({ ...current, launchReadinessStartedAt: null })
        readyToPublish = true
      })
      if (!readyToPublish) return
      await drainSession(id)
    })
    .catch(async (error) => {
      const reason = error instanceof Error ? error.message : String(error)
      const timedOut = error instanceof LaunchReadinessTimeout
      let live = false
      let terminal = timedOut
      try {
        await withRecordLock(id, async () => {
          const current = readRecord(id)
          if (timedOut && current) live = await launchReadinessWitnessAlive(id, harness, current)
          terminal = timedOut && !live
          noteQueuedLaunchFailureUnlocked(id, error, terminal, live ? 'launch readiness warning' : undefined, live)
        })
      }
      catch (recordError) {
        console.error(`spex: session ${id}: queued launch failure could not be recorded: ${recordError instanceof Error ? recordError.message : String(recordError)}; original failure: ${reason}`)
      }
    })
    .finally(() => launching.delete(id))
}

type QueuedStartResult = 'started' | 'blocked' | 'retryable'
// Launch a prepared `queued` worktree. Deterministic blockers retire its creation snapshot debt; a transport
// attempt that may succeed on the next drain keeps that durable debt for the eventual real outcome.
async function startQueuedUnlocked(id: string): Promise<QueuedStartResult> {
  if (archiving.has(id)) return 'retryable'
  const wt = await findWorktree(id)
  if (!wt) return 'blocked'
  if (archiving.has(id)) return 'retryable'
  if (wt.rec.archived) return 'blocked'
  if (!canDrainQueued(wt.rec)) return 'retryable'
  const h = harnessById(wt.rec.harness || defaultHarness.id)
  if (h.launchPayloadProof && hasReadableLaunchReceipt(id)) {
    launching.add(id)
    let readinessOwnsSlot = false
    try {
      try { consumeHarnessLaunchProofUnlocked(id) }
      catch (error) {
        noteQueuedLaunchFailureUnlocked(id, error, false)
        throw error
      }
      const recovered = readRecord(id) || wt.rec
      const readinessStartedAt = Date.now()
      publishCanonicalLifecycle(recovered, 'active', null, null)
      writeRecord({ ...recovered, status: 'active', proposal: null, note: null, launchOwner: null, launchReadinessStartedAt: readinessStartedAt })
      observeQueuedLaunchReadiness(id, h)
      readinessOwnsSlot = true
      return 'started'
    } finally {
      if (!readinessOwnsSlot) launching.delete(id)
    }
  }
  const launchPrompt = readLaunchFile(id)
  if (launchPrompt == null) {
    const message = `authoritative resolved launch payload is missing for queued session ${id}; refusing to create an empty thread`
    if (wt.rec.note !== message) {
      console.error(`spex: ${message}`)
      writeRecord({ ...wt.rec, note: message })
    }
    return 'blocked'
  }
  // a queued worktree can go missing while it waits (a human cleaned up, a disk moved). Draining it would open
  // a window that fast-exits and burn the retry budget every tick, so refuse ONCE, loudly, and stamp the reason
  // on the record — the drainer then leaves it alone instead of spinning on a launch that cannot work.
  const blocked = launchPreflight(wt.rec)
  if (blocked) {
    if (wt.rec.note !== blocked.message) {
      console.error(`spex: not launching queued session ${id}: ${blocked.message}`)
      writeRecord({ ...wt.rec, note: blocked.message })
    }
    return 'blocked'
  }
  launching.add(id)   // hold the slot across the boot window BEFORE we launch, so a concurrent count can't race us
  let readinessOwnsSlot = false
  try {
    const readinessStartedAt = Date.now()
    const stamped = readRecord(id) || wt.rec
    writeRecord({ ...stamped, launchReadinessStartedAt: readinessStartedAt })
    try {
      const sq = shQuote(launchPrompt)
      await launch(id, wt.path, `${h.sessionIdArg(id)} ${sq}`.trim(), h, launcherCmd(wt.rec))
    } catch {
      const failedLaunch = readRecord(id)
      if (failedLaunch) writeRecord({ ...failedLaunch, launchReadinessStartedAt: null })
      return 'retryable'   // launch failed → stays `queued`, with its initial debt, for the next drain tick
    }
    // the note this record may carry is the QUEUED state's word (a launch-blocker message stamped above); the
    // launch just succeeded, so it is spent. Clearing it with the transition is what keeps "a stored note
    // belongs to the state currently declared" true for every writer — the invariant [[session-label]]'s
    // headline precedence stands on.
    const launched = readRecord(id) || wt.rec
    publishCanonicalLifecycle(launched, 'active', null, null)
    writeRecord({ ...launched, status: 'active', proposal: null, note: null, stopped: false, launchOwner: null, launchReadinessStartedAt: readinessStartedAt })
    if (!h.launchPayloadProof) removeLaunchFile(id)
    // release the boot-window hold once the socket is up (then isOccupying takes over) or after the bounded
    // wait — so a launch that never booted reads offline and the drainer reclaims the slot instead of pinning it.
    observeQueuedLaunchReadiness(id, h)
    readinessOwnsSlot = true
    return 'started'
  } finally {
    if (!readinessOwnsSlot) launching.delete(id)
  }
}
const startQueued = (id: string): Promise<QueuedStartResult> => withSessionTransition(id, () => withRecordLock(id, () => startQueuedUnlocked(id)))

async function drainQueueUnlocked(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const cap = maxActive()   // read once per drain pass (spexcode.json → env → default); won't shift mid-burst
    for (;;) {
      const [sessions, snap] = await Promise.all([listSessions(), liveSnapshot()])
      for (const session of sessions) {
        const rec = readRecord(session.id)
        if (!rec || launching.has(session.id)) continue
        // Older timed-out rows predate the durable readiness timestamp. Reconcile their recorded failure
        // before any queue/watch work so a backend restart cannot resurrect the old active/limbo projection.
        if (rec.status !== 'queued' && /^queued launch readiness failed:/.test(rec.note || '')) {
          const priorReason = (rec.note || '').replace(/^queued launch readiness failed:\s*/, '') || 'launch readiness timed out'
          const harness = harnessById(rec.harness || defaultHarness.id)
          const live = await launchReadinessWitnessAlive(session.id, harness, rec)
          if (live) {
            await withRecordLock(session.id, async () => {
              const current = readRecord(session.id)
              if (current && !current.archived && !current.stopped) clearReadinessResidueUnlocked(current, true)
            })
            continue
          }
          await withRecordLock(session.id, async () => noteQueuedLaunchFailureUnlocked(
            session.id,
            priorReason,
            !live,
            live ? 'launch readiness warning' : undefined,
            live,
          ))
          continue
        }
        // A pre-fix active row may still carry the authoritative launch artifact without a timestamp. Its
        // mtime is the only durable age witness available; seed the new field so the same bounded recovery
        // rule applies on this and later restarts.
        if (rec.status === 'active' && !rec.stopped && existsSync(sessionArtifactPath(session.id, 'launch')) && rec.launchReadinessStartedAt == null) {
          const harness = harnessById(rec.harness || defaultHarness.id)
          const live = await launchReadinessWitnessAlive(session.id, harness, rec)
          if (!live) {
            let startedAt = Date.now()
            try { startedAt = statSync(sessionArtifactPath(session.id, 'launch')).mtimeMs } catch { /* race: observer below will fail loud */ }
            writeRecord({ ...rec, launchReadinessStartedAt: startedAt })
          }
        }
        const refreshed = readRecord(session.id) || rec
        if (refreshed.launchReadinessStartedAt && !refreshed.stopped && !refreshed.archived) {
          const harness = harnessById(refreshed.harness || defaultHarness.id)
          const live = await launchReadinessWitnessAlive(session.id, harness, refreshed)
          if (live) {
            await withRecordLock(session.id, async () => {
              const current = readRecord(session.id)
              if (current && !current.archived && !current.stopped) {
                clearReadinessResidueUnlocked(current, /^launch readiness warning:/.test(current.note || ''))
              }
            })
            continue
          }
          launching.add(session.id)
          const remaining = Math.max(0, SOCKET_READY_TIMEOUT_MS - (Date.now() - refreshed.launchReadinessStartedAt))
          observeQueuedLaunchReadiness(session.id, harness, remaining)
          continue
        }
        if (rec.status === 'queued') continue
      }
      // if the liveness probe FAILED (tmux timing out — the overload condition), occupancy is UNKNOWABLE: every
      // session would read window-less and isOccupying would undercount, so the drainer would OVER-launch and pile
      // MORE compute onto an already-thrashing box. Under load, do the safe thing — launch nothing this pass and
      // let the next tick re-drain once the probe recovers ([[state]] board honesty applied to the cap).
      if (snap.probeFailed) break
      const occupied = sessions.reduce((n, s) => n + (launching.has(s.id) || isOccupying(s, snap) ? 1 : 0), 0)
      if (occupied >= cap) {
        break
      }
      const authority = backendLaunchAuthority()
      const next = sessions.find((s) => {
        if (s.status !== 'queued' || launching.has(s.id)) return false
        const rec = readRecord(s.id)
        return !!rec && canDrainQueued(rec, authority)
      })
      if (!next) break
      const started = await startQueued(next.id)
      if (started !== 'started') {
        break   // launch failed → stop this pass; a later tick retries
      }
    }
  } finally { draining = false }
}
export const drainQueue = (): Promise<void> => drainQueueUnlocked()
const requestQueueDrain = (): void => {
  void drainQueue().catch((error) => {
    console.error(`spex: queue drain failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

// Canonical state commits already own the durable recipient queue. This is only the post-commit wake that hands
// each queued recipient to its existing runtime; a failed or absent runtime leaves the message pending for retry.
setSessionApplicationCommitWake((recipients) => {
  const wakeRecipients = recipients.filter(recipient => !readinessWakeSuppressed.has(recipient))
  queueMicrotask(() => {
    for (const recipient of wakeRecipients) {
      void drainSession(recipient).catch((error) => {
        console.error(`spex: canonical delivery wake failed for ${recipient}: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  })
})

let supervisingQueue = false
export function superviseQueue(intervalMs = 3000): void {
  if (supervisingQueue) return
  supervisingQueue = true
  const tick = async () => {
    try { await drainQueue() } catch { /* transient git/tmux hiccup; next tick retries */ }
    setTimeout(tick, intervalMs)
  }
  void tick()
}

let supervisingDelivery = false
// @@@ superviseDelivery - the RETRY half of [[delivery-queue]]. `sendText` hands over in its own process, which
// covers the live case; this covers everything that could not be handed over then — a harness mid-restart, a
// pane in the one state that swallows prompts, a session that was offline when the message arrived. Owned by
// the serve that serves this project root, so a message owed to a worker is delivered when the worker can take
// it rather than when it happens to run a tool. A tick with nothing owed is one existsSync per session, and
// concurrent serves are harmless: the queue's lock, not the process, is what makes a handover exactly-once.
export function superviseDelivery(intervalMs = 2000): void {
  if (supervisingDelivery) return
  supervisingDelivery = true
  const tick = async () => {
    try {
      const application = configuredSessionApplicationIfCutover()
      for (const id of listSessionIds()) {
        if (!sessionHasPendingDelivery(id, application)) continue
        try { await drainSession(id) } catch (error) {
          console.error(`spex: delivery retry failed for ${id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      console.error(`spex: delivery retry sweep failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    setTimeout(tick, intervalMs).unref()
  }
  void tick()
}

type TurnFailureObserverState = {
  fingerprint: string
  subscription: FailureSubscription | null
  startedAt: number
  failures: number
  retryAt: number
  lastReason: string | null
}
const turnFailureObservers = new Map<string, TurnFailureObserverState>()
let supervisingTurnFailures = false
let startingTurnFailureObserver = false
const TURN_FAILURE_OBSERVER_STABLE_MS = 5000

export function turnFailureNote(harness: string, failure: TurnFailure): string {
  const message = failure.message.replace(/\s+/g, ' ').trim().slice(0, 500) || 'turn failed'
  const at = failure.completedAt == null ? '' : ` at ${new Date(failure.completedAt * 1000).toISOString()}`
  return `${harness} turn failed${at}: ${message}`
}

export function turnFailureRetryDelay(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, Math.min(failures - 1, 5)))
}

function deferTurnFailureObserver(id: string, harness: string, state: TurnFailureObserverState, reason: string): void {
  state.subscription = null
  state.failures++
  const delay = turnFailureRetryDelay(state.failures)
  state.retryAt = Date.now() + delay
  if (state.lastReason !== reason)
    console.warn(`[spex ${harness}] turn failure observer for ${id} disconnected (${reason}); retrying in ${delay}ms`)
  state.lastReason = reason
}

// Reconcile one adapter-owned native failure subscription per live governed session. Product code knows only
// the optional interface capability; Codex owns WebSocket/thread semantics and Claude keeps using StopFailure.
export function reconcileTurnFailureObservers(): void {
  const wanted = new Map<string, { rec: SessRec; harness: Harness; fingerprint: string }>()
  for (const id of listSessionIds()) {
    let rec: SessRec | null = null
    try { rec = readRecord(id) } catch { continue }
    // Native turn failure observation is for an executing turn, not a durable roster census. Asking, awaiting,
    // and parked records have no turn to observe; subscribing them creates one expensive app-server resume per
    // idle record and lets stale observers accumulate after a backend restart.
    if (!rec?.governed || rec.stopped || rec.archived || rec.status !== 'active' || !rec.harnessSessionId) continue
    const harness = harnessById(rec.harness || defaultHarness.id)
    if (!harness.observeTurnFailures) continue
    wanted.set(id, { rec, harness, fingerprint: `${harness.id}:${rec.harnessSessionId}:${runtimeRoot()}` })
  }
  for (const [id, state] of turnFailureObservers) {
    if (wanted.get(id)?.fingerprint === state.fingerprint) continue
    turnFailureObservers.delete(id)
    state.subscription?.close()
  }
  for (const [id, target] of wanted) {
    const now = Date.now()
    let state = turnFailureObservers.get(id)
    if (state?.subscription) {
      if (state.failures > 0 && now - state.startedAt >= TURN_FAILURE_OBSERVER_STABLE_MS) {
        state.failures = 0
        state.retryAt = 0
        state.lastReason = null
      }
      continue
    }
    // Codex thread/resume is an expensive native subscription under load. Admit one observer at a time so a
    // backend restart cannot fan out N concurrent history reconciliations and exhaust CPU/RSS before any can settle.
    if (startingTurnFailureObserver) continue
    if (state && now < state.retryAt) continue
    state ??= { fingerprint: target.fingerprint, subscription: null, startedAt: 0, failures: 0, retryAt: 0, lastReason: null }
    state.startedAt = now
    turnFailureObservers.set(id, state)
    startingTurnFailureObserver = true
    try {
      const subscription = target.harness.observeTurnFailures!({
        session: id,
        worktreePath: target.rec.worktreePath,
        harnessSessionId: target.rec.harnessSessionId,
        runtimeDir: runtimeRoot(),
        launchCmd: target.rec.launchCmd,
      }, (failure) => {
        if (turnFailureObservers.get(id)?.fingerprint !== target.fingerprint) return
        try { markTurnFailure(id, turnFailureNote(target.harness.id, failure)) }
        catch (error) { console.error(`[spex ${target.harness.id}] could not record native turn failure for ${id}: ${error instanceof Error ? error.message : String(error)}`) }
      })
      state.subscription = subscription
      if (subscription.ready) void subscription.ready.then(() => { startingTurnFailureObserver = false }, () => { startingTurnFailureObserver = false })
      else startingTurnFailureObserver = false
      void subscription.closed.then((reason) => {
        startingTurnFailureObserver = false
        if (turnFailureObservers.get(id) !== state) return
        if (reason) deferTurnFailureObserver(id, target.harness.id, state, reason)
        else turnFailureObservers.delete(id)
      })
    } catch (error) {
      startingTurnFailureObserver = false
      deferTurnFailureObserver(id, target.harness.id, state, error instanceof Error ? error.message : String(error))
    }
  }
}

export function superviseTurnFailures(intervalMs = 1000): void {
  if (supervisingTurnFailures) return
  supervisingTurnFailures = true
  const tick = () => {
    try { reconcileTurnFailureObservers() }
    catch (error) { console.error(`spex: turn failure reconciliation failed: ${error instanceof Error ? error.message : String(error)}`) }
    const timer = setTimeout(tick, intervalMs)
    timer.unref?.()
  }
  tick()
}

type BackendSettings = { layout?: { main?: string } }
type BackendInstance = { root?: unknown }
function assertProjectRootMatch(verb: string, target: ApiBaseInfo, servedRoot: string | null): void {
  const { url, source } = target
  if (source === 'flag') return                                   // explicitly routed — the caller named the target
  let localMain: string
  try { localMain = realpathSync(mainRoot()) } catch { return }   // caller not in a repo → can't prove a mismatch
  if (!servedRoot || !isAbsolute(servedRoot)) return              // unknown / config-aliased root → don't risk a false refusal
  let backendMain: string
  try { backendMain = realpathSync(servedRoot) } catch { return } // backend root not a local path → a remote backend, allow
  if (backendMain !== localMain) {
    const e = new Error(
      `${verb}: refusing WRITE — cwd is in ${localMain} but the backend at ${url} serves ${backendMain}.\n` +
      `Name the target explicitly (--api <url> / --port <n>) to write cross-project on purpose,\n` +
      `or run this project's own backend:  cd ${localMain} && spex serve.  (Reads stay unguarded.)`)
    e.name = 'GuardError'
    throw e
  }
}
function assertProjectSettingsMatch(verb: string, target: ApiBaseInfo, settings: BackendSettings | null): void {
  assertProjectRootMatch(verb, target, settings?.layout?.main ?? null)
}
function assertProjectInstanceMatch(verb: string, target: ApiBaseInfo, instance: BackendInstance | null): void {
  const root = instance?.root
  if (typeof root !== 'string' || !isAbsolute(root)) return
  let servedMain: string
  try { servedMain = mainRoot(root) } catch { return }
  assertProjectRootMatch(verb, target, servedMain)
}
export async function assertProjectMatch(verb: string): Promise<void> {
  const target = await apiBaseInfo()
  if (target.source === 'flag') return
  let settings: BackendSettings | null = null
  try {
    const r = await fetch(`${target.url}/api/settings`)
    if (r.ok) settings = await r.json() as BackendSettings
  } catch { return }                                              // backend unreachable → the write itself surfaces it (fail-loud there)
  assertProjectSettingsMatch(verb, target, settings)
}

export type SessionCreateFailureCode =
  | 'session_create_timeout'
  | 'session_create_cancelled'
  | 'session_create_failed'
  | 'session_create_cleanup_failed'
  | 'session_create_key_reused'
type SessionCreateFailureStatus = 400 | 408 | 409 | 500 | 504
type SessionCreatePhase = 'request' | 'creation-lock' | 'launcher-resolution' | 'target-resolution' | 'git-worktree' | 'materialize' | 'record-write' | 'launcher-queue' | 'cleanup'
export class SessionCreateError extends Error {
  constructor(
    readonly code: SessionCreateFailureCode,
    readonly phase: SessionCreatePhase,
    message: string,
    readonly status: SessionCreateFailureStatus,
  ) {
    super(message)
    this.name = 'SessionCreateError'
  }
}
type SessionCreateContext = { id: string; requestDigest: string; payloadHash: string; signal: AbortSignal; base?: string | null }
type SessionCreateRequestOptions = {
  requestKey?: string
  signal?: AbortSignal
  timeoutMs?: number
  onPublished?: (session: Session) => void | Promise<void>
}
export type SessionCreateRequestResult =
  | { status: 201; session: Session }
  | { status: SessionCreateFailureStatus; error: string; code?: SessionCreateFailureCode; phase?: SessionCreatePhase }

const DEFAULT_CREATE_TIMEOUT_MS = 30_000
export function sessionCreateTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.SPEXCODE_SESSION_CREATE_TIMEOUT_MS)
  return Number.isFinite(configured) ? Math.max(250, Math.min(120_000, Math.floor(configured))) : DEFAULT_CREATE_TIMEOUT_MS
}
function normalizeCreateKey(raw: string | undefined): string {
  const key = raw?.trim() || randomUUID()
  if (key.length > 128 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new SessionCreateError('session_create_failed', 'request', 'Idempotency-Key must be 1-128 visible ASCII characters', 400)
  }
  return key
}
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
export function sessionIdForCreateKey(key: string): string {
  const hex = digest(`spexcode-session-create\0${key}`)
  const uuid = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17)}`
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20, 32)}`
}
function traceSessionCreate(id: string, requestDigest: string, phase: SessionCreatePhase, event: 'start' | 'finish' | 'abort' | 'publish', detail?: string): void {
  console.error(`spex session-create ${JSON.stringify({ ts: new Date().toISOString(), request: requestDigest.slice(0, 12), session: id, phase, event, ...(detail ? { detail } : {}) })}`)
}
function createAbortError(signal: AbortSignal, phase: SessionCreatePhase): SessionCreateError {
  const timedOut = signal.reason instanceof SessionCreateError && signal.reason.code === 'session_create_timeout'
  return new SessionCreateError(
    timedOut ? 'session_create_timeout' : 'session_create_cancelled',
    phase,
    timedOut ? `session creation timed out during ${phase}` : `session creation was cancelled during ${phase}`,
    timedOut ? 504 : 408,
  )
}
function throwIfCreateAborted(signal: AbortSignal, phase: SessionCreatePhase): void {
  if (signal.aborted) throw createAbortError(signal, phase)
}

// The API create boundary accepts one small, closed object shape. Unknown fields fail through this generic
// contract before any worktree is made; removed or misspelled inputs never disappear into defaults.
export async function sessionCreateRequest(body: unknown, options: SessionCreateRequestOptions = {}): Promise<SessionCreateRequestResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'body must be a JSON object' }
  const input = body as Record<string, unknown>
  const unknown = Object.keys(input).filter((key) => !['prompt', 'parent', 'launcher', 'name', 'base'].includes(key)).sort()
  if (unknown.length) return { status: 400, error: `unknown session-create field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}` }
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  if (!prompt.trim()) return { status: 400, error: 'empty prompt' }
  const launcher = typeof input.launcher === 'string' && input.launcher.trim() ? input.launcher.trim() : undefined
  const parent = typeof input.parent === 'string' && input.parent.trim() ? input.parent.trim() : null
  if (input.name !== undefined && typeof input.name !== 'string') return { status: 400, error: 'session-create name must be a string' }
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null
  if (input.base !== undefined && typeof input.base !== 'string') return { status: 400, error: 'session-create base must be a string' }
  const base = typeof input.base === 'string' && input.base.trim() ? input.base.trim() : null
  const cutoverState = sessionApplicationCutoverState()
  if (cutoverState === 'fenced') return { status: 409, error: 'legacy JSON session store is fenced for one-time migration', code: 'session_create_failed', phase: 'request' }
  if (cutoverState === 'migration-required') return { status: 409, error: 'legacy JSON session store must be migrated before creating sessions', code: 'session_create_failed', phase: 'request' }
  if (cutoverState === 'ambiguous') return { status: 409, error: 'session database exists without a migration marker', code: 'session_create_failed', phase: 'request' }
  let key: string
  try { key = normalizeCreateKey(options.requestKey) }
  catch (error) {
    const failure = error as SessionCreateError
    return { status: failure.status, error: failure.message, code: failure.code, phase: failure.phase }
  }
  const requestDigest = digest(key)
  const id = sessionIdForCreateKey(key)
  // Keep no-name retries byte-compatible with pre-name receipts; an explicit non-empty name is one more
  // immutable creation input because it publishes the record's existing display override. `base` joins them
  // for the same reason and with the same shape: absent, it must not perturb an existing receipt's bytes.
  const payloadHash = digest(JSON.stringify({ prompt, parent, launcher: launcher ?? null, ...(name ? { name } : {}), ...(base ? { base } : {}) }))
  let freshStoreOwned = false
  let freshStoreCommitted = false
  try {
    const acquired = acquireFreshSessionApplicationForCreate()
    freshStoreOwned = acquired.owned
  } catch (error) {
    return { status: 409, error: error instanceof Error ? error.message : String(error), code: 'session_create_failed', phase: 'request' }
  }
  try { assertLegacyJsonWritesAllowed() }
  catch (error) {
    releaseFreshSessionApplicationForCreate(freshStoreOwned, false)
    const message = error instanceof Error ? error.message : String(error)
    return { status: 409, error: message, code: 'session_create_failed', phase: 'request' }
  }
  const controller = new AbortController()
  const cancel = () => controller.abort(new SessionCreateError('session_create_cancelled', 'request', 'session creation caller disconnected', 408))
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new SessionCreateError('session_create_timeout', 'request', 'session creation exceeded its deadline', 504)), options.timeoutMs ?? sessionCreateTimeoutMs())
  timer.unref?.()
  traceSessionCreate(id, requestDigest, 'request', 'start')
  try {
    try {
      const session = await prepareSession(prompt, parent, launcher, name, { id, requestDigest, payloadHash, base, signal: controller.signal })
      await options.onPublished?.(session)
      freshStoreCommitted = true
      traceSessionCreate(id, requestDigest, 'request', 'finish')
      return { status: 201, session }
    } catch (error) {
      const failure = error instanceof SessionCreateError
        ? error
        : controller.signal.aborted
          ? createAbortError(controller.signal, 'request')
          : new SessionCreateError('session_create_failed', 'request', String((error as Error).message || error), 400)
      return { status: failure.status, error: failure.message, code: failure.code, phase: failure.phase }
    }
  } finally {
    releaseFreshSessionApplicationForCreate(freshStoreOwned, freshStoreCommitted)
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}

function isExplicitConnectionRefused(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  if ((error as NodeJS.ErrnoException).code === 'ECONNREFUSED') return true
  const errors = (error as { errors?: unknown }).errors
  if (Array.isArray(errors)) return errors.length > 0 && errors.every(isExplicitConnectionRefused)
  return isExplicitConnectionRefused((error as { cause?: unknown }).cause)
}
async function establishBackendConnection(target: ApiBaseInfo): Promise<boolean> {
  const parsed = new URL(target.url)
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  return await new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ host: parsed.hostname, port })
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      fn()
    }
    const timer = setTimeout(() => {
      // The event loop may have been blocked past the wall after the kernel completed the handshake. In that
      // case Node has not emitted `connect` yet, but `connecting` is already false; acceptance still proves
      // presence and must not be relabelled as an unavailable backend.
      if (!socket.connecting || socket.readyState === 'open') return finish(() => resolve(false))
      finish(() => {
      const error = new Error(`backend connection was not accepted at ${target.url} within 1500ms`)
      error.name = 'BackendError'
      Object.assign(error, { code: 'backend_availability_indeterminate' })
      reject(error)
      })
    }, 1500)
    timer.unref?.()
    socket.once('connect', () => finish(() => resolve(false)))
    socket.once('error', (error) => finish(() => {
      if (isExplicitConnectionRefused(error)) return resolve(true)
      const failed = new Error(`backend availability is indeterminate at ${target.url}; refusing in-process session creation (${error instanceof Error ? error.message : error})`)
      failed.name = 'BackendError'
      Object.assign(failed, { code: 'backend_availability_indeterminate', cause: error })
      reject(failed)
    }))
  })
}
async function probeSessionCreateAuthority(target: ApiBaseInfo): Promise<boolean> {
  // TCP acceptance establishes presence. The identity route can be delayed by a busy backend event loop,
  // so it gets the ordinary create request deadline instead of a short availability deadline.
  const refused = await establishBackendConnection(target)
  if (refused) return true
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('backend authority request timed out')), sessionCreateTimeoutMs() + 5_000)
  timer.unref?.()
  let response: Response
  try {
    response = await fetch(`${target.url}/api/instance`, { signal: controller.signal })
  } catch (error) {
    clearTimeout(timer)
    const failed = new Error(`backend authority read failed after connection at ${target.url}; refusing in-process session creation (${error instanceof Error ? error.message : error})`)
    failed.name = 'BackendError'
    Object.assign(failed, { code: 'backend_authority_read_failed', cause: error })
    throw failed
  }
  try {
    let instance: BackendInstance | null = null
    if (response.ok) {
      try { instance = await response.json() as BackendInstance }
      catch { /* an HTTP response already established backend authority */ }
    }
    assertProjectInstanceMatch('spex session new', target, instance)
    return false
  } finally { clearTimeout(timer) }
}
export async function createSession(prompt: string, launcher?: string, name?: string, base?: string): Promise<Session> {
  const parent = ownSessionId()
  const requestKey = randomUUID()
  const body = { prompt, parent, launcher, ...(name !== undefined ? { name } : {}), ...(base !== undefined ? { base } : {}) }
  const target = await apiBaseInfo()
  const apiUrl = target.url
  const refused = await probeSessionCreateAuthority(target)
  if (refused) {
    console.error('spex: no backend reachable — launching in-process (caller env owns auth, no concurrency cap)')
    const fallback = await sessionCreateRequest(body, { requestKey, onPublished: projectCreatedSession })
    if (fallback.status === 201) return fallback.session
    const error = new Error(`${fallback.code || 'session_create_failed'}: ${fallback.error}`)
    error.name = 'BackendError'
    throw error
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('backend session-create request timed out')), sessionCreateTimeoutMs() + 5_000)
  timer.unref?.()
  let res: Response
  try {
    res = await fetch(`${apiUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    const failed = new Error(`backend session create failed without fallback after admission began: ${error instanceof Error ? error.message : error}`)
    failed.name = 'BackendError'
    throw failed
  } finally { clearTimeout(timer) }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let msg = text
    try { msg = JSON.parse(text).error || text } catch {}
    const err = new Error(`backend rejected session (${res.status}): ${msg}`)
    err.name = 'BackendError'
    throw err
  }
  return await res.json() as Session
}

export function projectCreatedSession(session: Session): void {
  const application = initializeFreshSessionApplication()
  try {
    application.createSession({
      sessionId: session.id,
      status: session.lifecycle,
      parentSessionId: session.parent,
      proposal: session.proposal,
      note: session.note,
    })
    if (session.parent) application.attachWatcher(session.parent, session.id, 'watch:parent')
  } catch (error) {
    const state = application.readState(session.id)
    const sameProjection = state?.status === session.lifecycle
      && state.parentSessionId === (session.parent ?? null)
    if (!sameProjection) throw error
  }
}

export function spawnerClause(p: SessRec | null): string {
  if (!p?.worktreePath) return ''
  const who = p.name || p.title
  return `\n\nYou were created by session \`${p.session.slice(0, 8)}\`${who ? ` (${who})` : ''}, whose worktree is ${p.worktreePath}` +
    `${p.branch ? ` on branch \`${p.branch}\`` : ''}. Your own worktree is branched from \`${mainBranch()}\`, so it does NOT contain that ` +
    `session's uncommitted or unmerged work — a spec node it just created, an edit it hasn't landed. If your task needs anything of theirs, ` +
    `read it there directly. Read only: never write into another session's worktree.`
}

function sessionCreateFailureRecord(rec: SessRec, error: unknown): SessRec {
  const msg = error instanceof Error ? error.message : String(error)
  console.error(`spex: materialize failed for worktree ${rec.worktreePath} — hooks/contract not materialized, worker launches UNGOVERNED: ${msg}`)
  return { ...rec, note: `materialize failed at creation — worker ungoverned (no hooks/contract): ${msg}` }
}

// A materialize failure can leave a tracked contract or .gitignore half-written. Until publication this is
// still creation-owned preparation: no worker can have authored work here, so restore HEAD and remove its
// untracked artifacts rather than publish a queued record that close must preserve as possibly-user-dirty.
// Disable checkout hooks: recovery is not another anchor that may recreate the failed materialization.
async function resetFailedMaterializeCandidate(rec: SessRec, signal: AbortSignal): Promise<void> {
  throwIfCreateAborted(signal, 'materialize')
  const reset = await gitTry(['-C', rec.worktreePath, '-c', 'core.hooksPath=/dev/null', 'reset', '--hard', '--quiet', 'HEAD'])
  if (!reset.ok) {
    const detail = (reset.stderr || reset.stdout || 'git reset failed without diagnostic').trim()
    throw new SessionCreateError('session_create_failed', 'materialize',
      `materialize failed and its prepared worktree could not be restored: ${detail}`, 500)
  }
  const clean = await gitTry(['-C', rec.worktreePath, '-c', 'core.hooksPath=/dev/null', 'clean', '-fd', '-e', 'spexcode.local.json'])
  if (clean.ok) return
  const detail = (clean.stderr || clean.stdout || 'git clean failed without diagnostic').trim()
  throw new SessionCreateError('session_create_failed', 'materialize',
    `materialize failed and its prepared worktree could not be restored: ${detail}`, 500)
}

async function materializeSessionCandidate(rec: SessRec, signal: AbortSignal): Promise<SessRec> {
  throwIfCreateAborted(signal, 'materialize')
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, [...cliEntrypointArgs(pkgRoot(), dirname(fileURLToPath(import.meta.url))), 'materialize'], {
        cwd: rec.worktreePath,
        env: process.env,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
      })
      let stderr = '', settled = false
      const killTree = () => {
        if (!child.pid) return
        try { process.kill(-child.pid, 'SIGKILL') } catch { /* process group already gone */ }
        try { child.kill('SIGKILL') } catch { /* child already gone */ }
      }
      const abort = () => killTree()
      signal.addEventListener('abort', abort, { once: true })
      child.stderr.setEncoding('utf8').on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk })
      child.once('error', (error) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        reject(error)
      })
      child.once('close', (code, childSignal) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', abort)
        if (signal.aborted) { reject(createAbortError(signal, 'materialize')); return }
        if (code === 0) { resolvePromise(); return }
        reject(new Error(`materialize exited ${childSignal || code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
      })
      if (signal.aborted) abort()
    })
    return rec
  } catch (error) {
    if (signal.aborted || error instanceof SessionCreateError) throw createAbortError(signal, 'materialize')
    const failed = sessionCreateFailureRecord(rec, error)
    await resetFailedMaterializeCandidate(rec, signal)
    return failed
  }
}

type SessionCandidateOwnership = { store: boolean; path: boolean; worktree: boolean; branch: boolean }
type SessionCandidateState = { path: boolean; worktree: boolean; branch: boolean }
type SessionCandidateStage = 'prepared' | 'git-created' | 'store-created'
type SessionCandidateReceipt = {
  version: 1
  requestDigest: string
  payloadHash: string
  root: string
  path: string
  branch: string
  prestate: { store: false; path: false; worktree: false; branch: false }
  stage: SessionCandidateStage
}
type SessionCandidateReceiptRead =
  | { kind: 'absent' }
  | { kind: 'invalid'; error: string }
  | { kind: 'valid'; receipt: SessionCandidateReceipt }

const sessionCandidateReceiptDir = () => join(runtimeRoot(), '.session-create-candidates')
const sessionCandidateReceiptPath = (id: string) => join(sessionCandidateReceiptDir(), `${id}.json`)
const sessionCandidateLockId = (path: string, branch: string) => `create-resource-${digest(`${path}\0${branch}`)}`
// The graph watcher uses this private fence to avoid rebuilding the full board while Git is still
// registering a session candidate. The receipt is written before `git worktree add` and retired only
// after publication or bounded cleanup, so the path names exactly the transaction-owned worktree.
export function pendingSessionCreateWorktreePaths(): Set<string> {
  const paths = new Set<string>()
  let entries: Dirent[]
  try { entries = readdirSync(sessionCandidateReceiptDir(), { withFileTypes: true }) }
  catch { return paths }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const value = JSON.parse(readFileSync(join(sessionCandidateReceiptDir(), entry.name), 'utf8')) as Partial<SessionCandidateReceipt>
      if (typeof value.path === 'string' && value.path && typeof value.stage === 'string') paths.add(resolve(value.path))
    } catch { /* an in-flight atomic replace is not a candidate path */ }
  }
  return paths
}
function readSessionCandidateReceipt(id: string): SessionCandidateReceiptRead {
  const path = sessionCandidateReceiptPath(id)
  if (!existsSync(path)) return { kind: 'absent' }
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionCandidateReceipt>
    const prestate = value.prestate
    if (value.version !== 1 || typeof value.requestDigest !== 'string' || typeof value.payloadHash !== 'string'
      || typeof value.root !== 'string' || typeof value.path !== 'string' || typeof value.branch !== 'string'
      || !prestate || prestate.store !== false || prestate.path !== false || prestate.worktree !== false || prestate.branch !== false
      || !['prepared', 'git-created', 'store-created'].includes(value.stage as string)) {
      return { kind: 'invalid', error: `invalid private candidate receipt at ${path}` }
    }
    return { kind: 'valid', receipt: value as SessionCandidateReceipt }
  } catch (error) {
    return { kind: 'invalid', error: `invalid private candidate receipt at ${path}: ${error instanceof Error ? error.message : error}` }
  }
}
function writeSessionCandidateReceipt(id: string, receipt: SessionCandidateReceipt): void {
  const dir = sessionCandidateReceiptDir()
  mkdirSync(dir, { recursive: true })
  const path = sessionCandidateReceiptPath(id)
  const tmp = join(dir, `.${id}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(tmp, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, path)
  } finally { rmSync(tmp, { force: true }) }
}
function retireSessionCandidateReceipt(id: string): boolean {
  try { rmSync(sessionCandidateReceiptPath(id), { force: true }) } catch { return false }
  return !existsSync(sessionCandidateReceiptPath(id))
}
function sessionCandidateReceiptMatches(receipt: SessionCandidateReceipt, context: SessionCreateContext, root: string, path: string, branch: string): boolean {
  return receipt.requestDigest === context.requestDigest && receipt.payloadHash === context.payloadHash
    && receipt.root === root && receipt.path === path && receipt.branch === branch
}
function publishedSessionCandidateReceiptRetirementFailure(rec: SessRec, root: string): string | null {
  const durable = readSessionCandidateReceipt(rec.session)
  if (durable.kind === 'absent') return null
  if (durable.kind === 'invalid') return durable.error
  if (!rec.createRequestId || !rec.createPayloadHash || !rec.branch || !rec.worktreePath
    || durable.receipt.requestDigest !== rec.createRequestId || durable.receipt.payloadHash !== rec.createPayloadHash
    || durable.receipt.root !== root || durable.receipt.path !== rec.worktreePath || durable.receipt.branch !== rec.branch) {
    return `private candidate receipt at ${sessionCandidateReceiptPath(rec.session)} does not match the published record`
  }
  if (!retireSessionCandidateReceipt(rec.session)) return `private candidate receipt remains at ${sessionCandidateReceiptPath(rec.session)}`
  return readSessionCandidateReceipt(rec.session).kind === 'absent'
    ? null
    : `private candidate receipt retirement is unproven at ${sessionCandidateReceiptPath(rec.session)}`
}
async function retirePublishedSessionCandidateReceipt(rec: SessRec, context: SessionCreateContext): Promise<void> {
  if (!rec.branch || !rec.worktreePath) return
  if (readSessionCandidateReceipt(rec.session).kind === 'absent') return
  const root = mainRoot(), path = rec.worktreePath, branch = rec.branch
  await withRecordLock(sessionCandidateLockId(path, branch), async () => {
    const failure = publishedSessionCandidateReceiptRetirementFailure(rec, root)
    if (failure) console.error(`spex: published session ${rec.session.slice(0, 8)} remains the fence for its candidate receipt: ${failure}`)
  }, context.signal)
}
async function sessionCandidateState(root: string, path: string, branch: string, signal: AbortSignal): Promise<SessionCandidateState> {
  const [listed, ref] = await withGitAbortSignal(signal, () => Promise.all([
    gitTry(['-C', root, 'worktree', 'list', '--porcelain', '-z']),
    gitTry(['-C', root, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]),
  ]))
  if (!listed.ok) throw new SessionCreateError('session_create_failed', 'git-worktree', `cannot read worktree registry: ${listed.stderr.trim() || listed.failure}`, 500)
  if (!ref.ok && ref.failure !== 'exit') throw new SessionCreateError('session_create_failed', 'git-worktree', `cannot read candidate branch: ${ref.stderr.trim() || ref.failure}`, 500)
  return { path: existsSync(path), worktree: listed.stdout.split('\0').includes(`worktree ${path}`), branch: ref.ok }
}

async function cleanupSessionCandidate(root: string, id: string, path: string, branch: string, owned: SessionCandidateOwnership): Promise<string[]> {
  const residues: string[] = []
  if (owned.store) {
    try { rmSync(sessionStoreDir(id), { recursive: true, force: true }) } catch { /* verified below */ }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  timer.unref?.()
  try {
    await withGitAbortSignal(controller.signal, async () => {
      if (owned.worktree) {
        const removed = await gitTry(['-C', root, 'worktree', 'remove', '--force', path])
        if (!removed.ok) residues.push(`worktree remove failed: ${removed.stderr.trim() || removed.failure}`)
      }
      const afterRemove = await sessionCandidateState(root, path, branch, controller.signal)
      if (owned.path && afterRemove.path && !afterRemove.worktree) {
        try { rmSync(path, { recursive: true, force: true }) } catch { /* verified below */ }
      }
      const ref = `refs/heads/${branch}`
      if (owned.branch) {
        const deleted = await gitTry(['-C', root, 'branch', '-D', branch])
        if (!deleted.ok) residues.push(`branch delete failed: ${deleted.stderr.trim() || deleted.failure}`)
      }
      const state = await sessionCandidateState(root, path, branch, controller.signal)
      if ((owned.path && state.path) || (owned.worktree && state.worktree)) residues.push(`owned worktree remains at ${path}`)
      if (owned.branch && state.branch) residues.push(`owned branch remains at ${ref}`)
      if ((!owned.path && state.path) || (!owned.worktree && state.worktree)) residues.push(`unowned candidate worktree preserved at ${path}`)
      if (!owned.branch && state.branch) residues.push(`unowned candidate branch preserved at ${ref}`)
    })
  } catch (error) {
    residues.push(`Git cleanup did not settle: ${error instanceof Error ? error.message : error}`)
  } finally { clearTimeout(timer) }
  if (owned.store && existsSync(sessionStoreDir(id))) residues.push(`owned session store remains at ${sessionStoreDir(id)}`)
  return residues
}

function existingCreateReceipt(rec: SessRec): Session {
  const h = harnessById(rec.harness || defaultHarness.id)
  if (rec.status === 'queued') return toSession(rec, 'queued', 'offline')
  const status = rec.status === 'active' ? 'working' : rec.status === 'awaiting' ? displayStatusForProposal(rec.proposal) : rec.status
  return toSession(rec, status, rec.stopped ? 'offline' : h.headless ? 'online' : 'starting')
}

async function proveSessionCandidate(path: string, branch: string, signal: AbortSignal): Promise<string | null> {
  const [top, checkedOut, ref] = await withGitAbortSignal(signal, () => Promise.all([
    gitTry(['-C', path, 'rev-parse', '--show-toplevel']),
    gitTry(['-C', path, 'symbolic-ref', '--quiet', '--short', 'HEAD']),
    gitTry(['-C', mainRoot(), 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]),
  ]))
  if (!top.ok || !checkedOut.ok || !ref.ok) return [top.stderr, checkedOut.stderr, ref.stderr].map((value) => value.trim()).filter(Boolean).join('; ') || 'Git identity validation failed'
  let actualTop = top.stdout.trim()
  try { actualTop = realpathSync(actualTop) } catch { /* missing path is reported by the comparison */ }
  let expectedTop = path
  try { expectedTop = realpathSync(path) } catch { /* missing path is reported by the comparison */ }
  if (actualTop !== expectedTop) return `worktree top-level is ${actualTop}, expected ${expectedTop}`
  if (checkedOut.stdout.trim() !== branch) return `worktree checked out ${checkedOut.stdout.trim() || '(detached)'}, expected ${branch}`
  return null
}

async function prepareSession(prompt: string, parent: string | null, launcher: string | undefined, name: string | null, context: SessionCreateContext): Promise<Session> {
  const { id, requestDigest, payloadHash, base, signal } = context
  let phase: SessionCreatePhase = 'creation-lock'
  let shouldDrain = false
  traceSessionCreate(id, requestDigest, phase, 'start')
  try {
    const receipt = await withRecordLock(id, async () => {
      const existing = readRecord(id)
      if (existing) {
        if (existing.createRequestId !== requestDigest || existing.createPayloadHash !== payloadHash) {
          throw new SessionCreateError('session_create_key_reused', 'creation-lock', 'Idempotency-Key is already bound to another session-create payload', 409)
        }
        await retirePublishedSessionCandidateReceipt(existing, context)
        return existingCreateReceipt(existing)
      }

      phase = 'launcher-resolution'
      traceSessionCreate(id, requestDigest, phase, 'start')
      let chosen: ReturnType<typeof resolveLauncher>
      let h: Harness
      let pinned: string
      try {
        const lname = launcher ?? defaultLauncher(mainRoot())
        chosen = resolveLauncher(lname)
        h = harnessById(chosen.harness)
        pinned = h.baseCmd(chosen.cmd)
        if (h.ownsRendezvous) assertRvSockPath(id)
      } catch (error) {
        throw new SessionCreateError('session_create_failed', phase, error instanceof Error ? error.message : String(error), 400)
      }
      traceSessionCreate(id, requestDigest, phase, 'finish')

      phase = 'target-resolution'
      traceSessionCreate(id, requestDigest, phase, 'start')
      throwIfCreateAborted(signal, phase)
      const rawPrompt = prompt
      // @@@ the first mention is read TWICE and stored NEVER - it names the worktree slug and, when that id
      // exists, the [[spec-pointer]] line. The record carries no spec node: a session is not bound to one.
      const ref = nodeFromPrompt(rawPrompt)
      const launchSpecs = ref ? loadSpecsLite() : null
      const title = titleFromPrompt(rawPrompt)
      const slug = `${slugify(ref || title)}-${id.slice(0, 4)}`
      const root = mainRoot()
      // An explicit base pins the fork point so a run is reproducible against a frozen commit instead of
      // whatever the source-of-truth branch has drifted to. Resolve it here, before any git mutation: an
      // unknown ref must fail the create request outright, never leave a half-made worktree behind.
      const startPoint = base ?? mainBranch()
      if (base) {
        const resolved = await withGitAbortSignal(signal, () => gitTry(['-C', root, 'rev-parse', '--verify', '--quiet', `${base}^{commit}`]))
        if (!resolved.ok || !resolved.stdout.trim()) {
          throw new SessionCreateError('session_create_failed', phase, `session-create base does not name a commit: ${base}`, 400)
        }
      }
      const branch = `${readConfig(dirname(gitCommonDir())).branchPrefix ?? 'node/'}${slug}`
      const path = join(root, '.worktrees', slug)
      const spec = ref ? launchSpecs?.find((node) => node.id === ref) : undefined
      const suffix = (spec ? `\n\nThe spec node \`${ref}\` is your ground truth — read its spec at ${join(path, spec.path)}.` : '')
        + spawnerClause(parent ? readRecord(parent) : null)
      let launchPrompt: string
      try {
        launchPrompt = (await composeSessionPrompt(rawPrompt, { session: id, harness: h.id }, {
          loadedSpecs: launchSpecs ?? undefined,
          suffix: suffix || undefined,
        })).text
      } catch (error) {
        throw new SessionCreateError('session_create_failed', phase, error instanceof Error ? error.message : String(error), 400)
      }
      traceSessionCreate(id, requestDigest, phase, 'finish')

      phase = 'git-worktree'
      traceSessionCreate(id, requestDigest, phase, 'start')
      const resourceLock = sessionCandidateLockId(path, branch)
      return await withRecordLock(resourceLock, async () => {
        throwIfCreateAborted(signal, phase)
        traceSessionCreate(id, requestDigest, phase, 'start', 'candidate-state')
        let before = await sessionCandidateState(root, path, branch, signal)
        traceSessionCreate(id, requestDigest, phase, 'finish', 'candidate-state')
        let storePresent = existsSync(sessionStoreDir(id))
        const durable = readSessionCandidateReceipt(id)
        if (durable.kind === 'invalid') throw new SessionCreateError('session_create_failed', phase, durable.error, 409)
        if (durable.kind === 'valid') {
          if (!sessionCandidateReceiptMatches(durable.receipt, context, root, path, branch)) {
            throw new SessionCreateError('session_create_failed', phase, 'private candidate receipt does not match this create request; preserving candidate resources', 409)
          }
          phase = 'cleanup'
          traceSessionCreate(id, requestDigest, phase, 'start', `recover-${durable.receipt.stage}`)
          const recovered = await cleanupSessionCandidate(root, id, path, branch, {
            store: storePresent, path: before.path, worktree: before.worktree, branch: before.branch,
          })
          traceSessionCreate(id, requestDigest, phase, recovered.length ? 'abort' : 'finish', recovered.join('; ') || undefined)
          if (recovered.length) throw new SessionCreateError('session_create_cleanup_failed', phase, `matching candidate recovery left residue: ${recovered.join('; ')}`, 500)
          before = { path: false, worktree: false, branch: false }
          storePresent = false
          phase = 'git-worktree'
        } else if (storePresent || before.path || before.worktree || before.branch) {
          const occupied = [storePresent ? `session store ${sessionStoreDir(id)}` : '', before.path ? `path ${path}` : '', before.worktree ? `registered worktree ${path}` : '', before.branch ? `branch ${branch}` : ''].filter(Boolean).join(', ')
          throw new SessionCreateError('session_create_failed', phase, `session target is already occupied: ${occupied}`, 409)
        }
        let candidateReceipt: SessionCandidateReceipt = {
          version: 1, requestDigest, payloadHash, root, path, branch,
          prestate: { store: false, path: false, worktree: false, branch: false }, stage: 'prepared',
        }
        writeSessionCandidateReceipt(id, candidateReceipt)
        const owned: SessionCandidateOwnership = { store: false, path: false, worktree: false, branch: false }
        let gitMutationStarted = false
        let published = false
        try {
          gitMutationStarted = true
          traceSessionCreate(id, requestDigest, phase, 'start', 'worktree-add')
          const added = await withGitAbortSignal(signal, () => gitTry(
            ['-C', root, 'worktree', 'add', '--no-track', '-b', branch, path, startPoint],
            { extraEnv: DEFER_FOOTPRINT_REFRESH },
          ))
          traceSessionCreate(id, requestDigest, phase, 'finish', 'worktree-add')
          if (added.ok) Object.assign(owned, { path: true, worktree: true, branch: true })
          if (!added.ok || !existsSync(path)) {
            throw new SessionCreateError('session_create_failed', phase, `git worktree add failed: ${added.stderr.trim() || added.failure || 'worktree missing after success'}`, 500)
          }
          candidateReceipt = { ...candidateReceipt, stage: 'git-created' }
          writeSessionCandidateReceipt(id, candidateReceipt)
          traceSessionCreate(id, requestDigest, phase, 'finish')
          traceSessionCreate(id, requestDigest, phase, 'start', 'seed-worktree-host-state')
          seedWorktreeHostState(root, path)
          traceSessionCreate(id, requestDigest, phase, 'finish', 'seed-worktree-host-state')

          // The branch ref right after `worktree add` IS the fork point. Record it: it is the only thing that
          // later separates "this branch never authored a commit" from "its commits landed in the base", and
          // git ancestry alone cannot tell those apart. A read that fails leaves it null — the diff reader
          // recovers the same commit from the branch's creation reflog entry.
          const forkResolved = await withGitAbortSignal(signal, () => gitTry(['-C', root, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`]))
          const forkCommit = forkResolved.ok && isGitObjectId(root, forkResolved.stdout.trim()) ? forkResolved.stdout.trim() : null

          let rec: SessRec = {
            session: id, governed: true, worktreePath: path, branch,
            title, name, parent: parent && parent !== id ? parent : null,
            status: 'queued', proposal: null, merges: 0, note: null, sortKey: null, createdAt: Date.now(),
            harness: h.id, harnessSessionId: null, runtimeStartToken: randomUUID(), stopped: false, archived: false, closedAt: null, coldProof: null, adapterRecovery: null, launcher: chosen.name,
            launchCmd: pinned, launchConfigDir: chosen.configDir, launchOwner: backendLaunchAuthority(), createRequestId: requestDigest, createPayloadHash: payloadHash,
            diffComments: [],
            ...(base ? { base } : {}),
            ...(forkCommit ? { forkCommit } : {}),
          }
          owned.store = true
          const dir = storeDir(id)
          writeFileSync(join(dir, 'prompt'), rawPrompt)
          writeFileSync(join(dir, 'launch'), launchPrompt)
          candidateReceipt = { ...candidateReceipt, stage: 'store-created' }
          writeSessionCandidateReceipt(id, candidateReceipt)

          phase = 'materialize'
          traceSessionCreate(id, requestDigest, phase, 'start')
          rec = await materializeSessionCandidate(rec, signal)
          traceSessionCreate(id, requestDigest, phase, 'finish')

          phase = 'record-write'
          traceSessionCreate(id, requestDigest, phase, 'start')
          throwIfCreateAborted(signal, phase)
          const gitMismatch = await proveSessionCandidate(path, branch, signal)
          if (gitMismatch) throw new SessionCreateError('session_create_failed', phase, `refusing session publication: ${gitMismatch}`, 500)
          throwIfCreateAborted(signal, phase)
          publishCanonicalLifecycle(rec, rec.status, rec.proposal, rec.note)
          writeRecord(rec)
          published = true
          const receiptFailure = publishedSessionCandidateReceiptRetirementFailure(rec, root)
          if (receiptFailure) console.error(`spex: published session ${id.slice(0, 8)} remains the fence for its candidate receipt: ${receiptFailure}`)
          shouldDrain = true
          traceSessionCreate(id, requestDigest, phase, 'publish')
          return toSession(rec, 'queued', 'offline')
        } catch (error) {
          if (published) throw error
          const failurePhase = error instanceof SessionCreateError ? error.phase : phase
          let ownershipFailure: string | null = null
          if (gitMutationStarted && !(owned.path && owned.worktree && owned.branch)) {
            const inspection = new AbortController()
            const timer = setTimeout(() => inspection.abort(), 10_000)
            timer.unref?.()
            try {
              const after = await sessionCandidateState(root, path, branch, inspection.signal)
              owned.path ||= !before.path && after.path
              owned.worktree ||= !before.worktree && after.worktree
              owned.branch ||= !before.branch && after.branch
            } catch (inspectionError) {
              ownershipFailure = `candidate ownership inspection failed: ${inspectionError instanceof Error ? inspectionError.message : inspectionError}`
            } finally { clearTimeout(timer) }
          }
          phase = 'cleanup'
          traceSessionCreate(id, requestDigest, phase, 'start')
          const residues = await cleanupSessionCandidate(root, id, path, branch, owned)
          if (ownershipFailure) residues.unshift(ownershipFailure)
          if (!residues.length && !retireSessionCandidateReceipt(id)) residues.push(`private candidate receipt remains at ${sessionCandidateReceiptPath(id)}`)
          traceSessionCreate(id, requestDigest, phase, residues.length ? 'abort' : 'finish', residues.join('; ') || undefined)
          if (residues.length) throw new SessionCreateError('session_create_cleanup_failed', phase, `session creation failed and cleanup left residue: ${residues.join('; ')}`, 500)
          if (signal.aborted) { phase = failurePhase; throw createAbortError(signal, failurePhase) }
          throw error instanceof SessionCreateError
            ? error
            : new SessionCreateError('session_create_failed', failurePhase, error instanceof Error ? error.message : String(error), 500)
        }
      }, signal)
    }, signal)
    traceSessionCreate(id, requestDigest, 'creation-lock', 'finish')
    if (shouldDrain) {
      phase = 'launcher-queue'
      traceSessionCreate(id, requestDigest, phase, 'start')
      requestQueueDrain()
      traceSessionCreate(id, requestDigest, phase, 'finish')
    }
    return receipt
  } catch (error) {
    const failure = signal.aborted
      ? createAbortError(signal, phase)
      : error instanceof SessionCreateError
        ? error
        : new SessionCreateError('session_create_failed', phase, error instanceof Error ? error.message : String(error), 500)
    traceSessionCreate(id, requestDigest, failure.phase, 'abort', failure.code)
    throw failure
  }
}

export function bootstrapMaterialize(rec: SessRec, doMaterialize: (proj: string) => unknown = materialize): void {
  try {
    doMaterialize(rec.worktreePath)
  } catch (e) {
    writeRecord(sessionCreateFailureRecord(rec, e))
  }
}

const SOCKET_READY_TIMEOUT_MS = 30000   // spans launchScript's bounded fast-fail relaunch window, so
                                        // waitForReady (slot-hold + resume) waits through a daemon-race retry
                                        // instead of returning before a recovering socket
const SOCKET_POLL_MS = 200
async function waitForReady(id: string, harness: Harness, pending?: SessRec, timeoutMs = SOCKET_READY_TIMEOUT_MS, recordLockHeld = false): Promise<LaunchReadinessOutcome> {
  const current = () => {
    const stored = readRecord(id)
    const rec = stored && pending
      ? { ...pending, ...stored, stopped: pending.stopped, archived: pending.archived }
      : stored || pending
    return rec ? { ...rec, runtimeDir: runtimeRoot() } : null
  }
  const deadline = Date.now() + timeoutMs
  // @@@identity stage waits on state, not on the artifact - the receipt is ONE mechanism that binds the
  // native id, and this observer is one of several serialized consumers (the drain, a resume recovery). So
  // consuming an available receipt is an action this stage takes, never its completion test: whichever
  // consumer binds the identity first is this launch's success, and a single-use artifact that is already
  // gone says nothing about whether that happened. Only an identity still unbound at the deadline is failure.
  if (harness.launchPayloadProof) {
    for (;;) {
      if (current()?.harnessSessionId) break
      if (hasReadableLaunchReceipt(id)) {
        const consume = (): void => {
          readinessWakeSuppressed.add(id)
          try { if (hasReadableLaunchReceipt(id)) consumeHarnessLaunchProofUnlocked(id) }
          finally { readinessWakeSuppressed.delete(id) }
        }
        if (recordLockHeld) consume()
        else await withRecordLock(id, async () => consume())
        if (current()?.harnessSessionId) break
      }
      if (Date.now() >= deadline) return { ok: false, stage: 'identity' }
      await new Promise((r) => setTimeout(r, SOCKET_POLL_MS))
    }
  }
  if (harness.launchReady) {
    const fence = await harness.launchReady(current, deadline)
    return fence ? { ok: true, fence } : { ok: false, stage: 'liveness' }
  }
  const genericFence = (): HarnessLaunchReadinessFence => ({
    proof: Object.freeze({ kind: 'adapter-liveness', harnessId: harness.id, sessionId: id }),
    validate: async (latest) => {
      const rec = latest()
      const snap = await liveSnapshot()
      return !!rec && harness.liveness(rec, snap.windows.has(id), runtimeRoot(), snap.windows.get(id), snap.sockets.has(id)) === 'online'
    },
  })
  for (;;) {
    const rec = current()
    const snap = await liveSnapshot()   // window + pane probe + live-listener set in one snapshot — all the adapter needs
    if (rec && harness.liveness(rec, snap.windows.has(id), runtimeRoot(), snap.windows.get(id), snap.sockets.has(id)) === 'online') return { ok: true, fence: genericFence() }
    if (Date.now() >= deadline) return { ok: false, stage: 'liveness' }
    await new Promise((r) => setTimeout(r, SOCKET_POLL_MS))
  }
}

type ResumeOptions = { force?: boolean; guard?: boolean }
// An explicit successful resume is a new runtime attempt. A prior terminal launch/turn error must not
// survive that handoff as current lifecycle truth; waiting declarations remain waiting declarations.
const restingLifecycle = (status: Lifecycle): Lifecycle =>
  status === 'active' || status === 'queued' || status === 'error' ? 'idle' : status
const resumeNote = (status: Lifecycle, note: string | null): string | null => status === 'error' ? null : note

const archiveRef = (id: string): string => `refs/spex-archive/${id}`

function archiveWorktreeState(id: string, path: string): string {
  const root = mainRoot()
  try {
    const parent = git(['-C', path, 'rev-parse', 'HEAD']).trim()
    git(['-C', path, 'add', '-A'])
    const tree = git(['-C', path, 'write-tree']).trim()
    const commit = git(['-C', path, '-c', 'user.name=SpexCode', '-c', 'user.email=spexcode@localhost', 'commit-tree', tree, '-p', parent, '-m', `spex close archive ${id}`]).trim()
    if (!/^[0-9a-f]{40,64}$/.test(commit)) throw new Error('archive commit was malformed')
    git(['-C', root, 'update-ref', archiveRef(id), commit])
    const stored = git(['-C', root, 'rev-parse', '--verify', `${archiveRef(id)}^{commit}`]).trim()
    if (stored !== commit) throw new Error('archive ref publication was not verified')
    return commit
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error)
    throw new ResourceConflict(`refusing to close ${id}: could not publish ${archiveRef(id)}${detail ? ` - ${detail}` : ''}`)
  }
}

async function restoreArchivedWorktree(id: string, rec: SessRec): Promise<void> {
  if (existsSync(rec.worktreePath)) return
  if (!rec.branch) throw new ResourceConflict(`session ${id} has no branch to restore its archived worktree`)
  const ref = archiveRef(id)
  const archive = await gitTry(['-C', mainRoot(), 'rev-parse', '--verify', `${ref}^{commit}`])
  const start = await gitTry(['-C', mainRoot(), 'rev-parse', '--verify', `refs/heads/${rec.branch}^{commit}`])
  if (!start.ok) throw new ResourceConflict(`session ${id} branch ${rec.branch} is missing`)
  await gitTry(['-C', mainRoot(), 'worktree', 'add', rec.worktreePath, rec.branch]).then((result) => {
    if (!result.ok) throw new ResourceConflict(`git worktree add failed: ${result.stderr.trim() || result.failure}`)
  })
  if (!archive.ok) return
  const patch = git(['-C', mainRoot(), 'diff', '--binary', `${rec.branch}..${ref}`])
  if (!patch) return
  try {
    execFileSync('git', ['-C', rec.worktreePath, 'apply', '--binary', '-'], { input: patch, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    throw new ResourceConflict(`session ${id} archived changes could not be restored: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function resumeSessionUnlocked(id: string, opts: ResumeOptions = {}): Promise<{ ok: boolean; error?: string; refused?: boolean; info?: string }> {
  const { force = false, guard = true } = opts
  let wt: { path: string; branch: string | null; rec: SessRec } | null
  try { wt = await findWorktree(id) }
  catch (e) { if (e instanceof SessionRecordUnusable) return { ok: false, refused: true, error: e.message }; throw e }
  if (!wt) return { ok: false, error: `no such session ${id}` }
  if (wt.rec.archived && retirementReason(wt.rec)) {
    try {
      await restoreArchivedWorktree(id, wt.rec)
      wt = await findWorktree(id)
      if (!wt) return { ok: false, error: `session ${id} disappeared while restoring its archived worktree` }
    } catch (error) {
      return { ok: false, refused: true, error: `session ${id}: archived worktree restore failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }
  // A process that died while validating left an internal candidate behind. This record lock proves no live
  // resume still owns it. Restore the frozen public original before doing any transport work and require an
  // explicit retry; stale runtime evidence is never adopted into a fresh launch attempt.
  if (wt.rec.launchReadinessPending) {
    writeRecord(restoreLaunchReadinessOriginal(wt.rec))
    return {
      ok: false,
      refused: true,
      error: `session ${id}: stale launch readiness pending was recovered fail-closed; the exact stopped/offline record was retained. Retry resume.`,
    }
  }
  const preResume = wt.rec
  // a retired session (its worktree gone) is terminal, not offline: say so in its own words rather than in the
  // preflight's, since `close` — not a repair — is what it needs.
  const retired = retirementReason(wt.rec)
  if (retired) return { ok: false, refused: true, error: retired }
  // everything else the transport can settle before opening a window: no branch, no launcher. A launch that
  // cannot succeed must not be attempted, retried, or given a regenerated launch script.
  const blocked = launchPreflight(wt.rec)
  if (blocked) return { ok: false, refused: true, error: blocked.message }
  const h = harnessById(wt.rec.harness || defaultHarness.id)
  // A prior adapter process may have proven identity + first-turn durability just before its session owner
  // died. Consume that receipt before choosing a recovery tail, so retry resumes the proven thread instead of
  // creating another one with the same first prompt.
  if (h.launchPayloadProof && hasReadableLaunchReceipt(id)) {
    consumeHarnessLaunchProofUnlocked(id)
    wt = await findWorktree(id)
    if (!wt) return { ok: false, error: `session ${id} disappeared while recovering native launch receipt` }
  }
  // An archived record is expected to be stopped, but the guard must still inspect physical liveness in case
  // it is a legacy/invariant-violating row. Ignore filing and stale stop metadata for this one safety probe so
  // resume can never kill a live leaf merely because the record was hidden.
  const probeRec = wt.rec.archived ? { ...wt.rec, archived: false, stopped: false } : wt.rec
  const resumeSnap = h.runtimeOwnership === 'adapter' ? null : await liveSnapshot()
  const lv = h.runtimeOwnership === 'adapter'
    ? await adapterRuntimeLiveness(probeRec)
    : liveness(probeRec, resumeSnap!)   // FRESH, honest liveness (listener-verified)
  if (guard && !force && lv === 'online')
    return { ok: false, refused: true, error: `session ${id} is ALIVE — refusing to relaunch, which would kill a live worker mid-work. To steer it, send it a message; use force only for a genuinely wedged (but alive) process.` }
  if (guard && !force && lv === 'unknown')
    return { ok: false, refused: true, error: `session ${id}: the liveness probe failed (the box is likely overloaded) — refusing to relaunch since a live worker can't be ruled out. Retry in a moment, or use force to override.` }
  const wasArchived = wt.rec.archived
  if (!wasArchived && wt.rec.adapterRecovery) {
    const recovery = await h.restoreRuntime?.(wt.rec)
    if (recovery && !recovery.ok) return { ok: false, refused: true, error: `session ${id}: recovery required before resume — ${recovery.reason}` }
    writeRecord({ ...(readRecord(id) || wt.rec), adapterRecovery: null, coldProof: null, archived: false, closedAt: null, stopped: true })
    wt = await findWorktree(id)
    if (!wt) return { ok: false, error: `session ${id} disappeared during adapter recovery` }
  }
  if (wasArchived && (force || lv === 'offline')) {
    // Make the durable row visible/offline before any adapter unarchive or launch RPC. Any later failure leaves
    // a retryable unarchived record rather than archived:true with a newly loaded target thread.
    const pendingRecovery = wt.rec.adapterRecovery || 'restore-runtime-pending'
    writeRecord({ ...wt.rec, archived: false, closedAt: null, stopped: true, coldProof: wt.rec.coldProof, adapterRecovery: pendingRecovery })
    const visible = readRecord(id) || { ...wt.rec, archived: false, closedAt: null, stopped: true, coldProof: wt.rec.coldProof, adapterRecovery: pendingRecovery }
    const restored = await h.restoreRuntime?.(visible)
    if (restored && !restored.ok) return { ok: false, refused: true, error: `session ${id}: ${restored.reason}` }
    writeRecord({ ...(readRecord(id) || visible), adapterRecovery: null, coldProof: null })
  }
  // proceeding: settle the RESTING lifecycle (a resumed working agent is now idle), then relaunch iff the agent
  // is CONFIRMED offline (or force — the wedged-but-alive escape). Clear the explicit-stop marker only after
  // launch has accepted the relaunch; a thrown launch leaves the record truthfully stopped. `starting`/`unknown`
  // fall through to a metadata-only no-op.
  // Archived sessions have no runtime by invariant. Resume first leaves cold storage, then the normal
  // starting -> online launch path recreates the same conversation.
  const current = wasArchived ? (readRecord(id) || { ...wt.rec, archived: false, closedAt: null, stopped: true, coldProof: null }) : wt.rec
  const resumed: SessRec = {
    ...current,
    archived: false,
    closedAt: null,
    coldProof: null,
    status: restingLifecycle(current.status),
    note: resumeNote(current.status, current.note),
    stopped: false,
  }
  if (force || lv === 'offline') {
    let resumeTail: string
    try { resumeTail = h.resumeArg(wt.rec, readLaunchFile(id)).trim() }
    catch (error) {
      return { ok: false, refused: true, error: error instanceof Error ? error.message : String(error) }
    }
    await sessionHost().stop(id)   // drop a dead/offline pane (or a force-killed live one)
    await launch(id, wt.path, resumeTail, h, launcherCmd(wt.rec))
    let readiness: LaunchReadinessOutcome = { ok: false, stage: 'liveness' }
    let readinessError = ''
    try { readiness = await waitForReady(id, h, resumed, SOCKET_READY_TIMEOUT_MS, true) }
    catch (error) { readinessError = error instanceof Error ? error.message : String(error) }
    if (!readiness.ok) {
      const failed = readRecord(id) || current
      writeRecord({ ...failed, ...preResume, harnessSessionId: failed.harnessSessionId, launchReadinessPending: null })
      return {
        ok: false,
        refused: true,
        error: `session ${id}: launch did not become ready${readinessError ? ` - ${readinessError}` : ''}; the session remains stopped and can be retried`,
      }
    }
    const latest = readRecord(id) || resumed
    const candidate: SessRec = {
      ...latest,
      archived: false,
      closedAt: null,
      coldProof: null,
      status: restingLifecycle(latest.status),
      note: resumeNote(latest.status, latest.note),
      stopped: false,
      launchReadinessPending: launchReadinessPending(preResume),
    }
    writeRecord(candidate)
    let stillReady = false
    try { stillReady = await readiness.fence.validate(() => {
      const stored = readRecord(id)
      return stored ? { ...stored, runtimeDir: runtimeRoot() } : null
    }) }
    catch (error) { readinessError = error instanceof Error ? error.message : String(error) }
    if (!stillReady) {
      const failed = readRecord(id) || candidate
      writeRecord(restoreLaunchReadinessOriginal(failed))
      return {
        ok: false,
        refused: true,
        error: `session ${id}: launch readiness changed across the pending publication${readinessError ? ` - ${readinessError}` : ''}; the session remains stopped and can be retried`,
      }
    }
    // `readRecord` projects the still-public pre-resume lifecycle while the candidate fence is pending.
    // Carrying that stale projection into the final publish used to leave queued/error rows unchanged in
    // SQLite even though the runtime envelope had crossed readiness. Publish the candidate lifecycle while
    // retaining the latest non-lifecycle envelope fields.
    const latestPublished = readRecord(id) || candidate
    const published = { ...latestPublished, status: candidate.status, proposal: candidate.proposal, note: candidate.note }
    publishCanonicalLifecycle(published, candidate.status, candidate.proposal, candidate.note)
    writeRecord({ ...published, launchReadinessPending: null })
  } else {
    publishCanonicalLifecycle(current, resumed.status, resumed.proposal, resumed.note)
    writeRecord(resumed)
  }
  return { ok: true }
}
export const resumeSession = (id: string, opts: ResumeOptions = {}) =>
  withSessionTransition(id, async () => {
    const result = await withRecordLock(id, () => resumeSessionUnlocked(id, opts))
    if (result.ok) await drainSession(id)
    return result
  })

export function markState(status: Lifecycle, opts: { proposal?: Proposal; note?: string; sessionId?: string } = {}): boolean {
  const id = opts.sessionId || ownSessionId()
  if (!id) return false
  return withRecordLockSync(id, () => {
    const raw = readRecord(id)
    if (raw?.archived) throw new ResourceConflict(`refusing lifecycle change for closed session ${id}: it is read-only; resume it before changing state`)
    const rec = readLiveRecord(id)
    if (!rec?.governed) return false
    const application = configuredSessionApplicationIfCutover()
    if (application) {
      const proposal = status === 'awaiting' ? (opts.proposal ?? 'nothing') : null
      const note = opts.note ?? null
      const current = application.readState(id)
      if (current && current.status === status && current.proposal === proposal && current.note === note) return true
      const recipients = canonicalWatchRecipients(application, id, status)
      application.transitionSession(id, {
        status,
        proposal,
        note,
        recipientSessionIds: recipients,
      })
      return true
    }
    const proposal = status === 'awaiting' ? (opts.proposal ?? 'nothing') : null
    writeRecord({
      ...rec, status,
      proposal,
      note: opts.note ?? null,
    })
    return true
  })
}
// A human prompt is the explicit re-entry from a waiting turn; runtime liveness is not.
export function markHumanPromptActive(sessionId: string): boolean {
  try {
    const rec = readRecord(sessionId)
    const canonical = sessionHookState(sessionId)
    // The canonical lifecycle decides whether this record is writable. Any real human re-entry can
    // resume a waiting declaration, including an `awaiting` close/merge proposal; the old envelope
    // status is only migration metadata and must never veto the re-entry.
    if (!rec || !canonical || rec.archived || retirementReason(rec)) return false
    return markState('active', { sessionId })
  } catch (error) {
    // The message/PTY write is already accepted; a raced close or unreadable record must not turn it into a false send failure.
    console.error(`spex: could not publish human-input activity for ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
export const markDone = (proposal: Proposal = 'nothing', sessionId?: string, note?: string) => markState('awaiting', { proposal, note, sessionId })
export function markTurnFailure(sessionId: string | undefined, note: string): boolean {
  if (!sessionId) return false
  return withRecordLockSync(sessionId, () => {
    const rec = readLiveRecord(sessionId)
    if (!rec?.governed || rec.status !== 'active' || rec.stopped || rec.archived) return false
    const application = configuredSessionApplicationIfCutover()
    if (application) {
      application.transitionSession(sessionId, {
        status: 'error', proposal: null, note,
        recipientSessionIds: canonicalWatchRecipients(application, sessionId, 'error'),
      })
      return true
    }
    writeRecord({ ...rec, status: 'error', proposal: null, note })
    return true
  })
}
// @@@ interrupt projection - a CONFIRMED human interrupt ended the turn, and the record says so the way an
// undeclared stop does: `asking`, with the reason, because the agent now waits for the human's next message.
// Active-only like every other turn-outcome writer: a declaration that landed first (the agent answered
// before the abort reached it) stays authoritative. The marker is stamped before the abort is sent so the
// adapter's own exit report — a one-turn process leaves with a non-zero code when aborted — reads the same
// outcome instead of filing a failed turn; it expires so a genuine failure later is never mistaken for it.
export const INTERRUPTED_NOTE = 'interrupted: the human stopped this turn; the next message continues the conversation'
const INTERRUPT_MARKER_TTL_MS = 15_000
const interruptMarkerPath = (id: string) => sessionArtifactPath(id, 'turn.interrupted')
export function stampInterrupt(id: string): void {
  mkdirSync(storeDir(id), { recursive: true })
  writeFileSync(interruptMarkerPath(id), String(Date.now()))
}
export function clearInterruptMarker(id: string): void {
  try { unlinkSync(interruptMarkerPath(id)) } catch { /* never stamped, or already consumed */ }
}
function consumeInterruptMarker(id: string): boolean {
  let at = NaN
  try { at = Number(readFileSync(interruptMarkerPath(id), 'utf8')) } catch { return false }
  clearInterruptMarker(id)
  return Number.isFinite(at) && Date.now() - at <= INTERRUPT_MARKER_TTL_MS
}
function projectInterruptedUnlocked(sessionId: string): boolean {
  const rec = readLiveRecord(sessionId)
  if (!rec?.governed || rec.status !== 'active' || rec.stopped || rec.archived) return false
  const application = configuredSessionApplicationIfCutover()
  if (application) {
    application.transitionSession(sessionId, {
      status: 'asking', proposal: null, note: INTERRUPTED_NOTE,
      recipientSessionIds: canonicalWatchRecipients(application, sessionId, 'asking'),
    })
    return true
  }
  writeRecord({ ...rec, status: 'asking', proposal: null, note: INTERRUPTED_NOTE })
  return true
}
export const markInterrupted = (sessionId: string): boolean => withRecordLockSync(sessionId, () => projectInterruptedUnlocked(sessionId))
export function markHeadlessTurnFailure(sessionId: string, harness: string, exitCode: string): boolean {
  if (exitCode === '0') return false
  if (consumeInterruptMarker(sessionId)) return markInterrupted(sessionId)
  const outcome = /^\d+$/.test(exitCode) ? `exit code ${exitCode}` : `signal ${exitCode}`
  return markTurnFailure(sessionId, `${harness} turn exited with ${outcome}`)
}
function bindHarnessSessionIdUnlocked(rec: SessRec, harnessSessionId: string, generationId = process.env.SPEXCODE_CODEX_GENERATION?.trim()): void {
  const id = rec.session
  if (rec.harnessSessionId && rec.harnessSessionId !== harnessSessionId)
    throw new ResourceConflict(`refusing to replace exact harness thread identity for ${id}; create a new governed session instead`)
  const codex = rec.harness === 'codex' || rec.harness === 'codex-headless'
  const root = runtimeRoot()
  let priorBinding: ReturnType<typeof codexGenerationBindingForSession> = null
  let registrationPrepared = false
  if (codex) {
    const ledger = readCodexGenerationLedger(root)
    if (ledger.revision > 0 && !generationId) throw new ResourceConflict(`refusing to bind Codex thread ${harnessSessionId}: launch did not provide an exact generation id`)
    priorBinding = codexGenerationBindingForSession(root, id)
    if (priorBinding && (!generationId || priorBinding.generationId !== generationId || priorBinding.threadId !== harnessSessionId))
      throw new ResourceConflict(`refusing to replace exact Codex generation binding for ${id}`)
    if (generationId && !priorBinding) {
      prepareCodexGenerationRegistration(root, id, harnessSessionId, generationId)
      registrationPrepared = true
    }
  }
  const application = configuredSessionApplicationIfCutover()
  const nativeStartToken = rec.runtimeStartToken || process.env.SPEXCODE_NATIVE_START_TOKEN?.trim()
  if (application && !nativeStartToken)
    throw new ResourceConflict(`refusing to bind runtime for ${id}: native start token is missing`)
  try {
    writeRecord({ ...rec, harnessSessionId, coldProof: null, adapterRecovery: null })
    if (application) {
      if (!nativeStartToken) throw new ResourceConflict(`refusing to bind runtime for ${id}: native start token is missing`)
      application.bindRuntime(id, {
        namespace: 'spex-governed',
        runtimeKind: rec.harness || defaultHarness.id,
        nativeSessionId: harnessSessionId,
        nativeStartToken,
      })
    }
  } catch (error) {
    if (codex && generationId && registrationPrepared) {
      try { bindCodexGeneration(root, id, harnessSessionId, null) }
      catch (rollback) {
        throw new ResourceConflict(`Codex generation binding persisted but session ${id} record write failed and rollback failed: ${rollback instanceof Error ? rollback.message : String(rollback)}`)
      }
    }
    throw error
  }
  if (codex && generationId) commitCodexGenerationRegistration(root, id, harnessSessionId, generationId)
}

type StagedHarnessLaunchProof = {
  version: 1
  sessionId: string
  harnessId: string
  harnessSessionId: string
  launchPayloadHash: string
  generationId: string | null
}

const NATIVE_LAUNCH_RECEIPT_FILE = 'launch.receipt'
const LEGACY_NATIVE_LAUNCH_RECEIPT_FILE = 'launch.proof' // dead-words-ok: one-release reader preserves staged receipts created before the protocol rename

function launchReceiptPath(id: string): string {
  return sessionArtifactPath(id, NATIVE_LAUNCH_RECEIPT_FILE)
}

function readableLaunchReceiptPath(id: string): string | null {
  const current = launchReceiptPath(id)
  if (existsSync(current)) return current
  const legacy = sessionArtifactPath(id, LEGACY_NATIVE_LAUNCH_RECEIPT_FILE)
  return existsSync(legacy) ? legacy : null
}

function hasReadableLaunchReceipt(id: string): boolean {
  return readableLaunchReceiptPath(id) !== null
}

function readHarnessLaunchProof(id: string, path = readableLaunchReceiptPath(id)): StagedHarnessLaunchProof {
  if (!path) throw new ResourceConflict(`native launch receipt for ${id} is missing`)
  try {
    const proof = JSON.parse(readFileSync(path, 'utf8')) as Partial<StagedHarnessLaunchProof> | null
    if (!proof || proof.version !== 1 || typeof proof.sessionId !== 'string'
      || typeof proof.harnessId !== 'string' || typeof proof.harnessSessionId !== 'string' || !proof.harnessSessionId
      || typeof proof.launchPayloadHash !== 'string'
      || (proof.generationId !== null && typeof proof.generationId !== 'string')) throw new Error('invalid receipt shape')
    return proof as StagedHarnessLaunchProof
  } catch (error) {
    throw new ResourceConflict(`native launch receipt for ${id} is unreadable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function sameHarnessLaunchProof(left: StagedHarnessLaunchProof, right: StagedHarnessLaunchProof): boolean {
  return left.version === right.version && left.sessionId === right.sessionId && left.harnessId === right.harnessId
    && left.harnessSessionId === right.harnessSessionId && left.launchPayloadHash === right.launchPayloadHash
    && left.generationId === right.generationId
}

// A native launch can be proven just before its visible TUI exits. A shell-level retry must be able to ask
// for that exact target without replaying the first prompt. This read-only resolver accepts either side of the
// proof-consumption boundary: the durable record after identity binding, or the staged receipt while the record
// lock has not consumed it yet. Any mismatch remains a loud resource conflict; returning null means no proof has
// been established and a fresh first-turn attempt is still allowed.
export function existingHarnessLaunchTarget(id: string): string | null {
  const rec = readLiveRecord(id)
  if (!rec) return null
  const harness = harnessById(rec.harness || defaultHarness.id)
  if (!harness.launchPayloadProof) return null
  const receiptPath = readableLaunchReceiptPath(id)
  if (receiptPath) {
    const proof = readHarnessLaunchProof(id, receiptPath)
    if (proof.sessionId !== id || proof.harnessId !== harness.id)
      throw new ResourceConflict(`native launch receipt for ${id} does not match the governed adapter identity`)
    const pending = readLaunchFile(id)
    if (pending != null && proof.launchPayloadHash !== createHash('sha256').update(pending).digest('hex'))
      throw new ResourceConflict(`native launch receipt for ${id} does not match the authoritative resolved launch payload`)
    if (rec.harnessSessionId && rec.harnessSessionId !== proof.harnessSessionId)
      throw new ResourceConflict(`refusing to replace exact harness thread identity for ${id}; staged launch receipt differs from the record`)
    return proof.harnessSessionId
  }
  return rec.harnessSessionId || null
}

export function stageHarnessLaunchProof(sessionId: string | undefined, harnessSessionId: string | undefined, launchPayload: string): boolean {
  const id = sessionId || ownSessionId()
  if (!id || !harnessSessionId) return false
  const rec = readLiveRecord(id)
  if (!rec) return false
  const harness = harnessById(rec.harness || defaultHarness.id)
  if (!harness.launchPayloadProof)
    throw new ResourceConflict(`harness ${harness.id} does not use native launch-payload receipts`)
  const pending = readLaunchFile(id)
  if (pending == null)
    throw new ResourceConflict(`refusing native launch receipt for ${id}: authoritative resolved launch payload is missing`)
  if (pending !== launchPayload)
    throw new ResourceConflict(`refusing native launch receipt for ${id}: first-turn payload differs from the authoritative resolved launch payload`)
  const generationId = process.env.SPEXCODE_CODEX_GENERATION?.trim() || null
  if (rec.harness === 'codex' || rec.harness === 'codex-headless') {
    const ledger = readCodexGenerationLedger(runtimeRoot())
    if (ledger.revision > 0 && !generationId)
      throw new ResourceConflict(`refusing native launch receipt for ${id}: launch did not provide an exact Codex generation id`)
    if (generationId && (!ledger.generations[generationId] || ledger.generations[generationId].state === 'reclaimed'))
      throw new ResourceConflict(`refusing to bind Codex thread ${harnessSessionId}: generation ${generationId} is absent or reclaimed`)
  }
  const proof: StagedHarnessLaunchProof = {
    version: 1,
    sessionId: id,
    harnessId: harness.id,
    harnessSessionId,
    launchPayloadHash: createHash('sha256').update(launchPayload).digest('hex'),
    generationId,
  }
  const existingPath = readableLaunchReceiptPath(id)
  if (existingPath) {
    const staged = readHarnessLaunchProof(id, existingPath)
    if (sameHarnessLaunchProof(staged, proof)) return true
    throw new ResourceConflict(`refusing to replace native launch receipt for ${id}: the staged session, thread, payload, or generation differs`)
  }
  const path = launchReceiptPath(id)
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temp, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 })
  try {
    linkSync(temp, path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const staged = readHarnessLaunchProof(id, path)
    if (sameHarnessLaunchProof(staged, proof)) return true
    throw new ResourceConflict(`refusing to replace native launch receipt for ${id}: the staged session, thread, payload, or generation differs`)
  } finally {
    rmSync(temp, { force: true })
  }
}

function consumeHarnessLaunchProofUnlocked(id: string): boolean {
  const rec = readLiveRecord(id)
  if (!rec) return false
  const harness = harnessById(rec.harness || defaultHarness.id)
  const receiptPath = readableLaunchReceiptPath(id)
  const proof = readHarnessLaunchProof(id, receiptPath)
  if (proof.sessionId !== id || proof.harnessId !== harness.id)
    throw new ResourceConflict(`native launch receipt for ${id} does not match the governed adapter identity`)
  const pending = readLaunchFile(id)
  if (pending == null && rec.harnessSessionId !== proof.harnessSessionId)
    throw new ResourceConflict(`refusing native launch receipt for ${id}: authoritative resolved launch payload is missing`)
  if (pending != null && proof.launchPayloadHash !== createHash('sha256').update(pending).digest('hex'))
    throw new ResourceConflict(`native launch receipt for ${id} does not match the authoritative resolved launch payload`)
  bindHarnessSessionIdUnlocked(rec, proof.harnessSessionId, proof.generationId || undefined)
  if (pending != null) {
    try { rmSync(sessionArtifactPath(id, 'launch')) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`spex: native launch receipt committed for ${id}, but launch could not be consumed: ${error instanceof Error ? error.message : String(error)}`)
        return true
      }
    }
  }
  try { if (receiptPath) rmSync(receiptPath) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      console.error(`spex: native launch receipt committed for ${id}, but the receipt could not be consumed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return true
}

export function markHarnessSessionId(sessionId: string | undefined, harnessSessionId: string | undefined): boolean {
  const id = sessionId || ownSessionId()
  if (!id || !harnessSessionId) return false
  return withRecordLockSync(id, () => {
    const rec = readLiveRecord(id)
    if (!rec) return false
    const harness = harnessById(rec.harness || defaultHarness.id)
    if (harness.launchPayloadProof)
      throw new ResourceConflict(`harness ${harness.id} must stage native identity together with an authoritative first-turn payload receipt`)
    bindHarnessSessionIdUnlocked(rec, harnessSessionId)
    return true
  })
}
export function markIdle(sessionId?: string): boolean {
  const id = sessionId || ownSessionId()
  if (!id) return false
  return withRecordLockSync(id, () => {
    const rec = readLiveRecord(id)
    if (!rec?.governed || rec.status !== 'active') return false  // managed active-only: never clobber a declaration
    publishCanonicalLifecycle(rec, 'idle', null, null)
    // After cutover the JSON file is only the runtime/worktree envelope. Do not mirror this inferred
    // lifecycle transition into it: doing so creates a second, stale-looking status surface for hooks.
    if (!configuredSessionApplicationIfCutover()) writeRecord({ ...rec, status: 'idle' })
    return true
  })
}
export function mergeReadiness(proposal: 'merge' | 'nothing' = 'merge'): { ready: boolean; reason?: string } {
  let dirty: string[] = []
  try {
    dirty = git(['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map(porcelainPath)
  } catch { /* git status failed — fall through to the ahead check, still a real guard */ }
  if (dirty.length) {
    const shown = dirty.slice(0, 8).join(', ') + (dirty.length > 8 ? ', …' : '')
    return { ready: false, reason: `uncommitted changes on your node branch (${shown}) — commit your spec+code first` }
  }
  // a `nothing` proposal makes no claim about having something to land, so the clean tree is the whole gate.
  if (proposal === 'nothing') return { ready: true }
  let ahead = 0
  const base = mainBranch()
  try { ahead = Number(git(['rev-list', '--count', `${base}..HEAD`]).trim()) || 0 } catch { ahead = 0 }
  if (ahead === 0) return { ready: false, reason: `your node branch is 0 commits ahead of ${base} — nothing is committed to merge (declaring \`done --propose nothing\` needs no commits ahead; use it to pause for the human)` }
  return { ready: true }
}

// the path a `git status --porcelain` line refers to: strip the `XY ` status, and for a rename keep the
// NEW path (after ` -> `). Shared by the dirty-file counters (mergeReadiness above, reviewPayload below).
function porcelainPath(line: string): string {
  let p = line.slice(3)
  const arrow = p.indexOf(' -> '); if (arrow >= 0) p = p.slice(arrow + 4)
  return p
}

export type ReviewEvalFacts = { freshPass: number; freshFail: number; needReview: number; blind: number }
export type ReviewEvalGate = ({ phase: 'ready' } & ReviewEvalFacts) | { phase: 'unavailable' | 'loading' | 'updating' | 'error' | 'dormant' }
// the session-side gates only. The measured-loss readout is composed ABOVE this layer ([[manager-cockpit]]'s
// cockpit.ts): the eval package imports this module, so reading it from here could only ever be a deferred
// import working around a cycle. The eval side never consumed this field — it reads lint/conflict/ahead/dirty.
export type ReviewGates = {
  conflictsWithMain: boolean                       // a dry-run merge into main would conflict (in-memory, safe)
  lint: { errorCount: number; warningCount: number } // the spec↔code graph lint
}
export type ReviewPayload = {
  id: string; branch: string | null
  label: string              // the session's identity, derived ONCE via deriveLabel — the review surface renders THIS, never its own branch||id chain
  ahead: number              // commits the session branch is ahead of main
  dirtyNonRuntime: number    // uncommitted files excluding SpexCode's own runtime files
  diff: ReviewDiffFile[]     // the worker's real changes, anchored at the merge-base
  gates: ReviewGates
  proposal: { kind: Proposal | null; note: string | null }   // the session's standing proposal + its note
}

export type SessionDiffFile = ReviewDiffFile & { patch: string; diffIdentity: string }
export type DiffScope = 'branch' | 'working'
// What is true of the branch's own commits, decided HERE so the reader never infers it from an empty list:
// 'no-commits' the branch head still stands at its fork point, 'merged' its head is contained in the base,
// 'open' it carries commits the base does not.
export type BranchState = 'no-commits' | 'merged' | 'open'
export type SessionDiffPayload = {
  id: string; scope: 'branch'; branch: string; baseRef: string; base: string; head: string; mergeBase: string
  branchState: BranchState; commitUrl: string | null
  files: SessionDiffFile[]
  // The uncommitted half of "what has this session changed". `readable` is false when the session's own
  // worktree directory is gone: an unknowable working tree, never a claim that it is clean.
  working: { readable: boolean; files: SessionDiffFile[] }
  comments: DiffComment[]
}

export function commitUrlForRemote(remote: string, commit: string): string | null {
  const raw = remote.trim()
  let host = '', path = ''
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ssh:') {
      host = url.host
      path = url.pathname
    }
  } catch {
    const scp = /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(raw)
    if (scp) [, host, path] = scp
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')
  if (!host || !path) return null
  const commitPath = host.toLowerCase().includes('gitlab') ? '-/commit' : 'commit'
  return `https://${host}/${path}/${commitPath}/${commit}`
}

// The branch diff is a proof over commits, not over a working directory: refs and objects are shared with
// the main checkout, so a session whose worktree directory is gone (landed and cleaned, or reaped) keeps a
// provable diff for as long as its branch ref survives. Anchor git at the live worktree when it exists and
// at the main checkout otherwise; only a branch whose ref is gone everywhere is honestly unavailable, and
// that refusal is a structured conflict (409 {error, code}) — never a raw git ENOENT turned into a 500.
async function diffAnchorRoot(wt: { path: string; branch: string | null; rec: SessRec }): Promise<string> {
  if (!wt.branch) throw new ResourceConflict(`session ${wt.rec.session} has no branch to diff`, 'diff-unavailable')
  if (wt.path && existsSync(wt.path)) return wt.path
  const main = mainRoot()
  const proven = await gitTry(['-C', main, 'rev-parse', '--verify', `refs/heads/${wt.branch}^{commit}`])
  if (proven.ok) return main
  throw new ResourceConflict(`session ${wt.rec.session} has no worktree on disk and its branch ${wt.branch} no longer exists`, 'diff-unavailable')
}

// @@@ forkCommitOf - the commit the branch was created at, from the most authoritative source that has it.
// The record carries it for every session created since it was introduced. Older records recover the same
// commit from the branch ref's OLDEST reflog entry, which is where git itself wrote the `worktree add` start
// point. Neither available (reflog pruned, or a branch adopted from outside this flow) → null, and the caller
// falls back to what ancestry alone can prove.
async function forkCommitOf(root: string, wt: { branch: string | null; rec: SessRec }): Promise<string | null> {
  if (wt.rec.forkCommit && isGitObjectId(root, wt.rec.forkCommit)) return wt.rec.forkCommit
  if (!wt.branch) return null
  const log = await gitTry(['-C', root, 'reflog', 'show', '--no-abbrev', '--format=%H', `refs/heads/${wt.branch}`])
  if (!log.ok) return null
  const entries = log.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  const created = entries[entries.length - 1]
  return created && isGitObjectId(root, created) ? created : null
}

async function diffHeadPair(root: string, wt: { path: string; branch: string | null; rec: SessRec }): Promise<{ branch: string; baseRef: string; base: string; head: string; mergeBase: string; branchState: BranchState; commitUrl: string | null }> {
  if (!wt.branch) throw new ResourceConflict(`session ${wt.rec.session} has no branch to diff`, 'diff-unavailable')
  const baseRef = wt.rec.base || mainBranch()
  const [headOut, baseOut] = await Promise.all([
    gitTry(['-C', root, 'rev-parse', '--verify', `refs/heads/${wt.branch}^{commit}`]),
    gitTry(['-C', root, 'rev-parse', '--verify', `${baseRef}^{commit}`]),
  ])
  const head = headOut.ok ? headOut.stdout.trim() : '', resolvedBase = baseOut.ok ? baseOut.stdout.trim() : ''
  if (!head || !resolvedBase || !isGitObjectId(root, head) || !isGitObjectId(root, resolvedBase))
    throw new ResourceConflict(`session ${wt.rec.session} diff heads are unproven`, 'diff-unavailable')
  const mergeBaseOut = await gitTry(['-C', root, 'merge-base', resolvedBase, head])
  const mergeBase = mergeBaseOut.ok ? mergeBaseOut.stdout.trim() : ''
  if (!mergeBase || !isGitObjectId(root, mergeBase)) throw new ResourceConflict(`session ${wt.rec.session} diff merge-base is unproven`, 'diff-unavailable')
  const [ancestor, remote, forkCommit] = await Promise.all([
    gitTry(['-C', root, 'merge-base', '--is-ancestor', head, resolvedBase]),
    gitTry(['-C', root, 'remote', 'get-url', 'origin']),
    forkCommitOf(root, wt),
  ])
  // A branch that never authored a commit is ALSO an ancestor of its base, so ancestry must be asked second.
  // Without a fork commit the only provable form of "authored nothing" is a head that is still the base head.
  const authoredNothing = forkCommit ? head === forkCommit : head === resolvedBase
  return {
    branch: wt.branch, baseRef, base: resolvedBase, head, mergeBase,
    branchState: authoredNothing ? 'no-commits' : ancestor.ok ? 'merged' : 'open',
    commitUrl: remote.ok ? commitUrlForRemote(remote.stdout, head) : null,
  }
}

// @@@ workingFiles - the session's uncommitted changes, enumerated from ONE porcelain status plus ONE numstat.
// Untracked files count their own lines rather than spawning a git child each: the metadata call stays two
// processes however dirty the tree is, and nothing here touches the index — an `--intent-to-add` would mutate
// the worktree a live agent is working in.
const WORKING_STATUS: Record<string, string> = { '??': 'untracked', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed' }
async function workingFiles(root: string): Promise<ReviewDiffFile[]> {
  const [statusOut, numstatOut] = await Promise.all([
    gitA(['-C', root, '-c', 'core.quotePath=false', 'status', '--porcelain', '--untracked-files=all']),
    gitA(['-C', root, '-c', 'core.quotePath=false', 'diff', '--numstat', '-M', 'HEAD']),
  ])
  const counts = new Map<string, { additions: number; deletions: number }>()
  for (const line of numstatOut.split('\n')) {
    const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/)
    if (!m) continue
    const { to } = parseStatPath(m[3])
    counts.set(to, { additions: m[1] === '-' ? 0 : +m[1], deletions: m[2] === '-' ? 0 : +m[2] })
  }
  const files: ReviewDiffFile[] = []
  for (const line of statusOut.split('\n')) {
    if (!line.trim()) continue
    const code = line.slice(0, 2)
    const path = porcelainPath(line)
    const arrow = line.indexOf(' -> ')
    const oldPath = arrow >= 0 ? line.slice(3, arrow) : ''
    const letter = code.trim().replace(/[^A-Z?]/g, '').slice(0, 1) || 'M'
    const status = WORKING_STATUS[code === '??' ? '??' : letter] ?? 'modified'
    files.push({
      path,
      ...(oldPath && oldPath !== path ? { oldPath } : {}),
      status,
      ...(counts.get(path) ?? (code === '??' ? untrackedCounts(join(root, path)) : { additions: 0, deletions: 0 })),
    })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

// An untracked file is entirely new, so its addition count is its line count. A NUL byte means git would
// print `-`/`-` for a binary blob; report the same nothing rather than a line count of bytes.
function untrackedCounts(absolute: string): { additions: number; deletions: number } {
  try {
    const body = readFileSync(absolute)
    if (body.includes(0)) return { additions: 0, deletions: 0 }
    const text = body.toString('utf8')
    return { additions: text.length ? text.replace(/\n$/, '').split('\n').length : 0, deletions: 0 }
  } catch { return { additions: 0, deletions: 0 } }
}

async function workingPatch(root: string, file: ReviewDiffFile, untracked: boolean): Promise<string> {
  if (untracked) {
    // --no-index against /dev/null renders a whole new file as one addition hunk. It exits 1 when the two
    // sides differ, which is the normal case here, so the patch is read off stdout rather than off `ok`.
    const out = await gitTry(['-C', root, '--no-pager', 'diff', '--no-ext-diff', '--unified=40', '--no-index', '--', '/dev/null', file.path])
    return out.stdout
  }
  return gitA(['-C', root, '--no-pager', 'diff', '--no-ext-diff', '--unified=40', 'HEAD', '--', ...(file.oldPath ? [file.oldPath, file.path] : [file.path])])
}

// A working file's identity must move when its CONTENT moves, or a stale editor and a stale comment anchor
// would survive an edit. Size and mtime are what change on every write, and they cost one stat.
function workingIdentity(root: string, file: ReviewDiffFile): string {
  let stamp = 'gone'
  try { const s = statSync(join(root, file.path)); stamp = `${s.size}:${s.mtimeMs}` } catch { /* deleted in the worktree */ }
  return createHash('sha256').update(`working\0${file.path}\0${file.oldPath || ''}\0${stamp}`).digest('hex')
}

export async function sessionDiff(id: string, filePath?: string, offset = 0, limit = 120_000, scope: DiffScope = 'branch'): Promise<SessionDiffPayload | null> {
  const wt = await findWorktree(id)
  if (!wt) return null
  const root = await diffAnchorRoot(wt)
  const pair = await diffHeadPair(root, wt)
  // The working tree is the session's OWN directory or it is not knowable. `root` falls back to the main
  // checkout once the worktree is gone ([[diff-document]]), and that checkout's dirty files belong to whoever
  // is working there — never to this session.
  const liveRoot = wt.path && existsSync(wt.path) ? wt.path : null
  const window = (patch: string) => patch.slice(offset, offset + limit)

  // A per-file fetch names its scope, so only that scope is enumerated: opening one file in a worktree with a
  // hundred dirty paths must not re-walk the other scope's git reads.
  const branch = scope === 'branch' || !filePath ? await mergeBaseDiff(root, pair.base, pair.head) : []
  const branchSelected = scope === 'branch' && filePath ? branch.filter((file) => file.path === filePath || file.oldPath === filePath) : (filePath ? [] : branch)
  const files = await Promise.all(branchSelected.map(async (file) => {
    const identity = createHash('sha256').update(`${pair.mergeBase}\0${pair.head}\0${file.path}\0${file.oldPath || ''}`).digest('hex')
    if (!filePath) return { ...file, patch: '', diffIdentity: identity }
    const patch = await gitA(['-C', root, '--no-pager', 'diff', '--no-ext-diff', '--unified=40', pair.mergeBase, pair.head, '--', ...(file.oldPath ? [file.oldPath, file.path] : [file.path])])
    return { ...file, patch: window(patch), diffIdentity: identity }
  }))

  const dirty = liveRoot && (scope === 'working' || !filePath) ? await workingFiles(liveRoot) : []
  const workingSelected = scope === 'working' && filePath ? dirty.filter((file) => file.path === filePath || file.oldPath === filePath) : (filePath ? [] : dirty)
  const working = await Promise.all(workingSelected.map(async (file) => {
    const identity = workingIdentity(liveRoot!, file)
    if (!filePath) return { ...file, patch: '', diffIdentity: identity }
    const patch = await workingPatch(liveRoot!, file, file.status === 'untracked')
    return { ...file, patch: window(patch), diffIdentity: identity }
  }))

  return {
    id, scope: 'branch', ...pair, files,
    working: { readable: !!liveRoot, files: working },
    comments: wt.rec.diffComments ?? [],
  }
}

export async function saveDiffComment(id: string, input: Omit<DiffComment, 'id' | 'sentAt'> & { id?: string }): Promise<DiffComment | null> {
  const body = input.body.trim()
  if (!input.filePath || !body || !Number.isInteger(input.lineStart) || input.lineStart < 1 || !Number.isInteger(input.lineEnd) || input.lineEnd < input.lineStart || !input.diffIdentity)
    throw new ResourceConflict('diff comment needs a file, line range, body, and diff identity')
  return withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return null
    const comment: DiffComment = { id: input.id || randomUUID(), filePath: input.filePath, lineStart: input.lineStart, lineEnd: input.lineEnd, body, diffIdentity: input.diffIdentity, sentAt: null }
    const comments = (rec.diffComments ?? []).filter((candidate) => candidate.id !== comment.id)
    writeRecord({ ...rec, diffComments: [...comments, comment] })
    return comment
  })
}

// A review conversation you can only append to is not a conversation. Saving, editing and sending all
// existed; nothing could take a row back, so a comment filed on the wrong line — or a probe left by a
// measurement — stayed on the record forever. Retract is the same shape as the other two `retract` verbs
// this product already has ([[session-files]], eval): it removes the row under the record lock and says
// which one it removed. Already-DELIVERED text is not recalled — the agent read it — so this retracts the
// record's row, never the message that was sent.
export async function retractDiffComment(id: string, commentId: string): Promise<DiffComment | null> {
  if (!commentId) throw new ResourceConflict('retracting a diff comment needs its id')
  return withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return null
    const comments = rec.diffComments ?? []
    const removed = comments.find((comment) => comment.id === commentId)
    if (!removed) return null
    writeRecord({ ...rec, diffComments: comments.filter((comment) => comment.id !== commentId) })
    return removed
  })
}

export async function sendDiffComments(id: string, ids?: string[]): Promise<{ ok: boolean; sentAt?: string; count?: number; error?: string }> {
  const selected = await withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return null
    const wanted = ids?.length ? new Set(ids) : null
    return (rec.diffComments ?? []).filter((comment) => !comment.sentAt && (!wanted || wanted.has(comment.id)))
  })
  if (!selected) return { ok: false, error: `no such session ${id}` }
  if (!selected.length) return { ok: false, error: 'no unsent diff comments' }
  const text = ['Review comments on the branch diff:', ...selected.map((comment) => {
    const lines = comment.lineStart === comment.lineEnd ? `L${comment.lineStart}` : `L${comment.lineStart}-L${comment.lineEnd}`
    return `- ${comment.filePath}:${lines}\n  ${comment.body.replace(/\n/g, '\n  ')}`
  })].join('\n')
  const sent = await sendText(id, text)
  if (!sent.ok) return { ok: false, error: sent.error || 'could not send diff comments' }
  const sentAt = new Date().toISOString()
  await withRecordLock(id, async () => {
    const rec = readLiveRecord(id)
    if (!rec) return
    const selectedById = new Map(selected.map((comment) => [comment.id, comment]))
    writeRecord({ ...rec, diffComments: (rec.diffComments ?? []).map((comment) => {
      const before = selectedById.get(comment.id)
      const unchanged = before && !comment.sentAt && comment.body === before.body && comment.diffIdentity === before.diffIdentity
      return unchanged ? { ...comment, sentAt } : comment
    }) })
  })
  return { ok: true, sentAt, count: selected.length }
}

type ReviewHeadPair = { branchHead: string; baseHead: string }

async function reviewHeadPair(root: string, branch: string, base: string): Promise<ReviewHeadPair> {
  const branchRef = `refs/heads/${branch}`, baseRef = `refs/heads/${base}`
  const output = await gitA(['-C', root, 'for-each-ref', '--sort=refname', '--format=%(refname)%00%(objectname)', branchRef, baseRef])
  const refs = new Map<string, string>()
  for (const line of output.split('\n')) {
    const at = line.indexOf('\0')
    if (at > 0) refs.set(line.slice(0, at), line.slice(at + 1).trim())
  }
  const branchHead = refs.get(branchRef), baseHead = refs.get(baseRef)
  if (!branchHead || !baseHead || !isGitObjectId(root, branchHead) || !isGitObjectId(root, baseHead)) {
    throw new ResourceConflict(`review head pair is unproven: ${branchRef} or ${baseRef} is missing or not a native Git object id`)
  }
  return { branchHead, baseHead }
}

// @@@ lintGate - the spec↔code graph lint is a LOCATION gate: a function of the backend checkout's tree ALONE
// (its .spec graph + governed files), not of which session is reviewed, and it costs a few seconds. Re-running
// it on every reviewPayload — i.e. on every [[session-eval]] Proof-tab open, and once per session — is
// wasteful, so memoize it on a whole-repo fingerprint: `rev-parse HEAD` + `status --porcelain` + the mtimes of
// the changed paths (covers committed state, the dirty SET, and dirty-file CONTENT). An identical fingerprint
// reuses the last (in-flight) result — a re-open or a second session's proof is instant — while any commit or
// working-tree edit moves the fingerprint and recomputes. A rejected run is not cached.
let gateCache: { fp: string; p: Promise<ReviewGates['lint']> } | null = null
async function lintGate(): Promise<ReviewGates['lint']> {
  const root = repoRoot()
  const [head, status] = await Promise.all([
    gitA(['-C', root, 'rev-parse', 'HEAD']),
    gitA(['-C', root, 'status', '--porcelain', '--untracked-files=all']),
  ])
  // `status --porcelain` gives the SET of changed paths + status letters but is CONTENT-BLIND: re-editing an
  // already-listed (dirty or untracked) file leaves the string byte-identical, so HEAD+status alone would
  // freeze the gate after a file first goes dirty. `--untracked-files=all` stops an untracked dir from
  // collapsing to one line (which hides a newly-added file); then fold each listed path's mtime in, so a
  // content edit to a dirty file also moves the fingerprint. HEAD covers committed state, this covers the
  // working tree. (Residual, accepted: the fingerprint is snapshot just before the compute, so a change
  // landing mid-compute is labelled with the pre-change fp — rare, and the gate is advisory, re-verified at merge.)
  const mtimes = status.split('\n').filter(Boolean).map(porcelainPath)
    .map((p) => { try { return statSync(join(root, p)).mtimeMs } catch { return 0 } }).join(',')
  const fp = head.trim() + '\n' + status + '\n' + mtimes
  if (gateCache?.fp === fp) return gateCache.p
  const p = (async () => {
    const { specLint } = await import('./lint.js')
    const findings = await specLint()
    return {
      errorCount: findings.filter((f) => f.level === 'error').length,
      warningCount: findings.filter((f) => f.level === 'warn').length,
    }
  })()
  p.catch(() => { if (gateCache?.p === p) gateCache = null })   // don't pin a failed run
  gateCache = { fp, p }
  return p
}

// @@@ reviewPayload - assemble the cockpit review for one session. The four session-specific reads
// (ahead / dirty / diff / conflict gate) plus the one location gate (lint) are all independent, so they run
// in parallel. The lint gate goes through lintGate(), which memoizes it on the checkout's tree fingerprint —
// so an unchanged tree doesn't re-run the lint on each review / Proof-tab open, while any commit or edit
// invalidates and recomputes.
export async function reviewPayload(id: string): Promise<ReviewPayload | null> {
  const wt = await findWorktree(id)
  if (!wt) return null
  if (!wt.rec.governed || !wt.branch) throw new ResourceConflict(`session ${id} has no governed branch to review`)
  const base = mainBranch()
  const { branchHead, baseHead } = await reviewHeadPair(wt.path, wt.branch, base)
  const [aheadOut, statusOut, diff, conflictsWithMain, lint] = await Promise.all([
    gitA(['-C', wt.path, 'rev-list', '--count', `${baseHead}..${branchHead}`]),
    gitA(['-C', wt.path, 'status', '--porcelain', '--untracked-files=all']),
    mergeBaseDiff(wt.path, baseHead, branchHead),
    mergeConflicts(wt.path, baseHead, branchHead),
    lintGate(),   // lint — memoized on the checkout fingerprint, not re-run per session/open
  ])
  const settledPair = await reviewHeadPair(wt.path, wt.branch, base)
  if (settledPair.branchHead !== branchHead || settledPair.baseHead !== baseHead) {
    throw new ResourceConflict(
      `review head pair changed while assembling: started branch ${branchHead} / base ${baseHead}, ended branch ${settledPair.branchHead} / base ${settledPair.baseHead}`,
      'session_review_head_changed',
    )
  }
  // the worktree carries no SpexCode runtime files any more (the store lives in ~/.spexcode), so every dirty
  // path is genuine work — this is just the total uncommitted count.
  const dirtyNonRuntime = statusOut.split('\n').filter(Boolean).map(porcelainPath).length
  return {
    id, branch: wt.branch,
    label: deriveLabel({ id, name: wt.rec.name, title: wt.rec.title, branch: wt.branch }),
    ahead: Number(aheadOut.trim()) || 0,
    dirtyNonRuntime, diff,
    gates: { conflictsWithMain, lint },
    proposal: { kind: wt.rec.proposal, note: wt.rec.note },
  }
}

const MERGE_PROMPT = `Merge your branch into main, then settle the session honestly.

1. In your own worktree, merge the latest main into your branch. Resolve any conflicts there and re-run the tests.
2. Atomic landing: main only receives the completed branch as one no-ff merge. Never resolve conflicts in the shared main checkout.
3. Verify main advanced cleanly with no merge left in progress. If this task is settled, run \`spex session done --propose close\` as your FINAL action; otherwise declare the state that is true.`

export type MergeSessionResult =
  | { dispatched: true }
  | { dispatched: false; reason: string }

export async function mergeSession(id: string): Promise<MergeSessionResult> {
  const wt = await findWorktree(id)
  if (!wt?.branch) return { dispatched: false, reason: 'no such mergeable session' }
  const r = await sendText(id, MERGE_PROMPT, undefined, {
    deferDrain: true,
  })
  if (!r.ok) return { dispatched: false, reason: r.error || 'could not dispatch merge prompt' }
  await resumeSession(id, { guard: false })
  await drainSession(id)
  return { dispatched: true }
}

// @@@ killAgentProcess - the pane is the agent's HOME, not its LEASH. `kill-session` SIGHUPs the pane's
// process group, and an idle agent goes with it (measured: ~0.8s) — but one mid-turn can outlive the whole
// tmux server and keep running, orphaned, still holding its rendezvous socket (measured: pane gone, server
// gone, agent still answering). Close promises ZERO residue including the process tree, so the teardown
// escalates on the pid launch registered for exactly this purpose: give the SIGHUP its moment, then SIGTERM,
// then SIGKILL, each bounded. This is also what lets the socket sweep run at all — a still-answering listener
// is never ours to unlink, so an un-killed agent would otherwise strand its own socket forever.
// The escalation is IDENTITY-GUARDED: a recorded pid can have been recycled by an unrelated process, so we
// signal only the immutable pid/start instance whose ownership was witnessed in the exact tmux pane closure.
// Unidentifiable → we signal nothing and let the adapter's proof-of-death rule leave the transport alone.
const AGENT_EXIT_GRACE_MS = 3000
const SESSION_LEAF_RECEIPT_VERSION = 1
const SESSION_LEAF_RECEIPT_KIND = 'session-leaf'
export type SessionLeafReceipt = {
  version: 1
  kind: 'session-leaf'
  sessionId: string
  pid: number
  startToken: string
}
type SessionLeafReceiptCandidate = { ok: boolean; receipt?: SessionLeafReceipt; reason?: string }

export function parseSessionLeafReceipt(raw: string, sessionId: string): SessionLeafReceipt | null {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const keys = Object.keys(row).sort()
  if (keys.join(',') !== 'kind,pid,sessionId,startToken,version') return null
  if (row.version !== SESSION_LEAF_RECEIPT_VERSION || row.kind !== SESSION_LEAF_RECEIPT_KIND || row.sessionId !== sessionId) return null
  if (!Number.isSafeInteger(row.pid) || (row.pid as number) <= 0 || typeof row.startToken !== 'string' || !row.startToken) return null
  return row as SessionLeafReceipt
}

function pidInPaneClosure(pid: number, panePid: number, procs: ProcTable): boolean {
  const seen = new Set<number>()
  for (let current = pid; current > 0 && !seen.has(current);) {
    if (current === panePid) return true
    seen.add(current)
    const row = procs.get(current)
    if (!row || row.ppid === current) return false
    current = row.ppid
  }
  return false
}

export function sessionLeafReceiptCandidate(
  sessionId: string,
  pid: number,
  panePid: number | null,
  procs: ProcTable | null,
  startBefore: string | null,
  startAfter: string | null,
): SessionLeafReceiptCandidate {
  if (!panePid) return { ok: false, reason: 'exact target pane PID is unavailable' }
  if (!procs) return { ok: false, reason: 'process snapshot is unavailable' }
  if (!startBefore || !startAfter) return { ok: false, reason: 'leaf process-start identity is unreadable' }
  if (startBefore !== startAfter) return { ok: false, reason: 'leaf process-start identity changed during ancestry observation' }
  if (!pidInPaneClosure(pid, panePid, procs)) return { ok: false, reason: `registered leaf PID ${pid} is not in exact target pane ${panePid} descendant closure` }
  return {
    ok: true,
    receipt: { version: SESSION_LEAF_RECEIPT_VERSION, kind: SESSION_LEAF_RECEIPT_KIND, sessionId, pid, startToken: startAfter },
  }
}

export function sessionLeafReceiptIdentityState(
  receipt: SessionLeafReceipt,
  registeredPid: number | null,
  currentStartToken: string | null,
  liveness: 'alive' | 'dead' | 'unknown',
): 'same-live' | 'gone' | 'pid-reused' | 'unknown' | 'registration-changed' | 'registration-missing' {
  if (registeredPid == null) return 'registration-missing'
  if (registeredPid !== receipt.pid) return 'registration-changed'
  if (liveness === 'unknown') return 'unknown'
  if (liveness === 'dead') return currentStartToken ? 'unknown' : 'gone'
  if (!currentStartToken) return 'unknown'
  return currentStartToken === receipt.startToken ? 'same-live' : 'pid-reused'
}

const sessionLeafReceiptPath = (id: string) => sessionArtifactPath(id, 'agent.identity.json')
function readSessionLeafReceipt(id: string): { state: 'missing' } | { state: 'invalid'; reason: string } | { state: 'valid'; receipt: SessionLeafReceipt } {
  const path = sessionLeafReceiptPath(id)
  let raw: string
  try { raw = readFileSync(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' }
    return { state: 'invalid', reason: `leaf birth receipt is unreadable (${error instanceof Error ? error.message : String(error)})` }
  }
  const receipt = parseSessionLeafReceipt(raw, id)
  return receipt ? { state: 'valid', receipt } : { state: 'invalid', reason: 'leaf birth receipt is malformed or names a different session' }
}

function writeSessionLeafReceipt(id: string, receipt: SessionLeafReceipt): void {
  const path = sessionLeafReceiptPath(id)
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
    renameSync(temp, path)
  } finally { rmSync(temp, { force: true }) }
}

function clearSessionLeafArtifacts(id: string): void {
  rmSync(sessionArtifactPath(id, 'agent.pid'), { force: true })
  pidRegistry.delete(id)
  rmSync(sessionLeafReceiptPath(id), { force: true })
}

type LeafIdentity = { pid: number; startToken: string; receipt: SessionLeafReceipt }
type LeafIdentityObservation =
  | { state: 'missing' }
  | { state: 'dead'; pid: number }
  | { state: 'owned'; identity: LeafIdentity }
  | { state: 'unknown'; pid?: number; reason: string }
const sameSessionLeafReceipt = (left: SessionLeafReceipt, right: SessionLeafReceipt): boolean =>
  left.version === right.version && left.kind === right.kind && left.sessionId === right.sessionId
  && left.pid === right.pid && left.startToken === right.startToken

async function killAgentProcess(id: string, beforeSignal: () => Promise<void>, leaf: LeafIdentity): Promise<void> {
  const pid = leaf.pid
  const startToken = leaf.startToken
  const alive = (): boolean => leafAlive(pid)
  const identityState = (): 'same' | 'gone' | 'changed' => {
    const stored = readSessionLeafReceipt(id)
    if (stored.state !== 'valid' || !sameSessionLeafReceipt(stored.receipt, leaf.receipt)) return 'changed'
    const registered = readAgentPid(sessionArtifactPath(id, 'agent.pid'))
    const liveness = leafProcessLiveness(pid)
    const currentStartToken = sessionLeafStartToken(pid)
    const state = sessionLeafReceiptIdentityState(
      stored.receipt,
      Number.isSafeInteger(registered) ? registered : null,
      currentStartToken,
      liveness,
    )
    return state === 'same-live' ? 'same' : state === 'gone' ? 'gone' : 'changed'
  }
  const initialState = identityState()
  if (initialState === 'gone') return
  if (initialState === 'changed') throw new ResourceConflict(`refusing to stop ${id}: session leaf identity changed before signal`)
  const gone = async (ms: number): Promise<boolean> => {
    for (const end = Date.now() + ms; Date.now() < end;) {
      if (!alive()) return true
      await new Promise((r) => setTimeout(r, 100))
    }
    return !alive()
  }
  if (await gone(AGENT_EXIT_GRACE_MS)) return                        // the pane's SIGHUP took it — the normal path
  for (const sig of ['SIGTERM', 'SIGKILL'] as const) {
    await beforeSignal()
    const state = identityState()
    if (state === 'gone') return
    if (state === 'changed') throw new ResourceConflict(`refusing to stop ${id}: session leaf identity changed during escalation`)
    try { process.kill(pid, sig) } catch { return }                  // vanished between checks
    if (await gone(sig === 'SIGTERM' ? AGENT_EXIT_GRACE_MS : 1000)) return
  }
  throw new ResourceConflict(`refusing to stop ${id}: exact leaf PID ${pid}@${startToken} remains live after escalation`)
}

// @@@ stopAgentProcess - the shared teardown both stop and close begin with, so there is ONE kill path, not
// two: kill the agent's tmux client, make sure the agent itself actually went with it, drop its boot-window
// stamp (else a just-launched id lingers in the grace window reading `starting` instead of `offline`), and ask
// the resolved adapter to sweep its ephemeral runtime transport — in that order, because the adapter only
// removes a transport whose listener is PROVEN dead.
// Deliberately does NOT drainQueue — the caller drains once, after it has settled the worktree.
// @@@ leafAlive - does this pid name a live process? EPERM counts as alive (a process we may not signal is
// still a process); only ESRCH is absence. Kept local: git.ts carries its own copy for lock reclamation, and
// collapsing the two is part of the spec/eval unification lane, not of this fix.
export type SessionLeafProcessProbe = Readonly<{
  startToken(pid: number): string | null
  liveness(pid: number): 'alive' | 'dead' | 'unknown'
}>
const hostLeafProcessLiveness = (pid: number): 'alive' | 'dead' | 'unknown' => {
  try { process.kill(pid, 0); return 'alive' }
  catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ESRCH') return 'dead'
    if (code === 'EPERM') return 'alive'
    return 'unknown'
  }
}
let sessionLeafProcessProbe: SessionLeafProcessProbe = {
  startToken: processStartToken,
  liveness: hostLeafProcessLiveness,
}
export function installSessionLeafProcessProbeForTest(probe: SessionLeafProcessProbe): () => void {
  const previous = sessionLeafProcessProbe
  sessionLeafProcessProbe = probe
  return () => { sessionLeafProcessProbe = previous }
}
const sessionLeafStartToken = (pid: number): string | null => sessionLeafProcessProbe.startToken(pid)
const leafProcessLiveness = (pid: number): 'alive' | 'dead' | 'unknown' => sessionLeafProcessProbe.liveness(pid)
const leafAlive = (pid: number): boolean => leafProcessLiveness(pid) !== 'dead'

// A retained leaf can mint durable ownership only while its registered PID is in the exact target pane's process
// closure. The receipt then binds that one immutable process instance across tmux reparenting and crash retry.
async function inspectSessionLeafIdentity(id: string, rec: SessRec): Promise<LeafIdentityObservation> {
  if (harnessById(rec.harness || defaultHarness.id).runtimeOwnership === 'adapter') return { state: 'missing' }
  const path = sessionArtifactPath(id, 'agent.pid')
  let raw: string
  try { raw = readFileSync(path, 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      const stored = readSessionLeafReceipt(id)
      if (stored.state === 'invalid') return { state: 'unknown', reason: stored.reason }
      if (stored.state === 'missing') return { state: 'missing' }
      const liveness = leafProcessLiveness(stored.receipt.pid)
      const current = sessionLeafStartToken(stored.receipt.pid)
      const state = sessionLeafReceiptIdentityState(stored.receipt, stored.receipt.pid, current, liveness)
      if (state === 'same-live')
        return { state: 'unknown', pid: stored.receipt.pid, reason: 'leaf birth receipt remains live but agent.pid registration is missing' }
      if (state === 'unknown')
        return { state: 'unknown', pid: stored.receipt.pid, reason: 'leaf birth receipt PID is live but its process-start identity is unreadable' }
      if (state !== 'gone' && state !== 'pid-reused')
        return { state: 'unknown', pid: stored.receipt.pid, reason: `leaf birth receipt cannot reconcile a missing registration (${state})` }
      rmSync(sessionLeafReceiptPath(id), { force: true })
      return { state: 'dead', pid: stored.receipt.pid }
    }
    return { state: 'unknown', reason: `leaf PID artifact is unreadable (${error instanceof Error ? error.message : String(error)})` }
  }
  const pid = Number(raw.trim())
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: 'unknown', reason: 'leaf PID artifact is malformed' }
  const stored = readSessionLeafReceipt(id)
  if (stored.state === 'invalid') return { state: 'unknown', pid, reason: stored.reason }
  if (stored.state === 'valid') {
    const liveness = leafProcessLiveness(pid)
    const current = sessionLeafStartToken(pid)
    const state = sessionLeafReceiptIdentityState(stored.receipt, pid, current, liveness)
    if (state === 'same-live') return { state: 'owned', identity: { pid, startToken: current!, receipt: stored.receipt } }
    if (state === 'gone') {
      clearSessionLeafArtifacts(id)
      return { state: 'dead', pid }
    }
    if (state === 'pid-reused') {
      const snap = await liveSnapshot(id)
      if (snap.probeFailed) return { state: 'unknown', pid, reason: 'target pane state is unreadable while reconciling a retired leaf receipt' }
      if (snap.windows.has(id)) return { state: 'unknown', pid, reason: `leaf birth receipt no longer matches PID ${pid} while the exact target pane remains live` }
      clearSessionLeafArtifacts(id)
      return { state: 'dead', pid }
    }
    if (state === 'unknown') return { state: 'unknown', pid, reason: `leaf PID ${pid} is live but its process-start identity is unreadable` }
    return { state: 'unknown', pid, reason: 'leaf birth receipt and agent.pid registration disagree' }
  }

  const snap = await liveSnapshot(id)
  if (snap.probeFailed) return { state: 'unknown', pid, reason: 'exact target pane is unreadable; leaf birth receipt cannot be minted' }
  const panePid = snap.windows.get(id)?.panePid ?? null
  const startBefore = sessionLeafStartToken(pid)
  if (!startBefore) {
    const live = leafProcessLiveness(pid)
    if (live !== 'dead') return { state: 'unknown', pid, reason: `leaf PID ${pid} process-start identity is unreadable while liveness is ${live}` }
    clearSessionLeafArtifacts(id)
    return { state: 'dead', pid }
  }
  let procs: ProcTable | null = null
  try { procs = await procSnapshot() } catch { /* fail closed below */ }
  const startAfter = sessionLeafStartToken(pid)
  const candidate = sessionLeafReceiptCandidate(id, pid, panePid, procs, startBefore, startAfter)
  if (!candidate.ok || !candidate.receipt) return { state: 'unknown', pid, reason: candidate.reason || 'leaf birth receipt validation failed' }
  if (readAgentPid(path) !== pid || sessionLeafStartToken(pid) !== candidate.receipt.startToken)
    return { state: 'unknown', pid, reason: `leaf PID ${pid} identity changed before receipt commit` }
  writeSessionLeafReceipt(id, candidate.receipt)
  const committed = readSessionLeafReceipt(id)
  if (committed.state !== 'valid' || !sameSessionLeafReceipt(committed.receipt, candidate.receipt)
    || readAgentPid(path) !== pid || sessionLeafStartToken(pid) !== candidate.receipt.startToken)
    return { state: 'unknown', pid, reason: `leaf PID ${pid} identity changed while receipt committed` }
  return { state: 'owned', identity: { pid, startToken: candidate.receipt.startToken, receipt: candidate.receipt } }
}

async function assertSessionLeafOwned(id: string, rec: SessRec): Promise<LeafIdentity | null> {
  if (harnessById(rec.harness || defaultHarness.id).runtimeOwnership === 'adapter') return null
  const observed = await inspectSessionLeafIdentity(id, rec)
  if (observed.state === 'missing') {
    if (rec.stopped || rec.status === 'queued') return null
    throw new ResourceConflict(`refusing to stop ${id}: no readable session-owned leaf PID`)
  }
  if (observed.state === 'dead') return null
  if (observed.state === 'owned') return observed.identity
  throw new ResourceConflict(`refusing to stop ${id}: ${observed.reason}`)
}

async function stopAgentProcess(id: string, rec: SessRec | null, requireCold = false, coldReceipt?: unknown): Promise<void> {
  // The caller resolves one readable owner before entering this seam. An absent/corrupt record never reaches
  // tmux, signals, or adapter cleanup: a bare session id is an address, not ownership authority.
  const assertOwned = () => assertSessionStopSafe(id, rec ? { ...rec, harness: rec.harness } : null,
    { ...(requireCold && coldReceipt !== undefined ? { coldReceipt } : {}) })
  await assertOwned()
  if (!rec) throw new ResourceConflict(`refusing to stop ${id}: no readable session owner`)
  const harness = harnessById(rec.harness || defaultHarness.id)
  const leaf = await assertSessionLeafOwned(id, rec)
  // Adapter-owned headless sessions may have no live leaf PID, but launch still created an exact tmux session
  // wrapper. Kill that session-id unconditionally; runtimeOwnership only changes the leaf receipt proof, never the
  // exact tmux teardown.
  await sessionHost().stop(id)
  await assertTargetTmuxAbsent(id, 'after kill')
  if (leaf) {
    await killAgentProcess(id, assertOwned, leaf)
    const registered = readAgentPid(sessionArtifactPath(id, 'agent.pid'))
    const liveness = leafProcessLiveness(leaf.pid)
    const currentStartToken = sessionLeafStartToken(leaf.pid)
    const finalState = sessionLeafReceiptIdentityState(
      leaf.receipt,
      Number.isSafeInteger(registered) ? registered : null,
      currentStartToken,
      liveness,
    )
    if (finalState !== 'gone' && finalState !== 'pid-reused')
      throw new ResourceConflict(`refusing to stop ${id}: exact leaf teardown remains ${finalState}`)
    clearSessionLeafArtifacts(id)
  }
  launchedAt.delete(id)
  await harness.cleanupRuntime(rec)
  if (requireCold) {
    const cold = await harness.coldRuntime?.(rec, coldReceipt)
    if (cold && !cold.ok) throw new ResourceConflict(`refusing to close ${id}: ${cold.reason}`)
  }
}

async function stopSessionUnlocked(id: string): Promise<boolean> {
  let wt: { path: string; branch: string | null; rec: SessRec } | null
  try { wt = await findWorktree(id) }
  catch (e) {
    if (!(e instanceof SessionRecordUnusable) || e.code !== 'corrupt') throw e
    await stopAgentProcess(id, null)
    throw e
  }
  if (!wt) return false
  await stopAgentProcess(id, wt.rec)
  const rec = readRecord(id)
  if (rec) writeRecord({ ...rec, stopped: true })
  if (wt.rec.status !== 'queued') requestQueueDrain()   // a live stop frees a slot; a prepared queue never held one
  return !!wt
}
export const stopSession = (id: string): Promise<boolean> =>
  withSessionTransition(id, () => withRecordLock(id, () => stopSessionUnlocked(id)))

async function coldStopSessionUnlocked(id: string): Promise<boolean> {
  let wt: { path: string; branch: string | null; rec: SessRec } | null
  try { wt = await findWorktree(id) }
  catch (e) {
    if (e instanceof SessionRecordUnusable) throw new ResourceConflict(`refusing to close ${id}: ${e.message}`)
    throw e
  }
  if (!wt) return false
  if (wt.rec.status === 'queued') throw new ResourceConflict(`refusing to close ${id}: queued sessions have only a prepared launch prompt; close handles their prepared tree directly`)
  const retired = retirementReason(wt.rec)
  if (retired) throw new ResourceConflict(`refusing to close ${id}: ${retired}`)
  archiving.add(id)
  try {
  const h = harnessById(wt.rec.harness || defaultHarness.id)
  const settleArchiveRecovery = () => {
    const current = readRecord(id)
    if (current?.adapterRecovery) writeRecord({ ...current, adapterRecovery: null })
  }
  // A proven cold record is already archived; never clear it and issue a second thread/archive RPC. Verify the
  // adapter's exact resident reference first so an externally respawned thread is repaired rather than hidden.
  if (wt.rec.archived && hasValidColdProof(wt.rec)) {
    const proofSnap = await liveSnapshot(id)
    if (proofSnap.probeFailed) throw new ResourceConflict(`refusing to close ${id}: liveness probe failed; the exact leaf may have respawned`)
    const proofLv = h.runtimeOwnership === 'adapter'
      ? (proofSnap.windows.has(id) ? 'online' : 'offline')
      : liveness({ ...wt.rec, archived: false, stopped: false }, proofSnap)
    if (proofLv === 'unknown' || proofLv === 'starting') throw new ResourceConflict(`refusing to close ${id}: session liveness is ${proofLv}; exact cold state is unproven`)
    if (proofLv === 'offline') {
      // A deliberately stopped shared control plane is a valid empty resident census. A durable proof plus
      // an adapter-owned root-absent fact is the only idempotent short-circuit; a live root still has to prove
      // the thread's archived/non-archived disk collection before we can claim it is already cold.
      const rootAbsent = await Promise.all((h.sharedRuntimes?.(runtimeRoot()) ?? []).map(async (descriptor) => {
        if (!descriptor.residency) return false
        const state = await descriptor.residency()
        return state.healthy && state.rootAbsent === true && state.referenceIds.length === 0
      })).then((states) => states.some(Boolean))
      if (rootAbsent) {
        settleArchiveRecovery()
        return true
      }
      const pre = await h.coldPreflight?.({ ...wt.rec, archived: false, stopped: true })
      if (!pre || pre.ok) {
        const cold = await h.coldRuntime?.({ ...wt.rec, archived: false, stopped: true }, pre?.ok ? pre.receipt : undefined)
        if (!cold || cold.ok) {
          settleArchiveRecovery()
          return true
        }
      }
    }
  }
  // Legacy/respawned closed rows are probed as ordinary runtime records, but the durable archived bit is kept
  // untouched until the new close publication succeeds.
  if (wt.rec.archived) {
    wt = { ...wt, rec: { ...wt.rec, archived: false, coldProof: null } }
  }

  const snap = await liveSnapshot(id)
  if (snap.probeFailed) throw new ResourceConflict(`refusing to close ${id}: liveness probe failed; the leaf may still be live`)
  const lv = h.runtimeOwnership === 'adapter'
    ? 'offline'
    : liveness({ ...wt.rec, archived: false, stopped: false }, snap)
  if (lv === 'unknown' || lv === 'starting')
    throw new ResourceConflict(`refusing to close ${id}: session liveness is ${lv}; exact leaf ownership is unproven`)
  // The adapter guard runs BEFORE any tmux/process signal. Active/unknown native turns and ambiguous descendant
  // ownership refuse here; a verified adapter receipt carries an exact subtree through to coldRuntime's commit.
  assertSessionOwnerSafe(id, h.id)
  const preflight = await h.coldPreflight?.({ ...wt.rec, archived: false, stopped: lv === 'offline' })
  if (preflight && !preflight.ok) throw new ResourceConflict(`refusing to close ${id}: ${preflight.reason}`)
  // Even a proven-offline leaf can leave a stale rendezvous/socket or adapter artifact. Reuse the same exact
  // teardown seam with the explicit stopped marker so cleanupRuntime gets its ownership check and no second
  // cleanup primitive is invented.
  let coldCommitted = false
  let coldAttempted = false
  try {
    coldAttempted = true
    await stopAgentProcess(id, { ...wt.rec, archived: false, stopped: lv === 'offline' }, true,
      preflight?.ok ? preflight.receipt : undefined)
    coldCommitted = true
    const latest = readRecord(id)
    if (!latest) throw new ResourceConflict(`refusing to close ${id}: session record disappeared before archive-ref publication`)
    // The leaf identity kill and adapter cold proof established process/transport absence. Record-backed
    // adapters intentionally project online until the archive write, so display liveness is not physical
    // evidence here. A target pane appearing after the stop proof is the remaining shared runtime witness.
    await assertTargetTmuxAbsent(id, 'before archive filing')
    writeRecord({ ...latest, stopped: true, coldProof: coldProofFor(latest), adapterRecovery: null })
  } catch (error) {
    if (coldCommitted) {
      const restored = await h.restoreRuntime?.(wt.rec, preflight?.ok ? preflight.receipt : undefined)
      if (restored && !restored.ok) {
        const current = readRecord(id)
        if (current) writeRecord({ ...current, archived: false, stopped: true, coldProof: null, adapterRecovery: `restore-runtime:${restored.reason}` })
        console.error(`spex: archive compensation for ${id} failed: ${restored.reason}`)
      }
    } else if (coldAttempted && error instanceof Error && /compensation failed|state is unknown|reconciliation failed/i.test(error.message)) {
      const current = readRecord(id)
      if (current) writeRecord({ ...current, archived: false, stopped: true, coldProof: coldProofFor(current), adapterRecovery: `restore-runtime:${error.message}` })
    }
    throw error
  }
  requestQueueDrain()
  return true
  } finally { archiving.delete(id) }
}

// A never-launched queue owns only prepared disk state. The transition/record locks around close serialize
// this check with startQueued: whichever wins decides whether the record is still a queue or has become live.
// No shared-runtime probe belongs here because a valid prepared row has no adapter thread to look up.
async function assertQueuedCloseSafe(id: string, rec: SessRec): Promise<void> {
  if (rec.status !== 'queued' || rec.harnessSessionId)
    throw new ResourceConflict(`refusing to close queued session ${id}: the record has a target thread or is no longer queued`)
  if (rec.adapterRecovery || launching.has(id))
    throw new ResourceConflict(`refusing to close queued session ${id}: target launch/recovery is already in progress`)

  const [snap, socket] = await Promise.all([liveSnapshot(id), rendezvousListening(id)])
  if (snap.probeFailed) throw new ResourceConflict(`refusing to close queued session ${id}: liveness probe failed; target runtime absence is unproven`)
  if (snap.windows.has(id)) throw new ResourceConflict(`refusing to close queued session ${id}: target tmux window already exists`)
  if (socket === 'live') throw new ResourceConflict(`refusing to close queued session ${id}: target rendezvous transport already exists`)
  if (socket === 'unproven') throw new ResourceConflict(`refusing to close queued session ${id}: target rendezvous state is ambiguous`)
  const pidPath = sessionArtifactPath(id, 'agent.pid')
  if (existsSync(pidPath)) {
    const pid = readAgentPid(pidPath)
    throw new ResourceConflict(`refusing to close queued session ${id}: target leaf PID artifact ${Number.isFinite(pid) && pid > 0 ? pid : 'is unreadable'}; never-launched ownership is ambiguous`)
  }
  // close preserves the prepared tree's dirty state in refs/spex-archive/<id>; cleanliness is not a
  // precondition for the soft terminal transition.
}

// A launch may leave its row active before Codex publishes the native thread binding. This close path owns
// only the record's dead local launch residue; an unbound app-server peer stays unowned and untouched.
async function assertUnboundCloseSafe(id: string, rec: SessRec): Promise<void> {
  if (harnessById(rec.harness || defaultHarness.id).exactNativeTargetId(rec) || rec.status === 'queued' || rec.archived)
    throw new ResourceConflict(`refusing to close unbound session ${id}: it is not an unbound live-record residue`)
  const failureStamped = /^queued launch readiness failed:/.test(rec.note || '') || rec.status === 'error' || rec.stopped
  const readinessStartedAt = rec.launchReadinessStartedAt ?? rec.launchReadinessPending?.startedAt ?? null
  const readinessInProgress = !failureStamped && (readinessStartedAt != null
    ? Date.now() - readinessStartedAt < SOCKET_READY_TIMEOUT_MS
    : launching.has(id))
  if (rec.adapterRecovery || readinessInProgress)
    throw new ResourceConflict(`refusing to close unbound session ${id}: launch or recovery is still in progress`)

  const [snap, socket] = await Promise.all([liveSnapshot(id), rendezvousListening(id)])
  if (snap.probeFailed) throw new ResourceConflict(`refusing to close unbound session ${id}: liveness probe failed; local worker absence is unproven`)
  const harness = harnessById(rec.harness || defaultHarness.id)
  if (harness.liveness(rec, snap.windows.has(id), runtimeRoot(), snap.windows.get(id), snap.sockets.has(id)) === 'online')
    throw new ResourceConflict(`refusing to close unbound session ${id}: its adapter still reports a live worker`)
  if (socket === 'live') throw new ResourceConflict(`refusing to close unbound session ${id}: target rendezvous transport already exists`)
  if (socket === 'unproven') throw new ResourceConflict(`refusing to close unbound session ${id}: target rendezvous state is ambiguous`)
  const leaf = await inspectSessionLeafIdentity(id, rec)
  if (leaf.state !== 'missing' && leaf.state !== 'dead')
    throw new ResourceConflict(`refusing to close unbound session ${id}: ${leaf.state === 'unknown' ? leaf.reason : 'target leaf identity is live or ambiguous'}`)
}

// Close has already completed its destructive boundary here. The sweep is advisory evidence only: detached
// descendants can outlive the exact leaf teardown, so surface them without inventing a second cleanup authority.
async function reportCloseResidue(id: string, worktreePath: string): Promise<void> {
  try {
    const report = await collectResourceReport({ persist: false })
    const owners = report.owners.filter((owner) => owner.processes.length > 0
      && ((owner.kind === 'session' || owner.kind === 'orphan') && owner.id === id))
    if (!owners.length) return
    console.warn(`spex: close ${id} completed, but detached process residue remains:`)
    for (const owner of owners) for (const process of owner.processes) {
      console.warn(`  pid=${process.pid} start=${process.startToken} command=${process.command || 'unknown'} worktree=${worktreePath}`)
    }
    console.warn('  inspect these PIDs and handle them through their owning harness/runtime; close does not kill detached descendants.')
  } catch (error) {
    console.warn(`spex: close ${id} completed, but the residual-process sweep failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function closeOwnedSessionUnlocked(id: string, wt: { path: string; branch: string | null; rec: SessRec }, _source: CloseSource, unboundStopped = false): Promise<boolean> {
  const root = mainRoot()
  const receiptFailure = publishedSessionCandidateReceiptRetirementFailure(wt.rec, root)
  if (receiptFailure) throw new ResourceConflict(`refusing close for ${id}: ${receiptFailure}; public record and resources remain the authority fence`)
  const retired = !!retirementReason(wt.rec)
  if (!retired && wt.rec.status === 'queued') await assertQueuedCloseSafe(id, wt.rec)
  if (!retired && !unboundStopped && wt.rec.status !== 'queued') {
    await coldStopSessionUnlocked(id)
    wt = (await findWorktree(id)) || wt
  }
  // The archive ref is published before any worktree removal. A failed ref write leaves the complete
  // worktree and record in place for retry.
  if (!retired && existsSync(wt.path)) archiveWorktreeState(id, wt.path)
  const latest = readRecord(id)
  if (!latest) throw new ResourceConflict(`refusing to finish close for ${id}: session record disappeared before publication`)
  writeRecord({
    ...latest,
    proposal: null,
    archived: true,
    closedAt: latest.closedAt || new Date().toISOString(),
    stopped: true,
    coldProof: latest.coldProof || coldProofFor(latest),
    adapterRecovery: null,
  })
  // The canonical lifecycle must settle at the same terminal boundary as the durable close fact. `archived`
  // is an internal terminal marker; public projections render its closed record as `retired`.
  const application = configuredSessionApplicationIfCutover()
  if (application?.readState(id)) {
    application.transitionSession(id, {
      status: 'archived',
      proposal: null,
      note: latest.note,
      parentSessionId: latest.parent,
      recipientSessionIds: canonicalWatchRecipients(application, id, 'archived'),
    })
  }
  let slot: string | null = null
  try { slot = existsSync(wt.path) ? treeSlotDir(wt.path) : null } catch { /* tree already unresolvable — nothing to key the slot by */ }
  if (existsSync(wt.path)) {
    const trashed = moveWorktreeToTrash(root, wt.path)
    const pruned = await gitTry(['-C', root, 'worktree', 'prune'])
    if (!pruned.ok) console.error(`spex: deferred worktree ${id} was renamed to ${trashed}, but git worktree prune failed: ${pruned.stderr.trim() || pruned.failure}`)
    queueWorktreeTrash(trashed)
  }
  if (slot) { try { rmSync(slot, { recursive: true, force: true }) } catch { /* best-effort GC */ } }
  requestQueueDrain()   // a close frees a slot — start the next queued session if any
  await reportCloseResidue(id, wt.rec.worktreePath)
  return true
}
async function closeSessionUnlocked(id: string, source: CloseSource): Promise<boolean> {
  let wt: { path: string; branch: string | null; rec: SessRec } | null = null
  try { wt = await findWorktree(id) }
  catch (e) {
    if (!(e instanceof SessionRecordUnusable) || e.code !== 'corrupt') throw e
    const quarantined = quarantineRecord(id)
    const runtime = sessionStoreDir(id)
    const evidence = quarantined
      ? `Original bytes were copied to ${quarantined}`
      : `Original bytes remain at ${join(runtime, 'runtime.json')}; no quarantine copy could be made`
    let guard = 'no readable session record proves the adapter or leaf owner'
    try { await stopAgentProcess(id, null) }
    catch (error) { guard = error instanceof Error ? error.message : String(error) }
    throw new SessionRecordUnusable('corrupt', id,
      `refusing close for ${id}: the unreadable record proves no adapter, leaf, worktree, or branch owner (${guard}). ${evidence}. Runtime remains at ${runtime}; worktree and branch ownership is unknown and was not touched; no process signal or deletion was attempted.`)
  }
  if (!wt) return false
  let unboundStopped = false
  if (!retirementReason(wt.rec) && !wt.rec.archived && wt.rec.status !== 'queued') {
    const harness = harnessById(wt.rec.harness || defaultHarness.id)
    if (!harness.exactNativeTargetId(wt.rec)) {
      await assertUnboundCloseSafe(id, wt.rec)
      await sessionHost().stop(id)
      await assertTargetTmuxAbsent(id, 'after unbound residue close')
      await harness.cleanupRuntime(wt.rec)
      unboundStopped = true
    } else {
      // closeOwnedSessionUnlocked performs the one exact cold-stop proof immediately before archive-ref
      // publication. Keeping that seam in one place prevents a second adapter mutation on retry.
    }
  }
  const target = wt
  return target.branch
    ? withRecordLock(sessionCandidateLockId(target.path, target.branch), () => closeOwnedSessionUnlocked(id, target, source, unboundStopped))
    : closeOwnedSessionUnlocked(id, target, source, unboundStopped)
}
export const closeSession = (id: string, rawSource?: unknown): Promise<boolean> => {
  const source = normalizeCloseSource(rawSource)
  return withSessionTransition(id, () => withRecordLock(id, () => closeSessionUnlocked(id, source)))
}

function quarantineRecord(id: string): string | null {
  let entry
  try { entry = readRecordEntry(id) } catch { return null }   // unreadable for another reason (permissions) — leave it
  if (entry.kind !== 'corrupt') return null
  try {
    const shelf = join(runtimeRoot(), 'corrupt')
    mkdirSync(shelf, { recursive: true })
    const dest = join(shelf, `${id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
    writeFileSync(dest, readFileSync(entry.path))
    console.error(`spex: session ${id.slice(0, 8)} had an unreadable record; its original bytes are preserved at ${dest}`)
    return dest
  } catch (e) {
    console.error(`spex: could not quarantine the unreadable record for ${id}: ${e instanceof Error ? e.message : e}`)
    return null
  }
}

// @@@ captureSessionResult - the session's live pane as a one-shot snapshot (output), the server side of
// `GET /api/sessions/:id/capture` that `spex session show --capture` (a backend client) reads. A monitoring read MUST
// distinguish "I failed to read" from "the pane is genuinely empty" — the old captureSession collapsed
// unknown-id, offline, and capture-error all to `''`, indistinguishable from an empty pane (a blank screen
// that exits 0 is worse than useless to a manager). So the result is DISCRIMINATED: an empty pane is a
// legitimate `{ok:true, pane:''}`; the three failure modes carry distinct reasons the route maps to distinct
// HTTP codes (unknown→404, offline→409, capture-failed→502). The known-vs-offline check only runs on the
// cold/not-alive branch, so a live capture (the polled hot path) costs just the one capture-pane.
export type CaptureResult = { ok: true; pane: string } | { ok: false; reason: 'unknown' | 'offline' | 'capture-failed' }
export async function captureSessionResult(id: string): Promise<CaptureResult> {
  if (!(await alive(id))) {
    const known = (await listSessions(true)).some((s) => s.id === id)
    return { ok: false, reason: known ? 'offline' : 'unknown' }
  }
  try { return { ok: true, pane: await sessionHost().command(['capture-pane', '-e', '-p', '-t', id]) } }
  catch { return { ok: false, reason: 'capture-failed' } }
}

// @@@ watch - the event source for Claude Code's Monitor tool (first-class managing-agent support).
// Polls the session list and emits the COMPLETE session lifecycle so it's a true "subscribe to all
// session changes" feed: a LAUNCH (first sighting of an id, even though it enters at 'working', which is
// not actionable — emitted ONCE per id so a manager learns a new session started), each ACTIONABLE state
// transition — review / done / close-pending (agent proposals), offline (process died), error — and the
// removal. Per Monitor's "silence is not success" rule a vanished session pings too. Net feed:
// launched → [actionable transitions] → closed. Each line names the suggested next action(s). Drop into Monitor:
//   Monitor({ command: 'spex session watch', persistent: true, description: 'session state changes' })
// @@@ presentation + selection - shared by `spex session ls` (pretty), `spex session watch` (events) and the API.
export const STATUS_GLYPH: Record<DisplayStatus, string> = {
  working: '\u25cf', idle: '\u25cb', offline: '\u23fb', starting: '\u25d4', review: '\u25c6', done: '\u2713',
  'close-pending': '\u2715', parked: '\u29d6', error: '\u2717', asking: '\u2370', queued: '\u25cc', unknown: '\u2047',
  corrupt: '\u26a0', retired: '\u2691',
}
const ANSI: Record<DisplayStatus, string> = {
  working: '33', idle: '90', offline: '90', starting: '36', review: '35', done: '34', 'close-pending': '31', parked: '36', error: '31', asking: '93', queued: '90', unknown: '93',
  corrupt: '31', retired: '90',
}

// @@@ session selectors - the ONE matcher every session command shares (see [[session-selectors]]). A
// selector matches a session iff it is the session's full id, an id-PREFIX, its branch, or `.` for
// the caller's own launched session. This is
// the single predicate; selectSessions (MANY) and resolveSession (ONE) both call it, so id-prefix/branch
// resolution can never drift between "which sessions ls/watch/wait/graph show" and "which session
// review/merge/send/close act on".
export function matchesSelector(s: Session, q: string, own = ownSessionId(), cwd = process.cwd()): boolean {
  // a selector may be a comma-separated list (the same convention as `--status a,b`): it matches iff ANY part
  // names the session, so `watch a,b` and `watch a b` are equivalent. A single name is the one-part case. This
  // is what stops a comma-joined selector from silently matching nothing — an id/branch never holds a
  // comma, so without the split `a,b` would be one literal selector that matches no session and streams in
  // silence forever. Each part sheds an optional reference sigil (stripRefSigil): `@<sel>` / `[[<sel>]]` name
  // the same session as the bare token, so the dashboard's mention grammar is tolerated in every CLI selector.
  const sessionPath = s.path ? resolve(s.path) : null
  const callerPath = resolve(cwd)
  const self = Boolean(own) && s.id === own
    || Boolean(sessionPath) && (callerPath === sessionPath || callerPath.startsWith(`${sessionPath}${sep}`))
  return q.split(',').map((p) => stripRefSigil(p.trim())).filter(Boolean)
    .some((p) => p === '.' ? self : s.id === p || s.id.startsWith(p) || s.branch === p)
}

// no selectors (or '@all') = everything. Optional status filter on top. This IS the ls/watch subscription.
export function selectSessions(all: Session[], selectors: string[], statuses?: string[], own = ownSessionId(), cwd = process.cwd()): Session[] {
  let out = all
  const sel = selectors.filter((x) => x && x !== '@all')
  if (sel.length) out = out.filter((s) => sel.some((q) => matchesSelector(s, q, own, cwd)))
  if (statuses && statuses.length) out = out.filter((s) => statuses.includes(s.status))
  return out
}

// Parentage is a durable direct pointer, even when that parent was terminally closed and no longer has a row.
// The CLI's child scope must keep that fact visible rather than requiring callers to reverse-engineer prompts.
export function selectChildren(all: Session[], parent: string): Session[] {
  return all.filter((session) => session.parent === parent)
}

// @@@ resolveSession - resolve ONE selector to ONE session against a board: the single-target counterpart of
// selectSessions, for the control verbs (review/send/merge/close/resume/show). The backend matches
// ids EXACTLY, so a verb resolves the selector here first and then calls with the FULL id — a branch/
// prefix selector drives a verb just as it filters `ls`. The result is DISCRIMINATED so a caller can fail
// precisely: an exact full-id hit wins outright (never reported ambiguous just for prefixing a longer id);
// otherwise a lone match is `ok`, several is `ambiguous` (a prefix hitting many), none is `none`.
export type Resolved = { ok: Session } | { ambiguous: Session[] } | { none: true }
export function resolveSession(selector: string, sessions: Session[], own = ownSessionId(), cwd = process.cwd()): Resolved {
  // the exact-id check sheds the optional sigil too, so `@<full-id>` keeps the exact-wins-over-prefix rule
  const exact = sessions.find((s) => s.id === stripRefSigil(selector))
  if (exact) return { ok: exact }
  const hits = sessions.filter((s) => matchesSelector(s, selector, own, cwd))
  if (hits.length === 1) return { ok: hits[0] }
  return hits.length ? { ambiguous: hits } : { none: true }
}

// @@@ display width - the table aligns by TERMINAL CELLS, not code units. CJK/fullwidth glyphs render
// two cells wide, so `slice`/`padEnd` (which count code units) shear a wide glyph mid-cut and under-pad
// the column, misaligning everything after it. A small wcwidth-style range check covers the wide blocks
// that actually reach session labels/prompts \u2014 no dependency needed.
const isWideCp = (cp: number): boolean =>
  (cp >= 0x1100 && cp <= 0x115f) ||                   // Hangul Jamo
  (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||  // CJK radicals \u2026 kana \u2026 CJK ideographs \u2026 Yi
  (cp >= 0xac00 && cp <= 0xd7a3) ||                   // Hangul syllables
  (cp >= 0xf900 && cp <= 0xfaff) ||                   // CJK compatibility ideographs
  (cp >= 0xfe30 && cp <= 0xfe4f) ||                   // CJK compatibility forms
  (cp >= 0xff00 && cp <= 0xff60) ||                   // fullwidth forms
  (cp >= 0xffe0 && cp <= 0xffe6) ||                   // fullwidth signs
  (cp >= 0x1f300 && cp <= 0x1faff) ||                 // emoji
  (cp >= 0x20000 && cp <= 0x3fffd)                    // CJK extensions B+
export function displayWidth(s: string): number {
  let w = 0
  for (const ch of s) w += isWideCp(ch.codePointAt(0)!) ? 2 : 1
  return w
}
// truncate to a display width (the ellipsis occupies its own cell); never cuts a wide glyph in half.
export function truncWidth(s: string, max: number): string {
  if (displayWidth(s) <= max) return s
  let w = 0
  let out = ''
  for (const ch of s) {
    const cw = isWideCp(ch.codePointAt(0)!) ? 2 : 1
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return out + '\u2026'
}
// pad to a display width \u2014 `padEnd` would count a double-cell glyph as one and under-pad the column.
export const padWidth = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - displayWidth(s)))
const trunc = truncWidth
// the board table's NOTE display cap \u2014 exported so the declaration echo (cli.ts) can tell an author
// exactly where their note gets cut, instead of the cap living as an anonymous magic number here.
export const NOTE_BOARD_LIMIT = 50
// short display label per status (only close-pending differs from the status name) \u2014 used by the legend.
const SHORT: Partial<Record<DisplayStatus, string>> = { 'close-pending': 'close' }

// @@@ statusLegend - one-line glyph\u2192meaning key, BUILT from STATUS_GLYPH so it can never drift from
// the glyphs the table actually prints. Shown under `spex session ls` so the symbols are self-explanatory.
export function statusLegend(color = true): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const parts = (Object.keys(STATUS_GLYPH) as DisplayStatus[]).map(
    (k) => `${c(ANSI[k], STATUS_GLYPH[k])} ${SHORT[k] || k}`,
  )
  return c('90', '  key: ') + parts.join('  ')
}

// human-friendly aligned table: header + (glyph + colour + status + title + id + parent + merges + note) rows +
// a status legend, so the table tells the whole story (incl. each agent's note) at a glance.
export type SessionTableScope = { kind: 'sessions' } | { kind: 'children'; parent: string }
function statusSummary(sessions: Session[]): string {
  const counts = new Map<DisplayStatus, number>()
  for (const session of sessions) counts.set(session.status, (counts.get(session.status) || 0) + 1)
  return (Object.keys(STATUS_GLYPH) as DisplayStatus[])
    .flatMap((status) => {
      const count = counts.get(status)
      return count ? [`${count} ${SHORT[status] || status}`] : []
    })
    .join(' · ')
}

export function formatTable(sessions: Session[], color = true, scope: SessionTableScope = { kind: 'sessions' }): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const label = scope.kind === 'children' ? `children of ${scope.parent.slice(0, 8)}` : 'sessions'
  const heading = c('1', `SpexCode ${label} (${sessions.length}${sessions.length ? `; ${statusSummary(sessions)}` : ''})`)
  if (!sessions.length) return [heading, c('90', `  no ${scope.kind === 'children' ? 'children' : 'living sessions'}`)].join('\n')
  const header = c('90', `    ${'STATUS'.padEnd(13)} ${'TITLE'.padEnd(22)} ${'ID'.padEnd(8)} ${'PARENT'.padEnd(8)} ${'\u00d7'.padEnd(4)}${'PROMPT'.padEnd(42)}NOTE`)
  const rows = sessions.map((s) => {
    const g = STATUS_GLYPH[s.status] ?? '\u00b7'
    const code = ANSI[s.status] ?? '0'
    const title = padWidth(truncWidth(sessionTitle(s), 22), 22)
    const st = s.status.padEnd(13)
    const parent = c('90', (s.parent || '-').slice(0, 8).padEnd(8))
    const merges = (s.merges ? `\u00d7${s.merges}` : '').padEnd(4)
    const prompt = c('90', padWidth(s.promptPreview ? trunc(s.promptPreview, 40) : '', 42))   // what it was asked to do
    const note = s.note ? c('90', trunc(s.note, NOTE_BOARD_LIMIT)) : ''
    return `  ${c(code, g)} ${c(code, st)} ${title} ${c('90', s.id.slice(0, 8))} ${parent} ${merges}${prompt}${note}`
  })
  return [heading, header, ...rows, statusLegend(color)].join('\n')
}

// @@@ sendText - THE APPEND ACCEPTS, THE QUEUE OWES ([[dispatch]]), except a live agent whose native transport
// is PROVEN unreachable. That stranded combination cannot ever drain, so it refuses before creating new debt.
// A merely unproven transport retains the ordinary append-and-retry behavior; liveness remains independently
// unknown so no user is invited to kill a live worker.
// A RETIRED session (worktree gone) still receives: the record gate governs the lifecycle axis, and a message
// that cannot reach an agent must at least leave a trace ([[session-timeline]]).
// (The separate RAW nav-key channel keeps its own `tmux send-keys` path — see rawKey.)
type MessageIdempotency = { operation: string; requestDigest: string; payloadHash: string }
type DispatchIdempotency = MessageIdempotency
type DispatchAcceptCode = 'dispatch_key_reused'
export const EMPTY_PROMPT_ERROR = 'empty prompt — nothing to dispatch'
type AcceptedDispatch = DispatchResult & {
  replayed?: boolean
  code?: DispatchAcceptCode
  // What this call MEASURED about the handover, never what it assumes. `accepted` = the adapter took the
  // message. `queued` = the adapter was asked and still owes it. `deferred` = the caller asked for the
  // handover to happen after the response, so NOTHING was measured and no transport claim may be made.
  delivery?: 'accepted' | 'queued' | 'deferred'
}
type SendTextOptions = {
  replyVia?: 'note'
  idempotency?: DispatchIdempotency
  // Dashboard callers keep this opaque key while a transport retry is pending. Canonical protocol
  // idempotency makes the retry address the existing queue row instead of appending a duplicate prompt.
  deliveryKey?: string
  acceptGuard?: (record: SessRec) => Promise<void>
  deferDrain?: boolean
  // Managed watch notifications are durable supervision events. Even when a live parent's native transport is
  // temporarily absent, the normal queue must retain the event so the parent's next runtime can wake and drain it.
  allowStranded?: boolean
}
export async function sendText(id: string, text: string, from?: string, opts: SendTextOptions = {}): Promise<AcceptedDispatch> {
  if (!text.trim()) return { ok: false, error: EMPTY_PROMPT_ERROR }
  const application = configuredSessionApplicationIfCutover()
  if (application) {
    let message: ReturnType<ProductionSessionApplication['protocol']['enqueue']>
    let replayed = false
    try {
      const rec = readRecord(id)
      if (!rec) throw new ResourceConflict(`no session record for ${id} — prompt NOT delivered`)
      await opts.acceptGuard?.(rec)
      const prompt = await composeSessionPrompt(text, rec, { from, replyVia: opts.replyVia })
      const idempotencyKey = opts.idempotency?.requestDigest ?? (opts.deliveryKey?.trim() || null)
      const existing = idempotencyKey
        ? application.readMessageHistory(id).find(message => message.idempotencyKey === idempotencyKey)
        : undefined
      message = existing ?? application.enqueueConversationMessage(id, {
          kind: 'session.prompt.v1',
          body: Buffer.from(prompt.text, 'utf8'),
          senderSessionId: from ?? null,
          idempotencyKey,
        }, { text, from: from ?? null, ...(prompt.replyVia ? { replyVia: prompt.replyVia } : {}) })
      replayed = !!existing
    } catch (error) {
      return { ok: false, error: `could not append the message to session ${id}'s application queue: ${error instanceof Error ? error.message : String(error)}` }
    }
    // Acceptance and handover are separate boundaries. A committed SQLite message remains a successful
    // command even when the runtime is currently unbound; binding/resume is the explicit event that makes
    // the durable debt drainable. Reporting the post-commit refusal as an append failure made command-box
    // callers show a false error despite the prompt already being safely queued.
    if (!opts.deferDrain) {
      try { await drainSession(id) } catch (error) {
        if (!(error instanceof ResourceConflict) || !/no bound spex-governed runtime/u.test(error.message)) throw error
      }
    }
    const pending = application.readPendingMessages(id).some(candidate => candidate.messageId === message.messageId)
    // Queue acceptance is not runtime activity. A prompt remains owed while the adapter is unbound,
    // restarting, or refusing the insert; only the handoff that removes this exact message may re-enter
    // a waiting session as active. This keeps a queued command from painting a dead pane as working.
    if (!from && !pending) markHumanPromptActive(id)
    // @@@ a deferred drain measured NOTHING, and must not be reported as a refusal.
    // `pending` is read microseconds after the enqueue with no await in between, so when the drain was
    // deferred it is answering "did I skip the handover" — always yes — rather than "did the adapter refuse".
    // Reporting that as `queued` made every first Command Box send claim the transport was still owed while
    // the prompt was in fact in the agent's pane milliseconds later, and the claim was UNCONDITIONAL: no
    // transport state, harness, or runtime binding could change it. Name the deferral instead, so the one
    // caller that defers can say "accepted, handover in flight" and the callers that DO drain keep a
    // `queued` that still means what it says.
    return {
      ok: true,
      delivery: opts.deferDrain ? 'deferred' : pending ? 'queued' : 'accepted',
      ...(opts.idempotency || opts.deliveryKey ? { replayed } : {}),
    }
  }
  throw new ResourceConflict('session application is unavailable; refusing the legacy delivery path')
}

// @@@ drainSession - hand over what this session is owed, as ordinary prompts. Safe to call from anywhere and
// at any time: the queue's own lock serializes concurrent passes, and an empty queue costs one existsSync.
// The retry sweep in `serve` calls this for the sessions whose queues an earlier pass could not empty.
export async function drainSession(id: string): Promise<void> {
  const application = configuredSessionApplicationIfCutover()
  if (application) {
    const rec = readRecord(id)
    if (!rec) return
    // An empty canonical queue is a successful no-op. Do not turn a resume with no owed prompt into a
    // runtime-binding error; require a bound adapter only when there is a message that must be handed over.
    if (application.readPendingMessages(id).length === 0) return
    const h = harnessById(rec.harness || defaultHarness.id)
    const binding = application.resolveRuntime(id, 'spex-governed')
    if (!binding || binding.status !== 'bound') {
      // Leaf adapters own their per-session controller and can deliver without a shared native identity.
      // Preserve the governed transport while that identity is absent, then acknowledge the same canonical
      // queue directly. Shared adapter runtimes (Codex) remain fail-closed until their exact binding exists.
      const leafWithoutNativeIdentity = !rec.harnessSessionId && (
        rec.harness === 'claude' || h.runtimeOwnership === 'leaf'
      )
      if (leafWithoutNativeIdentity) {
        await withDeliveryLocks([id], async () => {
          for (;;) {
            const pending = application.readPendingMessages(id)
            const msg = pending[0]
            if (!msg) return
            const text = canonicalMessageText(msg, rec)
            if (h.deliveryBlockedBy) {
              try {
            if (h.deliveryBlockedBy(await sessionHost().command(['capture-pane', '-p', '-t', rec.session], TMUX_PROBE_TIMEOUT_MS))) return
              } catch { /* no pane to consult — let the adapter decide */ }
            }
            const delivered = await h.deliver({ ...rec, runtimeDir: runtimeRoot(), mid: msg.messageId }, text)
            if (!delivered.ok) return
            const removed = application.dequeuePendingMessage(id, msg.messageId)
            if (!removed || removed.messageId !== msg.messageId) throw new ResourceConflict(`canonical queue head changed while delivering ${id}`)
            if (!msg.senderSessionId) markHumanPromptActive(id)
          }
        })
        return
      }
      throw new ResourceConflict(`canonical delivery for ${id} remains pending: no bound spex-governed runtime`)
    }
    await withDeliveryLocks([id], async () => {
      for (;;) {
        const pending = application.readPendingMessages(id)
        const msg = pending[0]
        if (!msg) return
        const text = canonicalMessageText(msg, rec)
        if (h.deliveryBlockedBy) {
          try {
                if (h.deliveryBlockedBy(await sessionHost().command(['capture-pane', '-p', '-t', rec.session], TMUX_PROBE_TIMEOUT_MS))) return
          } catch { /* no pane to consult — let the adapter decide */ }
        }
        const delivered = await h.deliver({ ...rec, runtimeDir: runtimeRoot(), mid: msg.messageId }, text)
        if (!delivered.ok) return
        const removed = application.dequeueForRuntime(id, 'spex-governed', binding.bindingGeneration, msg.messageId)
        if (!removed || removed.messageId !== msg.messageId) throw new ResourceConflict(`canonical queue head changed while delivering ${id}`)
        if (!msg.senderSessionId) markHumanPromptActive(id)
      }
    })
    return
  }
  throw new ResourceConflict('session application is unavailable; refusing the legacy delivery path')
}

// `recipient` is the session this text is delivered TO; a state message speaks about its `sessionId`, the
// watched subject, and the notice must name that subject — never the reader of the notice.
export function canonicalMessageText(message: { kind: string; body: Uint8Array }, recipient: SessRec): string {
  if (message.kind === 'session.prompt.v1') return Buffer.from(message.body).toString('utf8')
  if (message.kind === 'session.state.changed.v1') {
    try {
      const change = JSON.parse(Buffer.from(message.body).toString('utf8')) as { sessionId?: string; status?: string; proposal?: Proposal | null; note?: string | null; parentSessionId?: string | null }
      if (typeof change.sessionId !== 'string' || !change.sessionId) throw new ResourceConflict(`canonical state message delivered to ${recipient.session} names no subject session`)
      return watchMessage({ ...recipient, session: change.sessionId, status: (change.status ?? recipient.status) as Lifecycle, proposal: change.proposal ?? null, note: change.note ?? null, parent: change.parentSessionId ?? null })
    } catch (error) {
      if (error instanceof ResourceConflict) throw error
      throw new ResourceConflict(`canonical state message for ${recipient.session} is not valid JSON`)
    }
  }
  throw new ResourceConflict(`canonical message kind ${message.kind} cannot be delivered as session text`)
}

// Hard interrupt is adapter-native control, distinct from stop's process teardown. A harness with a native
// primitive uses it. Without one the transport decides: a HEADLESS adapter has no keyboard, so it refuses
// loudly rather than emulating an interrupt with a signal that could hit the wrong process; a PANE-BACKED
// TUI has an operator's keyboard by definition, so its interrupt is the key that operator would press —
// C-c into its own pane, through the raw-key channel below — and only while its lifecycle is actually
// active, because the same key on an idle TUI is a second Ctrl-C away from quitting it.
export async function interruptSession(id: string): Promise<DispatchResult> {
  // The lifecycle read and the key send share ONE record lock: a declaration that lands between them would
  // otherwise turn "interrupt the working turn" into "Ctrl-C an idle TUI", so there is no window.
  return withRecordLock(id, async () => {
    const rec = readRecord(id)
    if (!rec) return { ok: false, error: `no session record for ${id} - nothing to interrupt` }
    const h = harnessById(rec.harness || defaultHarness.id)
    if (h.interrupt) {
      // stamped BEFORE the abort: the adapter's exit report can race the confirmation, and either order must
      // read "interrupted" (see the interrupt projection); a refused interrupt leaves no trace behind.
      stampInterrupt(id)
      const result = await h.interrupt({ ...rec, runtimeDir: runtimeRoot() })
      if (!result.ok) { clearInterruptMarker(id); return result }
      projectInterruptedUnlocked(id)
      return result
    }
    if (h.headless) return { ok: false, error: `harness ${h.id} has no native hard-interrupt control` }
    if (rec.status !== 'active') return { ok: false, error: `session ${id} is not working (lifecycle ${rec.status}) - nothing to interrupt` }
    const sent = await sendRawKeysLocked(id, ['C-c'])
    return sent ? { ok: true } : { ok: false, error: `session ${id} has no live pane to interrupt` }
  })
}

// @@@ rawKey - the RAW-KEYSTROKE nav path, kept DELIBERATELY on `tmux send-keys` and NEVER the rendezvous
// socket. Two channels, two jobs: the socket INJECTS a whole prompt (text + submit), which can drive the
// agent's normal prompt but CANNOT navigate an interactive TUI select menu (e.g. `/model`'s list — ↑/↓ to
// move, ←/→ to adjust, Enter to set, `s` for this-session, Esc to cancel). When the agent is in that
// keystroke-navigation state its input box is replaced by the menu, so the CLI raw-key fallback forwards
// each key here in real time. send-keys is exactly right for single raw keys: named keys map to tmux's own
// key names; a single printable char is sent literally (`-l`) so tmux doesn't reinterpret it. The dashboard
// also drives the agent with MODIFIER COMBOS — a terminal's three modifiers carried as a `C-`/`M-`/`S-`
// prefix on the token (e.g. `C-r`, `M-b`, `S-Tab`, `C-M-x`); those are passed to tmux UNescaped so it parses
// the combo. One key per call, no socket and no Enter-synthesis — this IS the send-keys channel. False if
// the tmux session is gone, or if the token isn't a known base after its prefixes (defends the send-keys arg).
const TMUX_KEY: Record<string, string> = {
  Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
  Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Space: 'Space', Backspace: 'BSpace',
  Home: 'Home', End: 'End', Delete: 'DC',
}
// tmux honours an `S-` (shift) modifier ONLY on these named keys; on Enter/Space/BSpace it would send the
// literal text "S-Enter" etc. (and shift is a no-op there anyway), so a stray S- is dropped. Shift+Tab is
// the named exception: tmux spells it `BTab` (back-tab → ESC[Z, what Claude Code's mode-cycle reads).
const SHIFTABLE = new Set(['Up', 'Down', 'Left', 'Right', 'Home', 'End', 'DC'])
// resolve ONE frontend token to the `tmux send-keys` args for it, or null if it isn't a known base after its
// prefixes (defends the send-keys arg). Pure — the batch loop below sequences the actual sends.
function rawKeyArgs(id: string, key: string): string[] | null {
  // peel the optional C-/M-/S- modifier prefixes (each at most once, in any order) off the front; the
  // remainder is the BASE key. The frontend only ever sends {C-,M-,S-} prefixes + a named key or one char.
  let rest = key, prefix = ''
  const seen = new Set<string>()
  while (rest.length >= 2 && (rest[0] === 'C' || rest[0] === 'M' || rest[0] === 'S') && rest[1] === '-' && !seen.has(rest[0])) {
    seen.add(rest[0]); prefix += rest.slice(0, 2); rest = rest.slice(2)
  }
  const named = TMUX_KEY[rest]
  if (named) {
    const noShift = prefix.replace('S-', '')   // C-/M- without the shift bit
    let token: string
    if (prefix.includes('S-') && named === 'Tab') token = noShift + 'BTab'              // Shift+Tab → back-tab
    else if (prefix.includes('S-') && !SHIFTABLE.has(named)) token = noShift + named     // tmux can't carry S- here
    else token = prefix + named
    return ['send-keys', '-t', id, token]
  }
  if ([...rest].length === 1) {
    // a single printable char: bare → literal (`-l`, so tmux never reinterprets it as a key name);
    // modified → hand tmux the `C-`/`M-`/`S-` combo to parse (e.g. `C-a`), which `-l` would defeat.
    if (prefix) return ['send-keys', '-t', id, prefix + rest]
    return ['send-keys', '-t', id, '-l', '--', rest]
  }
  return null
}
// One call carries a BATCH of tokens (or one) — the client coalesces fast typing into an ordered array. Order
// is the whole point ([[nav-mode-key-ordering]]): the keys are sent by ONE awaited `send-keys` each, IN ARRAY
// ORDER, so they reach the pane in exactly the order they were struck. Concurrent per-key POSTs used to race
// (browser + server + send-keys all parallel) and scramble the sequence; a single serialised batch cannot.
// An unknown token is skipped without dropping the rest; false only if the tmux session is gone or nothing sent.
// the send itself, for a caller that already holds the record lock (rawKey below; interruptSession above)
async function sendRawKeysLocked(id: string, keys: readonly string[]): Promise<boolean> {
  const list = keys.filter((k) => typeof k === 'string' && k.length > 0)
  if (list.length === 0 || !(await alive(id))) return false
  let sent = false
  for (const k of list) {
    const args = rawKeyArgs(id, k)
    if (!args) continue
    const sendKeys = sessionHost().sendKeys
    if (!sendKeys) continue
    await sendKeys(id, args.slice(3)); sent = true
  }
  return sent
}
export async function rawKey(id: string, key: string | string[]): Promise<boolean> {
  const sent = await withRecordLock(id, () => sendRawKeysLocked(id, Array.isArray(key) ? key : [key]))
  // Raw-key remote control is transport fallback, not a lifecycle event. Freshness belongs to the
  // harness turn hooks or a successfully handed-over durable prompt; navigation keys cannot forge working.
  return sent
}
