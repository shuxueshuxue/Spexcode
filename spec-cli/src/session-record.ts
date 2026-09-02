import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, isAbsolute, resolve } from 'node:path'
import { mainRoot, runtimeRoot, sessionStoreDir, sessionRecordPath, sessionArtifactPath, rawLaunchReadinessOriginal, readRecordEntry, readAliasedRecordEntry, processStartToken, isSessionLifecycle, isSessionProposal, type RawRecord, type SessionLifecycle, type SessionProposal, type ProcessIdentity } from '@spexcode/spec-core'
import { jsonMigrationFencePath } from '@spexcode/session-application'
import { configuredSessionApplication, sessionApplicationCutoverState } from './session-application.js'
import { withSessionRecordLock, withSessionRecordLockSync as coreWithSessionRecordLockSync } from './session-record-lock.js'
import { defaultHarness, HARNESSES, harnessById, rendezvousListening } from './harness.js'
import { gitTry } from '@spexcode/spec-core'
import { ResourceConflict } from './host-resources.js'
import { sessionHost, probeTimedOut, TMUX_PROBE_TIMEOUT_MS } from './session-host.js'

type Lifecycle = SessionLifecycle
type Proposal = SessionProposal
let scheduleWatchNotifications: (target: SessRec) => void = () => {}
let withSessionTransition: <T>(id: string, body: () => Promise<T>) => Promise<T> = (_id, body) => body()

export type SessRec = {
  session: string; governed: boolean; worktreePath: string; branch: string | null
  title: string | null; name: string | null
  parent: string | null   // the spawning session's id ([[session-nesting]]); null for a top-level launch
  status: Lifecycle; proposal: Proposal | null; merges: number; note: string | null
  sortKey: number | null; createdAt: number; harness: string; harnessSessionId: string | null; runtimeStartToken: string | null
  stopped: boolean       // explicit human stop; liveness metadata, never an agent-authored lifecycle value
  archived: boolean      // closed by the human ([[archive]]) — only clean after coldProof is written
  closedAt: string | null // written atomically with archived:true; old archived records read as null
  coldProof?: string | null // durable exact leaf + adapter unload proof; missing on legacy archives => visible hazard
  adapterRecovery?: string | null // explicit adapter recovery state after an uncertain partial cold mutation
  launcher: string | null   // the launcher profile this session launches under ([[launcher-select]]); null only for old records predating launchers
  launchCmd: string | null  // the RESOLVED base launcher command pinned at creation ([[launcher-select]] resume-launcher-pin); null → old record → fall back to the launcher name / ambient
  launchConfigDir?: string | null // the launcher's DECLARED agent config dir pinned at creation ([[launcher-select]]) — where this conversation's native thread lives; null/absent → resolve the launcher name live, else the harness default root
  launchOwner: string | null // stable public-backend authority while queued; null for active/legacy records
  launchReadinessStartedAt?: number | null // durable bounded readiness window for queued launches
  createRequestId?: string | null // digest of the public Idempotency-Key; binds retry without storing the bearer
  createPayloadHash?: string | null // exact normalized create payload bound to createRequestId
  zcodeChildSessionIds?: string[] // persistent exact ZCode child ids; never inferred from title, path, branch, or timing
  base?: string | null   // explicit fork point the creator pinned; absent/null = the auto-detected source-of-truth branch
  forkCommit?: string | null // the commit the branch was actually created at; absent on records written before it, recovered from the branch reflog
  diffComments?: DiffComment[]
  launchReadinessPending?: LaunchReadinessPending | null // internal resume candidate; every public reader projects `original` until one final publish
}
export type DiffComment = {
  id: string; filePath: string; lineStart: number; lineEnd: number; body: string
  diffIdentity: string; sentAt: string | null
}
type LaunchReadinessOriginal = Pick<SessRec, 'status' | 'proposal' | 'note' | 'stopped' | 'archived' | 'closedAt' | 'coldProof' | 'adapterRecovery'>
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

export function canDrainQueued(rec: Pick<SessRec, 'status' | 'launchOwner' | 'stopped'>, authority = backendLaunchAuthority()): boolean {
  return rec.status === 'queued' && !rec.stopped && (rec.launchOwner === null || rec.launchOwner === authority)
}

// typed read of a session's record from the global store (null if it has none — a self-launched session that
// only ever wrote spec-discipline sentinels has a store dir but no runtime.json). Goes through layout's
// readAliasedRawRecord (the seam that owns the path + the codex-thread-id alias), then validates the loose
// on-disk fields into the typed shape — so a codex hook resolving by its thread id reaches the real record.
export function readRecord(id: string): SessRec | null {
  const entry = readAliasedRecordEntry(id)
  if (entry.kind === 'absent') {
    // A migrated session may retain its canonical application row after an envelope was removed or never
    // materialized. Lifecycle hooks must still reach that row; do not turn missing runtime metadata into a
    // silent "not governed" result. The minimal projection deliberately carries no guessed resource identity.
    const application = configuredSessionApplication()
    const state = application.readState(id)
    if (!state) return null
    return {
      session: id,
      governed: true,
      worktreePath: '', branch: null, title: null, name: null, parent: state.parentSessionId,
      status: state.status as SessionLifecycle,
      proposal: isSessionProposal(state.proposal) ? state.proposal : null,
      merges: 0, note: state.note, sortKey: null, createdAt: state.updatedAtMs,
      harness: 'claude', harnessSessionId: null, runtimeStartToken: null,
      stopped: false, archived: false, closedAt: null, coldProof: null, adapterRecovery: null,
      launcher: null, launchCmd: null, launchConfigDir: null, launchOwner: null, launchReadinessStartedAt: null,
      createRequestId: null, createPayloadHash: null, zcodeChildSessionIds: [], base: null,
      diffComments: [], launchReadinessPending: null,
    }
  }
  if (entry.kind === 'corrupt') throw new SessionRecordUnusable('corrupt', id, corruptReason(entry))
  try {
    const record = fromRaw(entry.raw)
    // After cutover, runtime.json is only the runtime/worktree envelope. Lifecycle is owned by the
    // session application. Overlaying here keeps every internal caller on the same fact instead of
    // letting a stale JSON snapshot steer a launch, close, or hook decision.
    const application = configuredSessionApplication()
    if (!record.governed) return record
    const state = application.readState(record.session)
    if (!state) throw new ResourceConflict(`session ${record.session} has no canonical application state after JSON cutover`)
    return {
      ...record,
      status: state.status as SessionLifecycle,
      proposal: isSessionProposal(state.proposal) ? state.proposal : null,
      note: state.note,
      parent: state.parentSessionId,
    }
  }
  catch (error) {
    if (error instanceof ResourceConflict) throw error
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
export const corruptReason = (e: { path: string; error: string }): string =>
  `session record is unreadable: ${e.path} — ${e.error}. The file is kept as-is; nothing will rewrite it. A close attempt quarantines the bytes and reports the preserved runtime/worktree/branch residue, but cannot signal or delete without an exact owner.`
export function retirementReason(rec: SessRec): string | null {
  if (!rec.worktreePath || existsSync(rec.worktreePath)) return null
  if (rec.archived)
    return `session ${rec.session.slice(0, 8)} is closed and read-only: its worktree ${rec.worktreePath} no longer exists`
  return `session ${rec.session.slice(0, 8)} is retired: its worktree ${rec.worktreePath} no longer exists, so it cannot work, be marked active/idle, or be relaunched`
}
export function readLiveRecord(id: string): SessRec | null {
  const rec = readRecord(id)
  if (!rec) return null
  const retired = retirementReason(rec)
  if (retired) throw new SessionRecordUnusable('retired', rec.session, retired)
  return rec
}

export const withRecordLock = withSessionRecordLock
export function withSessionRecordLockSync<T>(id: string, body: () => T): T {
  return coreWithSessionRecordLockSync(id, body)
}
export const withRecordLockSync = withSessionRecordLockSync

const COLD_PROOF_VERSION = 'cold-v1'
export function coldProofFor(rec: Pick<SessRec, 'session' | 'harness' | 'harnessSessionId'>): string {
  const adapter = harnessById(rec.harness || defaultHarness.id).id
  const exact = rec.harnessSessionId ? `thread:${rec.harnessSessionId}` : 'no-resident-ref'
  return `${COLD_PROOF_VERSION}|${adapter}|${rec.session}|${exact}`
}
export function hasValidColdProof(rec: SessRec): boolean {
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
  if (raw.closed_at != null && raw.closed_at !== ''
    && (typeof raw.closed_at !== 'string' || !Number.isFinite(Date.parse(raw.closed_at))))
    throw new Error(`session '${raw.session_id}' has invalid closed_at`)
  if (pendingRaw?.proposal && !pendingProposal) throw new Error(`session '${raw.session_id}' launch readiness original has invalid proposal '${pendingRaw.proposal}'`)
  const zcodeChildSessionIds = raw.zcode_child_session_ids ?? []
  if (!Array.isArray(zcodeChildSessionIds)
    || zcodeChildSessionIds.some((id) => typeof id !== 'string' || !id || id.trim() !== id)
    || new Set(zcodeChildSessionIds).size !== zcodeChildSessionIds.length)
    throw new Error(`session '${raw.session_id}' has invalid zcode_child_session_ids`)
  const diffComments = (raw as RawRecord & { diff_comments?: Array<{ id: string; file_path: string; line_start: number; line_end: number; body: string; diff_identity: string; sent_at: string | null }> }).diff_comments ?? []
  if (!Array.isArray(diffComments) || diffComments.some((comment) => !comment || typeof comment !== 'object'))
    throw new Error(`session '${raw.session_id}' has invalid diff_comments`)
  const parsedDiffComments = diffComments.map((comment) => {
    const c = comment as NonNullable<typeof diffComments>[number]
    if (!c.id || typeof c.id !== 'string' || typeof c.file_path !== 'string' || !c.file_path
      || !Number.isInteger(c.line_start) || c.line_start < 1 || !Number.isInteger(c.line_end) || c.line_end < c.line_start
      || typeof c.body !== 'string' || !c.body.trim() || typeof c.diff_identity !== 'string'
      || !(c.sent_at === null || typeof c.sent_at === 'string')) throw new Error(`session '${raw.session_id}' has invalid diff comment`)
    return { id: c.id, filePath: c.file_path, lineStart: c.line_start, lineEnd: c.line_end, body: c.body, diffIdentity: c.diff_identity, sentAt: c.sent_at }
  })
  return {
    session: raw.session_id, governed: !!raw.governed, worktreePath: raw.worktree_path || '', branch: raw.branch || null,
    title: raw.title || null, name: raw.name || null, parent: raw.parent || null,
    status, proposal, merges: Number(raw.merges) || 0,
    note: raw.note || null, sortKey, createdAt: Number(raw.createdAt) || 0,
    harness: raw.harness || 'claude',   // records written before the harness field default to claude
    harnessSessionId: raw.harness_session_id || null,
    runtimeStartToken: raw.runtime_start_token || null,
    stopped: !!raw.stopped,             // records written before explicit stop tracking were not stopped
    archived: !!raw.archived,           // records written before close retention → absent → working
    closedAt: typeof raw.closed_at === 'string' && raw.closed_at ? raw.closed_at : null,
    coldProof: raw.cold_proof || null,  // legacy archived rows have no proof and remain visible until re-archived
    adapterRecovery: raw.adapter_recovery || null,
    launcher: raw.launcher || null,     // records written before launchers → null → old-record fallback
    launchCmd: raw.launch_cmd || null,  // records written before the pin → null → fall back to launcher name / ambient
    launchConfigDir: raw.launch_config_dir || null, // records written before the field → null → resolve launcher name live
    launchOwner: launchOwner || null,
    launchReadinessStartedAt: Number.isFinite(Number((raw as RawRecord & { launch_readiness_started_at?: unknown }).launch_readiness_started_at))
      ? Number((raw as RawRecord & { launch_readiness_started_at?: unknown }).launch_readiness_started_at) : null,
    createRequestId: raw.create_request_id || null,
    createPayloadHash: raw.create_payload_hash || null,
    zcodeChildSessionIds: [...zcodeChildSessionIds],
    base: raw.base || null,             // records written before pinned bases → null → the source-of-truth branch
    forkCommit: (raw as RawRecord & { fork_commit?: unknown }).fork_commit as string || null, // records written before the fork commit → null → recovered from the branch reflog
    diffComments: parsedDiffComments,
    launchReadinessPending: pendingRaw ? {
      version: 1,
      startedAt: (raw.launch_readiness_pending as { startedAt: number }).startedAt,
      original: {
        status: pendingStatus!, proposal: pendingProposal, note: pendingRaw.note || null,
        stopped: pendingRaw.stopped, archived: pendingRaw.archived,
        closedAt: pendingRaw.closed_at || null,
        coldProof: pendingRaw.cold_proof || null, adapterRecovery: pendingRaw.adapter_recovery || null,
      },
    } : null,
  }
}

export function publicRecord(rec: SessRec): SessRec {
  const original = rec.launchReadinessPending?.original
  return original ? { ...rec, ...original } : rec
}

export function launchReadinessPending(original: SessRec): LaunchReadinessPending {
  return {
    version: 1,
    startedAt: Date.now(),
    original: {
      status: original.status,
      proposal: original.proposal,
      note: original.note,
      stopped: original.stopped,
      archived: original.archived,
      closedAt: original.closedAt,
      coldProof: original.coldProof ?? null,
      adapterRecovery: original.adapterRecovery ?? null,
    },
  }
}

export function restoreLaunchReadinessOriginal(rec: SessRec): SessRec {
  const original = rec.launchReadinessPending?.original
  return original ? { ...rec, ...original, launchReadinessPending: null } : rec
}
// Rebuild the full disk projection so retired keys disappear on the next write.
export function assertLegacyJsonWritesAllowed(): void {
  const fence = jsonMigrationFencePath(join(runtimeRoot(), 'sessions'))
  if (existsSync(fence) && sessionApplicationCutoverState() === 'fenced') {
    throw new ResourceConflict(`legacy JSON session store is fenced for one-time migration: ${fence}`)
  }
}

export function writeRecord(rec: SessRec): void {
  assertLegacyJsonWritesAllowed()
  const application = configuredSessionApplication()
  // The JSON file is runtime/worktree metadata after cutover, not a lifecycle store. Once the canonical row
  // exists, omit the four old lifecycle keys entirely; retaining them would leave a second apparent fact for
  // readers and tempt a future path to trust the wrong writer. New records still need the legacy shape until
  // their canonical row is created, and non-governed external runtime records keep their own contract.
  const envelope = rec.governed ? readAliasedRecordEntry(rec.session) : null
  const canonicalMetadataOnly = envelope?.kind === 'ok' && rec.governed
  const lifecycle = { status: rawLifecycleStatus(rec), proposal: rec.proposal, note: rec.note, parent: rec.parent }
  // A queued legacy envelope may still carry its lease until this metadata rewrite. The lease is an
  // operational launch claim, not a lifecycle fact, so preserve only that field while the typed record clears it.
  const envelopeLaunchOwner = envelope?.kind === 'ok'
    ? (envelope.raw as RawRecord & { launch_owner?: string }).launch_owner?.trim() || null
    : null
  let previous: SessRec | null = null
  try { previous = readRecord(rec.session) } catch { /* a new or damaged record has no prior transition */ }
  const metadataChanged = !previous || [
    'governed', 'worktreePath', 'branch', 'title', 'name', 'merges', 'sortKey', 'createdAt',
    'harness', 'harnessSessionId', 'runtimeStartToken', 'stopped', 'archived', 'closedAt', 'coldProof',
    'adapterRecovery', 'launcher', 'launchCmd', 'launchConfigDir', 'launchOwner', 'launchReadinessStartedAt', 'createRequestId',
    'createPayloadHash', 'zcodeChildSessionIds', 'base', 'forkCommit', 'diffComments', 'launchReadinessPending',
  ].some((key) => JSON.stringify((previous as unknown as Record<string, unknown>)[key]) !== JSON.stringify((rec as unknown as Record<string, unknown>)[key]))
  // Once a canonical row exists, a lifecycle-only write is already complete when the application transition
  // commits. Rewriting runtime.json here would recreate a second, stale status/proposal/note authority.
  if (canonicalMetadataOnly && previous && !metadataChanged) return
  const obj = {
    session_id: rec.session,
    governed: rec.governed,
    worktree_path: rec.worktreePath,
    branch: rec.branch ?? '',
    title: rec.title ?? '',
    name: rec.name ?? '',
    merges: rec.merges,
    sortkey: rec.sortKey ?? '',
    createdAt: rec.createdAt,
    harness: rec.harness || 'claude',
    harness_session_id: rec.harnessSessionId ?? '',
    stopped: rec.stopped,
    archived: rec.archived,
    // Pre-field records stay byte-shape compatible until a real close publishes the timestamp. In particular,
    // a failed resume must be able to restore an old working record without inventing an empty metadata key.
    ...(rec.closedAt ? { closed_at: rec.closedAt } : {}),
    cold_proof: rec.coldProof ?? '',
    adapter_recovery: rec.adapterRecovery ?? '',
    launcher: rec.launcher ?? '',
    launch_cmd: rec.launchCmd ?? '',
    // Written only when the launcher declared one: an undeclared record keeps its exact legacy bytes (the
    // same conditional shape as `base`/`fork_commit` below).
    ...(rec.launchConfigDir ? { launch_config_dir: rec.launchConfigDir } : {}),
    launch_owner: (lifecycle.status === 'queued' || lifecycle.status === OWNED_QUEUE_RAW_STATUS)
      ? rec.launchOwner ?? envelopeLaunchOwner ?? '' : '',
    ...(rec.launchReadinessStartedAt ? { launch_readiness_started_at: rec.launchReadinessStartedAt } : {}),
    ...(rec.runtimeStartToken ? { runtime_start_token: rec.runtimeStartToken } : {}),
    create_request_id: rec.createRequestId ?? '',
    create_payload_hash: rec.createPayloadHash ?? '',
    ...(rec.zcodeChildSessionIds?.length ? { zcode_child_session_ids: rec.zcodeChildSessionIds } : {}),
    // Written only when the creator pinned one: an unpinned record keeps its exact legacy bytes, so a
    // restore-the-frozen-record path stays byte-identical instead of silently gaining a key.
    ...(rec.base ? { base: rec.base } : {}),
    // The commit `git worktree add` actually started from, written on every create since it was introduced.
    // Conditional like `base` above, so a record written before it keeps its exact legacy bytes.
    ...(rec.forkCommit ? { fork_commit: rec.forkCommit } : {}),
    ...((rec.diffComments ?? []).length ? { diff_comments: (rec.diffComments ?? []).map((comment) => ({
      id: comment.id, file_path: comment.filePath, line_start: comment.lineStart, line_end: comment.lineEnd,
      body: comment.body, diff_identity: comment.diffIdentity, sent_at: comment.sentAt,
    })) } : {}),
    launch_readiness_pending: rec.launchReadinessPending ? {
      version: 1,
      startedAt: rec.launchReadinessPending.startedAt,
      original: {
        status: rec.launchReadinessPending.original.status,
        proposal: rec.launchReadinessPending.original.proposal ?? '',
        note: rec.launchReadinessPending.original.note ?? '',
        stopped: rec.launchReadinessPending.original.stopped,
        archived: rec.launchReadinessPending.original.archived,
        closed_at: rec.launchReadinessPending.original.closedAt,
        cold_proof: rec.launchReadinessPending.original.coldProof ?? '',
        adapter_recovery: rec.launchReadinessPending.original.adapterRecovery ?? '',
      },
    } : '',
    ...(canonicalMetadataOnly ? {} : {
      parent: lifecycle.parent ?? '',
      status: lifecycle.status,
      proposal: lifecycle.proposal ?? '',
      note: lifecycle.note ?? '',
    }),
  }
  const dir = sessionStoreDir(rec.session)
  mkdirSync(dir, { recursive: true })
  const path = sessionRecordPath(rec.session)
  const tmp = join(dir, `.runtime.json.${process.pid}.tmp`)
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n')
  renameSync(tmp, path)   // atomic within the dir: a concurrent reader sees the old record or the new one
}

export type CorruptRecordQuarantineWitness = {
  adapter: string
  thread: string | null
  // Legacy CLI calls this field `tmux`; on process-host it carries the exact `{pid,startToken}` identity.
  tmux: string | ProcessIdentity
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
  const rawHost = value.tmux
  const tmux = typeof rawHost === 'string' ? rawHost.trim() : rawHost && typeof rawHost === 'object' && !Array.isArray(rawHost)
    ? (() => {
      const identity = rawHost as Record<string, unknown>
      if (!Number.isSafeInteger(identity.pid) || (identity.pid as number) <= 0 || typeof identity.startToken !== 'string' || !identity.startToken)
        throw new ResourceConflict(`refusing to quarantine ${id}: process host witness must be {pid,startToken}`)
      return { pid: identity.pid as number, startToken: identity.startToken } satisfies ProcessIdentity
    })()
    : ''
  const worktree = text('worktree')
  const branch = text('branch')
  if (!Object.prototype.hasOwnProperty.call(value, 'thread'))
    throw new ResourceConflict(`refusing to quarantine ${id}: thread witness must be explicit (a string or null)`)
  const threadValue = value.thread
  const thread = typeof threadValue === 'string' && threadValue.trim() ? threadValue.trim() : threadValue == null || threadValue === '' ? null : null
  if (!adapter || !HARNESSES.some((h) => h.id === adapter)) throw new ResourceConflict(`refusing to quarantine ${id}: adapter must name one registered harness`)
  const expectedWitness = sessionHost().witness(id)
  if (typeof expectedWitness === 'string') {
    if (tmux !== expectedWitness) throw new ResourceConflict(`refusing to quarantine ${id}: host witness must be the exact session id ${id}`)
  } else if (!expectedWitness || !tmux || typeof tmux === 'string' || tmux.pid !== expectedWitness.pid || tmux.startToken !== expectedWitness.startToken) {
    throw new ResourceConflict(`refusing to quarantine ${id}: process host witness must match the recorded pid and start token`)
  }
  if (!worktree || !isAbsolute(worktree)) throw new ResourceConflict(`refusing to quarantine ${id}: worktree witness must be an absolute path`)
  if (!branch || branch.startsWith('-') || branch.startsWith('refs/')) throw new ResourceConflict(`refusing to quarantine ${id}: branch witness must be one local branch name`)
  if (threadValue !== undefined && threadValue !== null && typeof threadValue !== 'string') throw new ResourceConflict(`refusing to quarantine ${id}: thread witness must be a string or null`)
  return { adapter, thread, tmux, worktree: resolve(worktree), branch }
}

async function proveQuarantineTmuxAbsent(id: string, witness: CorruptRecordQuarantineWitness): Promise<{ state: 'absent' }> {
  if (typeof witness.tmux !== 'string') {
    const live = processStartToken(witness.tmux.pid)
    if (live === witness.tmux.startToken) throw new ResourceConflict(`refusing to quarantine ${id}: recorded process ${witness.tmux.pid}@${witness.tmux.startToken} is live`)
    return { state: 'absent' }
  }
  try { await sessionHost().alive(id, TMUX_PROBE_TIMEOUT_MS) }
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
    if (!harness.quarantineOrphanThread) throw new ResourceConflict(`refusing to quarantine ${id}: ${harness.id} has no archivable native thread; omit --thread (a SpexCode session id is not an adapter thread)`)
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
    const tmux = await proveQuarantineTmuxAbsent(id, witness)
    const git = await proveQuarantineGitAbsent(id, witness)
    const adapter = await proveQuarantineAdapter(id, witness)
    const bundle = join(quarantineRoot(id), `${observedAt.replace(/[:.]/g, '-')}-${randomUUID()}`)
    const stored = join(bundle, 'runtime.json')
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
    const bundle = bundles.map((name) => join(quarantineRoot(id), name)).find((path) => existsSync(join(path, 'runtime.json')) && existsSync(join(path, 'provenance.json')))
    if (!bundle) throw new ResourceConflict(`refusing to restore ${id}: no complete quarantine bundle exists`)
    const stored = join(bundle, 'runtime.json')
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

export function setRecordTransitionNotifier(fn: (target: SessRec) => void): void { scheduleWatchNotifications = fn }
export function setRecordTransitionWrapper(fn: <T>(id: string, body: () => Promise<T>) => Promise<T>): void { withSessionTransition = fn }
