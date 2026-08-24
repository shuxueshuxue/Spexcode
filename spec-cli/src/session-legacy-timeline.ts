// Transitional boundary only: canonical sessions read events through session-application.
// This adapter remains until the migration gate permits deleting the file timeline protocol.
export {
  currentHumanTurn,
  lastHumanSendVia,
  recordStatus,
  timelineEvents,
  timelineStamp,
  timelineTail,
  type TimelineEvent,
} from '@spexcode/session-core'
