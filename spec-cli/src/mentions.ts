// @@@ mentions - the two universal in-text reference primitives ([[mentions]]): `[[node]]` (a TOPIC — a spec
// node) and `@session` (an ACTOR — a live session, or `@new` for a fresh worker). The same parser resolves
// them in ANY input box; the resolve+dispatch live HERE (CLI-first) so the issues page, the composer, and an agent's
// own prompt share one implementation. An `@` "just auto-sends a prompt": resolve it against the live board
// sessions and dispatch via [[dispatch]]'s sendText / [[launch]]'s newSession — storage and delivery stay
// separate, and sessions.ts is imported LAZILY so a mention-free post pays nothing.

// ── parse (pure) ──────────────────────────────────────────────────────────────────────────────────────
// `@<token>` at a word boundary is an actor; `[[<id>]]` is a topic. Token chars are any unicode
// letter/number plus [_-] (a CJK session handle or node id is first-class — same charset the launch-side
// MENTION and the dashboard's MENTION_RE use); a session id, a short label/prefix, or the literal `new`.
// Both forms are deduped in first-seen order.
const ACTOR_RE = /(?:^|\s)@([\p{L}\p{N}_-]+)/gu
const NODE_RE = /\[\[([^\]\s]+)\]\]/g

const uniq = (xs: string[]): string[] => [...new Set(xs)]

// ── CLI sigil tolerance ───────────────────────────────────────────────────────────────────────────────
// In FREE TEXT the sigils are required — they are what marks a reference apart from prose. In a CLI
// ARGUMENT the whole token IS the reference, so the sigil is optional: `spex session review @graph` ≡
// `spex session review graph`, `spex eval add [[cli-surface]]` ≡ `spex eval add cli-surface`. One shared strip,
// applied by the session-selector matcher and every node-arg read site, so the habit a user learns in the
// dashboard's input boxes works verbatim on the CLI — never a second grammar to learn.
export function stripRefSigil(token: string): string {
  const wrapped = /^\[\[(.*)\]\]$/.exec(token)
  if (wrapped) return wrapped[1]
  return token.startsWith('@') ? token.slice(1) : token
}

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

// Any spawn's parent = its originator ([[session-nesting]]): the `@new` worker nests under the session that
// wrote the mention — but ONLY when the author IS a real board session id. A dashboard 'human', a CLI
// 'unknown', or a forge login resolves to no session → null → a top-level worker, never a phantom nest.
// Exact id match only (lineage is provenance, not addressing — no prefix/name resolution), any liveness:
// a parent that later closes is auto-promoted at read time by the derived tree.
export function spawnParent(author: string, sessions: { id: string }[]): string | null {
  return sessions.some((s) => s.id === author) ? author : null
}

// ── dispatch (integration) ─────────────────────────────────────────────────────────────────────────────
export type DispatchOutcome = { token: string; result: 'sent' | 'spawned' | 'offline' | 'unresolved' | 'failed'; detail?: string; note?: string }

// The prompt an @-mentioned actor receives: the comment verbatim + a pointer back to the thread. It is a
// nudge to look, never a rigid command — what to do is up to the comment's words.
function mentionPrompt(threadId: string, node: string | null, author: string, text: string): string {
  const re = node ? ` (re: ${node})` : ''
  return `You were @-mentioned in issue thread "${threadId}"${re} by ${author}:\n\n  ${text.trim()}\n\n` +
    `Read the thread and act as the comment asks (often just a look): \`spex issue ls --all\` lists them; ` +
    `reply with \`spex issue reply ${threadId} --body -\`.`
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
  return `Issue thread "${threadId}"${on} @-mentioned @new (by ${author}) for a fresh look:\n\n  ${text.trim()}\n\n` +
    settled +
    `Read the thread (\`spex issue ls --all\`, find ${threadId}) and act on it${node ? `; the relevant node is ${node}` : ''}.`
}

// Parse a committed issue post's text for `@` actors and deliver to each. Best-effort and LOUD: the thread is
// already committed, so a failed dispatch never fails the post — it is reported. sessions.ts is imported
// lazily; with no actor mentions this returns [] without loading it or hitting the backend.
export async function dispatchMentions(
  text: string,
  ctx: { threadId: string; node: string | null; author: string; status?: string | null },
): Promise<DispatchOutcome[]> {
  const { actors } = parseMentions(text)
  if (!actors.length) return []
  const { sendText, listSessions, newSession } = await import('./sessions.js')
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
        const s = await newSession(ctx.node, newWorkerPrompt(ctx.threadId, ctx.node, ctx.author, text, ctx.status), spawnParent(ctx.author, sessions))
        out.push({ token: r.token, result: 'spawned', detail: s.id, ...(settled ? { note: `thread ${settled}` } : {}) })
      } catch (e) { out.push({ token: r.token, result: 'failed', detail: e instanceof Error ? e.message : String(e) }) }
      continue
    }
    const res = await sendText(r.session.id, mentionPrompt(ctx.threadId, ctx.node, ctx.author, text), 'issues')
    out.push(res.ok ? { token: r.token, result: 'sent', detail: r.session.id }
                    : { token: r.token, result: 'offline', detail: res.error })
  }
  return out
}

// ── implicit originator loop-in + the dispatch fallback chain ([[mentions]] / [[remark-substrate]] R3) ────
// A committed reply is ALSO auto-delivered as a COURTESY — never an assignment — to a FALLBACK CHAIN of
// candidates, in order, stopping at the FIRST one that can be reached: for a remark this is the reading's
// filer session, then the node's governing session, then nobody (it still surfaces on the board via the
// teeth). This is a NOTIFICATION chain only — it resolves NOTHING (resolve stays a deliberate `spex remark resolve`,
// R3); it just reaches an agent who can act. It is the same delivery pipe as dispatchMentions (one
// online-resolution + one sendText), with the same cuts that keep courtesy ≠ assignment: deliver ONLY to an
// ONLINE session (an unreachable link is skipped for the next, NEVER spawns a worker, NEVER drains — only an
// explicit @new spawns); SKIP a candidate that is the replier (no self-notify); a candidate already reached by
// an explicit @-target of this same text counts as delivered, so the chain STOPS (no double-delivery, no
// needless escalation). Store-agnostic: a forge issue's author is a github login, resolves to no live session,
// and the chain runs dry silently — exactly right.
export type LoopIn = { originator: string }   // the candidate we actually reached (a filer OR a governing-session fallback)

// The courtesy prompt — framed as a heads-up, never a command (that is what an @-mention's mentionPrompt is).
function originatorPrompt(threadId: string, node: string | null, replier: string, text: string): string {
  const re = node ? ` (re: ${node})` : ''
  return `A new reply landed on a thread you originated — "${threadId}"${re}, from ${replier}:\n\n  ${text.trim()}\n\n` +
    `This is a courtesy heads-up (you started this thread), not an assignment. Look if it concerns you; ` +
    `\`spex issue ls --all\` lists them, reply with \`spex issue reply ${threadId} --body -\`.`
}

// The pure fallback decision (testable without sessions.ts): walk the ordered chain (nulls/dupes/the-replier
// pruned) and return the FIRST link that resolves to an online session — that is who the courtesy goes to. A
// link already reached by an explicit @-target of this same text short-circuits to `reached` (stop, no
// double-delivery — the actor already has it); an offline/absent link falls through to the next. `none` means
// the chain ran dry (nobody online). This is the whole fallback logic; delivery is a thin sendText around it.
export type LoopInPick =
  | { kind: 'deliver'; originator: string; session: ActorSession }
  | { kind: 'reached' }
  | { kind: 'none' }
export function pickLoopIn(
  chain: (string | null)[],
  replier: string,
  sessions: ActorSession[],
  alreadyDelivered?: Set<string>,
): LoopInPick {
  const seen = new Set<string>()
  const candidates = chain.filter((c): c is string => !!c && c !== replier && !seen.has(c) && (seen.add(c), true))
  for (const originator of candidates) {
    const [resolved] = resolveActors([originator], sessions)
    if (resolved.kind !== 'session') continue                 // offline / no live session → try the next fallback link
    if (alreadyDelivered?.has(resolved.session.id)) return { kind: 'reached' }   // already an explicit @-target: stop
    return { kind: 'deliver', originator, session: resolved.session }
  }
  return { kind: 'none' }
}

// `chain` is the ordered fallback list. We deliver the courtesy to the first online link and STOP; an
// offline/failed link falls through to the next. NOTIFICATION ONLY — this never touches a `resolved` bit
// (resolve is a deliberate `spex remark resolve`), never spawns (only `@new` spawns).
export async function notifyOriginator(
  chain: (string | null)[],
  replier: string,
  text: string,
  ctx: { threadId: string; node: string | null; alreadyDelivered?: Set<string> },
): Promise<LoopIn | null> {
  const seen = new Set<string>()
  if (!chain.some((c) => c && c !== replier && !seen.has(c) && (seen.add(c), true))) return null   // nothing to do → no session load
  const { sendText, listSessions } = await import('./sessions.js')
  const pick = pickLoopIn(chain, replier, await listSessions() as unknown as ActorSession[], ctx.alreadyDelivered)
  if (pick.kind !== 'deliver') return null                    // reached via @ / nobody online → silent
  const res = await sendText(pick.session.id, originatorPrompt(ctx.threadId, ctx.node, replier, text), 'issues')
  return res.ok ? { originator: pick.originator } : null      // a failed send behaves like offline: silent
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
