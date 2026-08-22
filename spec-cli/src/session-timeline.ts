import { readAliasedRawRecord, type SessionLifecycle, type SessionProposal } from '@spexcode/spec-core'
import { timelineTail, type TimelineEvent } from '@spexcode/session-core'
import { configuredSessionApplicationIfCutover } from './session-application.js'

export * from '@spexcode/session-core'

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
    const events = application.events.read(sessionId).flatMap((event): TimelineEvent[] => {
      const payload = JSON.parse(new TextDecoder().decode(event.payload)) as Record<string, unknown>
      if (event.type === 'session.state.changed.v1') {
        return [{
          ts: new Date(event.occurredAtMs).toISOString(),
          kind: 'status',
          status: String(payload.status) as SessionLifecycle,
          proposal: payload.proposal === null ? null : String(payload.proposal) as SessionProposal,
          note: payload.note === null ? null : String(payload.note),
        }]
      }
      if (event.type === 'session.message.sent.v1') {
        return [{
          ts: new Date(event.occurredAtMs).toISOString(),
          kind: 'sent',
          mid: String(payload.messageId),
          text: String(payload.text),
          from: payload.from === null ? null : String(payload.from),
          ...(payload.replyVia === 'note' ? { replyVia: 'note' as const } : {}),
        }]
      }
      return []
    })
    return { events: events.slice(-Math.max(1, limit)).map((event) =>
      event.kind === 'status' ? { ...event, display: timelineDisplay(event) } : event) }
  }
  if (!raw || !raw.governed) return null
  return { events: timelineTail(raw.session_id, limit).map((event) =>
    event.kind === 'status' ? { ...event, display: timelineDisplay(event) } : event) }
}
