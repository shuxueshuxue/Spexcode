import type { ForgeIssue, ForgePR } from './port.js'
import { resolveLinks, type LinkedIssue } from './links.js'

export const NEEDS_YATSU_EVAL = 'needs-yatsu-eval'

// a bare-marker body line: the name alone, case-insensitive, any indent, optional trailing colon — content after it (`needs-yatsu-eval: foo`) is NOT a match
const BODY_MARKER = new RegExp(`^\\s*${NEEDS_YATSU_EVAL}\\s*:?\\s*$`, 'im')

export function isNeedsYatsuEval(issue: ForgeIssue): boolean {
  if (issue.labels.some((l) => l.trim().toLowerCase() === NEEDS_YATSU_EVAL)) return true
  return BODY_MARKER.test(issue.body || '')
}

export type EvalPending = LinkedIssue
export type NodeEvalPending = { node: string; pending: EvalPending[] }

export function resolveEvalPending(
  issues: ForgeIssue[],
  prs: ForgePR[],
  nodeIds: string[],
): NodeEvalPending[] {
  const flagged = new Set(issues.filter(isNeedsYatsuEval).map((i) => i.number))
  if (!flagged.size) return []
  const out: NodeEvalPending[] = []
  for (const { node, issues: linked } of resolveLinks(issues, prs, nodeIds)) {
    const pending = linked.filter((i) => i.state === 'open' && flagged.has(i.number))
    if (pending.length) out.push({ node, pending })
  }
  return out
}
