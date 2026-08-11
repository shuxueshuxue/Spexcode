// @@@ mentions - the shared in-text grammar: `[[node]]` and `@session` are references;
// the exact @new token is the durable worker-creation action. Its dispatcher stays here
// so every composer reaches the same creation owner after its own write has committed.
const SESSION_RE = /(?:^|\s)@([\p{L}\p{N}_-]+(?::[\p{L}\p{N}_.-]+)?)/gu
const NODE_RE = /\[\[([^\]\s]+)\]\]/g

const uniq = (xs: string[]): string[] => [...new Set(xs)]

// In free text a sigil separates a reference from prose. A CLI argument is already a
// reference, so it tolerates either sigil without widening its normal matching grammar.
export function stripRefSigil(token: string): string {
  const wrapped = /^\[\[(.*)\]\]$/.exec(token)
  if (wrapped) return wrapped[1]
  return token.startsWith('@') ? token.slice(1) : token
}

export function parseMentions(text: string): { sessions: string[]; nodes: string[] } {
  const sessions: string[] = []
  const nodes: string[] = []
  for (const m of text.matchAll(SESSION_RE)) sessions.push(m[1])
  for (const m of text.matchAll(NODE_RE)) nodes.push(m[1])
  return { sessions: uniq(sessions), nodes: uniq(nodes) }
}

export type DispatchOutcome = { token: string; result: 'spawned' | 'failed'; detail?: string; note?: string }
export type NewDispatchContext =
  | { threadId: string; node: string | null; author: string; status?: string | null }
  | { sessionId: string }

export function spawnParent(author: string, sessions: { id: string }[]): string | null {
  return sessions.some((session) => session.id === author) ? author : null
}

export function newWorkerPrompt(threadId: string, node: string | null, author: string, text: string, status?: string | null): string {
  const scope = node ? ` on node [[${node}]]` : ''
  const settled = status && status !== 'open'
    ? `NOTE: this thread is already resolved (status: ${status}). Verify main first; if it already satisfies the thread, report that finding instead of re-implementing.\n\n`
    : ''
  return `Issue thread "${threadId}"${scope} @-mentioned @new (by ${author}) for a fresh look:\n\n  ${text.trim()}\n\n` +
    settled +
    `Read the thread (\`spex issue ls --all\`, find ${threadId}) and act on it${node ? `; the relevant node is ${node}` : ''}.`
}

export function commandWorkerPrompt(sessionId: string, text: string): string {
  return `Session "${sessionId}" opened a child worker from its Command Box:\n\n${text.trim()}`
}

// Writes call this only after their durable append/commit succeeds. @session deliberately remains absent:
// sending to an existing session is still the explicit `spex session send` operation.
export async function dispatchNewMentions(text: string, ctx: NewDispatchContext): Promise<DispatchOutcome[]> {
  const tokens = parseMentions(text).sessions
  const requested = tokens.flatMap((token) => {
    const match = /^new(?::([\p{L}\p{N}_.-]+))?$/u.exec(token)
    return match ? [{ token, launcher: match[1] }] : []
  })
  if (!requested.length) return []

  const { listSessions, sessionCreateRequest } = await import('./sessions.js')
  const sessions = await listSessions()
  const command = 'sessionId' in ctx
  const author = command ? ctx.sessionId : ctx.author
  const outcomes: DispatchOutcome[] = []
  for (const request of requested) {
    const settled = !command && ctx.status && ctx.status !== 'open' ? ctx.status : undefined
    try {
      const created = await sessionCreateRequest({
        prompt: command
          ? commandWorkerPrompt(ctx.sessionId, text)
          : newWorkerPrompt(ctx.threadId, ctx.node, ctx.author, text, ctx.status),
        parent: spawnParent(author, sessions),
        launcher: request.launcher,
      })
      if (created.status !== 201) throw new Error(`${created.code || 'session_create_failed'}: ${created.error}`)
      outcomes.push({ token: request.token, result: 'spawned', detail: created.session.id, ...(settled ? { note: `thread ${settled}` } : {}) })
    } catch (error) {
      outcomes.push({ token: request.token, result: 'failed', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  return outcomes
}

export const summarizeDispatch = (outcomes: DispatchOutcome[]): string =>
  outcomes.length ? '@ ' + outcomes.map((outcome) => outcome.result === 'spawned'
    ? `${outcome.token}->${outcome.detail}${outcome.note ? ` (${outcome.note})` : ''}`
    : `${outcome.token}->failed (${outcome.detail})`).join('  |  ') : ''

// The originator courtesy is the only automatic notification left in this module. It
// resolves explicit stored session ids against online rows; prose @ references never call it.
type Session = { id: string; node: string | null; name: string | null; title: string | null; liveness: string }

function resolveOnlineSession(token: string, sessions: Session[]): Session | null {
  const online = sessions.filter((session) => session.liveness === 'online')
  const text = token.toLowerCase()
  const label = (session: Session) => (session.name || session.title || '').toLowerCase()
  return online.find((session) => session.id === token)
    || online.find((session) => session.id.startsWith(token))
    || online.find((session) => label(session) === text)
    || online.find((session) => label(session).startsWith(text) && text.length >= 2)
    || null
}

export type LoopIn = { originator: string }
export type LoopInPick =
  | { kind: 'deliver'; originator: string; session: Session }
  | { kind: 'none' }

// A committed reply can notify its originator as a courtesy. This is not a mention
// dispatch or assignment, and it never creates a worker or retries an offline session.
export function pickLoopIn(chain: (string | null)[], replier: string, sessions: Session[]): LoopInPick {
  const seen = new Set<string>()
  for (const originator of chain) {
    if (!originator || originator === replier || seen.has(originator)) continue
    seen.add(originator)
    const session = resolveOnlineSession(originator, sessions)
    if (session) return { kind: 'deliver', originator, session }
  }
  return { kind: 'none' }
}

function originatorPrompt(threadId: string, node: string | null, replier: string, text: string): string {
  const re = node ? ` (re: ${node})` : ''
  return `A new reply landed on a thread you originated - "${threadId}"${re}, from ${replier}:\n\n  ${text.trim()}\n\n` +
    `This is a courtesy heads-up, not an assignment. Look if it concerns you; ` +
    `\`spex issue ls --all\` lists threads and \`spex issue reply ${threadId} --body -\` replies.`
}

export async function notifyOriginator(
  chain: (string | null)[],
  replier: string,
  text: string,
  ctx: { threadId: string; node: string | null },
): Promise<LoopIn | null> {
  if (!chain.some((candidate) => candidate && candidate !== replier)) return null
  const { sendText, listSessions } = await import('./sessions.js')
  const pick = pickLoopIn(chain, replier, await listSessions() as unknown as Session[])
  if (pick.kind !== 'deliver') return null
  const result = await sendText(pick.session.id, originatorPrompt(ctx.threadId, ctx.node, replier, text), 'issues')
  return result.ok ? { originator: pick.originator } : null
}

export const summarizeLoopIn = (loopIn?: LoopIn | null): string =>
  loopIn ? `looped in originator @${loopIn.originator} (online)` : ''
