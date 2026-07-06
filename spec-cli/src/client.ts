import { apiBase, resolveSession, type Session, type Resolved, type DispatchResult, type ReviewPayload } from './sessions.js'

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

// POST /api/sessions/:id/keys — prompt dispatch (the backend routes it through the rendezvous socket,
// socket-only + fail-loud; a non-accepted prompt comes back ok:false / HTTP 502).
export async function clientSend(id: string, text: string, from?: string): Promise<DispatchResult> {
  // `from` = the sending agent's own session id; the backend logs the comms edge ([[comms-edge]]) only when
  // it's present (an agent send), so a human-shell send stays unrecorded.
  const r = await apiFetch(`/api/sessions/${seg(id)}/keys`, post({ text, ...(from ? { from } : {}) }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` })) as DispatchResult
}

// GET /api/sessions/:id/review — the manager cockpit review bundle (null on 404).
export async function clientReview(id: string): Promise<ReviewPayload | null> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/review`)
  if (r.status === 404) return null
  if (!r.ok) throw new BackendError(`backend error ${r.status} reviewing ${id}`, r.status)
  return await r.json() as ReviewPayload
}

// GET /api/sessions/:id/proof — the rendered review PROOF ([[review-proof]]): the self-contained HTML the
// backend builds (default), or the model JSON (`json:true` → ?format=json). The engine runs on the backend,
// so the CLI is a thin fetcher that writes/opens these bytes — works against a remote backend unchanged.
// 404 → no such session.
export type ProofResult = { ok: true; body: string } | { ok: false; status: number }
export async function clientProof(id: string, json = false): Promise<ProofResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/proof${json ? '?format=json' : ''}`)
  if (r.ok) return { ok: true, body: await r.text() }
  return { ok: false, status: r.status }
}

// POST /api/sessions/:id/merge — the cockpit's merge DISPATCH (200 {dispatched:true} / 409 {reason}).
export async function clientMerge(id: string): Promise<{ dispatched: boolean; reason?: string }> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/merge`, post({}))
  return await r.json().catch(() => ({ dispatched: false, reason: `bad backend response (${r.status})` }))
}

// POST /api/sessions/:id/resume — bring the agent back (relaunch ONLY if confirmed offline); demotes
// working→idle, keeps any declaration. The RESUME GUARD REFUSES (409 {refused:true}) on a live/unproven agent;
// `force` overrides for a wedged-but-alive process. {ok:false} otherwise = no such session (404).
export async function clientReopen(id: string, force = false): Promise<{ ok: boolean; error?: string; refused?: boolean }> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/resume`, post({ force }))
  return await r.json().catch(() => ({ ok: false, error: `bad backend response (${r.status})` }))
}

// POST /api/sessions/:id/exit — the soft stop: kill tmux + socket, KEEP the worktree (session goes offline,
// resumable). Distinct from close. {ok:false} = no such session.
export async function clientExit(id: string): Promise<boolean> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/exit`, post({}))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/close — the human-only worktree removal. {ok:false} = no such session.
export async function clientClose(id: string): Promise<boolean> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/close`, post({}))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/rename — set (or clear, with a blank) the session's display-name override
// ([[session-rename]] as a CLI verb). {ok:false} = no such session (404).
export async function clientRename(id: string, name: string): Promise<boolean> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/rename`, post({ name }))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// POST /api/sessions/:id/rawkey — the raw nav-key channel (tmux send-keys, NEVER the prompt socket): an
// ordered token batch drives an interactive TUI menu ([[nav-mode-key-ordering]]). {ok:false} = unknown
// session, no live pane, or no valid token delivered.
export async function clientRawkey(id: string, keys: string[]): Promise<boolean> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/rawkey`, post({ keys }))
  return !!(await r.json().catch(() => ({ ok: false })))?.ok
}

// GET /api/sessions/:id/prompt — the session's originating prompt (404 if none recorded).
export type PromptResult = { ok: true; prompt: string } | { ok: false; status: number }
export async function clientPrompt(id: string): Promise<PromptResult> {
  const r = await apiFetch(`/api/sessions/${seg(id)}/prompt`)
  if (r.ok) return { ok: true, prompt: await r.text() }
  return { ok: false, status: r.status }
}
