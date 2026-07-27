import { apiBase, assertProjectMatch, resolveSession, type Session, type Resolved, type DispatchResult, type ReviewPayload } from './sessions.js'
import { readSync, writeSync } from 'node:fs'
import { maintenanceBrokerDescriptors, type Capability, type LeaseOwner, type MaintenanceState } from './session-maintenance.js'
import { processStartToken } from './process-identity.js'

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'BackendError'   // sessions.ts's isBackendDown matches on this name (no runtime import cycle)
  }
}

// the ONE seam where "no backend" becomes loud. A network failure (nothing listening at the resolved base)
// is the only thing thrown; an HTTP Response of any status is returned for the caller to interpret.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  if (maintenanceBrokerDescriptors() && init?.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()))
    throw new BackendError('maintenance_capability_missing: the operator broker admits only its exact stop/resume plan')
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
type BrokerRequest = { op: string; sessionId?: string; force?: boolean }
type BrokerOutcome = 'committed' | 'refused' | 'indeterminate'
type BrokerResponse = { ok: boolean; outcome?: BrokerOutcome; status?: number; body?: any; code?: string; error?: string }
function brokerRequest(request: BrokerRequest): BrokerResponse | null {
  const fds = maintenanceBrokerDescriptors()
  if (!fds) return null
  const startToken = processStartToken(process.pid)
  if (!startToken) throw new BackendError(`maintenance broker cannot identify client PID ${process.pid}`)
  const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const frame = `${JSON.stringify({ v: 1, id, ...request, client: { pid: process.pid, startToken } })}\n`
  if (Buffer.byteLength(frame) > 4_096) throw new BackendError('maintenance broker request exceeded PIPE_BUF')
  const token = Buffer.alloc(1)
  let ownsTurn = false
  try {
    if (readSync(fds.turn, token, 0, 1, null) !== 1 || token[0] !== 1)
      throw new BackendError('maintenance broker turn token was unavailable or invalid')
    ownsTurn = true
    if (writeSync(fds.request, frame) !== Buffer.byteLength(frame)) throw new BackendError('maintenance broker request write was incomplete')
    let line = ''
    const byte = Buffer.alloc(1)
    while (!line.endsWith('\n')) {
      const count = readSync(fds.response, byte, 0, 1, null)
      if (count === 0) throw new BackendError('maintenance broker closed before replying')
      line += byte.toString('utf8', 0, count)
      if (line.length > 64 * 1024) throw new BackendError('maintenance broker response exceeded its bound')
    }
    const response = JSON.parse(line) as BrokerResponse & { id?: string }
    if (response.id !== id) throw new BackendError('maintenance broker response identity mismatch')
    return response
  } finally {
    if (ownsTurn) {
      try { writeSync(fds.turn, token) } catch { /* broker shutdown owns the failure */ }
    }
  }
}
const brokerMutation = (request: BrokerRequest): BrokerResponse | null => brokerRequest(request)

export type MaintenanceLeaseResponse = { token: string; epoch: number; state: 'draining' | 'active'; owner: LeaseOwner; capabilities?: Capability[] }
export async function clientMaintenanceAcquire(capabilities: Capability[], ttlMs: number, waitMs: number): Promise<{ status: number; lease: MaintenanceLeaseResponse }> {
  await guarded('session maintain')
  const r = await apiFetch('/api/session-maintenance/acquire', post({ capabilities, ttlMs, waitMs }))
  const lease = await r.json().catch(() => ({})) as MaintenanceLeaseResponse & { error?: string }
  if (r.status !== 201 && r.status !== 202) throw new BackendError(`backend refused maintenance acquire (${r.status}): ${lease.error || 'invalid response'}`, r.status)
  return { status: r.status, lease }
}
export async function clientMaintenanceStatus(): Promise<MaintenanceState> {
  const r = await apiFetch('/api/session-maintenance')
  if (!r.ok) throw new BackendError(`backend refused maintenance status (${r.status})`, r.status)
  return await r.json() as MaintenanceState
}
const maintenanceHeaders = (token: string): Record<string, string> => ({
  'content-type': 'application/json',
  'x-spexcode-session-maintenance': token,
})
export async function clientMaintenanceHeartbeat(token: string, epoch: number, ttlMs: number): Promise<MaintenanceState> {
  const r = await apiFetch('/api/session-maintenance/heartbeat', { method: 'POST', headers: maintenanceHeaders(token), body: JSON.stringify({ epoch, ttlMs }) })
  if (!r.ok) throw new BackendError(`backend refused maintenance heartbeat (${r.status}): ${await r.text()}`, r.status)
  return await r.json() as MaintenanceState
}
export async function clientMaintenanceRelease(token: string, epoch: number): Promise<void> {
  const r = await apiFetch('/api/session-maintenance/release', { method: 'POST', headers: maintenanceHeaders(token), body: JSON.stringify({ epoch }) })
  if (!r.ok) throw new BackendError(`backend refused maintenance release (${r.status}): ${await r.text()}`, r.status)
}
export async function clientMaintenanceOperation(
  token: string,
  request: { op: 'stop' | 'resume'; sessionId: string; force?: boolean },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<BrokerResponse> {
  const path = `/api/sessions/${seg(request.sessionId)}/${request.op}`
  const controller = new AbortController()
  const abort = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) abort()
  else options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('maintenance operation timed out')), options.timeoutMs ?? 5_000)
  timer.unref()
  try {
    const r = await apiFetch(path, {
      method: 'POST', headers: maintenanceHeaders(token), signal: controller.signal,
      body: JSON.stringify(request.op === 'resume' ? { force: request.force === true } : {}),
    })
    let body: any
    try { body = await r.json() } catch {
      return { ok: false, outcome: 'indeterminate', status: r.status, code: 'maintenance_response_malformed', error: 'maintenance operation returned malformed JSON' }
    }
    const committed = r.ok && body?.ok === true
    const refused = (r.status >= 400 && r.status < 500 && (body?.ok === false || typeof body?.code === 'string'))
      || (r.ok && body?.ok === false && body?.refused === true)
    const outcome: BrokerOutcome = committed ? 'committed' : refused ? 'refused' : 'indeterminate'
    const code = typeof body?.code === 'string' ? body.code
      : refused ? 'session_operation_refused'
        : committed ? undefined : 'maintenance_operation_indeterminate'
    return {
      ok: committed,
      outcome,
      status: r.status,
      body,
      ...(code ? { code } : {}),
      ...(!committed ? { error: body?.error || `status ${r.status}` } : {}),
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
  }
}

// GET /api/sessions — the board, used by `spex session ls`, and by `spex session watch`/`wait` as their poll source.
export async function clientListSessions(includeArchived = false): Promise<Session[]> {
  const r = await apiFetch(includeArchived ? '/api/sessions?all=1' : '/api/sessions')
  if (!r.ok) throw new BackendError(`backend error ${r.status} listing sessions`, r.status)
  return await r.json() as Session[]
}

export async function clientResources(): Promise<import('./host-resources.js').ResourceReport> {
  const r = await apiFetch('/api/resources')
  if (!r.ok) throw new BackendError(`backend error ${r.status} loading resources: ${await r.text()}`, r.status)
  return await r.json() as import('./host-resources.js').ResourceReport
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

// POST /api/sessions/:id/input {kind:"text"} — prompt dispatch (the backend routes it through the rendezvous
// socket, socket-only + fail-loud; a non-accepted prompt comes back ok:false / HTTP 502).
export async function clientSend(id: string, text: string, from?: string): Promise<DispatchResult> {
  await guarded('session send')
  const brokered = brokerMutation({ op: 'send', sessionId: id })
  if (brokered) return brokered.ok ? brokered.body as DispatchResult : { ok: false, error: brokered.code || brokered.error || 'maintenance_active' }
  // `from` = the sending agent's own session id; the backend logs the comms edge ([[comms-edge]]) only when
  // it's present (an agent send), so a human-shell send stays unrecorded.
  const r = await apiFetch(`/api/sessions/${seg(id)}/input`, post({ kind: 'text', text, ...(from ? { from } : {}) }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` })) as DispatchResult
}

// GET /api/sessions/:id/review — the manager cockpit review bundle (null on 404).
export async function clientReview(id: string): Promise<ReviewPayload | null> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/review`)
  if (r.status === 404) return null
  if (!r.ok) throw new BackendError(`backend error ${r.status} reviewing ${id}`, r.status)
  return await r.json() as ReviewPayload
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
  const brokered = brokerMutation({ op: 'resume', sessionId: id, force })
  if (brokered) {
    if (!brokered.ok) throw new BackendError(brokered.code || brokered.error || 'maintenance_active', brokered.status)
    return brokered.body
  }
  const r = await apiFetch(`/api/sessions/${seg(id)}/resume`, post({ force }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` }))
}

// POST /api/sessions/:id/stop — the soft stop: kill tmux + socket, KEEP the worktree (session goes offline,
// resumable). Distinct from close. {ok:false} = no such session.
export async function clientStop(id: string): Promise<boolean> {
  await guarded('session stop')
  const brokered = brokerMutation({ op: 'stop', sessionId: id })
  if (brokered) {
    if (!brokered.ok) throw new BackendError(brokered.code || brokered.error || 'maintenance_active', brokered.status)
    return !!brokered.body?.ok
  }
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
  const r = await apiFetch(`/api/sessions/${seg(id)}`)
  if (r.ok) return { ok: true, session: await r.json() as Session & { prompt: string | null } }
  return { ok: false, status: r.status }
}
