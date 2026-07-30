import { existsSync } from 'node:fs'
import { platform } from 'node:os'
import { repoRoot } from './git.js'
import { resourceBudgets, type ResourceReport } from './host-resources.js'
import { listSessionIds, readPublicRecordEntry } from './layout.js'
import { cockpitReview, type CockpitReview } from './cockpit.js'
import { apiBase, apiBaseInfo, assertProjectMatch, fromRaw, resolveSession, toSession, type DisplayStatus, type Session, type Resolved, type DispatchResult, type ReviewPayload } from './sessions.js'

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'BackendError'   // cli.ts's top-level handler matches on the NAME, so it needs no import of this class
  }
}

// the ONE seam where "no backend" becomes loud. A network failure (nothing listening at the resolved base)
// is the only thing thrown; an HTTP Response of any status is returned for the caller to interpret.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = await apiBase()
  try {
    return await fetch(`${base}${path}`, init)
  } catch (e) {
    throw new BackendError(`no backend reachable at ${base} — run \`spex serve\` in the project, or name one with --api <url> (${(e as Error).message})`)
  }
}
// every MUTATING verb is project-bound ([[remote-client]]'s write guard): resolve the backend, compare its
// served root to the cwd project, refuse loudly on a same-host mismatch — an explicit --api/--port skips it.
// Reads stay unguarded (viewer-points-anywhere). Guarding HERE (not per cli.ts branch) covers every caller.
const guarded = (verb: string) => assertProjectMatch(`spex ${verb}`)
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const seg = (id: string) => encodeURIComponent(id)

// A rendezvous liveness probe can displace the real delivery client.
function cachedStatus(rec: ReturnType<typeof fromRaw>): DisplayStatus {
  if (!rec.worktreePath || !existsSync(rec.worktreePath)) return 'retired'
  if (rec.archived) return 'offline'
  if (rec.status === 'awaiting') return rec.proposal === 'merge' ? 'review' : rec.proposal === 'close' ? 'close-pending' : 'done'
  return rec.status === 'active' || rec.status === 'idle' ? 'unknown' : rec.status
}

function corruptCachedSession(id: string, reason: string): Session {
  const label = `${id.slice(0, 8)} (unreadable record)`
  return {
    id, node: null, branch: null, path: '', label, headline: label, raw: { name: null, title: null },
    parent: null, harness: 'unknown', capabilities: { headless: false }, launcher: null,
    lifecycle: 'active', proposal: null, merges: 0, status: 'corrupt', liveness: 'unknown',
    note: `session record is unreadable: ${reason}`, archived: false, archiveHazard: null,
    prompt: null, promptPreview: null, created: 0, activity: null, sortKey: null,
  }
}

// Also the board a FOLLOW resolves its selectors against ([[session-follow]]): following must work with no
// `spex serve` running, and asking a backend for the board would cost exactly the tmux/rendezvous probes the
// follow exists to eliminate. Every field here comes from the store — nothing is probed.
export function localCachedSessions(includeArchived = false): Session[] {
  const rows: Session[] = []
  for (const id of listSessionIds()) {
    const entry = readPublicRecordEntry(id)
    if (entry.kind === 'corrupt') {
      rows.push(corruptCachedSession(id, entry.error))
      continue
    }
    if (entry.kind !== 'ok') continue
    const rec = fromRaw(entry.raw)
    if (!rec.governed) continue
    rows.push(toSession(rec, cachedStatus(rec), 'unknown'))
  }
  return rows.filter((session) => includeArchived || !session.archived)
    .sort((a, b) => (a.sortKey ?? a.created) - (b.sortKey ?? b.created) || a.id.localeCompare(b.id))
}

function localCachedResources(): ResourceReport {
  const projectRoot = repoRoot()
  const budgets = resourceBudgets(projectRoot)
  const owners = localCachedSessions(true).map((session) => ({
    kind: 'session' as const,
    id: session.id,
    label: session.label,
    status: session.lifecycle,
    liveness: 'unknown' as const,
    proposal: session.proposal,
    note: session.note,
    worktreePath: session.path,
    branch: session.branch,
    archived: session.archived,
    processes: [],
    rssMiB: 0,
    pssMiB: null,
    cpuPercent: 0,
    budget: { rssMiB: budgets.sessionRssMiB, idleCpuPercent: budgets.idleCpuPercent },
    findings: ['local-store-only: runtime liveness and process measurements are unavailable'],
    reclaim: { eligible: false, reason: 'local store read cannot prove runtime ownership or liveness' },
  }))
  return {
    version: 1,
    measuredAt: new Date().toISOString(),
    projectRoot,
    platform: platform(),
    available: false,
    unavailableReason: 'backend unavailable; local session store has no runtime resource measurements',
    host: { memoryTotalMiB: null, memoryUsedMiB: null, memoryAvailableMiB: null, swapTotalMiB: null, swapUsedMiB: null, cpuPercent: null },
    budgets,
    owners,
    totals: { rssMiB: 0, pssMiB: null, cpuPercent: 0 },
    findings: owners.reduce((total, owner) => total + owner.findings.length, 0),
  }
}

async function cachedRead<T>(remote: () => Promise<T>, local: () => T | Promise<T>): Promise<T> {
  try {
    return await remote()
  } catch (error) {
    if (!(error instanceof BackendError) || error.status !== undefined || (await apiBaseInfo()).source === 'flag') throw error
    console.error('spex session: backend unreachable; source: local session store (liveness unknown)')
    return await local()
  }
}

// GET /api/sessions — the board, used by `spex session ls`, and by `spex session watch`/`wait` as their poll source.
export async function clientListSessions(includeArchived = false): Promise<Session[]> {
  return cachedRead(async () => {
    const r = await apiFetch(includeArchived ? '/api/sessions?all=1' : '/api/sessions')
    if (!r.ok) throw new BackendError(`backend error ${r.status} listing sessions`, r.status)
    return await r.json() as Session[]
  }, () => localCachedSessions(includeArchived))
}

export async function clientResources(): Promise<import('./host-resources.js').ResourceReport> {
  return cachedRead(async () => {
    const r = await apiFetch('/api/resources')
    if (!r.ok) throw new BackendError(`backend error ${r.status} loading resources: ${await r.text()}`, r.status)
    return await r.json() as import('./host-resources.js').ResourceReport
  }, localCachedResources)
}

// resolve a selector (full id, id-prefix, node, or branch) against the live board, then call with the full id.
export async function resolveClientSession(selector: string, includeArchived = true): Promise<Resolved> {
  return resolveSession(selector, await clientListSessions(includeArchived))
}

// GET /api/sessions/:id/capture — the live pane as text. The discriminated result keeps the three failure
// modes (404 unknown / 409 offline / 502 capture-failed) distinct from a legitimately empty pane (200, '').
export type CaptureResult = { ok: true; pane: string } | { ok: false; status: number; reason: string }
export async function clientCapture(id: string): Promise<CaptureResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/capture`)
  if (r.ok) return { ok: true, pane: await r.text() }
  return { ok: false, status: r.status, reason: (await r.text().catch(() => '')) || `status ${r.status}` }
}

// POST /api/sessions/:id/input {kind:"text"} appends the prompt to the durable timeline, then best-effort
// pokes the resolved adapter. HTTP failure means the append itself was refused.
export async function clientSend(id: string, text: string, from?: string): Promise<DispatchResult> {
  await guarded('session send')
  // `from` = the sending agent's own session id; the recipient's log records the sender ([[session-timeline]]) only when
  // it's present (an agent send), so a human-shell send stays unrecorded.
  const r = await apiFetch(`/api/sessions/${seg(id)}/input`, post({ kind: 'text', text, ...(from ? { from } : {}) }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` })) as DispatchResult
}

// GET /api/sessions/:id/review — the manager cockpit review bundle (null on 404).
export async function clientReview(id: string): Promise<CockpitReview | null> {
  return cachedRead(async () => {
    const r = await apiFetch(`/api/sessions/${seg(id)}/review`)
    if (r.status === 404) return null
    if (!r.ok) throw new BackendError(`backend error ${r.status} reviewing ${id}`, r.status)
    return await r.json() as CockpitReview
  }, () => cockpitReview(id))
}

// GET /api/sessions/:id/evals?format=html — the rendered EXPORT artifact ([[session-eval]]): the
// self-contained HTML the backend builds. The engine runs on the backend, so the CLI is a thin fetcher
// that writes/opens these bytes — works against a remote backend unchanged. 404 → no such session.
export type ExportResult = { ok: true; body: string } | { ok: false; status: number }
export async function clientEvalExport(id: string): Promise<ExportResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/evals?format=html`)
  if (r.ok) return { ok: true, body: await r.text() }
  return { ok: false, status: r.status }
}

// The CLI's explicit aggregate walks the same 25-row pages as the dashboard. No server response contains
// the full session model; aggregation exists only for this one-shot terminal rendering.
type SessionEvalPage = {
  items: any[]
  page: number
  pageCount: number
  total: number
  gates: any[]
  unknown: number
  revision: string
  summary?: any
  evalRevision?: any
}
export type EvalsResult = { ok: true; model: SessionEvalPage & { id: string } } | { ok: false; status: number }
export async function clientEvals(id: string): Promise<EvalsResult> {
  const q = encodeURIComponent(`is:eval scope:${id}`)
  for (let attempt = 0; attempt < 2; attempt++) {
    const items: any[] = []
    let first: SessionEvalPage | null = null
    let changed = false
    for (let page = 1;; page++) {
      const r = await apiFetch(`/api/evals?q=${q}&page=${page}`)
      if (!r.ok) return { ok: false, status: r.status }
      const current = await r.json() as SessionEvalPage
      first ??= current
      if (current.revision !== first.revision) { changed = true; break }
      items.push(...current.items)
      if (page >= current.pageCount) break
    }
    if (!changed) return { ok: true, model: { ...first!, id, items } }
  }
  throw new BackendError(`session eval pages changed while fetching ${id}; retry the command`)
}

// POST /api/sessions/:id/merge — the cockpit's merge DISPATCH (200 {dispatched:true} / 409 {reason}).
export async function clientMerge(id: string): Promise<{ dispatched: boolean; reason?: string }> {
  await guarded('merge')
  const r = await apiFetch(`/api/sessions/${seg(id)}/merge`, post({}))
  return await r.json().catch(() => ({ dispatched: false, reason: `bad backend response (${r.status})` }))
}

// POST /api/sessions/:id/resume — bring the agent back (relaunch ONLY if confirmed offline); demotes
// working→idle, keeps any declaration. The RESUME GUARD REFUSES (409 {refused:true}) on a live/unproven agent;
// `force` overrides for a wedged-but-alive process. {ok:false} otherwise = no such session (404). `info`
// carries a non-error advisory.
export async function clientResume(id: string, force = false): Promise<{ ok: boolean; error?: string; refused?: boolean; info?: string }> {
  await guarded('session resume')
  const r = await apiFetch(`/api/sessions/${seg(id)}/resume`, post({ force }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` }))
}

// POST /api/sessions/:id/stop — the soft stop: kill tmux + socket, KEEP the worktree (session goes offline,
// resumable). Distinct from close. {ok:false} = no such session.
export async function clientStop(id: string): Promise<boolean> {
  await guarded('session stop')
  const r = await apiFetch(`/api/sessions/${seg(id)}/stop`, post({}))
  if (!r.ok) throw new BackendError(`backend refused to stop ${id}: ${await r.text()}`, r.status)
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/interrupt - native hard interrupt of the current turn. Unsupported harnesses and
// unreachable control planes return the backend's loud DispatchResult; no signal/raw-key fallback exists.
export async function clientInterrupt(id: string): Promise<DispatchResult> {
  await guarded('session interrupt')
  const r = await apiFetch(`/api/sessions/${seg(id)}/interrupt`, post({}))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` })) as DispatchResult
}

// POST /api/sessions/:id/close — the human-only worktree removal. {ok:false} = no such session.
export async function clientClose(id: string): Promise<boolean> {
  await guarded('session close')
  const r = await apiFetch(`/api/sessions/${seg(id)}/close`, post({}))
  if (!r.ok) throw new BackendError(`backend refused to close ${id}: ${await r.text()}`, r.status)
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

export async function clientQuarantine(
  id: string,
  witness: { adapter: string; thread: string | null; tmux: string; worktree: string; branch: string },
): Promise<{ id: string; bundle: string; sha256: string; observedAt: string }> {
  await guarded('session quarantine')
  const r = await apiFetch(`/api/sessions/${seg(id)}/quarantine`, post(witness))
  if (!r.ok) throw new BackendError(`backend refused to quarantine ${id}: ${await r.text()}`, r.status)
  const body = await r.json() as { ok?: boolean; id?: string; bundle?: string; sha256?: string; observedAt?: string }
  if (!body.ok || !body.id || !body.bundle || !body.sha256 || !body.observedAt) throw new BackendError(`backend returned an invalid quarantine result for ${id}`, r.status)
  return { id: body.id, bundle: body.bundle, sha256: body.sha256, observedAt: body.observedAt }
}

export async function clientRestoreQuarantine(id: string): Promise<{ id: string; bundle: string; sha256: string; observedAt: string }> {
  await guarded('session quarantine')
  const r = await apiFetch(`/api/sessions/${seg(id)}/quarantine/restore`, post({}))
  if (!r.ok) throw new BackendError(`backend refused to restore ${id}: ${await r.text()}`, r.status)
  const body = await r.json() as { ok?: boolean; id?: string; bundle?: string; sha256?: string; observedAt?: string }
  if (!body.ok || !body.id || !body.bundle || !body.sha256 || !body.observedAt) throw new BackendError(`backend returned an invalid quarantine restore for ${id}`, r.status)
  return { id: body.id, bundle: body.bundle, sha256: body.sha256, observedAt: body.observedAt }
}

// POST /api/sessions/:id/archive — cold-archive the session ([[archive]]). The legacy on=false spelling is a
// signpost to the same resume transition; it never performs a record-only unarchive.
export async function clientArchive(id: string, on = true): Promise<boolean> {
  await guarded(on ? 'session archive' : 'session unarchive')
  const r = await apiFetch(`/api/sessions/${seg(id)}/archive`, post({ on }))
  if (!r.ok) throw new BackendError(`backend refused to ${on ? 'archive' : 'unarchive'} ${id}: ${await r.text()}`, r.status)
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/rename — set (or clear, with a blank) the session's display-name override
// ([[session-rename]] as a CLI verb). {ok:false} = no such session (404).
export async function clientRename(id: string, name: string): Promise<boolean> {
  await guarded('session rename')
  const r = await apiFetch(`/api/sessions/${seg(id)}/rename`, post({ name }))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/input {kind:"keys"} — the LAST-RESORT raw nav-key face of send (tmux send-keys,
// NEVER the prompt socket): an ordered token batch drives an interactive TUI menu
// ([[nav-mode-key-ordering]]). {ok:false} = unknown session, no live pane, or no valid token delivered.
export async function clientSendRawKeys(id: string, keys: string[]): Promise<boolean> {
  await guarded('session send')
  const r = await apiFetch(`/api/sessions/${seg(id)}/input`, post({ kind: 'keys', keys }))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// GET /api/sessions/:id — the session RECORD detail (`spex session show`): the board row plus the full
// originating prompt. 404 → no such session.
export type ShowResult = { ok: true; session: Session & { prompt: string | null } } | { ok: false; status: number }
export async function clientShow(id: string): Promise<ShowResult> {
  return cachedRead(async () => {
    const r = await apiFetch(`/api/sessions/${seg(id)}`)
    if (r.ok) return { ok: true, session: await r.json() as Session & { prompt: string | null } }
    return { ok: false, status: r.status }
  }, () => {
    const session = localCachedSessions(true).find((item) => item.id === id)
    return session ? { ok: true, session } : { ok: false, status: 404 }
  })
}
