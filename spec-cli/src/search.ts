import { loadSpecsLite } from './specs.js'
import { rankDocs, type RankInput } from './ranker.js'

// @@@ spec-search - the LEXICAL RETRIEVAL FLOOR. Given a natural-language question, rank the spec NODES most
// likely to govern the answer and return ONE shape — { id, title, path, score, snippet } — that three
// consumers reuse: the `spex search` CLI (a human reads it), spec-scout's `--deep` (re-ranks it with an LLM),
// and the spec→code relay (top ids → loadSpecs → their code: files). This file owns ONLY the NODE side: it
// reads the filesystem (loadSpecsLite — no git, cheap cold start), maps each node to the shared ranker's
// {name,desc,body} shape, and hands it to rankDocs. The SCORING itself lives in ./ranker.ts — the same pure
// core the dashboard `/` palette uses, so a human and an agent rank nodes identically. `--deep`, embeddings,
// and the LLM ranker are NOT here (they layer on top, in spec-scout).

export type SearchResult = { id: string; title: string; path: string; score: number; snippet: string }

// @@@ search-compute timing - the floor has NO index or cache: every call re-reads the tree (loadSpecsLite),
// maps it, and re-ranks the whole corpus via rankDocs — O(Q×D) in the corpus token count D. Fine at this scale
// (real latency is Node startup, not this) but it grows with the tree, so when the CLI asks (onStats) we report
// the PURE COMPUTE time of THIS call (excludes process boot + the lazy import) plus the corpus size, to catch
// the day it nears ~1s — the point an index would be overdue. See [[spec-search]]'s yatsu baseline.
export type SearchStats = { nodes: number; tokens: number; ms: number }

// @@@ searchSpecs - load the node corpus, map to the ranker's input shape, rank. The NODE field map: name =
// `title id` (both carry the chosen identity), desc = the one-line summary, body = the spec prose. Nodes are
// pre-sorted by the node tiebreak (shorter id, then id) BEFORE ranking: rankDocs sorts stably, so equal-scored
// nodes keep this order — reproducing the old explicit `id.length || id.localeCompare` tiebreak exactly. The
// scorer lives in ./ranker.ts (shared with the palette); search.bench.mjs guards that this extraction is
// behaviour-preserving (recall/MRR unchanged).
export async function searchSpecs(query: string, opts: { limit?: number; onStats?: (s: SearchStats) => void } = {}): Promise<SearchResult[]> {
  const t0 = performance.now()
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
