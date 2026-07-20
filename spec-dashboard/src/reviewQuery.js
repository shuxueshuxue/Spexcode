// The ONE token-query engine ([[review-query]]) — pure JS, no React/DOM. Both review ListViews, the
// route layer's legacy replay, and any consumer minting canonical eval/issue addresses import from HERE:
// the visible query TEXT is the single source of truth, and every tab/menu/autocomplete is only a
// BUILDER that rewrites tokens in it (GitHub-measured semantics).

export const ISSUE_QUERY_DEFAULT = 'is:issue state:open'
export const EVAL_QUERY_DEFAULT = 'is:eval'
// the session doors' scoped-list address: the default view, scoped — the text shows exactly that.
export const scopedEvalQuery = (sessionId) => setToken(EVAL_QUERY_DEFAULT, 'scope', sessionId)
// the aggregate score/count doors' address ([[eval-score-badge]]): the default view, node-filtered.
export const nodeEvalQuery = (nodeId) => setToken(EVAL_QUERY_DEFAULT, 'node', nodeId)

const KEY_RE = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/s
const unquote = (v) => (v.length >= 2 && v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v)
export const quoteValue = (v) => (/\s/.test(String(v)) ? `"${v}"` : String(v))

// segment scan preserving EVERY character — whitespace runs and tokens (a `"` swallows spaces until it
// closes), each with [start,end) offsets — so the aria-hidden highlight overlay mirrors the input
// glyph-for-glyph and the autocomplete can find the token under the caret.
export function scanQuery(text) {
  const s = String(text ?? '')
  const out = []
  let i = 0
  while (i < s.length) {
    let j = i
    if (/\s/.test(s[i])) {
      while (j < s.length && /\s/.test(s[j])) j++
      out.push({ ws: true, raw: s.slice(i, j), start: i, end: j })
    } else {
      while (j < s.length && !/\s/.test(s[j])) {
        if (s[j] === '"') {
          j++
          while (j < s.length && s[j] !== '"') j++
          if (j < s.length) j++
        } else j++
      }
      const raw = s.slice(i, j)
      const m = KEY_RE.exec(raw)
      out.push(m
        ? { ws: false, raw, start: i, end: j, key: m[1].toLowerCase(), value: unquote(m[2]) }
        : { ws: false, raw, start: i, end: j, key: null, value: unquote(raw) })
    }
    i = j
  }
  return out
}

export const tokenize = (text) => scanQuery(text).filter((seg) => !seg.ws)
export const serialize = (tokens) => tokens.map((t) => t.raw).join(' ')
export const normalizeQuery = (text) => serialize(tokenize(text))
export const sameQuery = (a, b) => normalizeQuery(a) === normalizeQuery(b)

// duplicate qualifiers: the LAST occurrence wins; bare words all apply.
export const effectiveTokens = (tokens) => {
  const last = new Map()
  for (const t of tokens) if (t.key != null) last.set(t.key, t)
  return tokens.filter((t) => t.key == null || last.get(t.key) === t)
}

export const readToken = (text, key) => {
  const tokens = tokenize(text)
  for (let i = tokens.length - 1; i >= 0; i--) if (tokens[i].key === key) return tokens[i].value
  return ''
}

// token SURGERY: rewrite the key at its first position, drop later duplicates, append when absent,
// remove the key entirely on an empty value. Every other token — known or not — survives verbatim.
export function setToken(text, key, value) {
  const next = value == null || String(value) === ''
    ? null
    : { ws: false, raw: `${key}:${quoteValue(value)}`, key, value: String(value) }
  const out = []
  let placed = false
  for (const t of tokenize(text)) {
    if (t.key === key) {
      if (next && !placed) { out.push(next); placed = true }
      continue
    }
    out.push(t)
  }
  if (next && !placed) out.push(next)
  return serialize(out)
}

// MATCHING is deliberately NOT here: this module owns text — scan/serialize/surgery/suggestions and the
// canonical-address discipline — while the conjunctive field matching (including the unknown-qualifier
// IMPOSSIBLE state) lives in the ONE [[review-filters]] engine, reached through its tokenFilterState
// bridge. A second predicate here would be the exact fork the fusion removed.

// canonical address discipline: the default view is the BARE page address; any other state is exactly
// ?q=<raw text>. An emptied submit falls back to the default (→ bare).
export const queryParam = (text, defaultText) => {
  const trimmed = String(text ?? '').trim()
  if (!trimmed || sameQuery(trimmed, defaultText)) return null
  return { q: trimmed }
}

// A query/filter action resets by omitting page; a PAGINATION action passes a page (including 1) and
// therefore records GitHub's explicit page=1 history form. The distinction is the action, not equivalence.
export const reviewRouteQuery = (text, defaultText, page = null) => {
  const query = queryParam(text, defaultText) || {}
  if (page != null) query.page = String(page)
  return Object.keys(query).length ? query : null
}

// LEGACY structured params → token pairs. `kind=all` maps to nothing: the evidence default IS all.
const LEGACY_PARAMS = {
  state: (v) => ['state', v],
  concluded: (v) => (v === '1' ? ['state', 'closed'] : null),
  ok: (v) => (v === '1' ? ['state', 'reviewed'] : null),
  verdict: (v) => ['verdict', v],
  freshness: (v) => ['freshness', v],
  kind: (v) => (v === 'all' ? null : ['evidence', v]),
  store: (v) => ['store', v],
  author: (v) => ['author', v],
  node: (v) => ['node', v],
  filer: (v) => ['filer', v],
  live: (v) => (v === '1' ? ['session', 'present'] : null),
  session: (v) => ['scope', v],
}

export const hasLegacyParams = (query) =>
  Object.keys(LEGACY_PARAMS).some((k) => query?.[k] != null && query[k] !== '')

// the legacy free q was ONE substring search — it must replay as ONE text token. Quote it whenever the
// tokenizer would read it as anything else: spaces (several words), a colon (q=drift:check would become
// an unknown qualifier and match zero), or a stray quote (which would swallow neighbours).
const freeTextToken = (v) => (/[\s:"]/.test(v) ? `"${v.replace(/"/g, '')}"` : v)

// a legacy LIST address replays as the FULL visible state: the page's default tokens with each legacy
// param surgically applied (live=1→session:present, session=<id>→scope:<id>, ok=1→state:reviewed,
// kind→evidence:), the free-text q appended as ONE bare/phrase token preserving the old
// single-substring search. Returns null when nothing legacy is present.
export function legacyQueryText(defaultText, query) {
  if (!hasLegacyParams(query)) return null
  let text = defaultText
  for (const [param, toPair] of Object.entries(LEGACY_PARAMS)) {
    const v = query[param]
    if (v == null || v === '') continue
    const pair = toPair(String(v))
    if (pair) text = setToken(text, pair[0], pair[1])
  }
  const free = String(query.q ?? '').trim()
  if (free) text = `${text} ${freeTextToken(free)}`.trim()
  return text
}

// inline autocomplete at the caret — client-side and BOUNDED. A bare prefix completes qualifier KEYS
// (insert `key:`, keep typing); a `key:prefix` completes VALUES from the page-supplied candidate list
// only (data-derived; scope = sessions on the current board), capped at 8. Everything else stays
// hand-typable and submits verbatim.
export function suggestAt(text, caret, keys = [], values = {}) {
  const s = String(text ?? '')
  const at = Math.max(0, Math.min(caret ?? s.length, s.length))
  const seg = scanQuery(s).find((g) => !g.ws && g.start < at && at <= g.end)
  if (!seg) return { start: at, end: at, items: [] }
  const typed = s.slice(seg.start, at)
  const m = KEY_RE.exec(typed)
  if (!m) {
    const w = typed.toLowerCase()
    if (!w || w.includes('"')) return { start: seg.start, end: seg.end, items: [] }
    const items = keys.filter((k) => k.startsWith(w)).slice(0, 8)
      .map((k) => ({ type: 'key', key: k, insert: `${k}:` }))
    return { start: seg.start, end: seg.end, items }
  }
  const key = m[1].toLowerCase()
  const prefix = m[2].replace(/^"/, '').replace(/"$/, '').toLowerCase()
  const pool = values[key] || []
  const items = pool
    .filter((c) => String(c.value).toLowerCase().startsWith(prefix) && String(c.value).toLowerCase() !== prefix)
    .slice(0, 8)
    .map((c) => ({ type: 'value', key, value: String(c.value), label: c.label || null, insert: `${key}:${quoteValue(c.value)} ` }))
  return { start: seg.start, end: seg.end, items }
}
