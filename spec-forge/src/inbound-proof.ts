// @@@ inbound proof - the smallest runnable demonstration of inbound triage: feed a couple of sample
// forge issues and print the pending-node descriptors importIssues maps them to. No network, no writes, no
// node creation — a pure mapping. The samples are inline (not the spec graph) precisely because these come
// from OUTSIDE. Run with `npm run inbound-proof` (tsx src/inbound-proof.ts).
import { importIssues, type ForgeIssue } from './inbound.js'

const issues: ForgeIssue[] = [
  {
    title: 'Dark mode flickers on first paint',
    body: 'The theme toggle flashes the light palette for one frame before applying the stored preference.',
    labels: ['bug', 'ui'],
    author: 'octocat',
    host: 'github',
    hostId: '142',
    url: 'https://github.com/acme/app/issues/142',
  },
  {
    title: 'Add CSV export to the reports page',
    body: 'Users want to download the filtered report table as a CSV instead of copy-pasting.',
    labels: ['enhancement'],
    author: 'mona',
    host: 'github',
    hostId: '143',
    url: 'https://github.com/acme/app/issues/143',
  },
]

const nodes = importIssues(issues)
console.log(`spec-forge · inbound triage · ${nodes.length} issue(s) → pending node(s)\n`)
for (const n of nodes) {
  console.log(`pending  ${n.id}`)
  console.log(`         ${n.title}`)
  console.log(`         ${n.desc.split('\n')[0]}`)
  console.log(`         from: ${n.from.host}#${n.from.issue} by ${n.from.author} — ${n.from.url}`)
  console.log()
}
