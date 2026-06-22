import type { ForgeIssue, ForgePR } from './port.js'
import { resolveLinks, type LinkedIssue } from './links.js'

// @@@ needs-yatsu-eval - the forge half of `spex yatsu scan`. A spec is a loss-function design, an
// issue/PR is the optimizer, and yatsu is the evaluator that re-reads the loss. So an OPEN issue can carry
// one more fact than "which node it serves": that the node owes a fresh evaluation — a fix is landing, a
// behavior changed, a repro needs re-reading. This module recognizes that flag and resolves it to a node,
// producing the eval-pending list `spex yatsu scan` consumes alongside its own stale-reading findings.
//
// Read-only and host-agnostic, exactly like links.ts: it consumes whatever a driver fetched and writes
// nothing. The FLAG says "re-evaluate"; the existing link machinery (links.ts) says WHICH node — one
// node-resolution authority, never a second. The marker mirrors `Spec:` in spirit but carries no id: it is
// a predicate, symmetric across its two forms (a label and a body line), and routing stays with Spec:/PR.

export const NEEDS_YATSU_EVAL = 'needs-yatsu-eval'

// @@@ body marker - a line that IS the marker (case-insensitive, any indent, an optional trailing colon),
// `Spec:`-styled but argument-less: it flags the issue, it does not name a node. A line that trails more
// content (`needs-yatsu-eval: foo`) is intentionally NOT a flag — routing is never smuggled in here, it
// stays in the Spec:/PR sources resolveLinks already owns, so there is exactly one place a node is named.
const BODY_MARKER = new RegExp(`^\\s*${NEEDS_YATSU_EVAL}\\s*:?\\s*$`, 'im')

// @@@ isNeedsYatsuEval - the predicate. Flagged iff a label is literally `needs-yatsu-eval` (the driver
// already flattened GitHub's `{name}` labels to strings) OR a body line is the bare marker. Two forms, one
// meaning — a UI/caller never has to learn which form a given forge prefers.
export function isNeedsYatsuEval(issue: ForgeIssue): boolean {
  if (issue.labels.some((l) => l.trim().toLowerCase() === NEEDS_YATSU_EVAL)) return true
  return BODY_MARKER.test(issue.body || '')
}

// @@@ EvalPending / NodeEvalPending - the eval-pending list, keyed by node, that `spex yatsu scan` reads.
// An entry is just the LinkedIssue links.ts already produced (it keeps `via`, so scan can show whether the
// node was named by a marker or inferred through the closing PR). One axis: the issue.
export type EvalPending = LinkedIssue
export type NodeEvalPending = { node: string; pending: EvalPending[] }

// @@@ resolveEvalPending - invert flagged OPEN issues into node → pending evaluations. Node resolution is
// delegated wholesale to resolveLinks (Spec: marker or transitive closing PR), then each node's issues are
// narrowed to the OPEN + flagged ones: open because a closed issue's eval is no longer owed (the keystone —
// the closing PR brackets the A→B step), flagged because that is the whole signal. A flag that resolves to
// NO node links nothing — the same silent drop as a typo'd Spec: marker (links.ts never invents a node).
// Returns only nodes that actually have pending evals, sorted by id (resolveLinks already sorts).
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
