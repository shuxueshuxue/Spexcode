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
// natural-language query carries that match nothing meaningful. Quantifiers (many, several, same, too…) are
// NOT stopped: in this corpus they are load-bearing ("too many owners" IS the multi-ownership concept —
// dropping them measurably breaks that reach).
const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'its', 'as', 'at', 'by', 'for',
  'how', 'does', 'do', 'what', 'which', 'that', 'this', 'these', 'those', 'with', 'from', 'into', 'are',
  'be', 'can', 'just', 'them', 'they', 'their', 'so', 'if', 'not', 'no', 'but', 'vs', 'us', 'we', 'you',
])

// The corpus is mostly English but not only — some nodes carry CJK prose (the root spexcode node is a whole
// Chinese paragraph), and the dashboard palette ([[shared-ranker]]) ranks session/issue titles that are
// frequently Chinese. CJK has no spaces, so a whitespace/`[^a-z0-9]` split silently discards ALL of it. We
// tokenize the SAME way on both sides: an ASCII alphanumeric run is one token; each CJK character is its own
// token (a unigram). Unigrams — not bigrams — keep the shared prefix-match/IDF/BM25 machinery untouched (a
// single-char query still matches, no bigram edge cases) and stay BLUNT & ROBUST, the floor's whole stance.
// Han (incl. Ext-A + compat) plus Japanese kana; enough to cover the CJK a spec body or a session title carries.
const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff' // Ext-A · Unified · Compat · kana
const TOKEN_RE = new RegExp(`[a-z0-9]+|[${CJK}]`, 'g')
const CJK_RE = new RegExp(`[${CJK}]`)
function isCjk(t: string): boolean { return CJK_RE.test(t) }
function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? []
}

// tokenize, lowercase, drop stopwords + length-1 ASCII tokens (a length-1 CJK token is a real word — keep it), de-dup.
export function terms(query: string): string[] {
  const seen = new Set<string>()
  for (const w of tokenize(query)) {
    if (isCjk(w) || (w.length > 1 && !STOP.has(w))) seen.add(w)
  }
  return [...seen]
}

// the words of a field, lowercased — used for word-boundary (prefix-of-a-word) matching, which kills
// short-token pollution (`main` must not match inside `domain`); CJK chars are single-char words.
function words(text: string): string[] {
  return tokenize(text)
}

// light query-side stem for prefix matching: drop a trailing plural 's' (len≥4, not 'ss') then a mute 'e'
// (len≥5) — so `sessions` prefix-reaches `session`, `merge`→`merg` reaches `merging`, `declare`→`declar`
// reaches `declaration`. Without the e-drop the spec's promised merge↔merging reach silently never worked
// (`'merging'.startsWith('merge')` is false). Query-side only; IDF self-neutralises the extra reach (a
// looser term matches more docs → bigger df → smaller idf), so no flood.
function stem(t: string): string {
  let s = t
  if (s.length >= 4 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1)
  if (s.length >= 5 && s.endsWith('e')) s = s.slice(0, -1)
  return s
}

// name match is forward-only (a chosen short field — reverse would let a stray short word swallow it);
// desc/body match bidirectionally so a longer doc word still reaches a shorter query term, reverse gated to
// words ≥3 chars so a stray short word can't swallow a longer term (IDF neutralises the generic words it
// pulls in).
function nameMatch(term: string, w: string): boolean { return w.startsWith(stem(term)) }
function textMatch(term: string, w: string): boolean { return w.startsWith(stem(term)) || (w.length >= 3 && term.startsWith(w)) }

// classic BM25 tf: frequency with saturation (K1 sets how fast it saturates) and length-normalisation (B),
// both in a wide insensitive plateau. tf=0 → 0.
const K1 = 1.2
const B = 0.4
function bm25tf(tf: number, len: number, avgLen: number): number {
  if (tf <= 0) return 0
  return (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (avgLen || 1)))
}

// the precomputed searchable fields of one doc (built once, reused for df, scoring, and snippet).
type Fields<T> = { ref: T; name: string; nameWords: string[]; desc: string; descWords: string[]; bodyWords: string[]; snippetText: string }

// the pre-IDF weight a term earns against one doc, picking its single best tier (three fields): a name
// word-prefix beats a name substring beats a desc hit beats a body hit. Name is a short, chosen field →
// binary presence. Desc is presence too (a curated one-liner — repetition there is stuffing, not evidence)
// but LENGTH-NORMALISED: it was flat-binary until descs drifted long and a bloated desc became a cheat code
// (one 60-word desc catches every query term a curated one-liner can't). bm25tf(1, avgLen, avgLen) = 1, so
// a hit in an average-length desc scores exactly the old binary W_DESC — the normalisation only bites
// outliers. The body keeps the full BM25-saturated term-frequency that discriminates the long ties.
function tierWeight<T>(term: string, n: Fields<T>, avgBodyLen: number, avgDescLen: number): number {
  if (n.nameWords.some((w) => nameMatch(term, w))) return W_NAME_PREFIX
  if (n.name.includes(term)) return W_NAME_SUBSTR
  if (n.descWords.some((w) => textMatch(term, w))) return W_DESC * bm25tf(1, n.descWords.length, avgDescLen)
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
    // ASCII terms locate at a word boundary (so `main` doesn't hit inside `domain`); a CJK term has no
    // `\b` around it (JS `\b` is ASCII-only), so locate it by plain substring.
    const i = isCjk(t) ? lower.indexOf(t) : lower.search(new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    if (i >= 0 && (at < 0 || i < at)) at = i
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

// the shared entrypoint: sum each query term's best-tier weight × IDF, keep docs hitting ≥1 term, sort by
// score desc (stable — equal scores keep the caller's pre-sorted input order), cap to `limit` (default 10).
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

  // IDF per query term: df = docs containing it (any field), idf = ln(N/df) — a term in every doc scores 0,
  // a rare one carries the rank. Read from the corpus, not hand-set.
  const N = docs.length
  const avgBodyLen = docs.reduce((a, n) => a + n.bodyWords.length, 0) / (N || 1)
  const avgDescLen = docs.reduce((a, n) => a + n.descWords.length, 0) / (N || 1)
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
    for (const t of qterms) score += tierWeight(t, n, avgBodyLen, avgDescLen) * idf[t]
    if (score <= 0) continue
    scored.push({ ref: n.ref, score: Math.round(score * 100) / 100, snippet: snippetFor(n.snippetText, n.desc, qterms) })
  }
  scored.sort((a, b) => b.score - a.score)   // stable: equal scores keep the caller's pre-sorted input order
  return scored.slice(0, limit)
}
