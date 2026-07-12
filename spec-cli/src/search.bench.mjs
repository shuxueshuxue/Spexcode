// throwaway benchmark harness for spec-search — drives the REAL `spex spec search --json` over the holdout
// cases and reports recall@1, recall@3, MRR. The cases live in the node's eval.md.
//
// Labels are node LEAF names, matched with the same de-collision rule the loader applies (specs.ts reId):
// a returned id matches a label if it IS the label or ends with `_<label>` — so a bare leaf keeps matching
// after collision-qualification renames it (e.g. a colliding `probe` leaf → `a_probe`). A label may
// also be written pre-qualified to pin one collision branch.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'spex.mjs')

const CASES = [
  ['exit-cleanup', "does /exit remove the session's worktree and tmux, or just orphan them?", ['session-console']],
  ['owner-at-edit', 'how does an agent learn which spec governs a file it just edited?', ['spec-of-file']],
  ['main-block', 'what stops an agent from committing or merging straight into main?', ['main-guard']],
  ['main-escape', 'the escape hatch that lets seeding run on the main branch', ['main-guard']],
  ['inter-agent-msg', 'how do two running agent sessions send messages to each other?', ['agent-reply-channel', 'comms']],
  ['search-hidden-node', 'keyboard shortcut to find a node hidden inside a collapsed subtree', ['keyboard-nav']],
  ['session-order', 'how is the order of sessions in the session list decided?', ['session-console']],
  ['node-status', 'what makes a node show as pending vs active vs merged vs drift?', ['spec-node-states']],
  ['dashboard-backend', 'how does the dashboard reach the backend API and on which port?', ['api-endpoint']],
  ['loss-measured', "how is a node's loss measured and its scenarios scored?", ['eval-core']],
  ['launch-injection', "what context gets injected into a freshly launched agent's prompt?", ['injected-context']],
  ['read-before-code', 'the one-shot nudge that makes an agent read its spec before touching code', ['spec-first']],
  ['hot-reload', 'zero-downtime backend reload without dropping connections', ['supervisor']],
  ['many-owners', 'can several specs own the same code file, and what happens if too many do?', ['governed-related']],
  ['active-spec-search', 'an injected sub-agent that searches specs for the agent, the spec analog of Explore', ['spec-search']],
  ['declare-done', 'how does a worker declare it is done', ['state']],
]

// de-collision-aware label match: exact id, or the id's trailing `_`-suffix is the label.
const matches = (id, label) => id === label || id.endsWith('_' + label)

let r1 = 0, r3 = 0, mrr = 0
const rows = []
for (const [name, query, expect] of CASES) {
  const out = execFileSync('node', [BIN, 'spec', 'search', query, '--json', '--limit', '10'], { encoding: 'utf8' })
  const results = JSON.parse(out)
  const ids = results.map((x) => x.id)
  const rank = ids.findIndex((id) => expect.some((label) => matches(id, label))) + 1   // 1-based; 0 = not found
  const hit1 = rank === 1
  const hit3 = rank >= 1 && rank <= 3
  if (hit1) r1++
  if (hit3) r3++
  if (rank >= 1) mrr += 1 / rank
  rows.push({ name, rank: rank || '—', top: ids.slice(0, 3).join(', '), expect: expect.join('|') })
}
const n = CASES.length
for (const row of rows) {
  const mark = row.rank === 1 ? '✓1' : (typeof row.rank === 'number' && row.rank <= 3 ? '·3' : (row.rank === '—' ? '✗ ' : `·${row.rank}`))
  console.log(`${mark} ${row.name.padEnd(20)} want=${row.expect.padEnd(22)} rank=${String(row.rank).padStart(2)}  top3: ${row.top}`)
}

// CJK-positive: the corpus is mostly English but a few nodes carry Chinese prose — the root `spexcode`
// node's body repeats 节点 throughout. A per-CJK-character tokenizer must let a Chinese content word reach
// that node; `spex spec search "节点"` MUST return `spexcode` in results (the bug: the old tokenizer split on
// [^a-z0-9]+ and discarded all CJK, so every Chinese query dead-ended at zero results).
const cjkPos = JSON.parse(execFileSync('node', [BIN, 'spec', 'search', '节点', '--json', '--limit', '10'], { encoding: 'utf8' }))
const cjkPosRank = cjkPos.map((x) => x.id).findIndex((id) => matches(id, 'spexcode')) + 1
const cjkPosPass = cjkPosRank >= 1
console.log(`${cjkPosPass ? `✓${cjkPosRank}` : '✗ '} cjk-positive          want=spexcode(节点)                rank=${cjkPosRank || '—'}  top3: ${cjkPos.slice(0, 3).map((x) => x.id).join(', ')}`)

// zero-result fail-loud regression: a CJK query whose characters appear NOWHERE in the corpus (会/话) returns
// nothing, and the zero-result message must still carry the corpus-is-English translate-and-retry fact
// (fail-loud) plus the browse-all next step — CJK support does not suppress the honest zero-result route.
// (No nearest titles: a CJK query has nothing to be lexically near.)
const cjk = execFileSync('node', [BIN, 'spec', 'search', '会话'], { encoding: 'utf8' })
const cjkPass = cjk.includes('corpus is English') && cjk.includes('spex graph')
console.log(`${cjkPass ? '✓ ' : '✗ '} cjk-zero-result       want=corpus-is-English + spex-tree  ${cjkPass ? 'both present' : 'MISSING: ' + cjk.trim()}`)

// zero-result typo routing: an English typo that matches nothing must surface the nearest node titles
// (per-word edit distance) plus the browse-all next step, so a typo routes forward instead of dead-ending.
const typo = execFileSync('node', [BIN, 'spec', 'search', 'kyeboard'], { encoding: 'utf8' })
const typoPass = typo.includes('nearest titles') && typo.includes('keyboard-nav') && typo.includes('spex graph')
console.log(`${typoPass ? '✓ ' : '✗ '} typo-zero-result      want=nearest-titles(keyboard-nav) + spex-tree  ${typoPass ? 'both present' : 'MISSING: ' + typo.trim()}`)

console.log('—'.repeat(72))
console.log(`recall@1 = ${r1}/${n} = ${(r1 / n).toFixed(3)}   recall@3 = ${r3}/${n} = ${(r3 / n).toFixed(3)}   MRR = ${(mrr / n).toFixed(3)}   cjk-positive = ${cjkPosPass ? 'PASS' : 'FAIL'}   cjk-hint = ${cjkPass ? 'PASS' : 'FAIL'}   typo-route = ${typoPass ? 'PASS' : 'FAIL'}`)
