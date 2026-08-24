// Transitional migration boundary for records that have not crossed the SQLite application fence.
// Canonical sessions never enter this module; keeping the old file protocol behind one adapter makes the
// remaining deletion work measurable instead of spreading session-core imports through the CLI.
export {
  acceptMessage,
  drain,
  owesDelivery,
  pendingMessages,
  type MessageIdempotency,
} from '@spexcode/session-core'
export {
  pendingSnapshot,
  replacePendingWhileLocked,
  revokePendingFromWhileLocked,
  withDeliveryLocks,
  trySessionRecordLockSync,
  withSessionRecordLock,
  withSessionRecordLockSync,
} from '@spexcode/session-core/internal'
