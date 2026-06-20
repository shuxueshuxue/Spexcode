// @@@ forge port - the host-agnostic seam. spec-forge bridges the spec graph to external forges (git
// hosts with issues + code review). The PORT names the abstraction; per-host DRIVERS (github here,
// gitlab/bitbucket later) sit behind it. The name is the seam, never the vendor.
//
// Contract (non-negotiable): git/`.spec` is the single source of truth; a forge is only a PROJECTION
// and NEVER flows back as authority. Every method on this port is therefore a one-way read OUT of the
// graph — nothing here mutates a node's version or status, and (this slice) nothing touches the network.

// @@@ IssueRow - the small, stable common subset a forge issue collapses to across every host: a title,
// a body, and labels. This vendor-neutral shape is what lets ONE port cover GitHub/GitLab/Bitbucket — a
// driver maps it onto its host's issue API later. For this slice it is the projection, returned as-is.
export type IssueRow = {
  title: string
  body: string
  labels: string[]
}

// @@@ ForgeDriver - one implementation per host. `host` names it; `listPending()` is this slice's only
// verb: project the graph's pending nodes (the spec system's native "issues") as forge-issue rows.
// Read-only — it returns objects, performs zero writes, and mutates nothing.
export interface ForgeDriver {
  readonly host: string
  listPending(): Promise<IssueRow[]>
}
