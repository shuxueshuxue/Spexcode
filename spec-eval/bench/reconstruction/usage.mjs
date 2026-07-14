// spec-reconstruction-bench stream-json accounting ([[spec-reconstruction-bench]]).
//
// Claude Code's stream-json emits CUMULATIVE usage snapshots within one assistant message id (each
// streaming delta carries the running total for that message). Naively summing every event's usage
// double-counts — the known GLM temporal bug. Correct accounting, per the frozen rule:
//   • group by assistant message.id; per (id, field) the values must be MONOTONIC NON-DECREASING in
//     event order. The TERMINAL value is the LAST observed (not the max). Duplicate finals are legal.
//   • a missing field keeps the prior value (never erased). A SMALLER non-missing value than the prior
//     is accounting-invalid → fail-loud (the caller stops the batch and marks the trace accounting-invalid).
//   • totals SUM the terminals across DISTINCT message ids.
//   • the `result` event's usage is DIAGNOSTIC / fallback only — never summed into the totals.
// Model provenance and API-error extraction ride along here so all stream parsing is one testable unit.
export const USAGE_FIELDS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens']

export function aggregateStream(events, expectedModel) {
  const perMsg = new Map()        // id -> { field -> lastValue }
  const anomalies = []            // monotonicity violations => accounting-invalid
  const apiModels = new Set()     // models from real assistant RESPONSES (excludes <synthetic>)
  const allModels = new Set()     // every model tag seen anywhere (diagnostic)
  let resultUsage = null, apiError = null, idx = -1
  for (const e of events) {
    idx++
    const msg = (e && e.message) ? e.message : e
    const model = msg && typeof msg.model === 'string' ? msg.model : null
    if (model) allModels.add(model)
    if (e && e.type === 'result' && (e.usage || (msg && msg.usage))) resultUsage = e.usage ?? msg.usage
    // an API-layer error (e.g. 429 rate limit) surfaces as a <synthetic> assistant message or api_error
    if (model === '<synthetic>' || (e && e.subtype === 'api_error')) {
      const txt = JSON.stringify(msg && msg.content != null ? msg.content : '').match(/API Error[^"\\]*/)?.[0]
      if (txt && !apiError) apiError = txt.slice(0, 200)
    }
    const isAssistant = msg && msg.role === 'assistant'
    if (!isAssistant) continue
    // (G) collect model from EVERY assistant response (not only usage-bearing ones)
    if (model && model !== '<synthetic>') apiModels.add(model)
    if (!(msg.usage && typeof msg.usage === 'object')) continue
    // (G) a usage-bearing assistant event with NO message.id cannot be grouped/deduped → accounting-invalid
    const id = typeof msg.id === 'string' && msg.id ? msg.id : null
    if (!id) { anomalies.push({ id: null, field: '__id', reason: 'usage-bearing assistant event has no message.id' }); continue }
    const rec = perMsg.get(id) ?? {}
    for (const f of USAGE_FIELDS) {
      const v = msg.usage[f]
      if (typeof v === 'number') {
        if (rec[f] !== undefined && v < rec[f]) anomalies.push({ id, field: f, prev: rec[f], got: v })
        rec[f] = v                 // terminal = last observed (monotonic asserted above)
      }
      // missing field: keep the prior value (do nothing)
    }
    rec.__model = model
    perMsg.set(id, rec)
  }
  const totals = Object.fromEntries(USAGE_FIELDS.map((f) => [f, 0]))
  for (const rec of perMsg.values()) for (const f of USAGE_FIELDS) if (typeof rec[f] === 'number') totals[f] += rec[f]
  const realCompletion = [...perMsg.values()].some((r) => (typeof r.output_tokens === 'number' && r.output_tokens > 0) && r.__model === expectedModel)
  return {
    messages: perMsg.size, messageIds: [...perMsg.keys()],
    totals, anomalies, accountingValid: anomalies.length === 0,
    apiModels: [...apiModels], allModels: [...allModels],
    modelClean: apiModels.size >= 1 && [...apiModels].every((m) => m === expectedModel),
    realCompletion, resultUsage, apiError,
  }
}
