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

// @@@ searchSpecs - load the node corpus, map to the ranker's input shape, rank. The NODE field map: name =
// `title id` (both carry the chosen identity), desc = the one-line summary, body = the spec prose. Nodes are
// pre-sorted by the node tiebreak (shorter id, then id) BEFORE ranking: rankDocs sorts stably, so equal-scored
// nodes keep this order — which reproduces the old explicit `id.length || id.localeCompare` tiebreak exactly.
// The invariant search.bench.mjs guards: its recall/MRR numbers are UNCHANGED by this extraction (a
// behaviour-preserving refactor — the scorer moved to ./ranker.ts, the maths did not).
export async function searchSpecs(query: string, opts: { limit?: number } = {}): Promise<SearchResult[]> {
  const nodes = loadSpecsLite()
    .slice()
    .sort((a, b) => a.id.length - b.id.length || a.id.localeCompare(b.id))
  const inputs: RankInput<(typeof nodes)[number]>[] = nodes.map((s) => ({
    ref: s, name: `${s.title} ${s.id}`, desc: s.desc, body: s.body,
  }))
  return rankDocs(query, inputs, opts).map((r) => ({
    id: r.ref.id, title: r.ref.title, path: r.ref.path, score: r.score, snippet: r.snippet,
  }))
}
