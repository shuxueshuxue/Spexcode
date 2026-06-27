import { loadSpecsLite } from './specs.js'
import { rankDocs, type RankInput } from './ranker.js'

export type SearchResult = { id: string; title: string; path: string; score: number; snippet: string }
export type SearchStats = { nodes: number; tokens: number; ms: number }

export async function searchSpecs(query: string, opts: { limit?: number; onStats?: (s: SearchStats) => void } = {}): Promise<SearchResult[]> {
  const t0 = performance.now()
  // pre-sort by (shorter id, then id): rankDocs sorts stably, so for equal-scored nodes this IS the tiebreak.
  const nodes = loadSpecsLite()
    .slice()
    .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))
  const inputs: RankInput<(typeof nodes)[number]>[] = nodes.map((s) => ({
    ref: s, name: `${s.title} ${s.id}`, desc: s.desc, body: s.body,
  }))
  const out = rankDocs(query, inputs, { limit: opts.limit }).map((r) => ({
    id: r.ref.id, title: r.ref.title, path: r.ref.path, score: r.score, snippet: r.snippet,
  }))
  if (opts.onStats) {
    const tokens = inputs.reduce((a, i) => a + `${i.name} ${i.desc} ${i.body}`.split(/[^a-z0-9]+/i).filter(Boolean).length, 0)
    opts.onStats({ nodes: inputs.length, tokens, ms: performance.now() - t0 })
  }
  return out
}
