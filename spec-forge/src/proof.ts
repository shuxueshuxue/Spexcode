// @@@ proof - the smallest runnable demonstration that the link tracer holds end to end against the LIVE
// repo (not a fixture): read GitHub's open issues/PRs through the github driver, resolve them against the
// real node ids, and print node → linked work. Read-only — it never writes a node or the forge. Run with
// `npm run proof` (tsx src/proof.ts) from a repo whose `gh` is authenticated; the same path `spex forge
// links` takes, minus the CLI flags. The link counts are the proof the marker + branch resolution works.
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { githubDriver } from './drivers/github.js'
import { resolveLinks } from './links.js'
import { ForgeCache, type ForgeDelta } from './cache.js'
import type { ForgeIssue, ForgePR } from './port.js'

// @@@ convergence proof - the deterministic, network-free half: prove the freshness cache's core
// invariant, that a stream of deltas leaves the cache IDENTICAL to a cold full pull of the same final
// state. Build a final open set B, then drive a cache from an earlier state A through the deltas that
// turn A into B (a new issue, a marker edit, a close→remove, a PR branch change), and a duplicated +
// out-of-order delta to exercise idempotence. The cache's view MUST equal resolveLinks(B) exactly.
const issue = (number: number, body: string, title = `issue ${number}`): ForgeIssue =>
  ({ number, title, body, url: `u/i/${number}`, state: 'open', labels: [] })
const pr = (number: number, headRefName: string): ForgePR =>
  ({ number, title: `pr ${number}`, url: `u/p/${number}`, state: 'open', headRefName, closesIssues: [] })

const ids = ['spec-forge', 'links']
// Final state B: issue #1 → links (re-marked), issue #3 → spec-forge (new), PR #2 on node/links branch.
const finalIssues = [issue(1, 'Spec: links'), issue(3, 'Spec: spec-forge')]
const finalPRs = [pr(2, 'node/links-abc123')]

const cache = new ForgeCache()
// Start at A (issue #1 → spec-forge, issue #4 transient, PR #2 on a stale branch), then apply deltas to B.
for (const i of [issue(1, 'Spec: spec-forge'), issue(4, 'Spec: links')]) cache.apply({ kind: 'issue', issue: i })
cache.apply({ kind: 'pr', pr: pr(2, 'node/spec-forge-old') })
const deltas: ForgeDelta[] = [
  { kind: 'issue', issue: issue(1, 'Spec: links') },     // #1 re-marked spec-forge → links
  { kind: 'issue', issue: issue(3, 'Spec: spec-forge') }, // #3 appears
  { kind: 'remove', target: 'issue', number: 4 },          // #4 closed
  { kind: 'pr', pr: pr(2, 'node/links-abc123') },          // PR #2 branch moved to node/links
  { kind: 'pr', pr: pr(2, 'node/links-abc123') },          // duplicate (idempotence)
  { kind: 'remove', target: 'issue', number: 4 },          // remove of an already-gone key (no-op)
]
for (const d of deltas) cache.apply(d)

const got = JSON.stringify(cache.view(ids))
const want = JSON.stringify(resolveLinks(finalIssues, finalPRs, ids))
if (got !== want) {
  console.error('convergence FAILED — delta-fed cache diverged from full pull\n got:', got, '\nwant:', want)
  process.exit(1)
}
console.log('convergence ✓ — delta stream ≡ cold full pull (idempotent, order-tolerant)\n')

const nodeIds = (await loadSpecs()).map((s) => s.id)
const [issues, prs] = await Promise.all([githubDriver.listIssues(), githubDriver.listPRs()])
const resolved = resolveLinks(issues, prs, nodeIds)

console.log(
  `spec-forge · ${githubDriver.host} · scanned ${issues.length} issue(s), ${prs.length} pr(s)` +
    ` → ${resolved.length} linked node(s)\n`,
)
for (const n of resolved) {
  console.log(n.node)
  for (const i of n.issues) console.log(`  issue #${i.number} ${i.state}  ${i.title}  (via ${i.via})`)
  for (const p of n.prs) console.log(`  pr    #${p.number} ${p.state}  ${p.title}  ${p.headRefName}`)
}
