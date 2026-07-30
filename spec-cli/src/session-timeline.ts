import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, appendFileSync, mkdirSync, statSync } from 'node:fs'
import { sessionStoreDir, sessionArtifactPath, readAliasedRawRecord } from './layout.js'
import type { Lifecycle, Proposal } from './sessions.js'

// @@@ session-timeline - the session's append-only log in its global store dir: every authored-lifecycle
// transition (status + proposal + the FULL note text) and every message addressed to it. It is what a
// terminal-free surface renders as the conversation, and it is the DELIVERY itself — a message is delivered
// when its bytes are in this file.
//
// There is exactly ONE writer path for the authored axis: every lifecycle hook shells to `spex internal
// session-*`, the same TypeScript writer the CLI declarations use, so no move reaches session.json without
// reaching this log. That is why there is no observer process, no repair tick, and no read-time folding of a
// move recorded twice — nothing writes state behind this module's back.

export type TimelineEvent =
  | { ts: string; kind: 'status'; status: Lifecycle; proposal: Proposal | null; note: string | null; display?: string }
  | { ts: string; kind: 'sent'; mid: string; text: string; from: string | null; replyVia?: 'note' }

const timelinePath = (id: string): string => sessionArtifactPath(id, 'timeline.ndjson')

function append(id: string, ev: TimelineEvent): void {
  mkdirSync(sessionStoreDir(id), { recursive: true })
  appendFileSync(timelinePath(id), JSON.stringify(ev) + '\n')
}

// Record a lifecycle value that has already landed in session.json. TypeScript state writers call this
// synchronously before returning, so a later write cannot erase an intermediate declaration note from the
// conversation. Best-effort: history is an accessory to the state machine, and failing to write it must never
// break the transition that already happened.
export function recordStatus(id: string, status: Lifecycle, proposal: Proposal | null, note: string | null): void {
  try { append(id, { ts: new Date().toISOString(), kind: 'status', status, proposal, note }) }
  catch { /* the record already moved; the history line is the only loss */ }
}

// The DELIVERY ([[dispatch]]): appending this line IS the send, so unlike a status line it must fail LOUD —
// the caller reports the throw rather than a false success. `text` is the message BEFORE any mechanism insert
// (hints are transport, not conversation); `replyVia` is the effective channel the prompt seam chose. Returns
// the new line's `mid` (what a poke carries and a reader dedupes against) and its event index, which is where
// the target's inbox cursor must be for that poke to count as already-shown.
export function appendSent(id: string, text: string, from: string | null, replyVia?: 'note'): { mid: string; pos: number } {
  const mid = randomUUID()
  const pos = timelineEvents(id).length
  append(id, { ts: new Date().toISOString(), kind: 'sent', mid, text, from, ...(replyVia ? { replyVia } : {}) })
  return { mid, pos }
}

// The L0 read: any process may take it with nothing but filesystem access, and taking it perturbs nothing
// ([[layers]]). Index = event position, which is what a cursor names ([[session-cursors]]).
export function timelineEvents(id: string): TimelineEvent[] {
  try {
    const p = timelinePath(id)
    if (!existsSync(p)) return []
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
      try { return JSON.parse(l) as TimelineEvent } catch { return null }
    }).filter((e): e is TimelineEvent => e != null && (e.kind === 'status' || e.kind === 'sent'))
  } catch { return [] }
}

// the same L0 read taken as CHEAPLY as it can be: a follower ([[session-follow]]) ticks over many logs, so it
// stats first and parses only what grew. null = no log yet (a session that has authored nothing).
export function timelineStamp(id: string): string | null {
  try { const s = statSync(timelinePath(id)); return `${s.size}:${s.mtimeMs}` }
  catch { return null }
}

// the display word for an authored state — the SAME vocabulary every other surface speaks (awaiting → its
// proposal's label, active → working), duplicated here as a tiny read-time map rather than importing the state
// machine (sessions.ts imports THIS module for appendSent; a value import back would be a cycle — the
// Lifecycle/Proposal imports above are type-only, erased at runtime).
const PROPOSAL_DISPLAY: Record<string, DisplayWord> = { merge: 'review', nothing: 'done', close: 'close-pending' }
type DisplayWord = 'working' | 'idle' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'
export const timelineDisplay = (e: { status: Lifecycle; proposal: Proposal | null }): DisplayWord =>
  e.status === 'awaiting' ? (PROPOSAL_DISPLAY[e.proposal ?? 'nothing'] ?? 'done')
  : e.status === 'active' ? 'working' : e.status

// the channel of the LAST HUMAN send (from == null): 'note' when the note-reply hint rode along, else null.
// This is what makes the reply-channel hints SYMMETRIC ([[session-timeline]]): a human send with no note flag
// arriving after a note-send is the "back at a terminal" transition, and the delivery gets the counter-insert.
// Derived from the durable log — no new state, and it survives a server restart. Agent senders (`from` set)
// say nothing about where the HUMAN is reading, so they neither set nor clear it.
export function lastHumanSendVia(id: string): 'note' | null {
  const evs = timelineEvents(id)
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]
    if (e.kind === 'sent' && e.from == null) return e.replyVia === 'note' ? 'note' : null
  }
  return null
}

// the read surface behind GET /api/sessions/:id/timeline: the last `limit` events, oldest first, each status
// event carrying its composed display word. null = no such session (the route 404s).
export function readTimeline(id: string, limit = 500): { events: TimelineEvent[] } | null {
  let raw: ReturnType<typeof readAliasedRawRecord>
  try { raw = readAliasedRawRecord(id) } catch { return null }
  if (!raw || !raw.governed) return null
  const evs = timelineEvents(id)
  const tail = evs.slice(Math.max(0, evs.length - Math.max(1, limit)))
  return { events: tail.map((e) => (e.kind === 'status' ? { ...e, display: timelineDisplay(e) } : e)) }
}
