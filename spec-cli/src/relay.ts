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
  // one spec-index read; map each top hit's id → its frontmatter `code:` governed paths (files/dirs/globs).
  const specs = await loadSpecs()
  const codeById = new Map(specs.map((s) => [s.id, (s.code as string[]) ?? []]))
  return hits.map((h) => ({ id: h.id, title: h.title, path: h.path, score: h.score, code: codeById.get(h.id) ?? [] }))
}
