import type { DerivedStatus } from '../../spec-cli/src/specs.js'

// @@@ inbound triage - the first forge direction (sibling of the outbound mirror). Where the outbound
// mirror projects a node OUT as a PR and the port projects pending nodes OUT as issues, inbound triage is
// the one direction that flows IN: a forge issue becomes a `pending` spec node — born outside, then it
// LIVES in the graph. After that birth the graph owns it; the forge never speaks for it again.
//
// Contract (non-negotiable, and the WHOLE POINT of this direction): git/`.spec` is the single source of
// truth; the forge is only a PROJECTION and NEVER flows back as authority. Inbound is the one inward edge,
// so the guard matters most here — provenance is RECORDED but is not AUTHORITY. Once an issue is imported,
// forge state (labels, comments, PR-merge) must NEVER mutate the node's version or status. This slice is a
// PURE MAPPING only: no network, no file writes, no node creation — it takes issue payloads and returns
// pending-node descriptors, which are PROPOSALS for nodes, not writes.

// @@@ ForgeIssue - the small, stable, vendor-neutral subset an inbound issue collapses to across every
// host: a title, a body, labels, an author, and the host ref (which host + the issue's id and url there).
// The twin of port.ts's IssueRow, pointed the other way — one shape a per-host driver fills from its
// issue API later. `host`/`hostId`/`url` are pure PROVENANCE: they say where this came from, never what
// the node should become.
export type ForgeIssue = {
  title: string
  body: string
  labels: string[]
  author: string
  host: string
  hostId: string
  url: string
}

// @@@ Provenance - the read-only origin record carried onto a pending node: which host, which issue id,
// which url, and who authored it there. It is a FOOTNOTE, never a controller — nothing downstream reads it
// to decide a node's version or status. Keeping it on its own field (not folded into the body) makes the
// one-way guard structural: the node's authority lives in its own fields; provenance just remembers birth.
export type Provenance = {
  host: string
  issue: string
  url: string
  author: string
}

// @@@ PendingNode - the descriptor importIssues returns: a PROPOSAL for a `pending` node, not a write.
// `id` is a kebab-case slug derived from the title (the node id convention = directory basename); `title`
// and `desc` carry the issue's intent; `status` is fixed `'pending'` (typed as the literal so a descriptor
// can NEVER arrive carrying a forge-decided status — the only status inbound can mint is pending). The
// graph, not this descriptor, advances it from there. `from` is the provenance footnote.
export type PendingNode = {
  id: string
  title: string
  desc: string
  status: Extract<DerivedStatus, 'pending'>
  from: Provenance
}

// @@@ slugify - title → kebab-case node id. Same shape spec-cli uses for session/node ids: lowercase,
// non-alphanumerics to dashes, collapse and trim runs, fall back to 'issue' when a title slugs to nothing.
function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'issue'
  )
}

// @@@ importIssues - pure-map each forge issue to a pending-node descriptor. This is the ENTIRE inbound
// slice: no network, no file writes, no node creation — caller decides whether to ever realize a
// descriptor as a real node, and the realized node thereafter belongs to the graph alone. Provenance is
// recorded under `from` but is inert: it is the only trace of the forge, and it carries no authority over
// the node's later version or status.
export function importIssues(issues: ForgeIssue[]): PendingNode[] {
  return issues.map((issue) => ({
    id: slugify(issue.title),
    title: issue.title,
    desc: issue.body,
    status: 'pending',
    from: {
      host: issue.host,
      issue: issue.hostId,
      url: issue.url,
      author: issue.author,
    },
  }))
}
