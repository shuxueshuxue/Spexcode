import { loadSpecs } from '../../../spec-cli/src/specs.js'
import type { ForgeDriver, IssueRow } from '../port.js'

// @@@ github driver - the first, read-only driver behind the forge port. It does NOT reimplement the
// .spec reader: it reuses spec-cli's loadSpecs (git + `.spec` are the source of truth), keeps only the
// nodes whose DERIVED status is `pending` — the graph's native "open issues" — and projects each as a
// GitHub issue-shaped row. Strictly read-only: no network, no writes, no mutation of any node.
export const githubDriver: ForgeDriver = {
  host: 'github',
  async listPending(): Promise<IssueRow[]> {
    const specs = await loadSpecs()
    return specs
      .filter((s) => s.status === 'pending')
      .map((s) => ({
        title: s.title,
        // the node's intent line is the issue body; fall back to the spec body for nodes without a desc.
        body: s.desc || s.body,
        // vendor-neutral labels naming what this projection is and which node it mirrors.
        labels: ['spec', 'status:pending', `node:${s.id}`],
      }))
  },
}
