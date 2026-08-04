import { apiBaseInfo, reparentSessionRecords, type SessionReparentResult } from './sessions.js'
import { BackendError, backendConnectionRefused, clientReparent } from './client.js'

export class SessionReparentRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SessionReparentRequestError'
  }
}

export function parseReparentRequest(body: unknown): { children: string[]; parent: string } {
  if (!body || typeof body !== 'object') throw new SessionReparentRequestError('reparent body must be JSON')
  const raw = body as { children?: unknown; parent?: unknown }
  if (!Array.isArray(raw.children) || !raw.children.length || raw.children.some((id) => typeof id !== 'string' || !id.trim()))
    throw new SessionReparentRequestError('reparent children must be one or more session ids')
  if (typeof raw.parent !== 'string' || !raw.parent.trim()) throw new SessionReparentRequestError('reparent parent must be a session id')
  return { children: raw.children.map((id) => id.trim()), parent: raw.parent.trim() }
}

export async function reparentRequest(body: unknown): Promise<SessionReparentResult> {
  const request = parseReparentRequest(body)
  return reparentSessionRecords(request.children, request.parent)
}

export async function reparentSessions(children: string[], parent: string): Promise<SessionReparentResult> {
  try {
    return await clientReparent(children, parent)
  } catch (error) {
    if (!(error instanceof BackendError) || (await apiBaseInfo()).source === 'flag' || !backendConnectionRefused(error)) throw error
    console.error('spex: no backend reachable — reparenting in-process under the session record locks')
    return reparentSessionRecords(children, parent)
  }
}
