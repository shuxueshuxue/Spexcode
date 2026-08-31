import { readAliasedRawRecord, type SessionLifecycle, type SessionProposal } from '@spexcode/spec-core'
import { decodeEventJson, type SessionEvent } from '@spexcode/session-events'
import { MIGRATED_MESSAGE_EVENT, MIGRATED_STATE_EVENT } from '@spexcode/session-application'
import { configuredSessionApplicationIfCutover } from './session-application.js'

export type TimelineEvent =
  | { ts: string; kind: 'status'; status: SessionLifecycle; proposal: SessionProposal | null; note: string | null; display?: string }
  | { ts: string; kind: 'sent'; mid: string; text: string; from: string | null; replyVia?: 'note' }

// The timeline is a history: events read in occurrence order (sequence breaks ties). Migrated legacy history
// lands after the live events in sequence but before them in time, and it is shown where it happened.
const canonicalSessionId = (id: string): string => readAliasedRawRecord(id)?.session_id ?? id

const publicEvent = (event: SessionEvent): TimelineEvent[] => {
  const decoded = decodeEventJson(event.payload)
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return []
  const payload = decoded as Record<string, unknown>
  if (event.type === 'session.state.changed.v1' || event.type === MIGRATED_STATE_EVENT) return [{
    ts: new Date(event.occurredAtMs).toISOString(),
    kind: 'status',
    status: String(payload.status) as SessionLifecycle,
    proposal: payload.proposal === null || payload.proposal === undefined ? null : String(payload.proposal) as SessionProposal,
    note: payload.note === null || payload.note === undefined ? null : String(payload.note),
  }]
  if (event.type === 'session.message.sent.v1' || event.type === MIGRATED_MESSAGE_EVENT) return [{
    ts: new Date(event.occurredAtMs).toISOString(),
    kind: 'sent',
    mid: String(payload.messageId),
    text: String(payload.text),
    from: payload.from === null || payload.from === undefined ? null : String(payload.from),
    ...(payload.replyVia === 'note' ? { replyVia: 'note' as const } : {}),
  }]
  return []
}

// @@@stamp-is-sequence-not-position - the stamp is the log's highest sequence, read from the store's own
// `ORDER BY event_seq` rows BEFORE they are put in time order. Migrated history holds a high sequence at an
// early time, so a position in the shown history is not a sequence and the two are never interchanged.
const canonicalTimeline = (id: string): { events: TimelineEvent[]; stamp: string | null } | null => {
  const canonicalId = canonicalSessionId(id)
  const application = configuredSessionApplicationIfCutover()
  if (!application || !application.readState(canonicalId)) return null
  const rows = application.readEvents(canonicalId)
  const ordered = [...rows].sort((a, b) => a.occurredAtMs - b.occurredAtMs || a.eventSeq - b.eventSeq)
  return { events: ordered.flatMap(publicEvent), stamp: rows.length === 0 ? null : String(rows.at(-1)!.eventSeq) }
}

export const timelineEvents = (id: string): TimelineEvent[] => canonicalTimeline(id)?.events ?? []

export const timelineStamp = (id: string): string | null => {
  const canonicalId = canonicalSessionId(id)
  const application = configuredSessionApplicationIfCutover()
  if (application?.readState(canonicalId)) {
    const events = application.readEvents(canonicalId)
    return events.length === 0 ? null : String(events.at(-1)!.eventSeq)
  }
  return null
}

export const timelineTail = (id: string, limit = 500): TimelineEvent[] =>
  timelineEvents(id).slice(-Math.max(1, limit))

export const lastHumanSendVia = (id: string): 'note' | null => {
  const events = timelineEvents(id)
  const sent = [...events].reverse().find((event): event is Extract<TimelineEvent, { kind: 'sent' }> => event.kind === 'sent' && event.from === null)
  return sent?.replyVia ?? null
}

export const currentHumanTurn = (id: string): { token: string; acceptedAt: string } | null => {
  const sent = [...timelineEvents(id)].reverse().find((event): event is Extract<TimelineEvent, { kind: 'sent' }> => event.kind === 'sent' && event.from === null)
  return sent ? { token: sent.mid, acceptedAt: sent.ts } : null
}

export const recordStatus = (id: string, status: SessionLifecycle, proposal: SessionProposal | null, note: string | null): void => {
  const application = configuredSessionApplicationIfCutover()
  if (!application?.readState(id)) throw new Error(`cannot record status for unknown canonical session ${id}`)
  application.transitionSession(id, { status, proposal, note, reason: 'cli-status' })
}

const PROPOSAL_DISPLAY: Record<string, DisplayWord> = { merge: 'review', nothing: 'done', close: 'close-pending' }
type DisplayWord = 'working' | 'idle' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'

export const timelineDisplay = (event: { status: SessionLifecycle; proposal: SessionProposal | null }): DisplayWord =>
  event.status === 'awaiting' ? (PROPOSAL_DISPLAY[event.proposal ?? 'nothing'] ?? 'done')
  : event.status === 'active' ? 'working' : event.status

const spoken = (events: readonly TimelineEvent[]): TimelineEvent[] =>
  events.map((event) => event.kind === 'status' ? { ...event, display: timelineDisplay(event) } : event)

// Was the agent working when the window opens? The derivation that turns this history into a conversation
// carries that word forward across the events which do not repeat it, so a window that starts mid-stretch
// needs the word the events before it already said — otherwise its first stretch of work is simply lost.
const priorWorkingAt = (events: readonly TimelineEvent[], start: number): boolean => {
  for (let index = start - 1; index >= 0; index--) {
    const event = events[index]
    if (event.kind === 'status') return timelineDisplay(event) === 'working'
  }
  return false
}

export const DEFAULT_TIMELINE_WINDOW = 200
// @@@window-is-content-not-rows - a count of events is not a measure of how much a reader faces. Notes are
// authored prose and their lengths differ by orders of magnitude, so the SAME 200 events are a couple of
// screens on one record and eighty-two on another. The window therefore stops at whichever bound it reaches
// first: the event count, or this much authored text. One event always fits, however long it is.
export const DEFAULT_TIMELINE_WINDOW_TEXT = 24 * 1024

const authoredLength = (event: TimelineEvent): number =>
  (event.kind === 'status' ? event.note?.length : event.text?.length) ?? 0

/** Walk back from `end` until the window has its events, its text budget, or the beginning. */
const windowStart = (events: readonly TimelineEvent[], end: number, limit: number, budget: number): number => {
  let start = end
  let text = 0
  while (start > 0 && end - start < limit) {
    const next = text + authoredLength(events[start - 1])
    if (next > budget && start < end) break
    text = next
    start--
  }
  return start
}

export type TimelineRead = { limit?: number; before?: number; since?: number; textBudget?: number }
export type TimelineWindow = {
  events: TimelineEvent[]
  stamp: string | null
  /** present ⇒ this is a WHOLE window at this position in the history; absent ⇒ events append to what the reader holds */
  offset?: number
  total?: number
  priorWorking?: boolean
}

// The HTTP projection remains a SpexCode concern: it resolves aliases, hides unmanaged records, and adds the
// board's display vocabulary. The package beneath it only reads the durable event store.
//
// THREE READS, ONE ROUTE. A reader holds a window over a history that only grows at its end:
//   - no cursor → the newest events, with the window's position and the history's size
//   - `before=<position>` → the page ending at that position: how a reader walks back
//   Both are bounded by COUNT and by TEXT, whichever comes first — see `windowStart`.
//   - `since=<stamp>` → only what the log grew by, which is the poll and costs a sequence range scan, not
//     the whole history. Growth past `limit` is answered with a whole window instead, because a reader that
//     far behind is cheaper to re-seat than to catch up event by event.
export function readTimeline(id: string, read: TimelineRead = {}): TimelineWindow | null {
  const application = configuredSessionApplicationIfCutover()
  const canonicalId = canonicalSessionId(id)
  if (!application || !application.readState(canonicalId)) return null
  const limit = Math.max(1, Math.trunc(read.limit ?? DEFAULT_TIMELINE_WINDOW))
  if (read.since !== undefined) {
    const rows = application.readEvents(canonicalId, Math.max(0, Math.trunc(read.since)))
    const grown = rows.flatMap(publicEvent)
    if (grown.length <= limit) {
      return { events: spoken(grown), stamp: rows.length === 0 ? String(Math.max(0, Math.trunc(read.since))) : String(rows.at(-1)!.eventSeq) }
    }
  }
  const timeline = canonicalTimeline(id)!
  const events = timeline.events
  const end = read.before === undefined ? events.length : Math.min(events.length, Math.max(0, Math.trunc(read.before)))
  const budget = Math.max(1, Math.trunc(read.textBudget ?? DEFAULT_TIMELINE_WINDOW_TEXT))
  const start = windowStart(events, end, limit, budget)
  return {
    events: spoken(events.slice(start, end)),
    stamp: timeline.stamp,
    offset: start,
    total: events.length,
    priorWorking: priorWorkingAt(events, start),
  }
}
