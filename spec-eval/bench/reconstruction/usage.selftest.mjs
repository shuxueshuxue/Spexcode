// regression test for aggregateStream ([[spec-reconstruction-bench]]) — proves cumulative snapshots are
// NOT double-counted, terminals sum across message ids, and a non-monotonic decrease fails loud.
//   run: node spec-eval/bench/reconstruction/usage.selftest.mjs   (exit 0 = pass)
import { aggregateStream } from './usage.mjs'

let failed = 0
const check = (name, cond, detail = '') => { if (!cond) { failed++; console.log(`  ✗ ${name} ${detail}`) } else console.log(`  ✓ ${name}`) }

// two assistant messages, each streamed as CUMULATIVE snapshots (rising within a message id).
// naive per-event summation would give input 10+20+20 + 5+15 = 70; correct = terminal 20 + 15 = 35.
const streamA = [
  { type: 'system', subtype: 'init', model: 'glm-5.2' },
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 10, output_tokens: 2 } } },
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 20, output_tokens: 6 } } },
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 20, output_tokens: 8 } } }, // duplicate-ish final legal
  { type: 'assistant', message: { id: 'm2', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 5, output_tokens: 3 } } },
  { type: 'assistant', message: { id: 'm2', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 15, output_tokens: 7 } } },
  { type: 'result', subtype: 'success', usage: { input_tokens: 999 } }, // diagnostic only — must NOT be summed
]
const a = aggregateStream(streamA, 'glm-5.2')
check('two message ids', a.messages === 2, `got ${a.messages}`)
check('input terminal-sum = 35 (not 70)', a.totals.input_tokens === 35, `got ${a.totals.input_tokens}`)
check('output terminal-sum = 15 (not 26)', a.totals.output_tokens === 15, `got ${a.totals.output_tokens}`)
check('result.usage not summed', a.totals.input_tokens !== 999 + 35, `got ${a.totals.input_tokens}`)
check('resultUsage kept as diagnostic', a.resultUsage && a.resultUsage.input_tokens === 999)
check('accountingValid', a.accountingValid === true)
check('modelClean {glm-5.2}', a.modelClean === true, JSON.stringify(a.apiModels))
check('realCompletion', a.realCompletion === true)

// a DECREASE within a message id (non-monotonic) => accounting-invalid, fail loud
const streamB = [
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 30, output_tokens: 10 } } },
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 12, output_tokens: 10 } } }, // decreased!
]
const b = aggregateStream(streamB, 'glm-5.2')
check('decrease flagged accounting-invalid', b.accountingValid === false && b.anomalies.length === 1, JSON.stringify(b.anomalies))

// a missing field keeps the prior value (not erased to 0)
const streamC = [
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 8, cache_read_input_tokens: 4, output_tokens: 1 } } },
  { type: 'assistant', message: { id: 'm1', role: 'assistant', model: 'glm-5.2', usage: { input_tokens: 8, output_tokens: 5 } } }, // cache_read missing this event
]
const c = aggregateStream(streamC, 'glm-5.2')
check('missing field keeps prior value', c.totals.cache_read_input_tokens === 4, `got ${c.totals.cache_read_input_tokens}`)
check('missing field does not erase, output terminal 5', c.totals.output_tokens === 5, `got ${c.totals.output_tokens}`)

// a <synthetic> API-error message: model provenance clean requires a REAL response; error surfaced
const streamD = [
  { type: 'system', subtype: 'init', model: 'glm-5.2' },
  { type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Request rejected (429) rate limit' }] } },
  { type: 'result', subtype: 'success' },
]
const d = aggregateStream(streamD, 'glm-5.2')
check('no real completion when only synthetic', d.realCompletion === false)
check('modelClean false when no real response', d.modelClean === false, JSON.stringify(d.apiModels))
check('apiError surfaced', typeof d.apiError === 'string' && /429/.test(d.apiError), String(d.apiError))
check('<synthetic> excluded from apiModels', !d.apiModels.includes('<synthetic>'))

console.log(failed ? `\nUSAGE SELFTEST FAILED (${failed})` : '\nusage selftest ✓ all pass')
process.exit(failed ? 1 : 0)
