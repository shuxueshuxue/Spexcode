import { readAliasedRawRecord, type SessionLifecycle, type SessionProposal } from '@spexcode/spec-core'
import { decodeEventJson } from '@spexcode/session-events'
import * as legacyTimeline from './session-legacy-timeline.js'
import { configuredSessionApplicationIfCutover } from './session-application.js'

export type TimelineEvent =
  | { ts: string; kind: 'status'; status: SessionLifecycle; proposal: SessionProposal | null; note: string | null; display?: string }
  | { ts: string; kind: 'sent'; mid: string; text: string; from: string | null; replyVia?: 'note' }

const canonicalTimelineEvents = (id: string): TimelineEvent[] | null => {
  const application = configuredSessionApplicationIfCutover()
  if (!application || !application.readState(id)) return null
  return application.readEvents(id).flatMap((event): TimelineEvent[] => {
    const decoded = decodeEventJson(event.payload)
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return []
    const payload = decoded as Record<string, unknown>
    if (event.type === 'session.state.changed.v1') return [{
      ts: new Date(event.occurredAtMs).toISOString(),
      kind: 'status',
      status: String(payload.status) as SessionLifecycle,
      proposal: payload.proposal === null || payload.proposal === undefined ? null : String(payload.proposal) as SessionProposal,
      note: payload.note === null || payload.note === undefined ? null : String(payload.note),
    }]
    if (event.type === 'session.message.sent.v1') return [{
      ts: new Date(event.occurredAtMs).toISOString(),
      kind: 'sent',
      mid: String(payload.messageId),
      text: String(payload.text),
      from: payload.from === null || payload.from === undefined ? null : String(payload.from),
      ...(payload.replyVia === 'note' ? { replyVia: 'note' as const } : {}),
    }]
    return []
  })
}

export const timelineEvents = (id: string): TimelineEvent[] =>
  canonicalTimelineEvents(id) ?? legacyTimeline.timelineEvents(id)

export const timelineStamp = (id: string): string | null => {
  const application = configuredSessionApplicationIfCutover()
  if (application?.readState(id)) {
    const events = application.readEvents(id)
    return events.length === 0 ? null : String(events.at(-1)!.eventSeq)
  }
  return legacyTimeline.timelineStamp(id)
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
  if (application?.readState(id)) {
    application.transitionSession(id, { status, proposal, note, reason: 'legacy-cli-status-adapter' })
    return
  }
  legacyTimeline.recordStatus(id, status, proposal, note)
}

const PROPOSAL_DISPLAY: Record<string, DisplayWord> = { merge: 'review', nothing: 'done', close: 'close-pending' }
type DisplayWord = 'working' | 'idle' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'

export const timelineDisplay = (event: { status: SessionLifecycle; proposal: SessionProposal | null }): DisplayWord =>
  event.status === 'awaiting' ? (PROPOSAL_DISPLAY[event.proposal ?? 'nothing'] ?? 'done')
  : event.status === 'active' ? 'working' : event.status

// The HTTP projection remains a SpexCode concern: it resolves aliases, hides unmanaged records, and adds the
// board's display vocabulary. The package beneath it only reads the durable file protocol.
export function readTimeline(id: string, limit = 500): { events: TimelineEvent[] } | null {
  let raw: ReturnType<typeof readAliasedRawRecord> = null
  try { raw = readAliasedRawRecord(id) } catch { /* cutover sessions may have no legacy record */ }
  const application = configuredSessionApplicationIfCutover()
  const sessionId = raw?.session_id ?? id
  if (application && application.readState(sessionId)) {
    return { events: canonicalTimelineEvents(sessionId)!.slice(-Math.max(1, limit)).map((event) =>
      event.kind === 'status' ? { ...event, display: timelineDisplay(event) } : event) }
  }
  if (!raw || !raw.governed) return null
  return { events: timelineTail(raw.session_id, limit).map((event) =>
    event.kind === 'status' ? { ...event, display: timelineDisplay(event) } : event) }
}
