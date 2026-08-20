import { readAliasedRawRecord, type SessionLifecycle, type SessionProposal } from '@spexcode/spec-core'
import { timelineTail, type TimelineEvent } from '@spexcode/session-core'

export * from '@spexcode/session-core'

const PROPOSAL_DISPLAY: Record<string, DisplayWord> = { merge: 'review', nothing: 'done', close: 'close-pending' }
type DisplayWord = 'working' | 'idle' | 'review' | 'done' | 'close-pending' | 'parked' | 'error' | 'asking' | 'queued'

export const timelineDisplay = (event: { status: SessionLifecycle; proposal: SessionProposal | null }): DisplayWord =>
  event.status === 'awaiting' ? (PROPOSAL_DISPLAY[event.proposal ?? 'nothing'] ?? 'done')
  : event.status === 'active' ? 'working' : event.status

// The HTTP projection remains a SpexCode concern: it resolves aliases, hides unmanaged records, and adds the
// board's display vocabulary. The package beneath it only reads the durable file protocol.
export function readTimeline(id: string, limit = 500): { events: TimelineEvent[] } | null {
  let raw: ReturnType<typeof readAliasedRawRecord>
  try { raw = readAliasedRawRecord(id) } catch { return null }
  if (!raw || !raw.governed) return null
  return { events: timelineTail(raw.session_id, limit).map((event) =>
    event.kind === 'status' ? { ...event, display: timelineDisplay(event) } : event) }
}
