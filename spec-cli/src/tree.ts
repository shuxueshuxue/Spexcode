// @@@ spex tree - the CLI's human-readable graph view: the same assembled board the dashboard's
// tidy-tree renders, as an indented terminal tree. Pure presentation over buildBoard()'s nodes —
// no read path of its own; status colours and badge semantics mirror the dashboard (drift /
// stale-yatsu / open-issues counts). Governed by the spex-tree spec node.

// the subset of a board node this view consumes (buildBoard attaches more; we read only these).
export type TreeNode = {
  id: string
  parent: string | null
  title: string
  status: string
  version?: number
  drift?: number
  ghost?: boolean
  openIssues?: unknown[]
  scenarios?: { name: string }[]
  evals?: { scenario: string; fresh?: boolean }[]
}

export type TreeOpts = { node?: string; depth?: number; color?: boolean }

// dashboard status palette mapped onto ANSI: merged=green, active=cyan (live/in-flight, distinct
// from the warning yellow), drift=yellow (the dashboard's warning colour), pending=muted grey.
const STATUS_ANSI: Record<string, string> = { merged: '32', active: '36', drift: '33', pending: '90' }

// stale-yatsu count: declared scenarios whose LATEST reading exists but is no longer fresh.
// board `evals` is already latest-per-scenario, so this is a straight filter — the same freshness
// axis the dashboard's grey ✓/✗ badges read (score.jsx readingScore).
function staleYatsu(n: TreeNode): number {
  if (!n.scenarios?.length || !n.evals?.length) return 0
  const latest = new Map(n.evals.map((r) => [r.scenario, r]))
  return n.scenarios.filter((s) => { const r = latest.get(s.name); return r && r.fresh === false }).length
}

function childrenIndex(nodes: TreeNode[]): Map<string | null, TreeNode[]> {
  const byParent = new Map<string | null, TreeNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parent) ?? []
    list.push(n)
    byParent.set(n.parent, list)
  }
  return byParent
}

// resolve the display roots: --node picks one subtree; default is the forest of parentless nodes
// (a node whose parent id isn't on the board — a ghost mid-add, say — surfaces as a root rather
// than vanishing). Unknown --node throws (fail loud, caller prints + exits 2), never an empty tree.
function roots(nodes: TreeNode[], nodeId?: string): TreeNode[] {
  if (nodeId) {
    const hit = nodes.find((n) => n.id === nodeId)
    if (!hit) throw new Error(`no spec node "${nodeId}" — spex tree lists every id; spex search <topic> finds one by intent`)
    return [hit]
  }
  const ids = new Set(nodes.map((n) => n.id))
  return nodes.filter((n) => n.parent === null || !ids.has(n.parent))
}

export function renderTree(nodes: TreeNode[], opts: TreeOpts = {}): string {
  const color = opts.color ?? false
  const c = (code: string, t: string) => (color ? `\x1b[${code}m${t}\x1b[0m` : t)
  const byParent = childrenIndex(nodes)
  const lines: string[] = []

  const badges = (n: TreeNode): string => {
    const parts: string[] = []
    if (n.ghost) parts.push(c('90', 'ghost'))
    if (n.drift) parts.push(c('33', `drift:${n.drift}`))
    const stale = staleYatsu(n)
    if (stale) parts.push(c('90', `stale:${stale}`))
    if (n.openIssues?.length) parts.push(c('31', `issues:${n.openIssues.length}`))
    return parts.length ? '  ' + parts.join(' ') : ''
  }

  const line = (n: TreeNode, prefix: string, branch: string) => {
    const code = STATUS_ANSI[n.status] ?? '0'
    // without colour the status word IS the signal, so it always prints — colour only reinforces it.
    const title = n.title && n.title !== n.id ? ' ' + c('90', '· ' + n.title) : ''
    lines.push(`${prefix}${branch}${c(code, '●')} ${n.id} ${c(code, `[${n.status}]`)}${title}${badges(n)}`)
  }

  const walk = (n: TreeNode, prefix: string, branch: string, childPrefix: string, depth: number) => {
    line(n, prefix, branch)
    const kids = byParent.get(n.id) ?? []
    if (!kids.length) return
    if (opts.depth !== undefined && depth >= opts.depth) {
      lines.push(`${childPrefix}${c('90', `└─ … ${kids.length} more (raise --depth)`)}`)
      return
    }
    kids.forEach((k, i) => {
      const last = i === kids.length - 1
      walk(k, childPrefix, last ? '└─ ' : '├─ ', childPrefix + (last ? '   ' : '│  '), depth + 1)
    })
  }

  for (const r of roots(nodes, opts.node)) walk(r, '', '', '', 0)
  return lines.join('\n')
}

// the machine exit: the same filtered subtree as NESTED objects, badge counts precomputed — a
// shaped view, not a replacement for `spex board` (which stays the full flat payload). Pruned
// children degrade to their ids, so --depth still tells the machine what exists below the cut.
export function treeJson(nodes: TreeNode[], opts: TreeOpts = {}): object[] {
  const byParent = childrenIndex(nodes)
  const shape = (n: TreeNode, depth: number): object => {
    const kids = byParent.get(n.id) ?? []
    const pruned = opts.depth !== undefined && depth >= opts.depth
    return {
      id: n.id, title: n.title, status: n.status, version: n.version ?? 0,
      drift: n.drift ?? 0, staleYatsu: staleYatsu(n), openIssues: n.openIssues?.length ?? 0,
      ...(n.ghost ? { ghost: true } : {}),
      children: pruned ? kids.map((k) => k.id) : kids.map((k) => shape(k, depth + 1)),
    }
  }
  return roots(nodes, opts.node).map((r) => shape(r, 0))
}
