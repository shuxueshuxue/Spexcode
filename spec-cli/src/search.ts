import { loadSpecsLite } from './specs.js'

// @@@ spec-search - the LEXICAL RETRIEVAL FLOOR. Given a natural-language question, rank the spec NODES most
// likely to govern the answer and return ONE shape — { id, title, path, score, snippet } — that three
// consumers reuse: the `spex search` CLI (a human reads it), spec-scout's `--deep` (re-ranks it with an LLM),
// and the spec→code relay (top ids → loadSpecs → their code: files). This file owns ONLY the lexical scorer;
// `--deep`, embeddings, and the LLM ranker are NOT here (they layer on top, in spec-scout).
//
// The ranking is the keyboard-nav `/` palette's tiered design (spec-dashboard/src/SpecSearch.jsx rank()),
// lifted server-side and adapted from "one typed fragment" to "a question". The palette matches the whole
// query as ONE substring because a human types a node-name fragment on purpose; a question is many words, so
// we TOKENIZE the query and sum a per-term tier score over THREE fields — name (title+id) > desc > body —
// weighted by corpus IDF and (on the body) BM25 term-frequency. Blunt, robust, lexical: no embeddings, no
// LLM, no per-case tuning. It reads the filesystem only (loadSpecsLite — no git), so a cold `spex search`
// process is cheap to call as often as an agent likes.

export type SearchResult = { id: string; title: string; path: string; score: number; snippet: string }

// tier multipliers, name > desc > body. A node's NAME is the strongest signal, its one-line DESC a curated
// summary (the next strongest), its BODY the weakest per-hit — but the body carries BM25 term-frequency so a
// node that genuinely concentrates a rare word still climbs. IDF scales all three. The spread only ORDERS the
// tiers; the discriminating magnitude comes from rarity (IDF) and body-density (BM25), not these constants —
// which is why they sit in flat plateaus rather than being fitted to any case.
const W_NAME_PREFIX = 8
const W_NAME_SUBSTR = 5
const W_DESC = 3
const W_BODY = 1

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

// @@@ asymmetric word-prefix - matching is by field, because the fields want different stemming:
//   name  (forward only)   — the term begins a name word (`guard`→`main-guard`). A node's name is short and
//                            chosen; we do NOT run the reverse direction here, or a plural query (`specs`)
//                            would light up every `spec-*` node's name in a tree where "spec" saturates.
//   text  (bidirectional)  — either is a prefix of the other (`merge`→`merging` AND `specs`→`spec`), used for
//                            desc and body, so a singular/plural mismatch still matches. Reverse is gated to
//                            words ≥3 chars so a stray short word (`on`, `id`) can't swallow a longer term;
//                            IDF neutralises whatever generic words this extra reach pulls in.
function nameMatch(term: string, w: string): boolean { return w.startsWith(term) }
function textMatch(term: string, w: string): boolean { return w.startsWith(term) || (w.length >= 3 && term.startsWith(w)) }

// @@@ BM25 saturation - the body tier's strength is its term FREQUENCY, with diminishing returns and length-
// normalised, so a node that SAYS "owner" eight times outranks a long off-topic node that mentions "file"
// once — without a 50-mention node swamping everything (saturation) and without a long node scoring high
// merely by being long (the len/avg term). Classic BM25 tf component; K1 sets how fast frequency saturates,
// B how hard length is penalised. Both sit in a wide insensitive plateau. tf=0 → 0.
const K1 = 1.2
const B = 0.4
function bm25tf(tf: number, len: number, avgLen: number): number {
  if (tf <= 0) return 0
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (avgLen || 1)))
}

type NodeFields = { id: string; title: string; path: string; name: string; nameWords: string[]; desc: string; descWords: string[]; bodyWords: string[]; snippetText: string }

// the pre-IDF weight a term earns against one node, picking its single best tier (palette shape, three
// fields): a name word-prefix beats a name substring beats a desc hit beats a body hit. Name and desc are
// short, chosen fields → binary presence; the body carries the BM25-saturated, length-normalised frequency
// that discriminates the long ties.
function tierWeight(term: string, n: NodeFields, avgBodyLen: number): number {
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

// @@@ searchSpecs - the one entrypoint every consumer shares. Sums each query term's best-tier weight × its
// IDF across the corpus; a term saturating the tree (`spec`, `node`, `session`) has IDF≈0 and is near-neutral
// however many titles it hits, while a rare content word (`loss`, `orphan`, `escape`) carries the rank. Keeps
// only nodes that hit ≥1 term, sorts by score DESC (ties → shorter id, then id), caps to `limit` (default 10).
export async function searchSpecs(query: string, opts: { limit?: number } = {}): Promise<SearchResult[]> {
  const limit = opts.limit ?? 10
  const qterms = terms(query)
  if (!qterms.length) return []

  // precompute each node's three searchable fields once (reused for df, scoring, and snippets).
  const nodes: NodeFields[] = loadSpecsLite().map((s) => {
    const name = `${s.title} ${s.id}`.toLowerCase()
    return {
      id: s.id, title: s.title, path: s.path,
      name, nameWords: words(name),
      desc: s.desc.toLowerCase(), descWords: words(s.desc),
      bodyWords: words(s.body),
      snippetText: `${s.desc}\n${s.body}`,
    }
  })

  // @@@ IDF - document frequency per query term = how many nodes contain it (in any field); idf = ln(N/df),
  // so a term in ALL nodes contributes 0 (perfectly neutral) and a term in one node contributes ln(N).
  // Read FROM the corpus, not hand-set — the rarity weighting is what makes the floor robust to the few words
  // (`spec`, `node`) that saturate this particular tree.
  const N = nodes.length
  const avgBodyLen = nodes.reduce((a, n) => a + n.bodyWords.length, 0) / (N || 1)
  const idf: Record<string, number> = {}
  for (const t of qterms) {
    let df = 0
    for (const n of nodes) {
      if (n.nameWords.some((w) => nameMatch(t, w)) || n.descWords.some((w) => textMatch(t, w)) || n.bodyWords.some((w) => textMatch(t, w))) df++
    }
    idf[t] = df > 0 ? Math.log(N / df) : 0
  }

  const scored: SearchResult[] = []
  for (const n of nodes) {
    let score = 0
    for (const t of qterms) score += tierWeight(t, n, avgBodyLen) * idf[t]
    if (score <= 0) continue
    scored.push({ id: n.id, title: n.title, path: n.path, score: Math.round(score * 100) / 100, snippet: snippetFor(n.snippetText, n.desc, qterms) })
  }
  scored.sort((a, b) => b.score - a.score || a.id.length - b.id.length || a.id.localeCompare(b.id))
  return scored.slice(0, limit)
}
