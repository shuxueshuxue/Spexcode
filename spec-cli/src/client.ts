// @@@ client - the CLI as a thin BACKEND CLIENT. The read/control session commands (ls, watch, wait,
// capture, send, review, merge, reopen, close, prompt) do NOT touch tmux/git in the CLI's own process: they
// call the running backend over HTTP. So there is exactly ONE actor on the tmux socket — the backend — and
// pointing SPEXCODE_API_URL at a REMOTE backend monitors a remote machine's sessions with no code change.
//
// The split is deliberate and is the whole point of the refactor:
//   - state PRODUCERS (`session done|ask|block|idle` + the lifecycle hooks) stay LOCAL — they write the cwd
//     worktree's `.session`, which is HOW the backend learns state; routing them through a live backend would
//     be fragile (an agent must be able to declare its own state even with no backend up — see the state node).
//   - launch (`spex new`) keeps its own already-spec'd POST-then-in-process path: it needs the backend's auth
//     env, and degrades loudly with a warning (see the launch node). It is out of this client's scope.
//
// ONE availability rule, stated once, for everything here: FAIL LOUD. Unlike sessions.ts's `postJSON` (a
// best-effort telemetry POST that swallows a down backend), every call here treats an unreachable backend as
// EXCEPTIONAL — it throws BackendError. It NEVER silently falls back to a local in-process path, because that
// is exactly what would re-create the dual-actor-on-tmux hazard this refactor removes. HTTP error *statuses*
// (404/409/502) are returned as data, not thrown, so a caller keeps "I failed to read" distinct from "empty".
import { apiBase, type Session, type DispatchResult, type ReviewPayload } from './sessions.js'

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'BackendError'   // sessions.ts's isBackendDown matches on this name (no runtime import cycle)
  }
}

// the ONE seam where "no backend" becomes loud. A network failure (nothing listening at apiBase) is the only
// thing thrown; an HTTP Response of any status is returned for the caller to interpret.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${apiBase()}${path}`, init)
  } catch (e) {
    throw new BackendError(`no backend reachable at ${apiBase()} — run \`spex serve\` there, or set SPEXCODE_API_URL (${(e as Error).message})`)
  }
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const seg = (id: string) => encodeURIComponent(id)

// GET /api/sessions — the board, used by `spex ls`, and by `spex watch`/`wait` as their poll source.
export async function clientListSessions(): Promise<Session[]> {
  const r = await apiFetch('/api/sessions')
  if (!r.ok) throw new BackendError(`backend error ${r.status} listing sessions`, r.status)
  return await r.json() as Session[]
}

// GET /api/sessions/:id/capture — the live pane as text. The discriminated result keeps the three failure
// modes (404 unknown / 409 offline / 502 capture-failed) distinct from a legitimately empty pane (200, '').
export type CaptureResult = { ok: true; pane: string } | { ok: false; status: number; reason: string }
export async function clientCapture(id: string): Promise<CaptureResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/capture`)
  if (r.ok) return { ok: true, pane: await r.text() }
  return { ok: false, status: r.status, reason: (await r.text().catch(() => '')) || `status ${r.status}` }
}

// POST /api/sessions/:id/keys — prompt dispatch (the backend routes it through the rendezvous socket,
// socket-only + fail-loud; a non-accepted prompt comes back ok:false / HTTP 502).
export async function clientSend(id: string, text: string): Promise<DispatchResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/keys`, post({ text }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` })) as DispatchResult
}

// GET /api/sessions/:id/review — the manager cockpit review bundle (null on 404).
export async function clientReview(id: string): Promise<ReviewPayload | null> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/review`)
  if (r.status === 404) return null
  if (!r.ok) throw new BackendError(`backend error ${r.status} reviewing ${id}`, r.status)
  return await r.json() as ReviewPayload
}

// POST /api/sessions/:id/merge — the cockpit's merge DISPATCH (200 {dispatched:true} / 409 {reason}).
export async function clientMerge(id: string): Promise<{ dispatched: boolean; reason?: string }> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/merge`, post({}))
  return await r.json().catch(() => ({ dispatched: false, reason: `bad backend response (${r.status})` }))
}

// POST /api/sessions/:id/resume — relaunch/back-to-working. {ok:false} = no such session.
export async function clientReopen(id: string): Promise<boolean> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/resume`, post({}))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/close — the human-only worktree removal. {ok:false} = no such session.
export async function clientClose(id: string): Promise<boolean> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/close`, post({}))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// GET /api/sessions/:id/prompt — the session's originating prompt (404 if none recorded).
export type PromptResult = { ok: true; prompt: string } | { ok: false; status: number }
export async function clientPrompt(id: string): Promise<PromptResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/prompt`)
  if (r.ok) return { ok: true, prompt: await r.text() }
  return { ok: false, status: r.status }
}
