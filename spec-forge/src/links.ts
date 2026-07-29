import type { ForgeIssue, ForgePR } from './port.js'

export type LinkedIssue = ForgeIssue & { via: 'marker' | 'pr' }
export type LinkedPR = ForgePR & { via: 'branch' }
export type NodeLinks = { node: string; issues: LinkedIssue[]; prs: LinkedPR[] }

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

  const prNode = new Map<number, string>()
  for (const pr of prs) {
    const node = branchToNode(pr.headRefName, nodeIds)
    if (!node) continue
    prNode.set(pr.number, node)
    slot(node).prs.set(pr.number, { ...pr, via: 'branch' })
  }

  const issueByNumber = new Map(issues.map((i) => [i.number, i]))
  for (const issue of issues) {
    for (const id of parseSpecMarkers(issue.body)) {
      if (known.has(id)) slot(id).issues.set(issue.number, { ...issue, via: 'marker' })
    }
  }

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
