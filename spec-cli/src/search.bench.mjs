// throwaway benchmark harness for spec-search — drives the REAL `spex search --json` over the 15 holdout
// cases and reports recall@1, recall@3, MRR. Not shipped/committed; the cases live in the node's yatsu.md.
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
  ['session-order', 'how is the order of sessions in the session list decided?', ['session-reorder']],
  ['node-status', 'what makes a node show as pending vs active vs merged vs drift?', ['spec-node-states']],
  ['dashboard-backend', 'how does the dashboard reach the backend API and on which port?', ['api-endpoint']],
  ['loss-measured', "how is a node's loss measured and its scenarios scored?", ['yatsu-core']],
  ['launch-injection', "what context gets injected into a freshly launched agent's prompt?", ['injected-context']],
  ['read-before-code', 'the one-shot nudge that makes an agent read its spec before touching code', ['spec-first']],
  ['hot-reload', 'zero-downtime backend reload without dropping connections', ['supervisor']],
  ['many-owners', 'can several specs own the same code file, and what happens if too many do?', ['governed-related']],
  ['active-spec-search', 'an injected sub-agent that searches specs for the agent, the spec analog of Explore', ['spec-scout']],
]

let r1 = 0, r3 = 0, mrr = 0
const rows = []
for (const [name, query, expect] of CASES) {
  const out = execFileSync('node', [BIN, 'search', query, '--json', '--limit', '10'], { encoding: 'utf8' })
  const results = JSON.parse(out)
  const ids = results.map((x) => x.id)
  const rank = ids.findIndex((id) => expect.includes(id)) + 1   // 1-based; 0 = not found
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
console.log('—'.repeat(72))
console.log(`recall@1 = ${r1}/${n} = ${(r1 / n).toFixed(3)}   recall@3 = ${r3}/${n} = ${(r3 / n).toFixed(3)}   MRR = ${(mrr / n).toFixed(3)}`)
