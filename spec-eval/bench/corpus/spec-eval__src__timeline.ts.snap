// step-timeline — the map from a POSITION on a piece of evidence's own axis to a named step. SpexCode owns
// only this FORMAT (a tiny data contract any userland emitter satisfies — a Playwright reporter, a WebDriver
// listener, a computer-use hand narrating as it drives, a CLI run stamping line numbers); aligning the
// emitter's positions to the evidence is the emitter's own job. The map rides as a second content-addressed
// blob on the reading, never a new ndjson column beyond the one hash.
//
// The step is anchored to the evidence's OWN axis, tagged by `axis`: `time` (ms, a video), `frame` (a still
// SEQUENCE by index), `line` (a transcript by line number), `index` (a bare action ordinal). The set is
// OPEN by convention — an unknown axis is legal and a reader renders its positions as bare numbers. `stepAt`
// (last step at or before a position) is axis-agnostic and unchanged.

export type TimelineEvent = { at: number; step: string; node?: string }
export type StepTimeline = { v: 2; axis: string; events: TimelineEvent[] }

// legacy v1 is the TIME axis with `tMs` as the position — read losslessly, normalized to the axis-tagged
// shape (`axis: 'time'`, `at: tMs`). Kept forever: an emitter that only knew `{ v: 1, events: [{ tMs }] }`
// still files a valid video step-map.
export type LegacyTimelineEvent = { tMs: number; step: string; node?: string }
export type LegacyStepTimeline = { v: 1; events: LegacyTimelineEvent[] }

const V2_EVENT_KEYS = new Set(['at', 'step', 'node'])
const V1_EVENT_KEYS = new Set(['tMs', 'step', 'node'])

// validate LOUD — every violation named, [] when well-formed. Both schema versions are accepted: v1 (legacy
// time axis, `tMs`) and v2 (axis-tagged, `at`). The key set is closed per version (like the eval.md
// scenario schema): a malformed timeline is rejected at filing time, never silently reshaped. The `axis`
// string itself is open — only its ABSENCE is an error, never an unrecognized value.
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

// normalize any VALID timeline (v1 or v2) to the axis-tagged shape every reader uses: v1 IS the time axis
// with `tMs` as the position. Call only on input `validateTimeline` accepted. This is the whole of the
// lossless back-compat: an old v1 blob and a new `{ v: 2, axis: 'time' }` render identically.
export function normalizeTimeline(raw: unknown): { axis: string; events: TimelineEvent[] } {
  const o = (raw ?? {}) as Record<string, any>
  const events: any[] = Array.isArray(o.events) ? o.events : []
  if (o.v === 1) return { axis: 'time', events: events.map((e) => ({ at: e.tMs, step: e.step, ...(e.node ? { node: e.node } : {}) })) }
  return { axis: typeof o.axis === 'string' ? o.axis : 'time', events: events.map((e) => ({ at: e.at, step: e.step, ...(e.node ? { node: e.node } : {}) })) }
}

// the whole of "which step is this position": the last event at or before `pos`; null before the first event
// (a plain moment, no step to name — graceful, never an error). Axis-agnostic — `pos` is on the events' axis.
export function stepAt(events: TimelineEvent[], pos: number): TimelineEvent | null {
  let hit: TimelineEvent | null = null
  for (const e of events) {
    if (e.at <= pos) hit = e
    else break
  }
  return hit
}
