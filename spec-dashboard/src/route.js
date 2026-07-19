import { useEffect, useState } from 'react'

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

export const PAGES = ['graph', 'sessions', 'evals', 'issues', 'projects', 'settings']

// canonical query serialization: fixed key order, so the same state always prints the same address
// (hash comparisons in navigate() and tests stay byte-stable).
const QUERY_KEYS = ['kind', 'live', 'ok', 'store', 'concluded', 'session']
export function queryString(query) {
  if (!query) return ''
  const sp = new URLSearchParams()
  for (const k of QUERY_KEYS) if (query[k] != null && query[k] !== '') sp.set(k, query[k])
  for (const k of Object.keys(query)) if (!QUERY_KEYS.includes(k) && query[k] != null && query[k] !== '') sp.set(k, query[k])
  const s = sp.toString()
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
// canonical [[evals-view]] form — '#/evals?session=<id>' / '#/evals/<node>/<scenario>?session=<id>'.
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
  return routeHash('evals', param, { session: id })
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

// the live route — one hashchange subscription, parsed; the legacy session-eval shape normalizes here
// (replace — idempotent across multiple mounted subscribers) before any page sees it.
const currentRoute = () => {
  const legacy = legacyEvalHash(window.location.hash)
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
