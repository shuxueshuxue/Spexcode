// @@@ forge port - the host-agnostic seam. spec-forge relates a forge's WORK objects (issues + pull
// requests) to the spec graph's DEFINITION nodes. The PORT names the abstraction; per-host DRIVERS
// (github here via `gh`, gitlab/bitbucket later) sit behind it. The name is the seam, never the vendor.
//
// Two planes, two axes (this is the whole design): a spec node DEFINES (the condition/need); a forge
// issue/PR is the DOING (the working process toward it). They are NOT the same object mirrored — an
// issue is the work spawned by the gap between a node and reality. The port therefore READS the forge
// (it does not project the graph out): a driver fetches the host's open issues/PRs, and host-agnostic
// core (links.ts) resolves each to the node it serves. Read-only: nothing here writes a node's status —
// that stays git-derived. Definition flows DOWN (a node motivates work); only execution facts (a merge)
// flow back, and they reach the graph through git, never through this port.

// @@@ ForgeIssue - the small, stable, vendor-neutral subset a forge ISSUE collapses to across hosts: its
// number, title, body (where the `Spec: <node-id>` marker lives), url, state, and labels. One shape a
// per-host driver fills from its issue API — what lets one port cover GitHub/GitLab/Bitbucket.
export type ForgeIssue = {
  number: number
  title: string
  body: string
  url: string
  state: string
  labels: string[]
}

// @@@ ForgePR - the vendor-neutral subset a PULL REQUEST collapses to. `headRefName` is the branch the PR
// heads off — SpexCode's `node/<id>` convention makes it a FREE structural link to a node, no marker
// needed. `closesIssues` is the issue numbers this PR closes (GitHub's closingIssuesReferences): it lets
// an issue link to a node TRANSITIVELY (issue ← PR → node) without any marker on the issue itself.
export type ForgePR = {
  number: number
  title: string
  url: string
  state: string
  headRefName: string
  closesIssues: number[]
}

// @@@ ForgeDriver - one implementation per host. `host` names it; the two verbs READ the host's open work
// objects. A driver is the ONLY thing that touches the network/CLI; all link resolution is host-agnostic
// and lives in links.ts. Read-only — a driver fetches and returns objects, and writes nothing anywhere.
export interface ForgeDriver {
  readonly host: string
  listIssues(): Promise<ForgeIssue[]>
  listPRs(): Promise<ForgePR[]>
}
