import { searchSpecs } from './search.js'
import { loadSpecs } from './specs.js'

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
