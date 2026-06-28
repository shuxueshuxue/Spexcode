// @@@ ranker - the SHARED, I/O-FREE lexical scoring core. One ranking algorithm, two callers: the server
// `searchSpecs` (spec-cli/src/search.ts) feeds it spec NODES; the dashboard `/` palette
// (spec-dashboard/src/SpecSearch.jsx) feeds it all FOUR planes (nodes/sessions/issues/scenarios). Lifting it
// here is the answer to "two diverging rank implementations": the SCORING is identical (human and agent rank
// the same), while each caller keeps its own intent — the server tokenises a question, the palette can pass a
// typed fragment — by simply choosing what `query` and `docs` it hands in. Pure: no fs, no git, no DOM, so
// vite bundles it for the browser AND tsx runs it server-side. The score scale is one scale (same scorer), so
// a caller mixing planes gets a single sortable list for free.

// tier multipliers, name > desc > body. A doc's NAME is the strongest signal, its one-line DESC a curated
// summary (next), its BODY the weakest per-hit — but the body carries BM25 term-frequency so a doc that
// genuinely concentrates a rare word still climbs. IDF scales all three. The spread only ORDERS the tiers;
// the discriminating magnitude comes from rarity (IDF) and body-density (BM25), not these constants — which
// is why they sit in flat plateaus rather than being fitted to any case.
const W_NAME_PREFIX = 8
const W_NAME_SUBSTR = 5
const W_DESC = 3
const W_BODY = 1

// a tiny stoplist of question scaffolding + length-1 tokens, dropped so "how does the … is it …" can't drown
// the content words. Deliberately small and general — NOT tuned to any benchmark; just the function words a
// natural-language query carries that match nothing meaningful.
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'its', 'as', 'at', 'by', 'for',
  'how', 'does', 'do', 'what', 'which', 'that', 'this', 'these', 'those', 'with', 'from', 'into', 'are',
  'be', 'can', 'just', 'them', 'they', 'their', 'so', 'if', 'not', 'no', 'but', 'vs', 'us', 'we', 'you',
])

// split on non-alphanumeric, lowercase, drop stopwords + length-1 tokens, de-dup.
export function terms(query: string): string[] {
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

// @@@ asymmetric word-prefix - matching is by field, because the fields want different stemming:
//   name  (forward only)   — the term begins a name word (`guard`→`main-guard`). A name is short and chosen;
//                            we do NOT run the reverse direction, or a plural query (`specs`) would light up
//                            every `spec-*` name in a tree where "spec" saturates.
//   text  (bidirectional)  — either is a prefix of the other (`merge`→`merging` AND `specs`→`spec`), used for
//                            desc and body, so a singular/plural mismatch still matches. Reverse is gated to
//                            words ≥3 chars so a stray short word (`on`, `id`) can't swallow a longer term;
//                            IDF neutralises whatever generic words this extra reach pulls in.
function nameMatch(term: string, w: string): boolean { return w.startsWith(term) }
function textMatch(term: string, w: string): boolean { return w.startsWith(term) || (w.length >= 3 && term.startsWith(w)) }

// @@@ BM25 saturation - the body tier's strength is its term FREQUENCY, with diminishing returns and length-
// normalised, so a doc that SAYS "owner" eight times outranks a long off-topic doc that mentions "file" once
// — without a 50-mention doc swamping everything (saturation) and without a long doc scoring high merely by
// being long (the len/avg term). Classic BM25 tf component; K1 sets how fast frequency saturates, B how hard
// length is penalised. Both sit in a wide insensitive plateau. tf=0 → 0.
const K1 = 1.2
const B = 0.4
function bm25tf(tf: number, len: number, avgLen: number): number {
  if (tf <= 0) return 0
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (avgLen || 1)))
}

// the precomputed searchable fields of one doc (built once, reused for df, scoring, and snippet).
type Fields<T> = { ref: T; name: string; nameWords: string[]; desc: string; descWords: string[]; bodyWords: string[]; snippetText: string }

// the pre-IDF weight a term earns against one doc, picking its single best tier (three fields): a name
// word-prefix beats a name substring beats a desc hit beats a body hit. Name and desc are short, chosen
// fields → binary presence; the body carries the BM25-saturated, length-normalised frequency that
// discriminates the long ties.
function tierWeight<T>(term: string, n: Fields<T>, avgBodyLen: number): number {
  if (n.nameWords.some((w) => nameMatch(term, w))) return W_NAME_PREFIX
  if (n.name.includes(term)) return W_NAME_SUBSTR
  if (n.descWords.some((w) => textMatch(term, w))) return W_DESC
  const tf = n.bodyWords.reduce((c, w) => c + (textMatch(term, w) ? 1 : 0), 0)
  return W_BODY * bm25tf(tf, n.bodyWords.length, avgBodyLen)
}

// a short single-line window of prose around the FIRST matched term, so a reader sees WHY it matched. Falls
// back to the desc (then the text head) when only the name matched. Collapsed to one line, ~window chars.
function snippetFor(text: string, desc: string, qterms: string[], window = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim()
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

// what a caller hands in per doc: the original item (`ref`, returned verbatim) + its three text fields.
export type RankInput<T> = { ref: T; name: string; desc: string; body: string }
export type Ranked<T> = { ref: T; score: number; snippet: string }

// @@@ rankDocs - the one entrypoint both callers share. Sums each query term's best-tier weight × its IDF
// across the supplied corpus; a term saturating the corpus (`spec`, `node`, `session`) has IDF≈0 and is
// near-neutral however many names it hits, while a rare content word carries the rank. Keeps only docs that
// hit ≥1 term, sorts by score DESC, caps to `limit` (default 10). TIES: the sort is STABLE, so equal-scored
// docs keep the caller's input order — the caller pre-sorts `inputs` in its own tiebreak (the server: shorter
// id then id; the palette: plane order then shorter name) so this core stays free of any caller's identity.
export function rankDocs<T>(query: string, inputs: RankInput<T>[], opts: { limit?: number } = {}): Ranked<T>[] {
  const limit = opts.limit ?? 10
  const qterms = terms(query)
  if (!qterms.length) return []

  const docs: Fields<T>[] = inputs.map((d) => {
    const name = d.name.toLowerCase()
    return {
      ref: d.ref, name, nameWords: words(name),
      desc: d.desc.toLowerCase(), descWords: words(d.desc),
      bodyWords: words(d.body),
      snippetText: `${d.desc}\n${d.body}`,
    }
  })

  // @@@ IDF - document frequency per query term = how many docs contain it (in any field); idf = ln(N/df), so
  // a term in ALL docs contributes 0 (perfectly neutral) and a term in one doc contributes ln(N). Read FROM
  // the corpus, not hand-set — the rarity weighting is what makes ranking robust to words that saturate it.
  const N = docs.length
  const avgBodyLen = docs.reduce((a, n) => a + n.bodyWords.length, 0) / (N || 1)
  const idf: Record<string, number> = {}
  for (const t of qterms) {
    let df = 0
    for (const n of docs) {
      if (n.nameWords.some((w) => nameMatch(t, w)) || n.descWords.some((w) => textMatch(t, w)) || n.bodyWords.some((w) => textMatch(t, w))) df++
    }
    idf[t] = df > 0 ? Math.log(N / df) : 0
  }

  const scored: Ranked<T>[] = []
  for (const n of docs) {
    let score = 0
    for (const t of qterms) score += tierWeight(t, n, avgBodyLen) * idf[t]
    if (score <= 0) continue
    scored.push({ ref: n.ref, score: Math.round(score * 100) / 100, snippet: snippetFor(n.snippetText, n.desc, qterms) })
  }
  scored.sort((a, b) => b.score - a.score)   // stable: equal scores keep the caller's pre-sorted input order
  return scored.slice(0, limit)
}
