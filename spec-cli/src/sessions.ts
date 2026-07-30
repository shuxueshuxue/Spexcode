import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, appendFileSync, existsSync, renameSync, mkdirSync, rmSync, readdirSync, realpathSync, statSync, openSync, closeSync, unlinkSync, writeSync } from 'node:fs'
import { join, dirname, relative, isAbsolute, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { seedWorktreeHostState } from './worktree-sources.js'
import { git, gitA, gitTry, repoRoot, mergeBaseDiff, mergeConflicts, withGitAbortSignal, type ReviewDiffFile } from './git.js'
import { loadConfig, loadSpecs, loadSpecsLite, type ConfigPreset, type SpecLite } from './specs.js'
import { adapterLoadedReferenceState, defaultHarness, HARNESSES, sessionIdentityEnvVars, defaultLauncher, harnessById, procSnapshot, resolveLauncher, rendezvousListening, stampRvSock, type Harness, type HarnessLaunchReadinessFence, type TurnFailure, type FailureSubscription, type DispatchResult, type PaneProbe, type ProcTable } from './harness.js'
import { materialize } from './materialize.js'
import { mainBranch, gitCommonDir, readConfig, runtimeRoot, treeSlotDir, sessionStoreDir, sessionRecordPath, sessionArtifactPath, listSessionIds, rawLaunchReadinessOriginal, readAliasedRawRecord, readRecordEntry, readAliasedRecordEntry, readPublicRecordEntry, envSessionId, isSessionLifecycle, isSessionProposal, type PublicRecordEntry, type RawRecord, type SessionLifecycle, type SessionProposal } from './layout.js'
import { appendSent, recordStatus, lastHumanSendVia } from './session-timeline.js'
import { stripRefSigil } from './mentions.js'
import { shQuote } from './sh.js'
import { assertSessionStopSafe, ResourceConflict } from './host-resources.js'
import { processStartToken } from './process-identity.js'
import { bindCodexGeneration, codexGenerationBindingForSession, commitCodexGenerationRegistration, prepareCodexGenerationClose, prepareCodexGenerationRegistration, readCodexGenerationLedger } from './codex-runtime-generations.js'

const pexec = promisify(execFile)
export const TMUX_SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const HARNESS = defaultHarness
const COLS = 120, ROWS = 32
const DEFAULT_MAX_ACTIVE = 8
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
const rvEnv = (id: string, harness = HARNESS) => {
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
    ...harness.launchEnv(id), ...homeVars].join(' ')
}

// Re-exported for existing importers.
export type { DispatchResult }

export type Lifecycle = SessionLifecycle
export type Proposal = SessionProposal
export type DisplayStatus = 'working' | 'idle' | 'offline' | 'starting' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued' | 'unknown' | 'corrupt' | 'retired'
export type Liveness = 'online' | 'starting' | 'offline' | 'unknown'
const PROPOSAL_STATUS: Record<Proposal, DisplayStatus> = { merge: 'review', nothing: 'done', close: 'close-pending' }

export type Session = {
  id: string; node: string | null; branch: string | null; path: string
  label: string; headline: string   // the DERIVED display strings ([[session-label]]) — the only names surfaces read
  raw: { name: string | null; title: string | null }   // the bare parts, for explicit consumers only (rename prefill)
  parent: string | null   // the SPAWNING session's id ([[session-nesting]]) — set once at creation when `spex session new` ran inside another session, else null; the frontend folds a child under it at read time
  harness: string   // which harness (claude|codex) runs this session — carried so liveness/occupancy route through its adapter
  capabilities: { headless: boolean }   // stable adapter projection; console surfaces consume data, never harness ids
  launcher: string | null   // the launcher profile this session launched under ([[launcher-select]]); null only for old records predating launchers
  lifecycle: Lifecycle; proposal: Proposal | null; merges: number; status: DisplayStatus; liveness: Liveness; note: string | null
  archived: boolean   // cold storage ([[archive]]) — successful records are offline; default views exclude them
  archiveHazard?: string | null // explicit legacy/invariant violation; never hidden as a clean archive
  prompt: string | null; promptPreview: string | null; created: number; activity: string | null
  sortKey: number | null   // manual drag-reorder override ([[session-reorder]]); null = sort by `created`
}

function storeDir(id: string): string { const d = sessionStoreDir(id); mkdirSync(d, { recursive: true }); return d }

function writePromptFile(id: string, prompt: string): void {
  try { writeFileSync(join(storeDir(id), 'prompt'), prompt) } catch { /* best-effort; must never block the launch */ }
}
function readPromptFile(id: string): string | null {
  try {
    const p = sessionArtifactPath(id, 'prompt')
    if (!existsSync(p)) return null
    const s = readFileSync(p, 'utf8')
    return s.trim() ? s : null
  } catch { return null }
}
// Persist queued launch input across restarts; consume it once the launch begins.
function writeLaunchFile(id: string, prompt: string): void {
  try { writeFileSync(join(storeDir(id), 'launch'), prompt) } catch { /* best-effort; the drainer treats a missing file as nothing-to-launch */ }
}
function readLaunchFile(id: string): string | null {
  try { const p = sessionArtifactPath(id, 'launch'); return existsSync(p) ? readFileSync(p, 'utf8') : null } catch { return null }
}
function removeLaunchFile(id: string): void {
  try { rmSync(sessionArtifactPath(id, 'launch'), { force: true }) } catch { /* best-effort */ }
}

function promptPreview(prompt: string, n = 60): string {
  const first = prompt.split('\n').map((l) => l.trim()).find(Boolean) || ''
  return first.length > n ? first.slice(0, n - 1) + '…' : first
}

export const deriveLabel = (r: { name?: string | null; node?: string | null; title?: string | null; branch?: string | null; id: string }): string =>
  r.name || r.node || r.title || r.branch || r.id
export const deriveHeadline = (r: { name?: string | null; activity?: string | null; promptPreview?: string | null; node?: string | null; title?: string | null; branch?: string | null; id: string }): string =>
  r.name || r.activity || r.promptPreview || r.node || r.title || r.branch || r.id

export const sessionLabel = (s: Session): string => s.label
export const sessionHeadline = (s: Session): string => s.headline

// @@@ tmux probe timeout - under load (the incident: load ~30 + swap thrash) a bare `tmux list-sessions` can
// HANG, and with no bound the whole board assembly hung behind it — the dashboard froze / dropped rows, which
// the human read as "sessions disappeared". So the liveness/title probes pass a bounded timeout; on expiry
// execFile SIGKILLs the child and rejects with `killed:true`, which liveSnapshot tells apart from a clean
// "no server" exit (see probeTimedOut) so a timeout renders `unknown`, not a false `offline`.
const TMUX_PROBE_TIMEOUT_MS = 4000
async function tmux(args: string[], timeoutMs?: number): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', TMUX_SOCK, ...args], { encoding: 'utf8', ...(timeoutMs ? { timeout: timeoutMs, killSignal: 'SIGKILL' as const } : {}) })
  return stdout
}
// a rejected pexec whose child we KILLED (timeout) vs one that exited cleanly non-zero (e.g. tmux "no server
// running" when there are genuinely no sessions). Only the former is a PROBE FAILURE (→ unknown); a clean
// non-zero exit is authoritative (→ everything offline). node sets `killed`/`signal` when it SIGKILLs on timeout.
function probeTimedOut(e: unknown): boolean {
  const err = e as { killed?: boolean; signal?: string | null; code?: string }
  return err?.killed === true || err?.signal === 'SIGKILL' || err?.code === 'ETIMEDOUT'
}
async function tmuxOk(args: string[]): Promise<boolean> { try { await tmux(args); return true } catch { return false } }
export async function alive(id: string): Promise<boolean> { return tmuxOk(['has-session', '-t', id]) }

// worktrees + branches are created off MAIN even when the server runs inside a worktree.
function mainRoot(): string {
  try {
    const checkout = dirname(gitCommonDir())
    const configured = readConfig(checkout).main?.trim()
    return configured ? resolve(checkout, configured) : checkout
  }
  catch { return repoRoot() }
}

function pkgRoot(): string {
  return fileURLToPath(new URL('..', import.meta.url))
}

export type SessRec = {
  session: string; governed: boolean; worktreePath: string; branch: string | null
  node: string | null; title: string | null; name: string | null
  parent: string | null   // the spawning session's id ([[session-nesting]]); null for a top-level launch
  status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null
  sortKey: number | null; createdAt: number; harness: string; harnessSessionId: string | null
  stopped: boolean       // explicit human stop; liveness metadata, never an agent-authored lifecycle value
  archived: boolean      // shelved by the human ([[archive]]) — only clean after coldProof is written
  coldProof?: string | null // durable exact leaf + adapter unload proof; missing on legacy archives => visible hazard
  adapterRecovery?: string | null // explicit adapter recovery state after an uncertain partial cold mutation
  launcher: string | null   // the launcher profile this session launches under ([[launcher-select]]); null only for old records predating launchers
  launchCmd: string | null  // the RESOLVED base launcher command pinned at creation ([[launcher-select]] resume-launcher-pin); null → old record → fall back to the launcher name / ambient
  launchOwner: string | null // stable public-backend authority while queued; null for active/legacy records
  createRequestId?: string | null // digest of the public Idempotency-Key; binds retry without storing the bearer
  createPayloadHash?: string | null // exact normalized create payload bound to createRequestId
  launchReadinessPending?: LaunchReadinessPending | null // internal resume candidate; every public reader projects `original` until one final publish
}
type LaunchReadinessOriginal = Pick<SessRec, 'status' | 'proposal' | 'note' | 'stopped' | 'archived' | 'coldProof' | 'adapterRecovery'>
type LaunchReadinessPending = { version: 1; startedAt: number; original: LaunchReadinessOriginal }
export const OWNED_QUEUE_RAW_STATUS = 'launch-queued'

export function backendLaunchAuthority(env: { SPEXCODE_API_URL?: string; PORT?: string } = process.env): string {
  const raw = env.SPEXCODE_API_URL?.trim() || `http://127.0.0.1:${env.PORT?.trim() || '8787'}`
  const url = new URL(raw)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}

export function rawLifecycleStatus(rec: Pick<SessRec, 'status' | 'launchOwner'>): string {
  return rec.status === 'queued' && rec.launchOwner ? OWNED_QUEUE_RAW_STATUS : rec.status
}

export function canDrainQueued(rec: Pick<SessRec, 'status' | 'launchOwner'>, authority = backendLaunchAuthority()): boolean {
  return rec.status === 'queued' && (rec.launchOwner === null || rec.launchOwner === authority)
}

// typed read of a session's record from the global store (null if it has none — a self-launched session that
// only ever wrote spec-discipline sentinels has a store dir but no session.json). Goes through layout's
// readAliasedRawRecord (the seam that owns the path + the codex-thread-id alias), then validates the loose
// on-disk fields into the typed shape — so a codex hook resolving by its thread id reaches the real record.
function readRecord(id: string): SessRec | null {
  const entry = readAliasedRecordEntry(id)
  if (entry.kind === 'absent') return null
  if (entry.kind === 'corrupt') throw new SessionRecordUnusable('corrupt', id, corruptReason(entry))
  try { return fromRaw(entry.raw) }
  catch (error) {
    throw new SessionRecordUnusable('corrupt', id,
      `session record is unreadable: ${sessionRecordPath(id)} — ${error instanceof Error ? error.message : String(error)}. The file is kept as-is; nothing will rewrite it.`)
  }
}
export class SessionRecordUnusable extends Error {
  constructor(readonly code: 'corrupt' | 'retired', readonly session: string, message: string) {
    super(message)
    this.name = 'SessionRecordUnusable'
  }
}
const corruptReason = (e: { path: string; error: string }): string =>
  `session record is unreadable: ${e.path} — ${e.error}. The file is kept as-is; nothing will rewrite it. A close attempt quarantines the bytes and reports the preserved runtime/worktree/branch residue, but cannot signal or delete without an exact owner.`
function retirementReason(rec: SessRec): string | null {
  if (!rec.worktreePath || existsSync(rec.worktreePath)) return null
  return `session ${rec.session.slice(0, 8)} is retired: its worktree ${rec.worktreePath} no longer exists, so it cannot work, be marked active/idle, or be relaunched. Close it (\`spex session close <id>\`) to drop the record.`
}
function readLiveRecord(id: string): SessRec | null {
  const rec = readRecord(id)
  if (!rec) return null
  const retired = retirementReason(rec)
  if (retired) throw new SessionRecordUnusable('retired', rec.session, retired)
  return rec
}

// Cross-process lifecycle serialization. Hooks and operator commands are separate CLI processes, so the
// in-memory transition tail is only an optimization. This lock covers each read/modify/write or destructive
// transition across archive/resume/stop/close and hook writers. It lives outside the record directory so close
// may remove the record while its lock is held. A dead writer's lock is reclaimed; a live writer is waited for
// with a bounded wall and then fails loudly rather than allowing a stale write to win.
const recordLockRoot = () => join(runtimeRoot(), '.session-locks')
const recordLockPath = (id: string) => join(recordLockRoot(), `${id}.lock`)
const syncPause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
function acquireRecordLockSync(id: string, timeoutMs = 30_000): () => void {
  mkdirSync(recordLockRoot(), { recursive: true })
  const path = recordLockPath(id), deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(path) } catch { /* another recovery already removed it */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let owner = 0
      try { owner = Number(readFileSync(path, 'utf8').trim()) || 0 } catch { /* race with creator/releaser */ }
      if (owner && owner !== process.pid) {
        try { process.kill(owner, 0) } catch { try { unlinkSync(path) } catch { /* race */ }; continue }
      }
      if (Date.now() >= deadline) throw new ResourceConflict(`session ${id}: lifecycle transition lock timed out; refusing a stale write`)
      syncPause(10)
    }
  }
}
const abortedOperation = (signal: AbortSignal): Error => signal.reason instanceof Error
  ? signal.reason
  : Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
async function recordLockPause(signal?: AbortSignal): Promise<void> {
  if (!signal) { await new Promise((resolve) => setTimeout(resolve, 10)); return }
  if (signal.aborted) throw abortedOperation(signal)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 10)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortedOperation(signal)) }
    function done() { signal!.removeEventListener('abort', abort); resolve() }
    signal.addEventListener('abort', abort, { once: true })
  })
}
async function acquireRecordLock(id: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<() => void> {
  mkdirSync(recordLockRoot(), { recursive: true })
  const path = recordLockPath(id), deadline = Date.now() + timeoutMs
  for (;;) {
    if (signal?.aborted) throw abortedOperation(signal)
    try {
      const fd = openSync(path, 'wx')
      writeSync(fd, String(process.pid))
      closeSync(fd)
      return () => { try { unlinkSync(path) } catch { /* another recovery already removed it */ } }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let owner = 0
      try { owner = Number(readFileSync(path, 'utf8').trim()) || 0 } catch { /* race with creator/releaser */ }
      if (owner && owner !== process.pid) {
        try { process.kill(owner, 0) } catch { try { unlinkSync(path) } catch { /* race */ }; continue }
      }
      if (Date.now() >= deadline) throw new ResourceConflict(`session ${id}: lifecycle transition lock timed out; refusing a stale write`)
      await recordLockPause(signal)
    }
  }
}
async function withRecordLock<T>(id: string, body: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquireRecordLock(id, 30_000, signal)
  try { return await body() } finally { release() }
}
function withRecordLockSync<T>(id: string, body: () => T): T {
  const release = acquireRecordLockSync(id)
  try { return body() } finally { release() }
}
function tryRecordLockSync(id: string): (() => void) | null {
  mkdirSync(recordLockRoot(), { recursive: true })
  const path = recordLockPath(id)
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return () => { try { unlinkSync(path) } catch { /* another recovery already removed it */ } }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return null
    throw e
  }
}
// Synchronous terminal input is another product turn-entry path. The PTY bridge uses this narrow seam to
// enqueue input while holding the same durable record lock as archive, so an archive preflight cannot pass idle
// and then race a just-queued TUI turn.
export function withSessionInputLock<T>(id: string, body: () => T): T | null {
  // PTY input is synchronous. A single non-blocking open is the only safe barrier: EEXIST rejects this input
  // regardless of owner PID, so a same-process async archive can never be frozen behind Atomics.wait.
  const release = tryRecordLockSync(id)
  if (!release) return null
  try { return body() } finally { release() }
}

const COLD_PROOF_VERSION = 'cold-v1'
function coldProofFor(rec: Pick<SessRec, 'session' | 'harness' | 'harnessSessionId'>): string {
  const adapter = harnessById(rec.harness || defaultHarness.id).id
  const exact = rec.harnessSessionId ? `thread:${rec.harnessSessionId}` : 'no-resident-ref'
  return `${COLD_PROOF_VERSION}|${adapter}|${rec.session}|${exact}`
}
function hasValidColdProof(rec: SessRec): boolean {
  return !!rec.coldProof && rec.coldProof === coldProofFor(rec)
}
// the loose on-disk fields validated into the typed shape. Exported so the old-record defaults (harness →
// claude, absent pin → null) are unit-auditable without a store on disk.
export function fromRaw(raw: RawRecord & { launch_owner?: string }): SessRec {
  const ownedQueue = raw.status === OWNED_QUEUE_RAW_STATUS
  const status = ownedQueue ? 'queued' : isSessionLifecycle(raw.status) ? raw.status : 'active'
  const launchOwner = ownedQueue ? raw.launch_owner?.trim() : null
  if (ownedQueue && !launchOwner) throw new Error(`owned queue record '${raw.session_id}' has no launch_owner`)
  const proposal = isSessionProposal(raw.proposal) ? raw.proposal : null
  const sk = raw.sortkey
  const sortKey = typeof sk === 'number' && Number.isFinite(sk) ? sk : null
  const pendingRaw = rawLaunchReadinessOriginal(raw)
  const pendingStatus = pendingRaw && isSessionLifecycle(pendingRaw.status) ? pendingRaw.status : null
  if (pendingRaw && !pendingStatus) throw new Error(`session '${raw.session_id}' launch readiness original has invalid lifecycle '${pendingRaw.status}'`)
  const pendingProposal = pendingRaw && isSessionProposal(pendingRaw.proposal) ? pendingRaw.proposal : null
  if (pendingRaw?.proposal && !pendingProposal) throw new Error(`session '${raw.session_id}' launch readiness original has invalid proposal '${pendingRaw.proposal}'`)
  return {
    session: raw.session_id, governed: !!raw.governed, worktreePath: raw.worktree_path || '', branch: raw.branch || null,
    node: raw.node || null, title: raw.title || null, name: raw.name || null, parent: raw.parent || null,
    status, proposal, merges: Number(raw.merges) || 0, note: raw.note || null, sortKey, createdAt: Number(raw.createdAt) || 0,
    harness: raw.harness || 'claude',   // records written before the harness field default to claude
    harnessSessionId: raw.harness_session_id || null,
    stopped: !!raw.stopped,             // records written before explicit stop tracking were not stopped
    archived: !!raw.archived,           // records written before archive → absent → not shelved
    coldProof: raw.cold_proof || null,  // legacy archived rows have no proof and remain visible until re-archived
    adapterRecovery: raw.adapter_recovery || null,
    launcher: raw.launcher || null,     // records written before launchers → null → old-record fallback
    launchCmd: raw.launch_cmd || null,  // records written before the pin → null → fall back to launcher name / ambient
    launchOwner: launchOwner || null,
    createRequestId: raw.create_request_id || null,
    createPayloadHash: raw.create_payload_hash || null,
    launchReadinessPending: pendingRaw ? {
      version: 1,
      startedAt: (raw.launch_readiness_pending as { startedAt: number }).startedAt,
      original: {
        status: pendingStatus!, proposal: pendingProposal, note: pendingRaw.note || null,
        stopped: pendingRaw.stopped, archived: pendingRaw.archived,
        coldProof: pendingRaw.cold_proof || null, adapterRecovery: pendingRaw.adapter_recovery || null,
      },
    } : null,
  }
}

function publicRecord(rec: SessRec): SessRec {
  const original = rec.launchReadinessPending?.original
  return original ? { ...rec, ...original } : rec
}

function launchReadinessPending(original: SessRec): LaunchReadinessPending {
  return {
    version: 1,
    startedAt: Date.now(),
    original: {
      status: original.status,
      proposal: original.proposal,
      note: original.note,
      stopped: original.stopped,
      archived: original.archived,
      coldProof: original.coldProof ?? null,
      adapterRecovery: original.adapterRecovery ?? null,
    },
  }
}

function restoreLaunchReadinessOriginal(rec: SessRec): SessRec {
  const original = rec.launchReadinessPending?.original
  return original ? { ...rec, ...original, launchReadinessPending: null } : rec
}
// Rebuild the full disk projection so retired keys disappear on the next write.
function writeRecord(rec: SessRec): void {
  let previous: SessRec | null = null
  try { previous = readRecord(rec.session) } catch { /* a new or damaged record has no prior transition */ }
  const obj = {
    session_id: rec.session,
    governed: rec.governed,
    worktree_path: rec.worktreePath,
    branch: rec.branch ?? '',
    node: rec.node ?? '',
    title: rec.title ?? '',
    name: rec.name ?? '',
    parent: rec.parent ?? '',
    status: rawLifecycleStatus(rec),
    proposal: rec.proposal ?? '',
    merges: rec.merges,
    note: rec.note ?? '',
    sortkey: rec.sortKey ?? '',
    createdAt: rec.createdAt,
    harness: rec.harness || 'claude',
    harness_session_id: rec.harnessSessionId ?? '',
    stopped: rec.stopped,
    archived: rec.archived,
    cold_proof: rec.coldProof ?? '',
    adapter_recovery: rec.adapterRecovery ?? '',
    launcher: rec.launcher ?? '',
    launch_cmd: rec.launchCmd ?? '',
    launch_owner: rec.status === 'queued' ? rec.launchOwner ?? '' : '',
    create_request_id: rec.createRequestId ?? '',
    create_payload_hash: rec.createPayloadHash ?? '',
    launch_readiness_pending: rec.launchReadinessPending ? {
      version: 1,
      startedAt: rec.launchReadinessPending.startedAt,
      original: {
        status: rec.launchReadinessPending.original.status,
        proposal: rec.launchReadinessPending.original.proposal ?? '',
        note: rec.launchReadinessPending.original.note ?? '',
        stopped: rec.launchReadinessPending.original.stopped,
        archived: rec.launchReadinessPending.original.archived,
        cold_proof: rec.launchReadinessPending.original.coldProof ?? '',
        adapter_recovery: rec.launchReadinessPending.original.adapterRecovery ?? '',
      },
    } : '',
  }
  const dir = sessionStoreDir(rec.session)
  mkdirSync(dir, { recursive: true })
  const path = sessionRecordPath(rec.session)
  const tmp = join(dir, `.session.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
  renameSync(tmp, path)   // atomic within the dir: a concurrent reader sees the old record or the new one
  const previousPublic = previous ? publicRecord(previous) : null
  const nextPublic = publicRecord(rec)
  if (rec.governed && previousPublic && (previousPublic.status !== nextPublic.status
    || previousPublic.proposal !== nextPublic.proposal || previousPublic.note !== nextPublic.note)) {
    recordStatus(rec.session, nextPublic.status, nextPublic.proposal, nextPublic.note)
  }
}

// Share one liveness snapshot rather than spawning tmux for every displayed session.
export type LiveSnap = { probeFailed: boolean; windows: Map<string, PaneProbe>; titles: Map<string, string>; sockets: Set<string>; unproven: Set<string> }

// First pane per session wins; split only twice so titles may contain tabs.
export function parseLivePanes(out: string): Map<string, { panePid?: number; title?: string }> {
  const m = new Map<string, { panePid?: number; title?: string }>()
  for (const line of out.split('\n')) {
    if (!line) continue
    const t1 = line.indexOf('\t')
    const name = (t1 < 0 ? line : line.slice(0, t1)).trim()
    if (!name || m.has(name)) continue   // first pane per session wins
    if (t1 < 0) { m.set(name, {}); continue }
    const rest = line.slice(t1 + 1)
    const t2 = rest.indexOf('\t')
    const pid = Number((t2 < 0 ? rest : rest.slice(0, t2)).trim())
    const title = t2 < 0 ? '' : rest.slice(t2 + 1)
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

async function liveSnapshot(): Promise<LiveSnap> {
  const windows = new Map<string, PaneProbe>()
  const titles = new Map<string, string>()
  let out: string
  try {
    // ONE merged spawn replaces the old two (list-sessions + list-panes): window presence + pane pid + title.
    out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_pid}\t#{pane_title}'], TMUX_PROBE_TIMEOUT_MS)
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
  const listening = await Promise.all(ids.map((id) => rendezvousListening(id)))
  const sockets = new Set<string>()
  const unproven = new Set<string>()
  ids.forEach((id, i) => {
    if (listening[i] === 'live') sockets.add(id)
    else if (listening[i] === 'unproven') unproven.add(id)
  })
  return { probeFailed: false, windows, titles, sockets, unproven }
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

function reconcile(rec: SessRec, snap: LiveSnap): DisplayStatus {
  // record integrity outranks both axes: a session whose worktree is gone has no work to be in any state
  // about. It reads `retired` — a terminal, human-closable row, never a lifecycle a hook can write back over.
  if (retirementReason(rec)) return 'retired'
  if (rec.archived) return 'offline'
  if (rec.status === 'awaiting') return PROPOSAL_STATUS[rec.proposal || 'nothing']
  if (rec.status !== 'active' && rec.status !== 'idle') return rec.status  // parked | error | asking | queued (no tmux yet)
  const lv = liveness(rec, snap)
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

function corruptSession(id: string, entry: { path: string; error: string }): Session {
  const label = `${id.slice(0, 8)} (unreadable record)`
  return {
    id, node: null, branch: null, path: '', label, headline: label, raw: { name: null, title: null },
    parent: null, harness: defaultHarness.id, capabilities: { headless: false }, launcher: null,
    lifecycle: 'active', proposal: null, merges: 0, status: 'corrupt', liveness: 'unknown',
    note: corruptReason(entry), archived: false, prompt: null, promptPreview: null, created: 0,
    activity: null, sortKey: null, archiveHazard: null,
  }
}

export function toSession(rec: SessRec, status: DisplayStatus, lv: Liveness, activity: string | null = null): Session {
  const prompt = readPromptFile(rec.session)   // the originating ask, captured at launch (store artifact; null for old sessions)
  // activity is the LIVE pane title; it only means anything while the worker is genuinely up — a
  // dead/booting session would show a stale or absent title, so it's suppressed unless liveness is online.
  const showActivity = lv === 'online'
  const act = showActivity ? activity : null
  const pp = prompt ? promptPreview(prompt) : null
  const parts = { id: rec.session, name: rec.name, node: rec.node, title: rec.title, branch: rec.branch, activity: act, promptPreview: pp }
  const harness = harnessById(rec.harness || defaultHarness.id)
  return { id: rec.session, node: rec.node, branch: rec.branch, label: deriveLabel(parts), headline: deriveHeadline(parts), raw: { name: rec.name, title: rec.title }, path: rec.worktreePath, parent: rec.parent, harness: harness.id, capabilities: { headless: harness.headless }, launcher: rec.launcher, lifecycle: rec.status, proposal: rec.proposal, merges: rec.merges, note: rec.note, status, liveness: lv, archived: rec.archived, archiveHazard: null, prompt, promptPreview: pp, created: rec.createdAt, activity: act, sortKey: rec.sortKey }
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

// Preserve rows through a transient record-read failure; prune after the store entry disappears.
const lastKnownSession = new Map<string, Session>()

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
  // Only archived adapter records need the resident-ID join. If there are none, this read path performs zero
  // control-plane probes; resources still owns the full turn/read probe for its detailed report.
  const censusRecords = [...snapshots.values()].flatMap(({ entry, rec }) => entry.kind === 'ok' && entry.liveness === null && rec && rec.governed && rec.archived && rec.harnessSessionId
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
    // A forced public liveness comes only from the shared record projection. Do not let live process/thread
    // evidence punch through it (including archive hazard repair).
    if (entry.kind === 'ok' && entry.liveness === 'offline') {
      const pending = toSession(rec, 'offline', 'offline')
      lastKnownSession.set(id, pending)
      return pending
    }
    // the pane title → headline activity, gated by THIS session's harness ([[harness-adapter]]): claude's title
    // is its task self-summary (used); codex's is the cwd folder name (refused → headline falls to the prompt).
    const activity = paneActivity(harnessById(rec.harness || defaultHarness.id), snap.titles.get(id))
    const sessionHarness = harnessById(rec.harness || defaultHarness.id)
    const resident = rec.harnessSessionId
      ? residentCensus.get(`${rec.harness || defaultHarness.id}:${rec.harnessSessionId}`)
      : undefined
    const residentRequired = sessionHarness.runtimeOwnership === 'adapter' && !!rec.harnessSessionId && !!sessionHarness.sharedRuntimes?.(runtimeRoot()).length
    const physical = rec.archived
      ? (sessionHarness.runtimeOwnership === 'adapter'
        ? (resident && !resident.healthy ? 'unknown' : resident?.loaded ? 'online' : snap.windows.has(id) ? 'online' : 'offline')
        : liveness({ ...rec, archived: false, stopped: false }, snap))
      : null
    // Only a physically-offline record projects as archived. A legacy archived+live/unknown record is exposed
    // as ordinary working-set state with its real liveness/status and one backend-owned hazard marker. A
    // missing durable cold proof is also legacy: leaf liveness alone cannot prove a Codex loaded thread was
    // unloaded, so it remains visible until an explicit archive repair.
    const cleanCold = rec.archived && !changedDuringCensus.has(id) && hasValidColdProof(rec) && physical === 'offline' && (!residentRequired || resident?.healthy === true)
    const projected = rec.archived && !cleanCold ? { ...rec, archived: false, stopped: false } : rec
    const projectedLv = projected === rec ? liveness(rec, snap) : physical!
    const s = toSession(projected, reconcile(projected, snap), projectedLv, activity)
    if (projected !== rec) s.archiveHazard = changedDuringCensus.has(id)
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
    // DEGRADED: the record dir still exists but reading session.json failed transiently. NEVER drop a live
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
// the explicit routing flag, read from THIS process's argv (never the environment — that's the point).
// `--port` doubles as a BIND port for serve/dashboard, so the sugar is skipped for those verbs.
function explicitApiFlag(): string | null {
  const argv = process.argv
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
export const withNoteReplyHint = (text: string): string =>
  `${text}\n\n— REQUIRED REPLY TRANSPORT (PER-MESSAGE): this terminal-free sender CANNOT see normal assistant/final output. Do not stop after only printing the answer. As your FINAL action, put your COMPLETE reply to this message in the truthful declaration's --note. For a simple answer awaiting the next message, run \`spex session ask --note "<complete reply>"\`; if the true state is done or parked, put the same complete reply in that declaration's --note instead. This declaration command is reply transport, not part of the requested work, and remains REQUIRED even when the message says to use no tools, make no tool calls, or only print/reply. A later message arriving WITHOUT this notice means the sender is back at a terminal and reads your normal output again.`
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
export function launchScript(id: string, tail: string, harness: Harness = HARNESS, cmd?: string): string {
  const file = join(storeDir(id), 'launch.sh')
  // NO --append-system-prompt / --settings: the contract + hooks are materialized into the worktree at
  // createSession ([[harness-delivery]]) and the agent auto-discovers them — the SAME path as a self-launched
  // agent. The launch line is just the rendezvous env + the harness command + the session-id/spec-pointer/prompt tail.
  // `cmd` is the session's persisted launcher command ([[launcher-select]]); when set it OVERRIDES the harness's
  // ambient default so resume reuses the same auth. Undefined is only for old records before launch_cmd existed.
  const invocation = `${rvEnv(id, harness)} ${harness.launchCmd(id, runtimeRoot(), cmd)} ${tail}`
  // @@@ birth registration - record the AGENT's real pid BEFORE exec, the anchor of the 100ms hot death tier
  // ([[state]]). Each attempt runs `sh -c '<pid-write>; exec env <invocation>'`: the sh writes its own `$$` to
  // agent.pid, then `exec env` REPLACES that sh in place — so the pid persists down the whole command chain
  // (claude: env→(reclaude→)claude; codex: env→bash -lc <script> whose last line is `exec codex … resume`), and
  // `$$` therefore IS the launched agent's pid. `env` carries the leading `VAR=val` assignments (an env prefix
  // can't lead an `exec`), and the whole payload is single-quoted for the outer shell (shQuote) so the
  // invocation's own single-quoted segments — the codex `$@`/`$tid` script, the prompt — reach sh verbatim,
  // parsed exactly ONCE, never double-expanded. Each retry attempt rewrites agent.pid with a fresh `$$`.
  const pidPath = join(storeDir(id), 'agent.pid')
  const born = `sh -c ${shQuote(`printf %s "$$" > ${shQuote(pidPath)}; exec env ${invocation}`)}`
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
      `  if tmux capture-pane -p -S -400 -t "\${TMUX_PANE:-}" 2>/dev/null | sed -n "/$__spex_mark/,\\$p" | grep -Eq ${shQuote(fatal)}; then`,
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
  await tmux(['new-session', '-d', '-s', id, '-x', String(COLS), '-y', String(ROWS), '-c', path])
  await tmux(['send-keys', '-t', id, '-l', '--', `bash ${launchScript(id, tail, harness, cmd)}`])
  await tmux(['send-keys', '-t', id, 'Enter'])
  launchedAt.set(id, Date.now())   // stamp the boot window so reconcile reads 'starting', not 'offline', until the socket is up
}


const OCCUPIES_SLOT = new Set<DisplayStatus>(['working', 'parked', 'starting'])  // starting's boot window is also held via `launching`
function isOccupying(s: Session, snap: LiveSnap): boolean {
  if (!OCCUPIES_SLOT.has(s.status)) return false                          // waiting-on-human / proposed / queued / dead → free
  const rec = readRecord(s.id)
  if (!rec) return false
  return harnessById(rec.harness || defaultHarness.id).liveness(rec, snap.windows.has(rec.session), runtimeRoot(), snap.windows.get(rec.session), snap.sockets.has(rec.session)) === 'online'
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
let draining = false   // re-entrancy guard: only one drain pass runs at a time (no double-launch)

// launch a prepared `queued` worktree: feed it its parked launch prompt, flip it to active. Returns false
// (leaving it queued, to be retried next drain) if the worktree/prompt is gone or the tmux launch threw.
async function startQueuedUnlocked(id: string): Promise<boolean> {
  if (archiving.has(id)) return false
  const wt = await findWorktree(id)
  if (!wt) return false
  if (archiving.has(id) || wt.rec.archived) return false
  if (!canDrainQueued(wt.rec)) return false
  const launchPrompt = readLaunchFile(id)
  if (launchPrompt == null) return false   // a queued session always has one; if it's gone, don't spin on it
  // a queued worktree can go missing while it waits (a human cleaned up, a disk moved). Draining it would open
  // a window that fast-exits and burn the retry budget every tick, so refuse ONCE, loudly, and stamp the reason
  // on the record — the drainer then leaves it alone instead of spinning on a launch that cannot work.
  const blocked = launchPreflight(wt.rec)
  if (blocked) {
    if (wt.rec.note !== blocked.message) {
      console.error(`spex: not launching queued session ${id}: ${blocked.message}`)
      writeRecord({ ...wt.rec, note: blocked.message })
    }
    return false
  }
  launching.add(id)   // hold the slot across the boot window BEFORE we launch, so a concurrent count can't race us
  const h = harnessById(wt.rec.harness || defaultHarness.id)   // launch THIS session's chosen harness (also drives waitForReady below)
  try {
    const sq = shQuote(launchPrompt)
    await launch(id, wt.path, `${h.sessionIdArg(id)} ${sq}`.trim(), h, launcherCmd(wt.rec))
  } catch {
    launching.delete(id)
    return false   // launch failed → stays `queued`, retried on the next drain tick
  }
  writeRecord({ ...wt.rec, status: 'active', proposal: null, launchOwner: null })
  removeLaunchFile(id)   // consumed
  // release the boot-window hold once the socket is up (then isOccupying takes over) or after the bounded
  // wait — so a launch that never booted reads offline and the drainer reclaims the slot instead of pinning it.
  void waitForReady(id, h).finally(() => launching.delete(id))
  return true
}
const startQueued = (id: string): Promise<boolean> => withSessionTransition(id, () => withRecordLock(id, () => startQueuedUnlocked(id)))

async function drainQueueUnlocked(): Promise<void> {
  if (draining) return
  draining = true
  try {
    const cap = maxActive()   // read once per drain pass (spexcode.json → env → default); won't shift mid-burst
    for (;;) {
      const [sessions, snap] = await Promise.all([listSessions(), liveSnapshot()])
      // if the liveness probe FAILED (tmux timing out — the overload condition), occupancy is UNKNOWABLE: every
      // session would read window-less and isOccupying would undercount, so the drainer would OVER-launch and pile
      // MORE compute onto an already-thrashing box. Under load, do the safe thing — launch nothing this pass and
      // let the next tick re-drain once the probe recovers ([[state]] board honesty applied to the cap).
      if (snap.probeFailed) break
      const occupied = sessions.reduce((n, s) => n + (launching.has(s.id) || isOccupying(s, snap) ? 1 : 0), 0)
      if (occupied >= cap) break
      const authority = backendLaunchAuthority()
      const next = sessions.find((s) => {
        if (s.status !== 'queued' || launching.has(s.id)) return false
        const rec = readRecord(s.id)
        return !!rec && canDrainQueued(rec, authority)
      })
      if (!next) break
      if (!(await startQueued(next.id))) break   // launch failed → stop this pass; a later tick retries
    }
  } finally { draining = false }
}
export const drainQueue = (): Promise<void> => drainQueueUnlocked()
const requestQueueDrain = (): void => {
  void drainQueue().catch((error) => {
    console.error(`spex: queue drain failed: ${error instanceof Error ? error.message : String(error)}`)
  })
}

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
    if (!rec?.governed || rec.stopped || rec.archived || !rec.harnessSessionId) continue
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
    if (state && now < state.retryAt) continue
    state ??= { fingerprint: target.fingerprint, subscription: null, startedAt: 0, failures: 0, retryAt: 0, lastReason: null }
    state.startedAt = now
    turnFailureObservers.set(id, state)
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
      void subscription.closed.then((reason) => {
        if (turnFailureObservers.get(id) !== state) return
        if (reason) deferTurnFailureObserver(id, target.harness.id, state, reason)
        else turnFailureObservers.delete(id)
      })
    } catch (error) {
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
function assertProjectSettingsMatch(verb: string, target: ApiBaseInfo, settings: BackendSettings | null): void {
  const { url, source } = target
  if (source === 'flag') return                                   // explicitly routed — the caller named the target
  let localMain: string
  try { localMain = realpathSync(mainRoot()) } catch { return }   // caller not in a repo → can't prove a mismatch
  const served = settings?.layout?.main ?? null
  if (!served || !isAbsolute(served)) return                      // unknown / config-aliased root → don't risk a false refusal
  let backendMain: string
  try { backendMain = realpathSync(served) } catch { return }     // backend root not a local path → a remote backend, allow
  if (backendMain !== localMain) {
    const e = new Error(
      `${verb}: refusing WRITE — cwd is in ${localMain} but the backend at ${url} serves ${backendMain}.\n` +
      `Name the target explicitly (--api <url> / --port <n>) to write cross-project on purpose,\n` +
      `or run this project's own backend:  cd ${localMain} && spex serve.  (Reads stay unguarded.)`)
    e.name = 'GuardError'
    throw e
  }
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
type SessionCreateContext = { id: string; requestDigest: string; payloadHash: string; signal: AbortSignal }
type SessionCreateRequestOptions = {
  requestKey?: string
  signal?: AbortSignal
  timeoutMs?: number
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
  const unknown = Object.keys(input).filter((key) => !['prompt', 'parent', 'launcher'].includes(key)).sort()
  if (unknown.length) return { status: 400, error: `unknown session-create field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}` }
  const prompt = typeof input.prompt === 'string' ? input.prompt : ''
  if (!prompt.trim()) return { status: 400, error: 'empty prompt' }
  const launcher = typeof input.launcher === 'string' && input.launcher.trim() ? input.launcher.trim() : undefined
  const parent = typeof input.parent === 'string' && input.parent.trim() ? input.parent.trim() : null
  let key: string
  try { key = normalizeCreateKey(options.requestKey) }
  catch (error) {
    const failure = error as SessionCreateError
    return { status: failure.status, error: failure.message, code: failure.code, phase: failure.phase }
  }
  const requestDigest = digest(key)
  const id = sessionIdForCreateKey(key)
  const payloadHash = digest(JSON.stringify({ prompt, parent, launcher: launcher ?? null }))
  const controller = new AbortController()
  const cancel = () => controller.abort(new SessionCreateError('session_create_cancelled', 'request', 'session creation caller disconnected', 408))
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new SessionCreateError('session_create_timeout', 'request', 'session creation exceeded its deadline', 504)), options.timeoutMs ?? sessionCreateTimeoutMs())
  timer.unref?.()
  traceSessionCreate(id, requestDigest, 'request', 'start')
  try {
    try {
      const session = await prepareSession(prompt, parent, launcher, { id, requestDigest, payloadHash, signal: controller.signal })
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
async function probeSessionCreateAuthority(target: ApiBaseInfo): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  timer.unref?.()
  try {
    const response = await fetch(`${target.url}/api/settings`, { signal: controller.signal })
    let settings: BackendSettings | null = null
    if (response.ok) {
      try { settings = await response.json() as BackendSettings }
      catch (error) { if (controller.signal.aborted) throw error }
    }
    assertProjectSettingsMatch('spex session new', target, settings)
    return false
  } catch (error) {
    if (isExplicitConnectionRefused(error)) return true
    const failed = new Error(`backend availability is indeterminate at ${target.url}; refusing in-process session creation (${error instanceof Error ? error.message : error})`)
    failed.name = 'BackendError'
    Object.assign(failed, { code: 'backend_availability_indeterminate', cause: error })
    throw failed
  } finally { clearTimeout(timer) }
}
export async function createSession(prompt: string, launcher?: string): Promise<Session> {
  const parent = ownSessionId()
  const requestKey = randomUUID()
  const target = await apiBaseInfo()
  const base = target.url
  const refused = await probeSessionCreateAuthority(target)
  if (refused) {
    console.error('spex: no backend reachable — launching in-process (caller env owns auth, no concurrency cap)')
    const fallback = await sessionCreateRequest({ prompt, parent, launcher }, { requestKey })
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
    res = await fetch(`${base}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': requestKey },
      body: JSON.stringify({ prompt, parent, launcher }),
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
    const req = createRequire(join(pkgRoot(), 'package.json'))
    const tsxImport = req.resolve('tsx/esm')
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(process.execPath, ['--import', tsxImport, join(pkgRoot(), 'src', 'cli.ts'), 'materialize'], {
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
  const status = rec.status === 'active' ? 'working' : rec.status === 'awaiting' ? PROPOSAL_STATUS[rec.proposal ?? 'nothing'] : rec.status
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

async function prepareSession(prompt: string, parent: string | null, launcher: string | undefined, context: SessionCreateContext): Promise<Session> {
  const { id, requestDigest, payloadHash, signal } = context
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
      } catch (error) {
        throw new SessionCreateError('session_create_failed', phase, error instanceof Error ? error.message : String(error), 400)
      }
      traceSessionCreate(id, requestDigest, phase, 'finish')

      phase = 'target-resolution'
      traceSessionCreate(id, requestDigest, phase, 'start')
      throwIfCreateAborted(signal, phase)
      const rawPrompt = prompt
      const ref = nodeFromPrompt(rawPrompt)
      const launchSpecs = ref ? loadSpecsLite() : null
      const title = ref ? null : titleFromPrompt(rawPrompt)
      const slug = `${slugify(ref || title)}-${id.slice(0, 4)}`
      const root = mainRoot()
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
        let before = await sessionCandidateState(root, path, branch, signal)
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
          const added = await withGitAbortSignal(signal, () => gitTry(['-C', root, 'worktree', 'add', '-b', branch, path, mainBranch()]))
          if (added.ok) Object.assign(owned, { path: true, worktree: true, branch: true })
          if (!added.ok || !existsSync(path)) {
            throw new SessionCreateError('session_create_failed', phase, `git worktree add failed: ${added.stderr.trim() || added.failure || 'worktree missing after success'}`, 500)
          }
          candidateReceipt = { ...candidateReceipt, stage: 'git-created' }
          writeSessionCandidateReceipt(id, candidateReceipt)
          traceSessionCreate(id, requestDigest, phase, 'finish')
          seedWorktreeHostState(root, path)

          let rec: SessRec = {
            session: id, governed: true, worktreePath: path, branch,
            node: ref || null, title, name: null, parent: parent && parent !== id ? parent : null,
            status: 'queued', proposal: null, merges: 0, note: null, sortKey: null, createdAt: Date.now(),
            harness: h.id, harnessSessionId: null, stopped: false, archived: false, coldProof: null, adapterRecovery: null, launcher: chosen.name,
            launchCmd: pinned, launchOwner: backendLaunchAuthority(), createRequestId: requestDigest, createPayloadHash: payloadHash,
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
async function waitForReady(id: string, harness: Harness, pending?: SessRec, timeoutMs = SOCKET_READY_TIMEOUT_MS): Promise<HarnessLaunchReadinessFence | null> {
  const current = () => {
    const stored = readRecord(id)
    const rec = stored && pending
      ? { ...pending, ...stored, stopped: pending.stopped, archived: pending.archived }
      : stored || pending
    return rec ? { ...rec, runtimeDir: runtimeRoot() } : null
  }
  const deadline = Date.now() + timeoutMs
  if (harness.launchReady) return harness.launchReady(current, deadline)
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
    if (rec && harness.liveness(rec, snap.windows.has(id), runtimeRoot(), snap.windows.get(id), snap.sockets.has(id)) === 'online') return genericFence()
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, SOCKET_POLL_MS))
  }
}

type ResumeOptions = { force?: boolean; guard?: boolean }

async function resumeSessionUnlocked(id: string, opts: ResumeOptions = {}): Promise<{ ok: boolean; error?: string; refused?: boolean; info?: string }> {
  const { force = false, guard = true } = opts
  let wt: { path: string; branch: string | null; rec: SessRec } | null
  try { wt = await findWorktree(id) }
  catch (e) { if (e instanceof SessionRecordUnusable) return { ok: false, refused: true, error: e.message }; throw e }
  if (!wt) return { ok: false, error: `no such session ${id}` }
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
  // An archived record is expected to be stopped, but the guard must still inspect physical liveness in case
  // it is a legacy/invariant-violating row. Ignore filing and stale stop metadata for this one safety probe so
  // resume can never kill a live leaf merely because the record was hidden.
  const probeRec = wt.rec.archived ? { ...wt.rec, archived: false, stopped: false } : wt.rec
  const resumeSnap = await liveSnapshot()
  const lv = h.runtimeOwnership === 'adapter'
    ? (resumeSnap.windows.has(id) ? 'online' : 'offline')
    : liveness(probeRec, resumeSnap)   // FRESH, honest liveness (listener-verified)
  if (guard && !force && lv === 'online')
    return { ok: false, refused: true, error: `session ${id} is ALIVE — refusing to relaunch, which would kill a live worker mid-work. To steer it, send it a message; use force only for a genuinely wedged (but alive) process.` }
  if (guard && !force && lv === 'unknown')
    return { ok: false, refused: true, error: `session ${id}: the liveness probe failed (the box is likely overloaded) — refusing to relaunch since a live worker can't be ruled out. Retry in a moment, or use force to override.` }
  const wasArchived = wt.rec.archived
  if (!wasArchived && wt.rec.adapterRecovery) {
    const recovery = await h.restoreRuntime?.(wt.rec)
    if (recovery && !recovery.ok) return { ok: false, refused: true, error: `session ${id}: recovery required before resume — ${recovery.reason}` }
    writeRecord({ ...(readRecord(id) || wt.rec), adapterRecovery: null, coldProof: null, archived: false, stopped: true })
    wt = await findWorktree(id)
    if (!wt) return { ok: false, error: `session ${id} disappeared during adapter recovery` }
  }
  if (wasArchived && (force || lv === 'offline')) {
    // Make the durable row visible/offline before any adapter unarchive or launch RPC. Any later failure leaves
    // a retryable unarchived record rather than archived:true with a newly loaded target thread.
    const pendingRecovery = wt.rec.adapterRecovery || 'restore-runtime-pending'
    writeRecord({ ...wt.rec, archived: false, stopped: true, coldProof: wt.rec.coldProof, adapterRecovery: pendingRecovery })
    const visible = readRecord(id) || { ...wt.rec, archived: false, stopped: true, coldProof: wt.rec.coldProof, adapterRecovery: pendingRecovery }
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
  const current = wasArchived ? (readRecord(id) || { ...wt.rec, archived: false, stopped: true, coldProof: null }) : wt.rec
  const resumed: SessRec = { ...current, archived: false, coldProof: null, status: current.status === 'active' ? 'idle' : current.status, stopped: false }
  if (force || lv === 'offline') {
    await tmuxOk(['kill-session', '-t', id])   // drop a dead/offline pane (or a force-killed live one)
    await launch(id, wt.path, h.resumeArg(wt.rec).trim(), h, launcherCmd(wt.rec))
    let readiness: HarnessLaunchReadinessFence | null = null
    let readinessError = ''
    try { readiness = await waitForReady(id, h, resumed) }
    catch (error) { readinessError = error instanceof Error ? error.message : String(error) }
    if (!readiness) {
      const failed = readRecord(id) || current
      writeRecord({ ...failed, ...preResume, launchReadinessPending: null })
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
      coldProof: null,
      status: latest.status === 'active' ? 'idle' : latest.status,
      stopped: false,
      launchReadinessPending: launchReadinessPending(preResume),
    }
    writeRecord(candidate)
    let stillReady = false
    try { stillReady = await readiness.validate(() => {
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
    const published = readRecord(id) || candidate
    writeRecord({ ...published, launchReadinessPending: null })
  } else writeRecord(resumed)
  return { ok: true }
}
export const resumeSession = (id: string, opts: ResumeOptions = {}) =>
  withSessionTransition(id, () => withRecordLock(id, () => resumeSessionUnlocked(id, opts)))

export function markState(status: Lifecycle, opts: { proposal?: Proposal; note?: string; sessionId?: string } = {}): boolean {
  const id = opts.sessionId || ownSessionId()
  if (!id) return false
  return withRecordLockSync(id, () => {
    const rec = readLiveRecord(id)
    if (!rec) return false
    writeRecord({
      ...rec, status,
      proposal: status === 'awaiting' ? (opts.proposal ?? 'nothing') : null,
      note: opts.note ?? null,
    })
    return true
  })
}
export const markDone = (proposal: Proposal = 'nothing', sessionId?: string, note?: string) => markState('awaiting', { proposal, note, sessionId })
export const markError = (sessionId?: string) => markState('error', { sessionId })
export function markTurnFailure(sessionId: string | undefined, note: string): boolean {
  if (!sessionId) return false
  return withRecordLockSync(sessionId, () => {
    const rec = readLiveRecord(sessionId)
    if (!rec || rec.status !== 'active' || rec.stopped || rec.archived) return false
    writeRecord({ ...rec, status: 'error', proposal: null, note })
    return true
  })
}
export function markHeadlessTurnFailure(sessionId: string, harness: string, exitCode: string): boolean {
  if (exitCode === '0') return false
  const outcome = /^\d+$/.test(exitCode) ? `exit code ${exitCode}` : `signal ${exitCode}`
  return markTurnFailure(sessionId, `${harness} turn exited with ${outcome}`)
}
export function markHarnessSessionId(sessionId: string | undefined, harnessSessionId: string | undefined): boolean {
  const id = sessionId || ownSessionId()
  if (!id || !harnessSessionId) return false
  return withRecordLockSync(id, () => {
    const rec = readLiveRecord(id)
    if (!rec) return false
    if (rec.harnessSessionId && rec.harnessSessionId !== harnessSessionId)
      throw new ResourceConflict(`refusing to replace exact harness thread identity for ${id}; create a new governed session instead`)
    const codex = rec.harness === 'codex' || rec.harness === 'codex-headless'
    const root = runtimeRoot()
    let priorBinding: ReturnType<typeof codexGenerationBindingForSession> = null
    let generationId: string | undefined
    let registrationPrepared = false
    if (codex) {
      generationId = process.env.SPEXCODE_CODEX_GENERATION?.trim()
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
    try {
      writeRecord({ ...rec, harnessSessionId, coldProof: null, adapterRecovery: null })
    } catch (error) {
      if (codex && generationId && registrationPrepared) {
        try {
          bindCodexGeneration(root, id, harnessSessionId, null)
        } catch (rollback) {
          throw new ResourceConflict(`Codex generation binding persisted but session ${id} record write failed and rollback failed: ${rollback instanceof Error ? rollback.message : String(rollback)}`)
        }
      }
      throw error
    }
    if (codex && generationId) commitCodexGenerationRegistration(root, id, harnessSessionId, generationId)
    return true
  })
}
export function markIdle(sessionId?: string): boolean {
  const id = sessionId || ownSessionId()
  if (!id) return false
  return withRecordLockSync(id, () => {
    const rec = readLiveRecord(id)
    if (!rec || rec.status !== 'active') return false  // active-only: never clobber a declaration
    writeRecord({ ...rec, status: 'idle' })
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
export type ReviewEvalGate = ({ phase: 'ready' } & ReviewEvalFacts) | { phase: 'unavailable' | 'loading' | 'updating' | 'error' }
export type ReviewGates = {
  conflictsWithMain: boolean                       // a dry-run merge into main would conflict (in-memory, safe)
  lint: { errorCount: number; warningCount: number } // the spec↔code graph lint
  evals: ReviewEvalGate                            // [[session-eval]]'s already-computed scenario categories
}
export type ReviewPayload = {
  id: string; node: string | null; branch: string | null
  label: string              // the session's identity, derived ONCE via deriveLabel — the review surface renders THIS, never its own node||branch||id chain
  ahead: number              // commits the node branch is ahead of main
  dirtyNonRuntime: number    // uncommitted files excluding SpexCode's own runtime files
  diff: ReviewDiffFile[]     // the worker's real changes, anchored at the merge-base
  gates: ReviewGates
  proposal: { kind: Proposal | null; note: string | null }   // the session's standing proposal + its note
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

// @@@ evalGate - the cockpit's measured-loss readout, taken from [[session-eval]]'s EXISTING projection.
// This is a cache READ and must stay one: buildSessionEvals() itself calls reviewPayload(), so building the
// model from here would recurse. The import is dynamic for the same reason the lint gate's is — the eval
// package imports this module, and the cockpit only needs it at call time.
async function evalGate(id: string): Promise<ReviewEvalGate> {
  const { sessionEvalProjection } = await import('../../spec-eval/src/sessioneval.js')
  const projection = sessionEvalProjection(id)
  if (!projection) return { phase: 'unavailable' }
  // only a `ready` projection carries a CURRENT value; last-known is deliberately not reported as current.
  if (projection.phase !== 'ready' || !projection.value) {
    return { phase: projection.phase === 'ready' ? 'unavailable' : projection.phase }
  }
  const summary = projection.value
  return { phase: 'ready', freshPass: summary.pass, freshFail: summary.fail, needReview: summary.review, blind: summary.blind }
}

// @@@ reviewPayload - assemble the cockpit review for one session. The four session-specific reads
// (ahead / dirty / diff / conflict gate) plus the one location gate (lint) are all independent, so they run
// in parallel. The lint gate goes through lintGate(), which memoizes it on the checkout's tree fingerprint —
// so an unchanged tree doesn't re-run the lint on each review / Proof-tab open, while any commit or edit
// invalidates and recomputes.
export async function reviewPayload(id: string): Promise<ReviewPayload | null> {
  const wt = await findWorktree(id)
  if (!wt) return null
  const base = mainBranch()
  const [aheadOut, statusOut, diff, conflictsWithMain, lint, evals] = await Promise.all([
    gitA(['-C', wt.path, 'rev-list', '--count', `${base}..HEAD`]),
    gitA(['-C', wt.path, 'status', '--porcelain', '--untracked-files=all']),
    mergeBaseDiff(wt.path, base),
    mergeConflicts(wt.path, base),
    lintGate(),   // lint — memoized on the checkout fingerprint, not re-run per session/open
    evalGate(id), // measured loss — a READ of the existing projection, never a build
  ])
  // the worktree carries no SpexCode runtime files any more (the store lives in ~/.spexcode), so every dirty
  // path is genuine work — this is just the total uncommitted count.
  const dirtyNonRuntime = statusOut.split('\n').filter(Boolean).map(porcelainPath).length
  return {
    id, node: wt.rec.node, branch: wt.branch,
    label: deriveLabel({ id, name: wt.rec.name, node: wt.rec.node, title: wt.rec.title, branch: wt.branch }),
    ahead: Number(aheadOut.trim()) || 0,
    dirtyNonRuntime, diff,
    gates: { conflictsWithMain, lint, evals },
    proposal: { kind: wt.rec.proposal, note: wt.rec.note },
  }
}

function mergePrompt(mainPath: string, branch: string, reason: string): string {
  const base = mainBranch()
  return `Merge your branch \`${branch}\` into \`${base}\`, then propose close. You know this work, so resolve any conflicts yourself — in YOUR OWN worktree, never in the shared ${base} checkout.\n\n` +
    `1. Sync first, where you work: \`git merge ${base}\` INTO your branch, resolve every conflict here, and re-run what proves your work. The ${base} checkout is the fleet's ONE landing door — a merge that stops to ask about conflicts holds it for everyone.\n` +
    `2. Land only a TRIVIAL merge: \`git -C ${mainPath} merge-base --is-ancestor ${base} ${branch}\` must exit 0 (your branch already contains ${base}) — then\n   git -C ${mainPath} merge --no-ff -m "merge ${branch}: ${reason}" ${branch}\n   If that check fails, ${base} moved while you tested: go back to step 1 instead of landing.\n` +
    `3. A busy door is a wait, not a race: if the ${base} checkout is already mid-merge (an unresolved index), retry with a bounded wait — never abort or resolve someone else's in-progress merge. ` +
    `4. Verify it landed: \`${base}\`'s HEAD must now be the new merge commit and no merge may be left in progress — if YOUR merge went half-merged, run \`git -C ${mainPath} merge --abort\` and report it rather than leaving \`${base}\` mid-state. ` +
    `5. Once you've verified \`${base}\` advanced cleanly, propose close for the human — do NOT close it yourself.`
}

async function mergeSessionUnlocked(id: string): Promise<{ dispatched: boolean; reason?: string }> {
  const wt = await findWorktree(id)
  if (!wt || !wt.branch) return { dispatched: false, reason: 'no such session' }
  const branch = wt.branch, main = mainRoot()
  // ensure-live, NOT the guarded human relaunch: an already-online agent is reused (the merge prompt just needs
  // a live socket), and only a confirmed-offline one is relaunched — so merge never refuses on a live agent.
  const re = await resumeSession(id, { guard: false })
  if (!re.ok) return { dispatched: false, reason: re.error || 'could not resume session' }
  const subject = (await gitA(['-C', main, 'log', '-1', '--format=%s', branch])).trim()
  const reason = subject.replace(/^spec:\s+/, '') || branch
  const r = await sendText(id, mergePrompt(main, branch, reason))
  if (!r.ok) return { dispatched: false, reason: r.error }
  return { dispatched: true }
}
export const mergeSession = (id: string): Promise<{ dispatched: boolean; reason?: string }> =>
  mergeSessionUnlocked(id)

// @@@ killAgentProcess - the pane is the agent's HOME, not its LEASH. `kill-session` SIGHUPs the pane's
// process group, and an idle agent goes with it (measured: ~0.8s) — but one mid-turn can outlive the whole
// tmux server and keep running, orphaned, still holding its rendezvous socket (measured: pane gone, server
// gone, agent still answering). Close promises ZERO residue including the process tree, so the teardown
// escalates on the pid launch registered for exactly this purpose: give the SIGHUP its moment, then SIGTERM,
// then SIGKILL, each bounded. This is also what lets the socket sweep run at all — a still-answering listener
// is never ours to unlink, so an un-killed agent would otherwise strand its own socket forever.
// The escalation is IDENTITY-GUARDED: a recorded pid can have been recycled by an unrelated process, so we
// signal only a pid whose argv still names THIS session. Unidentifiable → we signal nothing and let the
// adapter's proof-of-death rule leave the transport alone; never a blind kill on a stale number.
const AGENT_EXIT_GRACE_MS = 3000
type LeafIdentity = { pid: number; startToken: string; ownerNeedle: string }
async function killAgentProcess(id: string, beforeSignal: () => Promise<void>, leaf: LeafIdentity): Promise<void> {
  const pid = readAgentPid(sessionArtifactPath(id, 'agent.pid'))
  if (pid !== leaf.pid)
    throw new ResourceConflict(`refusing to stop ${id}: session leaf identity changed before signal`)
  if (!Number.isFinite(pid) || pid <= 0) return
  const startToken = leaf.startToken
  const alive = (): boolean => leafAlive(pid)
  const identityState = (): 'same' | 'gone' | 'changed' => {
    if (readAgentPid(sessionArtifactPath(id, 'agent.pid')) !== leaf.pid) return 'changed'
    const current = processStartToken(pid)
    if (!current) return alive() ? 'changed' : 'gone'
    return current === startToken ? 'same' : 'changed'
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
  const sameAgentInstance = async (): Promise<boolean> => {
    if (processStartToken(pid) !== startToken) return false
    const argv = await pexec('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).then((r) => r.stdout).catch(() => '')
    return argv.includes(leaf.ownerNeedle) && processStartToken(pid) === startToken
  }
  for (const sig of ['SIGTERM', 'SIGKILL'] as const) {
    await beforeSignal()
    const state = identityState()
    if (state === 'gone') return
    if (state === 'changed') throw new ResourceConflict(`refusing to stop ${id}: session leaf identity changed during escalation`)
    if (!await sameAgentInstance()) throw new ResourceConflict(`refusing to stop ${id}: leaf PID ${pid}@${startToken} no longer proves ownership`)
    try { process.kill(pid, sig) } catch { return }                  // vanished between checks
    if (await gone(sig === 'SIGTERM' ? AGENT_EXIT_GRACE_MS : 1000)) return
  }
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
const leafAlive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException)?.code !== 'ESRCH' }
}

async function assertSessionLeafOwned(id: string, rec: SessRec): Promise<LeafIdentity | null> {
  const harness = harnessById(rec.harness || defaultHarness.id)
  if (harness.runtimeOwnership === 'adapter') return null
  // Prove the exact per-session leaf before the first tmux signal. Missing identity is acceptable only for a
  // record-only/queued runtime; a live leaf without a matching pid/start/argv stays visible.
  const pid = readAgentPid(sessionArtifactPath(id, 'agent.pid'))
  if (!Number.isFinite(pid) || pid <= 0) {
    if (rec.stopped || rec.status === 'queued') return null
    throw new ResourceConflict(`refusing to stop ${id}: no readable session-owned leaf PID`)
  }
  const startToken = processStartToken(pid)
  if (!startToken) {
    if (rec.stopped || !leafAlive(pid)) return null
    throw new ResourceConflict(`refusing to stop ${id}: session-owned leaf PID ${pid} is alive but will not prove its start identity`)
  }
  const argv = await pexec('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' }).then((r) => r.stdout).catch(() => '')
  const ownerNeedle = harness.leafOwnerNeedle?.(rec)
  if (!ownerNeedle)
    throw new ResourceConflict(`refusing to stop ${id}: no exact harness identity is registered for leaf PID ${pid}`)
  if (!argv.includes(ownerNeedle) || processStartToken(pid) !== startToken)
    throw new ResourceConflict(`refusing to stop ${id}: leaf PID ${pid}@${startToken} does not prove argv ownership`)
  return { pid, startToken, ownerNeedle }
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
  // wrapper. Kill that session-id unconditionally; runtimeOwnership only changes the PID/argv proof, never the
  // exact tmux teardown.
  await tmuxOk(['kill-session', '-t', id])
  if (leaf) await killAgentProcess(id, assertOwned, leaf)
  launchedAt.delete(id)
  await harness.cleanupRuntime(rec)
  if (requireCold) {
    const cold = await harness.coldRuntime?.(rec, coldReceipt)
    if (cold && !cold.ok) throw new ResourceConflict(`refusing to archive ${id}: ${cold.reason}`)
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
  requestQueueDrain()   // a stop frees a slot — start the next queued session if any
  return !!wt
}
export const stopSession = (id: string): Promise<boolean> =>
  withSessionTransition(id, () => withRecordLock(id, () => stopSessionUnlocked(id)))

async function archiveSessionUnlocked(id: string, on = true): Promise<boolean> {
  let wt: { path: string; branch: string | null; rec: SessRec } | null
  try { wt = await findWorktree(id) }
  catch (e) {
    if (e instanceof SessionRecordUnusable) throw new ResourceConflict(`refusing to archive ${id}: ${e.message}`)
    throw e
  }
  if (!wt) return false
  if (!on) throw new ResourceConflict('unarchive is not a record-only transition; use resume to restore the runtime')
  if (wt.rec.status === 'queued') throw new ResourceConflict(`refusing to archive ${id}: queued sessions have only a prepared launch prompt; resume/startQueued is their lifecycle`)
  const retired = retirementReason(wt.rec)
  if (retired) throw new ResourceConflict(`refusing to archive ${id}: ${retired}`)
  archiving.add(id)
  try {
  const h = harnessById(wt.rec.harness || defaultHarness.id)
  // A proven cold record is already archived; never clear it and issue a second thread/archive RPC. Verify the
  // adapter's exact resident reference first so an externally respawned thread is repaired rather than hidden.
  if (wt.rec.archived && hasValidColdProof(wt.rec)) {
    const proofSnap = await liveSnapshot()
    if (proofSnap.probeFailed) throw new ResourceConflict(`refusing to re-archive ${id}: liveness probe failed; the exact leaf may have respawned`)
    const proofLv = h.runtimeOwnership === 'adapter'
      ? (proofSnap.windows.has(id) ? 'online' : 'offline')
      : liveness({ ...wt.rec, archived: false, stopped: false }, proofSnap)
    if (proofLv === 'unknown' || proofLv === 'starting') throw new ResourceConflict(`refusing to re-archive ${id}: session liveness is ${proofLv}; exact cold state is unproven`)
    if (proofLv === 'offline') {
      // A deliberately stopped shared control plane is a valid empty resident census. A durable proof plus
      // an adapter-owned root-absent fact is the only idempotent short-circuit; a live root still has to prove
      // the thread's archived/non-archived disk collection before we can claim it is already cold.
      const rootAbsent = await Promise.all((h.sharedRuntimes?.(runtimeRoot()) ?? []).map(async (descriptor) => {
        if (!descriptor.residency) return false
        const state = await descriptor.residency()
        return state.healthy && state.rootAbsent === true && state.referenceIds.length === 0
      })).then((states) => states.some(Boolean))
      if (rootAbsent) return true
      const pre = await h.coldPreflight?.({ ...wt.rec, archived: false, stopped: true })
      if (!pre || pre.ok) {
        const cold = await h.coldRuntime?.({ ...wt.rec, archived: false, stopped: true }, pre?.ok ? pre.receipt : undefined)
        if (!cold || cold.ok) return true
      }
    }
  }
  // Legacy/respawned archives are made visible before repair. Any refusal below therefore leaves an unarchived
  // row instead of relying on a hidden bit while a runtime proof is missing.
  if (wt.rec.archived) {
    writeRecord({ ...wt.rec, archived: false, coldProof: null })
    wt = await findWorktree(id)
    if (!wt) return false
  }

  const snap = await liveSnapshot()
  if (snap.probeFailed) throw new ResourceConflict(`refusing to archive ${id}: liveness probe failed; the leaf may still be live`)
  const lv = h.runtimeOwnership === 'adapter'
    ? 'offline'
    : liveness({ ...wt.rec, archived: false, stopped: false }, snap)
  if (lv === 'unknown' || lv === 'starting')
    throw new ResourceConflict(`refusing to archive ${id}: session liveness is ${lv}; exact leaf ownership is unproven`)
  // The adapter guard runs BEFORE any tmux/process signal. Active/unknown native turns and ambiguous descendant
  // ownership refuse here; a verified adapter receipt carries an exact subtree through to coldRuntime's commit.
  const preflight = await h.coldPreflight?.({ ...wt.rec, archived: false, stopped: lv === 'offline' })
  if (preflight && !preflight.ok) throw new ResourceConflict(`refusing to archive ${id}: ${preflight.reason}`)
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
    if (!latest) throw new ResourceConflict(`refusing to archive ${id}: session record disappeared before filing`)
    const finalSnap = await liveSnapshot()
    if (finalSnap.probeFailed) throw new ResourceConflict(`refusing to archive ${id}: final liveness probe failed; the leaf may still be live`)
    const finalLv = h.runtimeOwnership === 'adapter'
      ? (finalSnap.windows.has(id) ? 'online' : 'offline')
      : liveness({ ...latest, archived: false, stopped: false }, finalSnap)
    if (finalLv === 'unknown' || finalLv === 'starting' || finalLv === 'online')
      throw new ResourceConflict(`refusing to archive ${id}: leaf became ${finalLv} before filing`)
    writeRecord({ ...latest, archived: true, stopped: true, coldProof: coldProofFor(latest) })
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
export const archiveSession = (id: string, on = true): Promise<boolean> => {
  if (!on) return archiveSessionUnarchive(id)
  return withSessionTransition(id, () => withRecordLock(id, () => archiveSessionUnlocked(id, on)))
}
async function archiveSessionUnarchive(id: string): Promise<boolean> {
  const wt = await findWorktree(id)
  if (!wt) return false
  if (!wt.rec.archived) return true
  const resumed = await resumeSession(id)
  if (!resumed.ok) throw new ResourceConflict(resumed.error || `refusing to resume ${id}`)
  return true
}

// @@@ cold retirement - archive already returned the target's runtime, so closing a proven-cold row must not
// re-enter the live stop guard and make unrelated shared-root references prove ownership again. Verify only
// that the target-bound cold proof is still current and that no target PID/window/socket/thread has reappeared.
// This is read-only: no signal, adapter mutation, or shared-root cleanup belongs on the cold path.
async function assertColdRetirementSafe(id: string, rec: SessRec): Promise<void> {
  if (!rec.archived || !rec.stopped || !hasValidColdProof(rec))
    throw new ResourceConflict(`refusing to close archived session ${id}: target-bound cold witness is missing or stale`)
  if (rec.adapterRecovery)
    throw new ResourceConflict(`refusing to close archived session ${id}: adapter recovery is pending (${rec.adapterRecovery})`)

  const [snap, socket] = await Promise.all([liveSnapshot(), rendezvousListening(id)])
  if (snap.probeFailed) throw new ResourceConflict(`refusing to close archived session ${id}: liveness probe failed; target runtime absence is unproven`)
  if (snap.windows.has(id)) throw new ResourceConflict(`refusing to close archived session ${id}: target tmux window has reappeared`)
  if (socket === 'live') throw new ResourceConflict(`refusing to close archived session ${id}: target rendezvous transport has reappeared`)
  if (socket === 'unproven') throw new ResourceConflict(`refusing to close archived session ${id}: target rendezvous state is ambiguous`)
  const pid = readAgentPid(sessionArtifactPath(id, 'agent.pid'))
  if (Number.isFinite(pid) && pid > 0 && processStartToken(pid))
    throw new ResourceConflict(`refusing to close archived session ${id}: target leaf PID ${pid} is live or recycled; ownership is ambiguous`)

  const harness = harnessById(rec.harness || defaultHarness.id)
  if (harness.coldRetirementPreflight) {
    const proof = await harness.coldRetirementPreflight(rec)
    if (!proof.ok) throw new ResourceConflict(`refusing to close archived session ${id}: ${proof.reason}`)
    return
  }
  const descriptors = harness.sharedRuntimes?.(runtimeRoot()) ?? []
  let everySharedRootAbsent = descriptors.length > 0
  for (const descriptor of descriptors) {
    const resident: { healthy: boolean; referenceIds: string[]; error?: string; rootAbsent?: boolean } = descriptor.residency
      ? await descriptor.residency()
      : await descriptor.probe().then((probe) => ({ healthy: probe.healthy, referenceIds: probe.references.map((reference) => reference.referenceId), error: probe.error }))
    if (!resident.healthy)
      throw new ResourceConflict(`refusing to close archived session ${id}: ${resident.error || `${descriptor.label} resident census is unhealthy`}`)
    if (rec.harnessSessionId && resident.referenceIds.includes(rec.harnessSessionId))
      throw new ResourceConflict(`refusing to close archived session ${id}: target adapter thread ${rec.harnessSessionId} is loaded`)
    everySharedRootAbsent = everySharedRootAbsent && resident.rootAbsent === true
  }
  if (harness.coldPreflight && !everySharedRootAbsent) {
    const proof = await harness.coldPreflight(rec)
    if (!proof.ok) throw new ResourceConflict(`refusing to close archived session ${id}: ${proof.reason}`)
    if (!proof.alreadyCold)
      throw new ResourceConflict(`refusing to close archived session ${id}: target adapter collection is not proven cold`)
  }
}

// A never-launched queue owns only prepared disk state. The transition/record locks around close serialize
// this check with startQueued: whichever wins decides whether the record is still a queue or has become live.
// No shared-runtime probe belongs here because a valid prepared row has no adapter thread to look up.
async function assertQueuedRetirementSafe(id: string, rec: SessRec, path: string, branch: string | null): Promise<void> {
  if (rec.status !== 'queued' || rec.harnessSessionId)
    throw new ResourceConflict(`refusing to close queued session ${id}: the record has a target thread or is no longer queued`)
  if (rec.adapterRecovery || launching.has(id))
    throw new ResourceConflict(`refusing to close queued session ${id}: target launch/recovery is already in progress`)

  const [snap, socket] = await Promise.all([liveSnapshot(), rendezvousListening(id)])
  if (snap.probeFailed) throw new ResourceConflict(`refusing to close queued session ${id}: liveness probe failed; target runtime absence is unproven`)
  if (snap.windows.has(id)) throw new ResourceConflict(`refusing to close queued session ${id}: target tmux window already exists`)
  if (socket === 'live') throw new ResourceConflict(`refusing to close queued session ${id}: target rendezvous transport already exists`)
  if (socket === 'unproven') throw new ResourceConflict(`refusing to close queued session ${id}: target rendezvous state is ambiguous`)
  const pidPath = sessionArtifactPath(id, 'agent.pid')
  if (existsSync(pidPath)) {
    const pid = readAgentPid(pidPath)
    throw new ResourceConflict(`refusing to close queued session ${id}: target leaf PID artifact ${Number.isFinite(pid) && pid > 0 ? pid : 'is unreadable'}; never-launched ownership is ambiguous`)
  }

  if (existsSync(path)) {
    const status = await gitTry(['-C', path, 'status', '--porcelain', '--untracked-files=all'])
    if (!status.ok) throw new ResourceConflict(`refusing to close queued session ${id}: prepared worktree status is unreadable`)
    if (status.stdout.trim()) throw new ResourceConflict(`refusing to close queued session ${id}: prepared worktree has dirty work`)
  }
  if (branch) {
    const resolved = await gitTry(['-C', mainRoot(), 'rev-parse', '--verify', `${branch}^{commit}`])
    if (resolved.ok) {
      const count = await gitTry(['-C', mainRoot(), 'rev-list', '--count', `${mainBranch()}..${branch}`])
      if (!count.ok) throw new ResourceConflict(`refusing to close queued session ${id}: prepared branch ancestry is unreadable`)
      const ahead = Number(count.stdout.trim())
      if (!Number.isFinite(ahead) || ahead !== 0)
        throw new ResourceConflict(`refusing to close queued session ${id}: prepared branch is ${Number.isFinite(ahead) ? ahead : 'an unknown number of'} commit(s) ahead`)
    } else if (resolved.failure !== 'exit') {
      throw new ResourceConflict(`refusing to close queued session ${id}: prepared branch identity is unreadable`)
    } else if (existsSync(path)) {
      throw new ResourceConflict(`refusing to close queued session ${id}: prepared worktree exists but branch ${branch} is missing`)
    }
  }
}

async function closeOwnedSessionUnlocked(id: string, wt: { path: string; branch: string | null; rec: SessRec }): Promise<boolean> {
  const root = mainRoot()
  const receiptFailure = publishedSessionCandidateReceiptRetirementFailure(wt.rec, root)
  if (receiptFailure) throw new ResourceConflict(`refusing destructive close for ${id}: ${receiptFailure}; public record and resources remain the authority fence`)
  const closesCodexBinding = (wt.rec.harness === 'codex' || wt.rec.harness === 'codex-headless') && !!wt.rec.harnessSessionId
  if (closesCodexBinding) prepareCodexGenerationClose(runtimeRoot(), id, wt.rec.harnessSessionId!)
  if (wt.rec.archived) await assertColdRetirementSafe(id, wt.rec)
  else if (wt.rec.status === 'queued') await assertQueuedRetirementSafe(id, wt.rec, wt.path, wt.branch)
  else await stopAgentProcess(id, wt.rec)
  let slot: string | null = null
  try { slot = treeSlotDir(wt.path) } catch { /* tree already unresolvable — nothing to key the slot by */ }
  // a retired session's worktree/branch are already gone; removing them is a no-op to skip, not a failure.
  if (existsSync(wt.path)) {
    const removed = await gitTry(['-C', root, 'worktree', 'remove', '--force', wt.path])
    if (!removed.ok) throw new ResourceConflict(`refusing to finish close for ${id}: worktree removal failed`)
    if (existsSync(wt.path)) throw new ResourceConflict(`refusing to finish close for ${id}: worktree remains after removal`)
  }
  if (wt.branch) {
    const branchRef = `refs/heads/${wt.branch}`
    const present = await gitTry(['-C', root, 'rev-parse', '--verify', '--quiet', branchRef])
    if (present.ok) {
      const removed = await gitTry(['-C', root, 'branch', '-D', wt.branch])
      if (!removed.ok) throw new ResourceConflict(`refusing to finish close for ${id}: branch removal failed`)
      const remaining = await gitTry(['-C', root, 'rev-parse', '--verify', '--quiet', branchRef])
      if (remaining.ok || remaining.failure !== 'exit') throw new ResourceConflict(`refusing to finish close for ${id}: branch remains or its removal is unproven`)
    } else if (present.failure !== 'exit') {
      throw new ResourceConflict(`refusing to finish close for ${id}: branch presence is unreadable`)
    }
  }
  if (slot) { try { rmSync(slot, { recursive: true, force: true }) } catch { /* best-effort GC */ } }
  try { rmSync(sessionStoreDir(id), { recursive: true, force: true }) }
  catch (error) { throw new ResourceConflict(`refusing to finish close for ${id}: session record/prompt removal failed (${error instanceof Error ? error.message : String(error)})`) }
  if (existsSync(sessionStoreDir(id))) throw new ResourceConflict(`refusing to finish close for ${id}: session record removal failed`)
  if (closesCodexBinding && wt.rec.harnessSessionId) {
    bindCodexGeneration(runtimeRoot(), id, wt.rec.harnessSessionId, null)
  }
  requestQueueDrain()   // a close frees a slot — start the next queued session if any
  return true
}
async function closeSessionUnlocked(id: string): Promise<boolean> {
  let wt: { path: string; branch: string | null; rec: SessRec } | null = null
  try { wt = await findWorktree(id) }
  catch (e) {
    if (!(e instanceof SessionRecordUnusable) || e.code !== 'corrupt') throw e
    const quarantined = quarantineRecord(id)
    const runtime = sessionStoreDir(id)
    const evidence = quarantined
      ? `Original bytes were copied to ${quarantined}`
      : `Original bytes remain at ${join(runtime, 'session.json')}; no quarantine copy could be made`
    let guard = 'no readable session record proves the adapter or leaf owner'
    try { await stopAgentProcess(id, null) }
    catch (error) { guard = error instanceof Error ? error.message : String(error) }
    throw new SessionRecordUnusable('corrupt', id,
      `refusing destructive close for ${id}: the unreadable record proves no adapter, leaf, worktree, or branch owner (${guard}). ${evidence}. Runtime remains at ${runtime}; worktree and branch ownership is unknown and was not touched; no process signal or deletion was attempted.`)
  }
  if (!wt) return false
  const target = wt
  return target.branch
    ? withRecordLock(sessionCandidateLockId(target.path, target.branch), () => closeOwnedSessionUnlocked(id, target))
    : closeOwnedSessionUnlocked(id, target)
}
export const closeSession = (id: string): Promise<boolean> =>
  withSessionTransition(id, () => withRecordLock(id, () => closeSessionUnlocked(id)))

export type CorruptRecordQuarantineWitness = {
  adapter: string
  thread: string | null
  tmux: string
  worktree: string
  branch: string
}

export type CorruptRecordQuarantineResult = {
  id: string
  bundle: string
  sha256: string
  observedAt: string
}

const quarantineRoot = (id: string) => join(runtimeRoot(), 'corrupt', id)
const recordSha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function normalizeQuarantineWitness(id: string, raw: unknown): CorruptRecordQuarantineWitness {
  if (!raw || typeof raw !== 'object') throw new ResourceConflict(`refusing to quarantine ${id}: an exact adapter/thread/tmux/worktree/branch witness is required`)
  const value = raw as Record<string, unknown>
  const text = (key: keyof CorruptRecordQuarantineWitness): string => typeof value[key] === 'string' ? value[key].trim() : ''
  const adapter = text('adapter')
  const tmux = text('tmux')
  const worktree = text('worktree')
  const branch = text('branch')
  if (!Object.prototype.hasOwnProperty.call(value, 'thread'))
    throw new ResourceConflict(`refusing to quarantine ${id}: thread witness must be explicit (a string or null)`)
  const threadValue = value.thread
  const thread = typeof threadValue === 'string' && threadValue.trim() ? threadValue.trim() : threadValue == null || threadValue === '' ? null : null
  if (!adapter || !HARNESSES.some((h) => h.id === adapter)) throw new ResourceConflict(`refusing to quarantine ${id}: adapter must name one registered harness`)
  if (tmux !== id) throw new ResourceConflict(`refusing to quarantine ${id}: tmux witness must be the exact session id ${id}`)
  if (!worktree || !isAbsolute(worktree)) throw new ResourceConflict(`refusing to quarantine ${id}: worktree witness must be an absolute path`)
  if (!branch || branch.startsWith('-') || branch.startsWith('refs/')) throw new ResourceConflict(`refusing to quarantine ${id}: branch witness must be one local branch name`)
  if (threadValue !== undefined && threadValue !== null && typeof threadValue !== 'string') throw new ResourceConflict(`refusing to quarantine ${id}: thread witness must be a string or null`)
  return { adapter, thread, tmux, worktree: resolve(worktree), branch }
}

async function proveQuarantineTmuxAbsent(id: string): Promise<{ state: 'absent' }> {
  try { await tmux(['has-session', '-t', id], TMUX_PROBE_TIMEOUT_MS) }
  catch (error) {
    if (probeTimedOut(error)) throw new ResourceConflict(`refusing to quarantine ${id}: tmux absence is unknown (probe timed out)`)
    if (typeof (error as NodeJS.ErrnoException).code === 'number') return { state: 'absent' }
    throw new ResourceConflict(`refusing to quarantine ${id}: tmux absence is unknown (${error instanceof Error ? error.message : String(error)})`)
  }
  throw new ResourceConflict(`refusing to quarantine ${id}: exact tmux session ${id} is live`)
}

async function proveQuarantineGitAbsent(id: string, witness: CorruptRecordQuarantineWitness): Promise<{
  worktree: { state: 'absent' }
  branch: { state: 'absent' }
}> {
  if (existsSync(witness.worktree)) throw new ResourceConflict(`refusing to quarantine ${id}: witnessed worktree ${witness.worktree} is live`)
  const root = mainRoot()
  const listed = await gitTry(['-C', root, 'worktree', 'list', '--porcelain'])
  if (!listed.ok) throw new ResourceConflict(`refusing to quarantine ${id}: worktree registry is unknown`)
  const registered = listed.stdout.split('\n').filter((line) => line.startsWith('worktree ')).map((line) => resolve(line.slice('worktree '.length)))
  if (registered.includes(witness.worktree)) throw new ResourceConflict(`refusing to quarantine ${id}: witnessed worktree ${witness.worktree} remains registered`)
  const branch = await gitTry(['-C', root, 'show-ref', '--verify', '--quiet', `refs/heads/${witness.branch}`])
  if (branch.ok) throw new ResourceConflict(`refusing to quarantine ${id}: witnessed branch ${witness.branch} is live`)
  if (branch.failure !== 'exit') throw new ResourceConflict(`refusing to quarantine ${id}: branch absence is unknown`)
  return { worktree: { state: 'absent' }, branch: { state: 'absent' } }
}

function proveQuarantineLeafAbsent(id: string): { state: 'absent'; artifact: 'missing' | `stale:${number}` } {
  const path = sessionArtifactPath(id, 'agent.pid')
  let text: string
  try { text = readFileSync(path, 'utf8').trim() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent', artifact: 'missing' }
    throw new ResourceConflict(`refusing to quarantine ${id}: leaf PID artifact is unreadable`)
  }
  const pid = Number(text)
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new ResourceConflict(`refusing to quarantine ${id}: leaf PID artifact is malformed`)
  const start = processStartToken(pid)
  if (start) throw new ResourceConflict(`refusing to quarantine ${id}: registered agent process ${pid}@${start} is live or recycled`)
  return { state: 'absent', artifact: `stale:${pid}` }
}

async function proveQuarantineAdapter(id: string, witness: CorruptRecordQuarantineWitness): Promise<{
  adapter: string
  thread: string | null
  action: 'absent' | 'archived' | 'already-unloaded'
  compensate: () => Promise<{ ok: true } | { ok: false; reason: string }>
}> {
  const harness = harnessById(witness.adapter)
  if (harness.ownsRendezvous) {
    const socket = await rendezvousListening(id)
    if (socket === 'live') throw new ResourceConflict(`refusing to quarantine ${id}: ${harness.id} rendezvous transport is live`)
    if (socket === 'unproven') throw new ResourceConflict(`refusing to quarantine ${id}: ${harness.id} rendezvous transport absence is unknown`)
  }
  if (witness.thread) {
    if (!harness.quarantineOrphanThread) throw new ResourceConflict(`refusing to quarantine ${id}: ${harness.id} cannot prove and unload an exact native thread`)
    const native = await harness.quarantineOrphanThread(witness.thread, { excludingSessionId: id })
    if (!native.ok) throw new ResourceConflict(`refusing to quarantine ${id}: ${native.reason}`)
    return { adapter: native.audit.adapter, thread: native.audit.threadId, action: native.audit.action, compensate: native.compensate }
  }
  const descriptors = harness.sharedRuntimes?.(runtimeRoot()) ?? []
  for (const descriptor of descriptors) {
    if (!descriptor.residency) throw new ResourceConflict(`refusing to quarantine ${id}: ${descriptor.label} has no exact absence census`)
    let residency: Awaited<ReturnType<NonNullable<typeof descriptor.residency>>>
    try { residency = await descriptor.residency() }
    catch (error) { throw new ResourceConflict(`refusing to quarantine ${id}: ${descriptor.label} absence is unknown (${error instanceof Error ? error.message : String(error)})`) }
    if (!residency.healthy) throw new ResourceConflict(`refusing to quarantine ${id}: ${descriptor.label} absence is unknown (${residency.error || 'unhealthy census'})`)
    if (!residency.rootAbsent || residency.referenceIds.length)
      throw new ResourceConflict(`refusing to quarantine ${id}: ${descriptor.label} is live; supply its exact native thread instead of claiming absence`)
  }
  return { adapter: harness.id, thread: null, action: 'absent', compensate: async () => ({ ok: true }) }
}

export async function quarantineCorruptRecord(id: string, rawWitness: unknown): Promise<CorruptRecordQuarantineResult> {
  return withSessionTransition(id, () => withRecordLock(id, async () => {
    const entry = readRecordEntry(id)
    if (entry.kind === 'absent') throw new ResourceConflict(`refusing to quarantine ${id}: no active session record exists`)
    if (entry.kind === 'ok') throw new ResourceConflict(`refusing to quarantine ${id}: record is readable; use its ordinary lifecycle control`)
    const witness = normalizeQuarantineWitness(id, rawWitness)
    const original = readFileSync(entry.path)
    const sha256 = recordSha256(original)
    const observedAt = new Date().toISOString()
    const leaf = proveQuarantineLeafAbsent(id)
    const tmux = await proveQuarantineTmuxAbsent(id)
    const git = await proveQuarantineGitAbsent(id, witness)
    const adapter = await proveQuarantineAdapter(id, witness)
    const bundle = join(quarantineRoot(id), `${observedAt.replace(/[:.]/g, '-')}-${randomUUID()}`)
    const stored = join(bundle, 'session.json')
    const provenance = join(bundle, 'provenance.json')
    const audit = {
      version: 1,
      sessionId: id,
      observedAt,
      record: { activePath: entry.path, sha256, bytes: original.length },
      witness,
      observed: { leaf, tmux, ...git, adapter: { adapter: adapter.adapter, thread: adapter.thread, action: adapter.action } },
    }
    try {
      mkdirSync(bundle, { recursive: true, mode: 0o700 })
      const temp = `${provenance}.${process.pid}.${randomUUID()}.tmp`
      writeFileSync(temp, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600 })
      renameSync(temp, provenance)
      const current = readRecordEntry(id)
      if (current.kind !== 'corrupt' || current.path !== entry.path) throw new ResourceConflict(`refusing to quarantine ${id}: active record changed during absence verification`)
      const currentBytes = readFileSync(current.path)
      if (recordSha256(currentBytes) !== sha256) throw new ResourceConflict(`refusing to quarantine ${id}: opaque record changed during absence verification`)
      renameSync(current.path, stored)
      if (recordSha256(readFileSync(stored)) !== sha256) {
        renameSync(stored, current.path)
        throw new ResourceConflict(`refusing to quarantine ${id}: moved record failed byte-exact verification`)
      }
    } catch (error) {
      const restored = await adapter.compensate()
      const suffix = restored.ok ? '' : `; native orphan compensation failed: ${restored.reason}`
      if (error instanceof ResourceConflict) throw new ResourceConflict(`${error.message}${suffix}`)
      throw new ResourceConflict(`refusing to quarantine ${id}: ${error instanceof Error ? error.message : String(error)}${suffix}`)
    }
    return { id, bundle, sha256, observedAt }
  }))
}

export async function restoreQuarantinedRecord(id: string): Promise<CorruptRecordQuarantineResult> {
  return withSessionTransition(id, () => withRecordLock(id, async () => {
    if (readRecordEntry(id).kind !== 'absent') throw new ResourceConflict(`refusing to restore ${id}: an active session record already exists`)
    let bundles: string[]
    try { bundles = readdirSync(quarantineRoot(id), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse() }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ResourceConflict(`refusing to restore ${id}: no quarantine bundle exists`)
      throw new ResourceConflict(`refusing to restore ${id}: quarantine bundle inventory is unreadable`)
    }
    const bundle = bundles.map((name) => join(quarantineRoot(id), name)).find((path) => existsSync(join(path, 'session.json')) && existsSync(join(path, 'provenance.json')))
    if (!bundle) throw new ResourceConflict(`refusing to restore ${id}: no complete quarantine bundle exists`)
    const stored = join(bundle, 'session.json')
    let provenance: { sessionId?: unknown; record?: { sha256?: unknown } }
    try { provenance = JSON.parse(readFileSync(join(bundle, 'provenance.json'), 'utf8')) }
    catch { throw new ResourceConflict(`refusing to restore ${id}: quarantine provenance is unreadable`) }
    const bytes = readFileSync(stored)
    if (provenance.sessionId !== id || typeof provenance.record?.sha256 !== 'string' || provenance.record.sha256 !== recordSha256(bytes))
      throw new ResourceConflict(`refusing to restore ${id}: quarantine payload/provenance binding is invalid`)
    const active = sessionRecordPath(id)
    mkdirSync(dirname(active), { recursive: true })
    try { renameSync(stored, active) }
    catch (error) { throw new ResourceConflict(`refusing to restore ${id}: opaque record move failed (${error instanceof Error ? error.message : String(error)})`) }
    if (recordSha256(readFileSync(active)) !== provenance.record.sha256) {
      renameSync(active, stored)
      throw new ResourceConflict(`refusing to restore ${id}: restored record failed byte-exact verification`)
    }
    return { id, bundle, sha256: provenance.record.sha256, observedAt: new Date().toISOString() }
  }))
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
  try { return { ok: true, pane: await tmux(['capture-pane', '-e', '-p', '-t', id]) } }
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
// selector matches a session iff it is the session's full id, an id-PREFIX, its node, its branch, or `.` for
// the caller's own launched session. This is
// the single predicate; selectSessions (MANY) and resolveSession (ONE) both call it, so id-prefix/node/branch
// resolution can never drift between "which sessions ls/watch/wait/graph show" and "which session
// review/merge/send/close act on".
export function matchesSelector(s: Session, q: string, own = ownSessionId(), cwd = process.cwd()): boolean {
  // a selector may be a comma-separated list (the same convention as `--status a,b`): it matches iff ANY part
  // names the session, so `watch a,b` and `watch a b` are equivalent. A single name is the one-part case. This
  // is what stops a comma-joined selector from silently matching nothing — an id/node/branch never holds a
  // comma, so without the split `a,b` would be one literal selector that matches no session and streams in
  // silence forever. Each part sheds an optional reference sigil (stripRefSigil): `@<sel>` / `[[<sel>]]` name
  // the same session as the bare token, so the dashboard's mention grammar is tolerated in every CLI selector.
  const sessionPath = s.path ? resolve(s.path) : null
  const callerPath = resolve(cwd)
  const self = Boolean(own) && s.id === own
    || Boolean(sessionPath) && (callerPath === sessionPath || callerPath.startsWith(`${sessionPath}${sep}`))
  return q.split(',').map((p) => stripRefSigil(p.trim())).filter(Boolean)
    .some((p) => p === '.' ? self : s.id === p || s.id.startsWith(p) || s.node === p || s.branch === p)
}

// no selectors (or '@all') = everything. Optional status filter on top. This IS the ls/watch subscription.
export function selectSessions(all: Session[], selectors: string[], statuses?: string[], own = ownSessionId(), cwd = process.cwd()): Session[] {
  let out = all
  const sel = selectors.filter((x) => x && x !== '@all')
  if (sel.length) out = out.filter((s) => sel.some((q) => matchesSelector(s, q, own, cwd)))
  if (statuses && statuses.length) out = out.filter((s) => statuses.includes(s.status))
  return out
}

// @@@ resolveSession - resolve ONE selector to ONE session against a board: the single-target counterpart of
// selectSessions, for the control verbs (review/send/merge/close/resume/show). The backend matches
// ids EXACTLY, so a verb resolves the selector here first and then calls with the FULL id — a node/branch/
// prefix selector drives a verb just as it filters `ls`. The result is DISCRIMINATED so a caller can fail
// precisely: an exact full-id hit wins outright (never reported ambiguous just for prefixing a longer id);
// otherwise a lone match is `ok`, several is `ambiguous` (a prefix/node hitting many), none is `none`.
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

// human-friendly aligned table: header + (glyph + colour + status + name + id + merges + note) rows +
// a status legend, so the table tells the whole story (incl. each agent's note) at a glance.
export function formatTable(sessions: Session[], color = true): string {
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  if (!sessions.length) return c('90', '  no living sessions')
  const header = c('90', `    ${'STATUS'.padEnd(13)} ${'NODE'.padEnd(22)} ${'ID'.padEnd(8)} ${'\u00d7'.padEnd(4)}${'PROMPT'.padEnd(42)}NOTE`)
  const rows = sessions.map((s) => {
    const g = STATUS_GLYPH[s.status] ?? '\u00b7'
    const code = ANSI[s.status] ?? '0'
    const name = padWidth(truncWidth(sessionLabel(s), 22), 22)
    const st = s.status.padEnd(13)
    const merges = (s.merges ? `\u00d7${s.merges}` : '').padEnd(4)
    const prompt = c('90', padWidth(s.promptPreview ? trunc(s.promptPreview, 40) : '', 42))   // what it was asked to do
    const note = s.note ? c('90', trunc(s.note, NOTE_BOARD_LIMIT)) : ''
    return `  ${c(code, g)} ${c(code, st)} ${name} ${c('90', s.id.slice(0, 8))} ${merges}${prompt}${note}`
  })
  return [c('1', `SpexCode sessions (${sessions.length})`), header, ...rows, statusLegend(color)].join('\n')
}

// @@@ sendText - THE APPEND IS THE DELIVERY ([[dispatch]]). The message lands in the target's durable log
// under its record lock, and success is decided there; only then is the harness adapter poked with the same
// text, so a live agent sees it in its current turn instead of at its next turn boundary. The poke is
// best-effort — losing it, having it refused, or replaying it costs nothing, because the line is already the
// message's copy and the turn-boundary reader picks up whatever the poke did not show. What stays LOUD is only
// what genuinely cannot be recorded: an unknown session id, or a log that refuses the write.
// A RETIRED session (worktree gone) still receives: the record gate governs the lifecycle axis, and a message
// that cannot reach an agent must at least leave a trace ([[session-timeline]]).
// (The separate RAW nav-key channel keeps its own `tmux send-keys` path — see rawKey.)
export async function sendText(id: string, text: string, from?: string, opts: { replyVia?: 'note' } = {}): Promise<DispatchResult> {
  if (!text) return { ok: false, error: 'empty prompt — nothing to dispatch' }
  const rec = readRecord(id)
  if (!rec) return { ok: false, error: `no session record for ${id} — prompt NOT delivered` }
  const prompt = await composeSessionPrompt(text, rec, { from, replyVia: opts.replyVia })
  let sent: { mid: string }
  try {
    // The lock covers the append alone. Codex's native turn can synchronously run hooks that write this same
    // record, so holding it across the adapter poke below would deadlock the app-server's confirmation.
    sent = await withRecordLock(id, async () => appendSent(id, text, from ?? null, prompt.replyVia))
  } catch (error) {
    return { ok: false, error: `could not append the message to session ${id}'s log: ${error instanceof Error ? error.message : String(error)} — prompt NOT delivered` }
  }
  const h = harnessById(rec.harness || defaultHarness.id)
  // Awaited, not fire-and-forget: `spex session send` is a short-lived process that would exit before an
  // unawaited poke ever reached the socket, costing every CLI send its same-turn arrival. Its result never
  // advances the inbox: a write cannot prove the target parsed it, so only the target's reader consumes the
  // durable line.
  await pokeAdapter(h, rec, prompt.text, sent.mid)
  return { ok: true }
}

// The courtesy kick. Carries `mid` as the adapter's native message marker, so an adapter that replays or
// duplicates it stays harmless. Never throws and never reports: a poke has no outcome the caller can act on.
async function pokeAdapter(h: Harness, rec: SessRec, text: string, mid: string): Promise<void> {
  // the pane guard ([[harness-adapter]] deliveryBlockedBy): the ONE pane state where the harness swallows a
  // prompt its channel confirms (claude's sessions panel), checkable only from the pane. It no longer refuses
  // the send — the message is already delivered — it only skips a kick known to be swallowed.
  if (h.deliveryBlockedBy) {
    try {
      if (h.deliveryBlockedBy(await tmux(['capture-pane', '-p', '-t', rec.session], TMUX_PROBE_TIMEOUT_MS))) return
    } catch { /* no pane to consult — let the poke itself decide */ }
  }
  try { await h.deliver({ ...rec, runtimeDir: runtimeRoot(), mid }, text) }
  catch { /* the unread timeline line remains the delivery */ }
}

// Hard interrupt is adapter-native control, distinct from stop's process teardown. A harness without a
// confirmed native primitive refuses loudly; there is no signal/PTY fallback that could target the wrong turn.
export async function interruptSession(id: string): Promise<DispatchResult> {
  return withRecordLock(id, async () => {
    const rec = readRecord(id)
    if (!rec) return { ok: false, error: `no session record for ${id} - nothing to interrupt` }
    const h = harnessById(rec.harness || defaultHarness.id)
    if (!h.interrupt) return { ok: false, error: `harness ${h.id} has no native hard-interrupt control` }
    return h.interrupt({ ...rec, runtimeDir: runtimeRoot() })
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
export async function rawKey(id: string, key: string | string[]): Promise<boolean> {
  return withRecordLock(id, async () => {
    const list = (Array.isArray(key) ? key : [key]).filter((k) => typeof k === 'string' && k.length > 0)
    if (list.length === 0 || !(await alive(id))) return false
    let sent = false
    for (const k of list) {
      const args = rawKeyArgs(id, k)
      if (!args) continue
      await tmux(args); sent = true
    }
    return sent
  })
}
