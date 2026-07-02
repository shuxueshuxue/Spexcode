// step-timeline — the map from a moment in a video reading's clip to a named step. SpexCode owns only
// this FORMAT (a tiny data contract any userland emitter satisfies — a Playwright reporter, a WebDriver
// listener, a computer-use hand narrating as it drives); aligning the emitter's clock to the clip is the
// emitter's own job. The timeline rides as a second content-addressed blob on the reading, never a new
// ndjson column beyond the one hash.

export type TimelineEvent = { tMs: number; step: string; node?: string }
export type StepTimeline = { v: 1; events: TimelineEvent[] }

const EVENT_KEYS = new Set(['tMs', 'step', 'node'])

// validate LOUD — every violation named, [] when well-formed. The key set is closed (like the yatsu.md
// scenario schema): a malformed timeline is rejected at filing time, never silently reshaped.
export function validateTimeline(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['timeline must be a JSON object { v, events }']
  const errs: string[] = []
  const o = raw as Record<string, unknown>
  for (const k of Object.keys(o)) if (k !== 'v' && k !== 'events') errs.push(`unknown field \`${k}\` (allowed: v, events)`)
  if (o.v !== 1) errs.push('`v` must be 1')
  if (!Array.isArray(o.events)) { errs.push('`events` must be an array'); return errs }
  let prev = -Infinity
  o.events.forEach((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) { errs.push(`events[${i}] must be an object`); return }
    const ev = e as Record<string, unknown>
    for (const k of Object.keys(ev)) if (!EVENT_KEYS.has(k)) errs.push(`events[${i}]: unknown field \`${k}\` (allowed: tMs, step, node)`)
    if (typeof ev.tMs !== 'number' || !Number.isFinite(ev.tMs) || ev.tMs < 0) {
      errs.push(`events[${i}].tMs must be a finite number ≥ 0`)
    } else {
      if (ev.tMs < prev) errs.push(`events[${i}].tMs is out of order (the list is ordered by time)`)
      prev = ev.tMs
    }
    if (typeof ev.step !== 'string' || !ev.step.trim()) errs.push(`events[${i}].step must be a non-empty string`)
    if (ev.node !== undefined && (typeof ev.node !== 'string' || !ev.node.trim())) errs.push(`events[${i}].node must be a non-empty string when present`)
  })
  return errs
}

// the whole of "which step is this moment": the last event at or before T; null before the first event
// (a plain player moment, no step to name — graceful, never an error).
export function stepAt(events: TimelineEvent[], tMs: number): TimelineEvent | null {
  let hit: TimelineEvent | null = null
  for (const e of events) {
    if (e.tMs <= tMs) hit = e
    else break
  }
  return hit
}
