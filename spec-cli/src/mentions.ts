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
export type DispatchOutcome = { token: string; result: 'sent' | 'spawned' | 'offline' | 'unresolved' | 'failed'; detail?: string; note?: string }

// The prompt an @-mentioned actor receives: the comment verbatim + a pointer back to the thread. It is a
// nudge to look, never a rigid command — what to do is up to the comment's words.
function mentionPrompt(threadId: string, node: string | null, author: string, text: string): string {
  const re = node ? ` (re: ${node})` : ''
  return `You were @-mentioned in forum thread "${threadId}"${re} by ${author}:\n\n  ${text.trim()}\n\n` +
    `Read the thread and act as the comment asks (often just a look): \`spex issues --all\` lists them; ` +
    `reply with \`spex propose reply ${threadId} --body -\`.`
}
// A non-open thread is settled work: a fresh worker spawned onto it must not re-implement what already
// landed, so the prompt leads with the status and a verify-on-main-first instruction.
export function newWorkerPrompt(threadId: string, node: string | null, author: string, text: string, status?: string | null): string {
  const on = node ? ` on node ${node}` : ''
  const settled = status && status !== 'open'
    ? `NOTE: this thread is already resolved (status: ${status}) — the work it describes has likely LANDED. ` +
      `Verify the current state on main FIRST; if main already satisfies the thread, reply with that finding ` +
      `instead of re-implementing.\n\n`
    : ''
  return `Forum thread "${threadId}"${on} @-mentioned @new (by ${author}) for a fresh look:\n\n  ${text.trim()}\n\n` +
    settled +
    `Read the thread (\`spex issues --all\`, find ${threadId}) and act on it${node ? `; the relevant node is ${node}` : ''}.`
}

// Parse a committed forum post's text for `@` actors and deliver to each. Best-effort and LOUD: the thread is
// already committed, so a failed dispatch never fails the post — it is reported. sessions.ts is imported
// lazily; with no actor mentions this returns [] without loading it or hitting the backend.
export async function dispatchMentions(
  text: string,
  ctx: { threadId: string; node: string | null; author: string; status?: string | null },
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
      // the drain guard ([[mentions]]): @new on a settled thread still spawns (the summons may be a
      // deliberate audit/re-measure), but the worker prompt carries the status and the outcome line warns.
      const settled = ctx.status && ctx.status !== 'open' ? ctx.status : undefined
      try {
        const s = await newSession(ctx.node, newWorkerPrompt(ctx.threadId, ctx.node, ctx.author, text, ctx.status))
        out.push({ token: r.token, result: 'spawned', detail: s.id, ...(settled ? { note: `thread ${settled}` } : {}) })
      } catch (e) { out.push({ token: r.token, result: 'failed', detail: e instanceof Error ? e.message : String(e) }) }
      continue
    }
    const res = await sendKeys(r.session.id, mentionPrompt(ctx.threadId, ctx.node, ctx.author, text), 'forum')
    out.push(res.ok ? { token: r.token, result: 'sent', detail: r.session.id }
                    : { token: r.token, result: 'offline', detail: res.error })
  }
  return out
}

// ── implicit originator loop-in ([[mentions]]) ──────────────────────────────────────────────────────────
// A committed reply is ALSO auto-delivered to the thread's ORIGINATOR (a forum thread's author; an
// eval-comment thread's reading-filer) as a COURTESY — never an assignment. It is the same delivery pipe as
// dispatchMentions (one online-resolution + one sendKeys), but with three cuts that keep courtesy ≠
// assignment: deliver ONLY if the originator's session is ONLINE (offline → silent, NEVER spawn a worker,
// NEVER drain — only an explicit @new spawns); SKIP if the originator is the replier (no self-notify); SKIP
// if the originator was already an explicit @-target of this same text (no double-delivery). The notification
// carries the reply verbatim, so the originator sees any @mentions inside it. Store-agnostic: a forge issue's
// author is a github login, resolves to no live session, and stays silent — exactly right.
export type LoopIn = { originator: string }   // reported ONLY when we actually delivered (originator was online)

// The courtesy prompt — framed as a heads-up, never a command (that is what an @-mention's mentionPrompt is).
function originatorPrompt(threadId: string, node: string | null, replier: string, text: string): string {
  const re = node ? ` (re: ${node})` : ''
  return `A new reply landed on a thread you originated — "${threadId}"${re}, from ${replier}:\n\n  ${text.trim()}\n\n` +
    `This is a courtesy heads-up (you started this thread), not an assignment. Look if it concerns you; ` +
    `\`spex issues --all\` lists them, reply with \`spex propose reply ${threadId} --body -\`.`
}

export async function notifyOriginator(
  originator: string | null,
  replier: string,
  text: string,
  ctx: { threadId: string; node: string | null; alreadyDelivered?: Set<string> },
): Promise<LoopIn | null> {
  if (!originator || originator === replier) return null      // no originator, or it's the replier → nothing to do
  const { sendKeys, listSessions } = await import('./sessions.js')
  const sessions = await listSessions()
  const [resolved] = resolveActors([originator], sessions as unknown as ActorSession[])
  if (resolved.kind !== 'session') return null                // offline / no live session → silent (never spawn)
  if (ctx.alreadyDelivered?.has(resolved.session.id)) return null   // already an explicit @-target → no double-delivery
  const res = await sendKeys(resolved.session.id, originatorPrompt(ctx.threadId, ctx.node, replier, text), 'forum')
  return res.ok ? { originator } : null                       // a failed send behaves like offline: silent
}

// The set of session ids a dispatch ALREADY reached (sent or spawned) — what the loop-in skips to avoid a
// double-delivery to an originator who was also an explicit @-target.
export function deliveredIds(outcomes: DispatchOutcome[]): Set<string> {
  return new Set(outcomes.filter((o) => (o.result === 'sent' || o.result === 'spawned') && o.detail).map((o) => o.detail!))
}

// A one-line human summary of what a dispatch did, for the CLI to echo after a post. The optional loop-in is
// noted DISTINCT from the @-dispatch — a courtesy copy, not an assignment.
export function summarize(outcomes: DispatchOutcome[], loopIn?: LoopIn | null): string {
  const parts: string[] = []
  if (outcomes.length) parts.push('@ ' + outcomes.map((o) => {
    if (o.result === 'sent') return `${o.token}→sent`
    if (o.result === 'spawned') return `new→${o.detail}${o.note ? ` ⚠ ${o.note} — likely already landed` : ''}`
    if (o.result === 'offline') return `${o.token}→offline (stored)`
    if (o.result === 'unresolved') return `${o.token}→? (no live session; stored)`
    return `${o.token}→failed (${o.detail})`
  }).join('  ·  '))
  if (loopIn) parts.push(`↩ looped in originator @${loopIn.originator} (online)`)
  return parts.join('  ·  ')
}
