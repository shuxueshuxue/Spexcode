import { useEffect, useState } from 'react'
import { EVAL_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, hasLegacyParams, legacyQueryText, sameQuery, scopedEvalQuery } from './reviewQuery.js'

// The app's URL layer ([[side-nav]]): every top-level page has its own address, so a page can be
// bookmarked, reloaded, and history-navigated like any modern app. HASH routes (#/graph, #/sessions,
// #/sessions/<id>, #/evals[?query], #/evals/<node>/<scenario>[?query], #/issues[?query], #/issues/<id>,
// #/settings) — deliberately not the History API: the dashboard ships as a static dist behind plain file
// servers/gateways with no index.html fallback, and a hash route needs nothing from the server. No router
// dependency.
//
// The hash carries TWO axes (the GitHub list-URL grammar): the PATH names the object (a page, a detail),
// the QUERY carries view state (a list's filters, the evals session scope) — so a filtered list is a
// copyable, Back-restorable address and every consumer re-derives its whole state from the URL.

export const PAGES = ['graph', 'sessions', 'evals', 'issues', 'settings']

// canonical query serialization: `q` (the review lists' one token-text param, [[review-query]]) first,
// any remaining keys in sorted order — the same state always prints the same address (hash comparisons
// in navigate() and tests stay byte-stable).
const QUERY_KEYS = ['q', 'page']
export function queryString(query) {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const k of QUERY_KEYS) if (query[k] != null && query[k] !== '') sp.set(k, query[k])
  for (const k of Object.keys(query).filter((key) => !QUERY_KEYS.includes(key)).sort()) {
    if (query[k] != null && query[k] !== '') sp.set(k, query[k])
  }
  // GitHub's issue links use percent-encoded spaces in q, not form-style '+'. Both decode the same, but
  // the URL itself is observable/copyable state, so keep the measured bytes.
  const s = sp.toString().replace(/\+/g, '%20')
  return s ? `?${s}` : ''
}

// '#/sessions/abc' → { page: 'sessions', param: 'abc' }. '#/evals/<node>/<scenario>' → param
// 'node/scenario' (the canonical eval DETAIL address — each segment decoded; the page splits on the first
// '/'). '#/issues/<id>' → the issue detail. Anything after '?' inside the hash is the query axis.
// Anything unknown lands on graph (the home page).
export function parseRoute(hash) {
  const h = (hash || '').replace(/^#\/?/, '')
  const qi = h.indexOf('?')
  const path = qi >= 0 ? h.slice(0, qi) : h
  const query = Object.fromEntries(new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : ''))
  const parts = path.split('/').filter(Boolean)
  const page = PAGES.includes(parts[0]) ? parts[0] : 'graph'
  const param = page === 'sessions' || page === 'evals' || page === 'issues'
    ? (parts.length > 1 ? parts.slice(1).map(decodeURIComponent).join('/') : null)
    : null
  return { page, param, query }
}

// the LEGACY session-eval address ([[session-eval]]): '#/sessions/<id>/eval[/<node>/<scenario>]' → its
// canonical [[evals-view]] form — the scoped default list ('#/evals?q=is:eval state:current scope:<id>')
// or the scope-only detail ('#/evals/<node>/<scenario>?q=scope:<id>').
// Pure: returns the canonical hash, or null when the hash isn't the legacy shape. The rewrite happens at
// the parse layer (useRoute, with replace) so old links keep working and no page-level effect races it.
export function legacyEvalHash(hash) {
  const h = (hash || '').replace(/^#\/?/, '')
  const path = h.split('?')[0]
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== 'sessions' || parts[2] !== 'eval') return null
  const id = decodeURIComponent(parts[1] || '')
  if (!id) return null
  const node = parts[3] ? decodeURIComponent(parts[3]) : null
  const scenario = parts.length > 4 ? parts.slice(4).map(decodeURIComponent).join('/') : null
  const param = node && scenario ? `${node}/${scenario}` : null
  return routeHash('evals', param, { q: param ? `scope:${id}` : scopedEvalQuery(id) })
}

// the LEGACY structured review params ([[review-query]]): an old '#/evals|#/issues' address carrying
// state/concluded/store/author/node/filer/verdict/freshness/kind/live/ok/session params replays as the
// FULL visible token text (the page default with each param surgically applied) — a DETAIL address keeps
// only its worktree scope, never list filters. Returns the canonical hash, or null when the address is
// already canonical (bare, or ?q= only).
export function legacyReviewHash(hash) {
  const { page, param, query } = parseRoute(hash)
  if (page !== 'evals' && page !== 'issues') return null
  if (!hasLegacyParams(query)) return null
  if (param != null) {
    return routeHash(page, param, query.session ? { q: `scope:${query.session}` } : null)
  }
  const defaultText = page === 'issues' ? ISSUE_QUERY_DEFAULT : EVAL_QUERY_DEFAULT
  const text = legacyQueryText(defaultText, query)
  return routeHash(page, null, sameQuery(text, defaultText) ? null : { q: text })
}

export function invalidReviewPageHash(hash) {
  const { page, param, query } = parseRoute(hash)
  if ((page !== 'evals' && page !== 'issues') || param != null || query.page == null) return null
  if (/^[1-9]\d*$/.test(query.page) && Number.isSafeInteger(Number(query.page))) return null
  const { page: _invalid, ...rest } = query
  return routeHash(page, null, rest)
}

// a param's '/'-separated segments are encoded one by one so a multi-segment param (evals' node/scenario)
// keeps its path shape while each segment stays hash-safe.
export const routeHash = (page, param, query = null) =>
  `#/${page}${param ? `/${String(param).split('/').map(encodeURIComponent).join('/')}` : ''}${queryString(query)}`

// Navigate by writing the hash. A page switch, a list→detail open, and a human's filter change all PUSH
// (GitHub-measured: Back restores the previous list URL, filters intact); `replace` is for AUTOMATIC
// state-naming only — a normalization or the session board's selected-tab echo.
export function navigate(page, param = null, { replace = false, query = null } = {}) {
  const h = routeHash(page, param, query)
  if (window.location.hash === h) return
  if (replace) {
    window.history.replaceState(null, '', h)
    // replaceState fires no hashchange; poke the subscribers so every useRoute converges on the URL.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else window.location.hash = h
}

// the live route — one hashchange subscription, parsed; the legacy shapes (session-eval path, structured
// review params) normalize here (replace — idempotent across multiple mounted subscribers) before any
// page sees them.
const currentRoute = () => {
  const legacy = legacyEvalHash(window.location.hash) || legacyReviewHash(window.location.hash) || invalidReviewPageHash(window.location.hash)
  if (legacy) {
    window.history.replaceState(null, '', legacy)
    return parseRoute(legacy)
  }
  return parseRoute(window.location.hash)
}

export function useRoute() {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const onHash = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}
