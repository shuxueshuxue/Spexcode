// MESSAGES, SEAMS, AND EVENTS — the three things the Conversation shows, derived from a session's timeline in
// wire order. The status machine wrote the timeline (`working` ↔ `asking` ↔ `working` …), but a reader is not
// reading the machine: a stretch in which the agent said nothing and worked is one SEAM that carries the
// transcript for exactly that interval; anything said — a note, a sent message — is a message; `error` and
// `corrupt` are events that happened, not phases that lasted.
//
// THE ONE INVARIANT: the items partition the session's time, and no stretch of work is ever dropped. The record
// says the agent is working only ONCE — a later message or note lands on that working agent without any
// further status event (the state machine is idempotent) — so the derivation carries the agent's state forward
// itself: after every message or note, a working agent is working on it from that instant, and a seam opens
// there. Hence the theorem the page relies on: if the record's last word is `working`, the last item is an
// open seam — mid-history stretches get their `worked …` disclosure, and the live tail is always present.
// The tail seam's interval ends at the mount-time `now` so the transcript key stays stable across polls.

export const epochOf = (ts) => typeof ts === 'number' ? ts : Date.parse(ts)

// The envelope `spex session send` appends is addressing, not what the peer said. The server's one prompt
// seam still ships it inside the text, so this surface strips it to render the message and keeps only the
// sender name it carries; the record itself is untouched.
const ENVELOPE = /\n*— from session (?:"(.*?)" \(([^\s)]+)\)|(\S+))(?: on machine \S+)?\. To reply: spex session send (?:--ssh \S+ )?\S+ "<your reply>"\s*$/
export function splitEnvelope(text) {
  const m = ENVELOPE.exec(text || '')
  if (!m) return { text, envelope: null }
  return { text: text.slice(0, m.index), envelope: { label: m[1] || null, id: m[2] || m[3] } }
}

export function conversationItems(events, transcriptNow) {
  const items = []
  let seam = null
  let working = false   // the record's last word about the agent, carried across the events that do not repeat it
  const open = (ts) => { seam ??= { kind: 'seam', ts, from: epochOf(ts) } }
  const close = (to, open = false) => {
    if (seam) items.push({ ...seam, to, open })
    seam = null
  }
  for (const event of events) {
    const status = event.display || event.status
    if (event.kind === 'status') working = status === 'working'
    if (event.kind === 'status' && working && !event.note) { open(event.ts); continue }
    close(epochOf(event.ts))
    if (event.kind === 'sent') items.push({ kind: 'quote', ts: event.ts, from: event.from, ...splitEnvelope(event.text) })
    else if (status === 'error' || status === 'corrupt') items.push({ kind: 'event', ts: event.ts, status, text: event.note })
    else items.push({ kind: 'say', ts: event.ts, status, text: event.note })
    if (working) open(event.ts)
  }
  if (seam) close(Math.max(seam.from + 1, transcriptNow), true)
  return items
}
