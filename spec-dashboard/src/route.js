import { useEffect, useState } from 'react'
import { EVAL_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, hasLegacyParams, legacyQueryText, sameQuery, scopedEvalQuery } from '@spexcode/spec-core/review'

// The app's URL layer ([[side-nav]]): every top-level page has its own address, so a page can be
// bookmarked, reloaded, and history-navigated like any modern app. HASH routes (#/sessions, #/graph, #/graph/<node>,
// #/sessions/<id>, #/evals[?query], #/evals/<node>/<scenario>[?query], #/issues[?query], #/issues/<id>,
// #/settings) — deliberately not the History API: the dashboard ships as a static dist behind plain file
// servers/gateways with no index.html fallback, and a hash route needs nothing from the server. No router
// dependency.
//
// The hash carries TWO axes (the GitHub list-URL grammar): the PATH names the object (a page, a detail),
// the QUERY carries view state (a list's filters, the evals session scope) — so a filtered list is a
// copyable, Back-restorable address and every consumer re-derives its whole state from the URL.

// `spec` and `file` are DOCUMENT addresses — a node read as a document, a governed file read on its own.
// They are why the address list grew: the board used to have pages and no documents, so a document had
// nowhere to be addressed from and reading one meant opening a popup over whatever page was showing.
// `empty` is the workspace holding NOTHING — an address, because the state has to be somewhere the reader
// can land, reload, and leave. It is not a rail destination and not a document; the only thing that mints it
// is closing the last tab ([[tab-strip]]).
export const PAGES = ['graph', 'spec', 'file', 'sessions', 'evals', 'issues', 'settings', 'empty']
// The rail's DESTINATIONS — deliberately not `PAGES`. `spec` and `file` are addresses you arrive at by
// opening something (a node, a governed file); there is no "go to the spec page" the way there is a
// sessions page, and a rail icon for one would name a place that does not exist. `graph` is absent for
// the opposite reason: it is still addressable, but it is no longer a place the workspace sends anyone.
export const RAIL_PAGES = ['sessions', 'evals', 'issues', 'settings']

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

// '#/graph/node-a' → { page: 'graph', param: 'node-a' }. '#/sessions/abc' → { page: 'sessions', param: 'abc' }. '#/evals/<node>/<scenario>' → param
// 'node/scenario' (the canonical eval DETAIL address — each segment decoded; the page splits on the first
// '/'). '#/issues/<id>' → the issue detail. Anything after '?' inside the hash is the query axis.
// Anything unknown lands on sessions — the workspace's daily face. It used to land on the graph, back
// when the graph WAS the board; the graph is now an addressable legacy view nothing routes to on its own.
export function parseRoute(hash) {
  const h = (hash || '').replace(/^#\/?/, '')
  const qi = h.indexOf('?')
  const path = qi >= 0 ? h.slice(0, qi) : h
  const query = Object.fromEntries(new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : ''))
  const parts = path.split('/').filter(Boolean)
  const known = PAGES.includes(parts[0])
  const page = known ? parts[0] : 'sessions'
  // `settings` and `empty` name no object, so they carry no selector; every other page does, and `file`
  // carries a repo path, so the tail rejoins on '/'. An UNKNOWN first segment carries no selector either:
  // its tail was written for a page that does not exist, and handing it to the fallback page would mint an
  // object address for an object nobody named.
  const param = !known || page === 'settings' || page === 'empty'
    ? null
    : (parts.length > 1 ? parts.slice(1).map(decodeURIComponent).join('/') : null)
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

// Session faces are URL state, except Evals: the session-scoped Evals list already owns that
// address family ([[session-eval]]), so a face-shaped link is one replace into the canonical list.
export function sessionSurfaceHash(hash) {
  const { page, param, query } = parseRoute(hash)
  if (page !== 'sessions' || !param || !query.surface) return null
  if (query.surface === 'evals') return routeHash('evals', null, { q: scopedEvalQuery(param) })
  const resource = typeof query.surface === 'string' && query.surface.startsWith('resource:') && query.surface.length > 'resource:'.length
  if (query.surface !== 'conversation' && query.surface !== 'terminal' && query.surface !== 'diff' && !resource) return null
  return null
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
  const legacy = legacyEvalHash(window.location.hash) || sessionSurfaceHash(window.location.hash) || legacyReviewHash(window.location.hash) || invalidReviewPageHash(window.location.hash)
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
