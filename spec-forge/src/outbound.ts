import type { DerivedStatus } from '../../spec-cli/src/specs.js'

// @@@ outbound mirror - the second forge direction (sibling of the inbound triage import). Where a
// driver's listPending() projects pending nodes OUT as issues, the outbound mirror projects a node OUT
// as a PR-shaped object so collaborators who haven't adopted SpexCode still see motion on their host.
//
// Contract (non-negotiable, same as the port): git/`.spec` is the single source of truth; a mirror is
// only a PROJECTION and NEVER flows back as authority. Everything here is a one-way read OUT of the
// graph — pure functions, zero network, zero writes, no mutation of any node's version or status.

// @@@ MirrorPR - the vendor-neutral PR-shaped subset a node collapses to on every host: a title, a head
// branch, a base branch, a body, and labels (plus the `draft` flag the head encodes). This is the
// outbound twin of port.ts's IssueRow — one stable shape a per-host driver maps onto its PR/MR API
// later. `head` is null for a node with no branch yet (a pending todo): a mirror that honestly has
// nowhere to point, which `draft` also reflects.
export type MirrorPR = {
  title: string
  head: string | null
  base: string
  body: string
  labels: string[]
  draft: boolean
}

// @@@ mapStatus - the one mapping from a node's DERIVED 4-state status to vendor-neutral mirror labels.
// Every host gets the same words; a driver renames/colors them onto its label vocabulary later. The
// `status:*` label mirrors the graph's truth; the `mirror:*` label names what the projection looks like
// on the host (a pending node has no branch, so its mirror is a draft; drift means the code moved ahead
// of the spec, so the mirror is stale). `spec` tags every mirror as graph-originated.
const MIRROR_STATE: Record<DerivedStatus, string> = {
  pending: 'draft',
  active: 'open',
  merged: 'merged',
  drift: 'stale',
}
export function mapStatus(status: DerivedStatus): string[] {
  return ['spec', `status:${status}`, `mirror:${MIRROR_STATE[status]}`]
}

// @@@ MirrorInput - the minimal node shape mirrorNode reads. A subset of loadSpecs' node so this module
// stays decoupled from the full reader (and from port.ts/github.ts): id, status, title, and a body to
// project — desc is the node's one-line intent, falling back to the spec body when a node has no desc.
export type MirrorInput = {
  id: string
  status: DerivedStatus
  title: string
  desc?: string
  body?: string
}

// @@@ mirrorNode - project ONE node as a PR-shaped mirror. head is `node/<id>` — the branch convention
// SpexCode's worktrees already use, so a real PR could point at it — EXCEPT for a pending node, which
// has no branch yet: its head is null and it mirrors as a draft (you can't open a PR with no head). base
// is always `main`. The body is the node's intent (desc, or the spec body as fallback). Labels come from
// mapStatus, the single source for the status→label mapping.
export function mirrorNode(node: MirrorInput): MirrorPR {
  const hasBranch = node.status !== 'pending'
  return {
    title: node.title,
    head: hasBranch ? `node/${node.id}` : null,
    base: 'main',
    body: node.desc || node.body || '',
    labels: mapStatus(node.status),
    draft: !hasBranch,
  }
}
