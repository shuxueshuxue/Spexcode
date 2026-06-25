import { loadSpecs } from './specs.js'

// @@@ spec-search - the LEXICAL RETRIEVAL FLOOR. Given a natural-language question, rank the spec NODES most
// likely to govern the answer and return ONE shape — { id, title, path, score, snippet } — that three
// consumers reuse: the `spex search` CLI (a human reads it), spec-scout's `--deep` (re-ranks it with an LLM),
// and the spec→code relay (top ids → loadSpecs → their code: files). This file owns ONLY the lexical scorer;
// `--deep`, embeddings, and the LLM ranker are NOT here (they layer on top, in spec-scout).
//
// The ranking is the keyboard-nav `/` palette's tiered design (spec-dashboard/src/SpecSearch.jsx rank()),
// lifted server-side and adapted from "one typed fragment" to "a question". The palette matches the whole
// query as ONE substring because a human types a node-name fragment on purpose; a question is many words, so
// we TOKENIZE the query and sum a per-term tier score. Same tier SHAPE: name word-prefix > name substring >
// prose word-prefix. Blunt, robust, lexical — no embeddings, no LLM, no per-case tuning.

export type SearchResult = { id: string; title: string; path: string; score: number; snippet: string }

// tier multipliers — a name hit still outranks a prose hit, but the spread is small because the dominant
// signal is the per-term IDF below, not the tier. They only ORDER the tiers; magnitude comes from rarity.
const W_NAME_PREFIX = 8
const W_NAME_SUBSTR = 5
const W_PROSE = 1

// a tiny stoplist of question scaffolding + length-1 tokens, dropped so "how does the … is it …" can't drown
// the content words. Deliberately small and general — NOT tuned to the benchmark; just the function words a
// natural-language query carries that match nothing meaningful.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'its', 'as', 'at', 'by', 'for',
  'how', 'does', 'do', 'what', 'which', 'that', 'this', 'these', 'those', 'with', 'from', 'into', 'are',
  'be', 'can', 'just', 'them', 'they', 'their', 'so', 'if', 'not', 'no', 'but', 'vs', 'us', 'we', 'you',
])

// split on non-alphanumeric, lowercase, drop stopwords + length-1 tokens, de-dup.
function terms(query: string): string[] {
  const seen = new Set<string>()
  for (const w of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length > 1 && !STOP.has(w)) seen.add(w)
  }
  return [...seen]
}

// the words of a field, lowercased — used for word-boundary (prefix-of-a-word) matching, which kills
// short-token pollution (`main` must not match inside `domain`).
function words(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

// @@@ asymmetric word-prefix - matching is by field, because the two fields want different stemming:
//   name  (forward only)   — the term begins a name word (`guard`→`main-guard`). A node's name is short and
//                            chosen; we do NOT run the reverse direction here, or a plural query (`specs`)
//                            would light up every `spec-*` node's name in a tree where "spec" saturates.
//   prose (bidirectional)  — either is a prefix of the other (`merge`→`merging` AND `specs`→`spec`), so a
//                            singular/plural mismatch in the body still matches. Reverse is gated to body
//                            words ≥3 chars so a stray short word (`on`, `id`) can't swallow a longer term;
//                            IDF below neutralises whatever generic words this extra reach pulls in.
function nameMatch(term: string, w: string): boolean { return w.startsWith(term) }
function proseMatch(term: string, w: string): boolean { return w.startsWith(term) || (w.length >= 3 && term.startsWith(w)) }

// @@@ BM25 saturation - a prose tier's strength is its term FREQUENCY, but with diminishing returns and
// length-normalised, so a node that SAYS "owner" eight times outranks a long off-topic node that happens to
// mention "file" once — without a 50-mention node swamping everything (saturation) and without a long node
// scoring high merely by being long (the len/avg term). This is the classic BM25 tf component; K1 sets how
// fast frequency saturates, B how hard length is penalised. tf=0 → 0.
const K1 = 1.2
const B = 0.5
function bm25tf(tf: number, len: number, avgLen: number): number {
  if (tf <= 0) return 0
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (avgLen || 1)))
}

// the pre-IDF weight a term earns against one node, picking its single best tier (palette shape): a name
// word-prefix beats a name substring beats prose. A name hit is binary (a short chosen field); the prose tier
// carries the BM25-saturated, length-normalised term frequency so body-density discriminates the long ties.
function tierWeight(term: string, n: NodeFields, avgLen: number): number {
  if (n.nameWords.some((w) => nameMatch(term, w))) return W_NAME_PREFIX
  if (n.name.includes(term)) return W_NAME_SUBSTR
  const tf = n.proseWords.reduce((c, w) => c + (proseMatch(term, w) ? 1 : 0), 0)
  return W_PROSE * bm25tf(tf, n.proseWords.length, avgLen)
}

type NodeFields = { name: string; nameWords: string[]; proseWords: string[] }

// a short single-line window of prose around the FIRST matched term, so a reader sees WHY it matched. Falls
// back to the desc (then the body head) when only the name matched. Collapsed to one line, ~window chars.
function snippetFor(prose: string, desc: string, qterms: string[], window = 140): string {
  const flat = prose.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  let at = -1
  for (const t of qterms) {
    const m = lower.match(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    if (m && m.index !== undefined && (at < 0 || m.index < at)) at = m.index
  }
  if (at < 0) {
    const fb = (desc || flat).replace(/\s+/g, ' ').trim()
    return fb.length > window ? fb.slice(0, window).trimEnd() + '…' : fb
  }
  const start = Math.max(0, at - Math.floor(window / 3))
  let s = flat.slice(start, start + window).trim()
  if (start > 0) s = '…' + s
  if (start + window < flat.length) s = s + '…'
  return s
}

// @@@ searchSpecs - the one entrypoint every consumer shares. Ranks nodes by summed per-term score, where
// each term's contribution is its tier weight (name vs prose) TIMES its IDF — its rarity across the corpus.
// A term in nearly every node (`spec`, `node`, `session`) has IDF≈0, so it's near-neutral no matter how many
// titles it hits; a rare content word (`loss`, `orphan`, `escape`) dominates. This is what lets prose overlap
// of rare words outrank a generic word sitting in a title — and it makes the bidirectional stemmer safe,
// since the over-broad words it catches are exactly the ones IDF zeroes out. No per-case tuning.
// Keeps only nodes that hit ≥1 term, sorts by score DESC (ties → shorter id, then id), caps to `limit`.
export async function searchSpecs(query: string, opts: { limit?: number } = {}): Promise<SearchResult[]> {
  const limit = opts.limit ?? 10
  const qterms = terms(query)
  const specs = await loadSpecs()
  if (!qterms.length) return []

  // precompute each node's searchable fields once (reused for df, scoring, and snippets).
  const nodes = specs.map((s) => {
    const name = `${s.title} ${s.id}`.toLowerCase()
    const prose = `${s.desc}\n${s.body}`
    return { s, name, nameWords: words(name), prose, proseWords: words(prose) }
  })

  // @@@ IDF - document frequency per query term = how many nodes contain it (in name OR prose); idf =
  // ln(N/df), so a term in ALL nodes contributes 0 (perfectly neutral) and a term in one node contributes
  // ln(N). Computed from the corpus itself, not hand-set — the rarity weighting is what makes the floor
  // robust to the few words (`spec`, `node`) that saturate this particular tree.
  const N = nodes.length
  const avgLen = nodes.reduce((a, n) => a + n.proseWords.length, 0) / (N || 1)
  const idf: Record<string, number> = {}
  for (const t of qterms) {
    let df = 0
    for (const n of nodes) {
      if (n.nameWords.some((w) => nameMatch(t, w)) || n.proseWords.some((w) => proseMatch(t, w))) df++
    }
    idf[t] = df > 0 ? Math.log(N / df) : 0
  }

  const scored: SearchResult[] = []
  for (const n of nodes) {
    let score = 0
    for (const t of qterms) score += tierWeight(t, n, avgLen) * idf[t]
    if (score <= 0) continue
    scored.push({ id: n.s.id, title: n.s.title, path: n.s.path, score: Math.round(score * 100) / 100, snippet: snippetFor(n.prose, n.s.desc, qterms) })
  }
  scored.sort((a, b) => b.score - a.score || a.id.length - b.id.length || a.id.localeCompare(b.id))
  return scored.slice(0, limit)
}
