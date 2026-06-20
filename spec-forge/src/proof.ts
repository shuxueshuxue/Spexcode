// @@@ proof - the smallest runnable demonstration that the link tracer holds end to end against the LIVE
// repo (not a fixture): read GitHub's open issues/PRs through the github driver, resolve them against the
// real node ids, and print node → linked work. Read-only — it never writes a node or the forge. Run with
// `npm run proof` (tsx src/proof.ts) from a repo whose `gh` is authenticated; the same path `spex forge
// links` takes, minus the CLI flags. The link counts are the proof the marker + branch resolution works.
import { loadSpecs } from '../../spec-cli/src/specs.js'
import { githubDriver } from './drivers/github.js'
import { resolveLinks } from './links.js'

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
