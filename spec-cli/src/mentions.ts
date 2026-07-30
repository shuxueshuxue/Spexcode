// @@@ mentions - the two passive in-text references: `[[node]]` names a topic and
// `@session` names a retained session. The grammar is shared by every composer; neither
// reference is control. Sending to a session, launching one, and inheriting one remain
// explicit `spex session send`, `spex session new`, and `/distill <id>` actions.
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
