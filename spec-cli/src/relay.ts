import { searchSpecs } from './search.js'
import { loadSpecs } from './specs.js'

// @@@ spec→code relay - the THIRD consumer of the lexical floor (after the `spex search` CLI list and
// spec-scout's `--deep` rerank). Given a topic, take the floor's top spec hits and hand back each node's
// GOVERNED `code:` files — so an agent that found the right contract by user-story can jump straight to the
// code that contract governs (then grep/Explore it), closing "floor finds the node → relay finds its code"
// without a second manual lookup. It adds NO scoring of its own: it reuses the frozen floor (searchSpecs)
// for the ranking and the shared spec index (loadSpecs) for each hit's `code:` list. The contract is
// unchanged — this is a downstream reader of `spex search`, not a new ranker.
export type RelayHit = { id: string; title: string; path: string; score: number; code: string[] }

export async function relaySearch(query: string, opts: { limit?: number } = {}): Promise<RelayHit[]> {
  const limit = opts.limit ?? 3
  const hits = await searchSpecs(query, { limit })
  if (!hits.length) return []
  // one spec-index read; per node: its frontmatter `code:` governed paths (files/dirs/globs) + the tree shape.
  const specs = await loadSpecs()
  const codeById = new Map(specs.map((s) => [s.id, (s.code as string[]) ?? []]))
  const childrenOf = new Map<string, string[]>()
  for (const s of specs) if (s.parent) childrenOf.set(s.parent, [...(childrenOf.get(s.parent) ?? []), s.id])
  // @@@ codeless-parent fall-through - a node owns no code: when it's a pure-prose PARENT (e.g. injected-context,
  // whose code lives in its child spec-first). Returning empty would send the agent nowhere, so borrow the union
  // of the node's whole SUBTREE's code:. A general rule (any codeless node → its descendants' files), not a
  // special-case. A node with its own code: keeps exactly that — descendants are only the FALLBACK.
  const subtreeCode = (id: string): string[] => {
    const own = codeById.get(id) ?? []
    if (own.length) return own
    const acc: string[] = []
    const stack = [...(childrenOf.get(id) ?? [])]
    while (stack.length) {
      const c = stack.pop()!
      acc.push(...(codeById.get(c) ?? []))
      stack.push(...(childrenOf.get(c) ?? []))
    }
    return [...new Set(acc)]
  }
  return hits.map((h) => ({ id: h.id, title: h.title, path: h.path, score: h.score, code: subtreeCode(h.id) }))
}
