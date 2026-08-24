// Transitional boundary only: canonical sessions read events through session-application.
// This adapter remains until the migration gate permits deleting the file timeline protocol.
export {
  currentHumanTurn,
  advanceFollow,
  followCursor,
  lastHumanSendVia,
  recordStatus,
  timelineEvents,
  timelineStamp,
  timelineTail,
  unreadSince,
  type TimelineEvent,
} from '@spexcode/session-core'
