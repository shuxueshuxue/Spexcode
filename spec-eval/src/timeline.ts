export type TimelineEvent = { at: number; step: string; node?: string }
export type StepTimeline = { v: 2; axis: string; events: TimelineEvent[] }

export type LegacyTimelineEvent = { tMs: number; step: string; node?: string }
export type LegacyStepTimeline = { v: 1; events: LegacyTimelineEvent[] }

const V2_EVENT_KEYS = new Set(['at', 'step', 'node'])
const V1_EVENT_KEYS = new Set(['tMs', 'step', 'node'])

export function validateTimeline(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['timeline must be a JSON object { v, axis, events }']
  const o = raw as Record<string, unknown>
  if (o.v !== 1 && o.v !== 2) return ['`v` must be 1 (legacy time axis) or 2 (axis-tagged)']
  const errs: string[] = []
  const v2 = o.v === 2
  const posKey = v2 ? 'at' : 'tMs'
  const rootKeys = v2 ? new Set(['v', 'axis', 'events']) : new Set(['v', 'events'])
  const evKeys = v2 ? V2_EVENT_KEYS : V1_EVENT_KEYS
  for (const k of Object.keys(o)) if (!rootKeys.has(k)) errs.push(`unknown field \`${k}\` (allowed: ${[...rootKeys].join(', ')})`)
  if (v2 && (typeof o.axis !== 'string' || !o.axis.trim())) errs.push('`axis` must be a non-empty string (e.g. time, frame, line, index)')
  if (!Array.isArray(o.events)) { errs.push('`events` must be an array'); return errs }
  let prev = -Infinity
  o.events.forEach((e, i) => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) { errs.push(`events[${i}] must be an object`); return }
    const ev = e as Record<string, unknown>
    for (const k of Object.keys(ev)) if (!evKeys.has(k)) errs.push(`events[${i}]: unknown field \`${k}\` (allowed: ${[...evKeys].join(', ')})`)
    const pos = ev[posKey]
    if (typeof pos !== 'number' || !Number.isFinite(pos) || pos < 0) {
      errs.push(`events[${i}].${posKey} must be a finite number ≥ 0`)
    } else {
      if (pos < prev) errs.push(`events[${i}].${posKey} is out of order (the list is ordered by position)`)
      prev = pos
    }
    if (typeof ev.step !== 'string' || !ev.step.trim()) errs.push(`events[${i}].step must be a non-empty string`)
    if (ev.node !== undefined && (typeof ev.node !== 'string' || !ev.node.trim())) errs.push(`events[${i}].node must be a non-empty string when present`)
  })
  return errs
}

export function normalizeTimeline(raw: unknown): { axis: string; events: TimelineEvent[] } {
  const o = (raw ?? {}) as Record<string, any>
  const events: any[] = Array.isArray(o.events) ? o.events : []
  if (o.v === 1) return { axis: 'time', events: events.map((e) => ({ at: e.tMs, step: e.step, ...(e.node ? { node: e.node } : {}) })) }
  return { axis: typeof o.axis === 'string' ? o.axis : 'time', events: events.map((e) => ({ at: e.at, step: e.step, ...(e.node ? { node: e.node } : {}) })) }
}

export function stepAt(events: TimelineEvent[], pos: number): TimelineEvent | null {
  let hit: TimelineEvent | null = null
  for (const e of events) {
    if (e.at <= pos) hit = e
    else break
  }
  return hit
}
