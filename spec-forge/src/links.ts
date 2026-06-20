import type { ForgeIssue, ForgePR } from './port.js'

// @@@ link resolver - the host-agnostic heart of spec-forge. Given a host's open issues/PRs (whatever a
// driver fetched) and the set of real node ids, it INVERTS them into per-node link lists: node → the
// work (issues/PRs) pointing at it. Pure — no network, no git, no writes. Three link sources, in order:
//   branch  - a PR heading off `node/<id>` IS a link to that node (free, structural, no convention).
//   marker  - an issue body line `Spec: <id>[, <id>...]` names the node(s) it serves (the one convention).
//   pr      - an issue with no marker still links TRANSITIVELY through a PR that closes it on a node
//             branch (issue ← PR.closesIssues, PR → node via branch). Covers worked issues for free.

// @@@ LinkedIssue / LinkedPR - one work object resolved onto a node, carrying only what a display needs
// plus `via`: which of the three sources established the link (so a UI can show "marker" vs inferred).
export type LinkedIssue = ForgeIssue & { via: 'marker' | 'pr' }
export type LinkedPR = ForgePR & { via: 'branch' }
export type NodeLinks = { node: string; issues: LinkedIssue[]; prs: LinkedPR[] }

// @@@ parseSpecMarkers - pull node ids out of an issue body. Matches every `Spec: a, b` line
// (case-insensitive, the line may be indented), splits the comma list, and trims. Returns raw ids; the
// caller filters to KNOWN node ids so a typo'd marker silently links nothing rather than inventing a node.
export function parseSpecMarkers(body: string): string[] {
  const ids: string[] = []
  for (const m of (body || '').matchAll(/^\s*spec:\s*(.+)$/gim)) {
    for (const part of m[1].split(',')) {
      const id = part.trim()
      if (id) ids.push(id)
    }
  }
  return ids
}

// @@@ branchToNode - resolve a PR head branch to a node id. The branch is `node/<id>-<shortsha>` but an
// id itself contains dashes (`spec-forge`), so we don't guess where the suffix starts — we match against
// the KNOWN ids: strip `node/`, then take the longest known id that equals the rest or is its `<id>-…`
// prefix. Longest-match so `spec-forge` wins over a hypothetical `spec`. Returns null for a non-node branch.
export function branchToNode(branch: string, nodeIds: string[]): string | null {
  if (!branch?.startsWith('node/')) return null
  const rest = branch.slice('node/'.length)
  let best: string | null = null
  for (const id of nodeIds) {
    if (rest === id || rest.startsWith(id + '-')) {
      if (!best || id.length > best.length) best = id
    }
  }
  return best
}

// @@@ resolveLinks - build the node → work inversion. Walk PRs first (branch links + a number→node map so
// issues can resolve transitively), then issues (marker links, then the transitive fallback for issues a
// PR closes but no marker named). De-dups per node so an issue linked by BOTH a marker and a PR appears
// once (marker wins — the explicit intent). Returns only nodes that actually have links, sorted by id.
export function resolveLinks(
  issues: ForgeIssue[],
  prs: ForgePR[],
  nodeIds: string[],
): NodeLinks[] {
  const known = new Set(nodeIds)
  const byNode = new Map<string, { issues: Map<number, LinkedIssue>; prs: Map<number, LinkedPR> }>()
  const slot = (node: string) => {
    let s = byNode.get(node)
    if (!s) { s = { issues: new Map(), prs: new Map() }; byNode.set(node, s) }
    return s
  }

  // PRs: branch → node (free structural link), and remember which node each PR belongs to.
  const prNode = new Map<number, string>()
  for (const pr of prs) {
    const node = branchToNode(pr.headRefName, nodeIds)
    if (!node) continue
    prNode.set(pr.number, node)
    slot(node).prs.set(pr.number, { ...pr, via: 'branch' })
  }

  // Issues by marker — the explicit convention. Unknown ids are dropped (no inventing nodes).
  const issueByNumber = new Map(issues.map((i) => [i.number, i]))
  for (const issue of issues) {
    for (const id of parseSpecMarkers(issue.body)) {
      if (known.has(id)) slot(id).issues.set(issue.number, { ...issue, via: 'marker' })
    }
  }

  // Transitive: a PR on a node branch that closes an issue links that issue to the node — unless a marker
  // already linked it (marker wins, so we don't overwrite the explicit source with the inferred one).
  for (const pr of prs) {
    const node = prNode.get(pr.number)
    if (!node) continue
    for (const num of pr.closesIssues) {
      const issue = issueByNumber.get(num)
      if (issue && !slot(node).issues.has(num)) {
        slot(node).issues.set(num, { ...issue, via: 'pr' })
      }
    }
  }

  return [...byNode.entries()]
    .map(([node, s]) => ({ node, issues: [...s.issues.values()], prs: [...s.prs.values()] }))
    .sort((a, b) => a.node.localeCompare(b.node))
}
