import { loadSpecs } from '../../../spec-cli/src/specs.js'
import type { ForgeDriver, IssueRow } from '../port.js'

// @@@ gitlab driver - the SECOND read-only driver behind the forge port, and the proof the seam holds:
// it sits behind the SAME `ForgeDriver` and returns the SAME `IssueRow` shape as the github driver. Like
// github it reuses spec-cli's loadSpecs (git + `.spec` stay canonical), keeps only the nodes whose
// DERIVED status is `pending` — the graph's native "open issues" — and projects each as an issue row.
// The vendor flavor lives only in the label vocabulary (gitlab's `::` scoped-label convention), never in
// the row's shape. Strictly read-only: no network, no writes, no mutation of any node.
export const gitlabDriver: ForgeDriver = {
  host: 'gitlab',
  async listPending(): Promise<IssueRow[]> {
    const specs = await loadSpecs()
    return specs
      .filter((s) => s.status === 'pending')
      .map((s) => ({
        title: s.title,
        // the node's intent line is the issue body; fall back to the spec body for nodes without a desc.
        body: s.desc || s.body,
        // gitlab-flavored scoped labels (`status::pending`) — same shape as github, vendor vocab differs.
        labels: ['spec', 'status::pending', `node::${s.id}`],
      }))
  },
}
