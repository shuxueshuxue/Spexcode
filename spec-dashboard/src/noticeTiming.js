export const MIN_NOTICE_DURATION = 5000
export const MAX_NOTICE_DURATION = 14000
export const NOTICE_BASE_DURATION = 3200
export const NOTICE_MILLISECONDS_PER_CHARACTER = 70

export function readingNoticeDuration(message) {
  const length = Array.from(String(message)).length
  const duration = NOTICE_BASE_DURATION + length * NOTICE_MILLISECONDS_PER_CHARACTER
  return Math.min(MAX_NOTICE_DURATION, Math.max(MIN_NOTICE_DURATION, duration))
}

export function resolveNoticeDuration(message, requestedDuration) {
  const duration = requestedDuration === undefined ? readingNoticeDuration(message) : requestedDuration
  if (!Number.isFinite(duration) || duration < 0) throw new Error('notice duration must be a non-negative finite number')
  return duration
}
