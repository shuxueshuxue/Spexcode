// @@@ mentions - the two universal in-text reference primitives ([[mentions]]): `[[node]]` (a TOPIC — a spec
// node) and `@session` (an ACTOR — a live session, or `@new` for a fresh worker). The same parser resolves
// them in ANY input box; the resolve+dispatch live HERE (CLI-first) so the forum, the composer, and an agent's
// own prompt share one implementation. An `@` "just auto-sends a prompt": resolve it against the live board
// sessions and dispatch via [[dispatch]]'s sendKeys / [[launch]]'s newSession — storage and delivery stay
// separate, and sessions.ts is imported LAZILY so a mention-free post pays nothing.

// ── parse (pure) ──────────────────────────────────────────────────────────────────────────────────────
// `@<token>` at a word boundary is an actor; `[[<id>]]` is a topic. Tokens are [A-Za-z0-9_-]; a session id,
// a short label/prefix, or the literal `new`. Both forms are deduped in first-seen order.
const ACTOR_RE = /(?:^|\s)@([A-Za-z0-9_-]+)/g
const NODE_RE = /\[\[([^\]\s]+)\]\]/g

const uniq = (xs: string[]): string[] => [...new Set(xs)]

export function parseMentions(text: string): { actors: string[]; nodes: string[] } {
  const actors: string[] = []
  const nodes: string[] = []
  for (const m of text.matchAll(ACTOR_RE)) actors.push(m[1])
  for (const m of text.matchAll(NODE_RE)) nodes.push(m[1])
  return { actors: uniq(actors), nodes: uniq(nodes) }
}

// ── resolve actors against live sessions (pure) ───────────────────────────────────────────────────────
// A minimal shape of what dispatchMentions needs from a Session (so this stays testable without sessions.ts).
export type ActorSession = { id: string; node: string | null; name: string | null; title: string | null; liveness: string }
export type Resolved =
  | { token: string; kind: 'new' }
  | { token: string; kind: 'session'; session: ActorSession }
  | { token: string; kind: 'unresolved' }

// Resolve each actor token to a `new` sentinel, an ONLINE session (never a dead one — you don't summon a
// closed agent; `@new` acts on its behalf), or unresolved. Match order: literal `new` → exact id → id prefix
// → name/title (case-insensitive) → name/title prefix. First online match wins.
export function resolveActors(tokens: string[], sessions: ActorSession[]): Resolved[] {
  const online = sessions.filter((s) => s.liveness === 'online')
  return tokens.map((token): Resolved => {
    if (token === 'new') return { token, kind: 'new' }
    const t = token.toLowerCase()
    const label = (s: ActorSession) => (s.name || s.title || '').toLowerCase()
    const hit =
      online.find((s) => s.id === token) ||
      online.find((s) => s.id.startsWith(token)) ||
      online.find((s) => label(s) === t) ||
      online.find((s) => label(s).startsWith(t) && t.length >= 2)
    return hit ? { token, kind: 'session', session: hit } : { token, kind: 'unresolved' }
  })
}

// ── dispatch (integration) ─────────────────────────────────────────────────────────────────────────────
export type DispatchOutcome = { token: string; result: 'sent' | 'spawned' | 'offline' | 'unresolved' | 'failed'; detail?: string }

// The prompt an @-mentioned actor receives: the comment verbatim + a pointer back to the thread. It is a
// nudge to look, never a rigid command — what to do is up to the comment's words.
function mentionPrompt(threadId: string, node: string | null, author: string, text: string): string {
  const re = node ? ` (re: ${node})` : ''
  return `You were @-mentioned in forum thread "${threadId}"${re} by ${author}:\n\n  ${text.trim()}\n\n` +
    `Read the thread and act as the comment asks (often just a look): \`spex proposals --all\` lists the forum; ` +
    `reply with \`spex propose reply ${threadId} --body -\`.`
}
function newWorkerPrompt(threadId: string, node: string | null, author: string, text: string): string {
  const on = node ? ` on node ${node}` : ''
  return `Forum thread "${threadId}"${on} @-mentioned @new (by ${author}) for a fresh look:\n\n  ${text.trim()}\n\n` +
    `Read the thread (\`spex proposals --all\`, find ${threadId}) and act on it${node ? `; the relevant node is ${node}` : ''}.`
}

// Parse a committed forum post's text for `@` actors and deliver to each. Best-effort and LOUD: the thread is
// already committed, so a failed dispatch never fails the post — it is reported. sessions.ts is imported
// lazily; with no actor mentions this returns [] without loading it or hitting the backend.
export async function dispatchMentions(
  text: string,
  ctx: { threadId: string; node: string | null; author: string },
): Promise<DispatchOutcome[]> {
  const { actors } = parseMentions(text)
  if (!actors.length) return []
  const { sendKeys, listSessions, newSession } = await import('./sessions.js')
  const sessions = await listSessions()
  const resolved = resolveActors(actors, sessions as unknown as ActorSession[])
  const out: DispatchOutcome[] = []
  for (const r of resolved) {
    if (r.kind === 'unresolved') { out.push({ token: r.token, result: 'unresolved' }); continue }
    if (r.kind === 'new') {
      try {
        const s = await newSession(ctx.node, newWorkerPrompt(ctx.threadId, ctx.node, ctx.author, text))
        out.push({ token: r.token, result: 'spawned', detail: s.id })
      } catch (e) { out.push({ token: r.token, result: 'failed', detail: e instanceof Error ? e.message : String(e) }) }
      continue
    }
    const res = await sendKeys(r.session.id, mentionPrompt(ctx.threadId, ctx.node, ctx.author, text), 'forum')
    out.push(res.ok ? { token: r.token, result: 'sent', detail: r.session.id }
                    : { token: r.token, result: 'offline', detail: res.error })
  }
  return out
}

// A one-line human summary of what a dispatch did, for the CLI to echo after a post.
export function summarize(outcomes: DispatchOutcome[]): string {
  if (!outcomes.length) return ''
  return '@ ' + outcomes.map((o) => {
    if (o.result === 'sent') return `${o.token}→sent`
    if (o.result === 'spawned') return `new→${o.detail}`
    if (o.result === 'offline') return `${o.token}→offline (stored)`
    if (o.result === 'unresolved') return `${o.token}→? (no live session; stored)`
    return `${o.token}→failed (${o.detail})`
  }).join('  ·  ')
}
