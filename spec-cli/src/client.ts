import { apiBase, assertProjectMatch, resolveSession, type Session, type Resolved, type DispatchResult, type ReviewPayload } from './sessions.js'

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'BackendError'   // sessions.ts's isBackendDown matches on this name (no runtime import cycle)
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

// GET /api/sessions — the board, used by `spex session ls`, and by `spex session watch`/`wait` as their poll source.
export async function clientListSessions(): Promise<Session[]> {
  const r = await apiFetch('/api/sessions')
  if (!r.ok) throw new BackendError(`backend error ${r.status} listing sessions`, r.status)
  return await r.json() as Session[]
}

// resolve a selector (full id, id-prefix, node, or branch) against the live board, then call with the full id.
export async function resolveClientSession(selector: string): Promise<Resolved> {
  return resolveSession(selector, await clientListSessions())
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
  throw new BackendError(`session eval pages changed while reading ${id}; retry the command`)
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
