// throwaway benchmark harness for spec-search — drives the REAL `spex search --json` over the holdout
// cases and reports recall@1, recall@3, MRR. The cases live in the node's yatsu.md.
//
// Labels are node LEAF names, matched with the same de-collision rule the loader applies (specs.ts reId):
// a returned id matches a label if it IS the label or ends with `_<label>` — so a bare leaf keeps matching
// after collision-qualification renames it (e.g. `spec-scout` → `injected-context_spec-scout`). A label may
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
  ['loss-measured', "how is a node's loss measured and its scenarios scored?", ['yatsu-core']],
  ['launch-injection', "what context gets injected into a freshly launched agent's prompt?", ['injected-context']],
  ['read-before-code', 'the one-shot nudge that makes an agent read its spec before touching code', ['spec-first']],
  ['hot-reload', 'zero-downtime backend reload without dropping connections', ['supervisor']],
  ['many-owners', 'can several specs own the same code file, and what happens if too many do?', ['governed-related']],
  ['active-spec-search', 'an injected sub-agent that searches specs for the agent, the spec analog of Explore', ['spec-scout']],
  ['declare-done', 'how does a worker declare it is done', ['state']],
]

// de-collision-aware label match: exact id, or the id's trailing `_`-suffix is the label.
const matches = (id, label) => id === label || id.endsWith('_' + label)

let r1 = 0, r3 = 0, mrr = 0
const rows = []
for (const [name, query, expect] of CASES) {
  const out = execFileSync('node', [BIN, 'search', query, '--json', '--limit', '10'], { encoding: 'utf8' })
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

// zero-result fail-loud regression: a CJK query over the English corpus returns nothing, and the
// zero-result message must carry the corpus-is-English translate-and-retry fact (fail-loud, unconditional)
// plus the browse-all next step (no nearest titles — a CJK query has nothing to be lexically near).
const cjk = execFileSync('node', [BIN, 'search', '重命名一个会话'], { encoding: 'utf8' })
const cjkPass = cjk.includes('corpus is English') && cjk.includes('spex tree')
console.log(`${cjkPass ? '✓ ' : '✗ '} cjk-zero-result       want=corpus-is-English + spex-tree  ${cjkPass ? 'both present' : 'MISSING: ' + cjk.trim()}`)

// zero-result typo routing: an English typo that matches nothing must surface the nearest node titles
// (per-word edit distance) plus the browse-all next step, so a typo routes forward instead of dead-ending.
const typo = execFileSync('node', [BIN, 'search', 'kyeboard'], { encoding: 'utf8' })
const typoPass = typo.includes('nearest titles') && typo.includes('keyboard-nav') && typo.includes('spex tree')
console.log(`${typoPass ? '✓ ' : '✗ '} typo-zero-result      want=nearest-titles(keyboard-nav) + spex-tree  ${typoPass ? 'both present' : 'MISSING: ' + typo.trim()}`)

console.log('—'.repeat(72))
console.log(`recall@1 = ${r1}/${n} = ${(r1 / n).toFixed(3)}   recall@3 = ${r3}/${n} = ${(r3 / n).toFixed(3)}   MRR = ${(mrr / n).toFixed(3)}   cjk-hint = ${cjkPass ? 'PASS' : 'FAIL'}   typo-route = ${typoPass ? 'PASS' : 'FAIL'}`)
