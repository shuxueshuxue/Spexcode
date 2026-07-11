import { loadSpecsLite } from './specs.js'
import { rankDocs, type RankInput } from './ranker.js'

export type SearchResult = { id: string; title: string; path: string; score: number; snippet: string }
export type SearchStats = { nodes: number; tokens: number; ms: number }

// zero-result fallback: nearest node titles by per-word edit distance over title+id — the lightweight
// string distance that routes a typo'd query to a next step. Each query word takes its best normalised
// Levenshtein similarity against any title/id word (≥0.5, so unrelated words don't accumulate), then the
// words sum. Same loadSpecsLite read as the ranker; deliberately NOT part of rankDocs scoring (this
// tolerates typos, the ranker must not).
export function nearestTitles(query: string, n = 3): { id: string; title: string }[] {
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1)
  const lev = (a: string, b: string) => {
    const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
      let prev = dp[0]
      dp[0] = i
      for (let j = 1; j <= b.length; j++) {
        const cur = dp[j]
        dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
        prev = cur
      }
    }
    return dp[b.length]
  }
  const qws = words(query)
  if (!qws.length) return []   // nothing to be "near" (e.g. a pure-CJK query) — the caller still points at spex graph
  return loadSpecsLite()
    .map((s) => {
      const tws = [...new Set(words(`${s.title} ${s.id}`))]
      let score = 0
      for (const q of qws) {
        let best = 0
        for (const t of tws) best = Math.max(best, 1 - lev(q, t) / Math.max(q.length, t.length))
        if (best >= 0.5) score += best
      }
      return { id: s.id, title: s.title, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ id, title }) => ({ id, title }))
}

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
