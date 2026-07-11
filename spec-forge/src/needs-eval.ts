import type { ForgeIssue, ForgePR } from './port.js'
import { resolveLinks, type LinkedIssue } from './links.js'

export const NEEDS_EVAL = 'needs-eval'

// a bare-marker body line: the name alone, case-insensitive, any indent, optional trailing colon — content after it (`needs-eval: foo`) is NOT a match
const BODY_MARKER = new RegExp(`^\\s*${NEEDS_EVAL}\\s*:?\\s*$`, 'im')

export function isNeedsEval(issue: ForgeIssue): boolean {
  if (issue.labels.some((l) => l.trim().toLowerCase() === NEEDS_EVAL)) return true
  return BODY_MARKER.test(issue.body || '')
}

export type EvalPending = LinkedIssue
export type NodeEvalPending = { node: string; pending: EvalPending[] }

export function resolveEvalPending(
  issues: ForgeIssue[],
  prs: ForgePR[],
  nodeIds: string[],
): NodeEvalPending[] {
  const flagged = new Set(issues.filter(isNeedsEval).map((i) => i.number))
  if (!flagged.size) return []
  const out: NodeEvalPending[] = []
  for (const { node, issues: linked } of resolveLinks(issues, prs, nodeIds)) {
    const pending = linked.filter((i) => i.state === 'open' && flagged.has(i.number))
    if (pending.length) out.push({ node, pending })
  }
  return out
}
