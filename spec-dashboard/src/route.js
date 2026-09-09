import { useEffect, useState } from 'react'
import { ISSUE_QUERY_DEFAULT, hasLegacyParams, legacyQueryText, sameQuery } from '@spexcode/spec-core/review'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'

// The app's URL layer ([[side-nav]]): every top-level page has its own address, so a page can be
// bookmarked, reloaded, and history-navigated like any modern app. HASH routes (#/sessions, #/graph, #/graph/<node>,
// #/sessions/<id>, #/issues[?query], #/issues/<id>,
// #/settings) — deliberately not the History API: the dashboard ships as a static dist behind plain file
// servers/gateways with no index.html fallback, and a hash route needs nothing from the server. No router
// dependency.
//
// The hash carries TWO axes (the GitHub list-URL grammar): the PATH names the object (a page, a detail),
// the QUERY carries view state (a list's filters) — so a filtered list is a
// copyable, Back-restorable address and every consumer re-derives its whole state from the URL.

// `spec` and `file` are DOCUMENT addresses — a node detail read as a resident document, a governed file read on its own.
// They are why the address list grew: the board used to have pages and no documents, so a document had
// nowhere to be addressed from and reading one meant opening a popup over whatever page was showing.
// `empty` is the workspace holding NOTHING — an address because the state must be landable, reloadable and
// leaveable. It is not a rail destination or document; only closing the last tab mints it ([[tab-strip]]).
export const PAGES = ['graph', 'spec', 'file', 'sessions', 'issues', 'settings', 'empty']
// The rail is the workspace's top-level board bar. Spec is a resident board destination; a node or file
// route projects back onto it instead of making the selected top-level board disappear. Graph remains
// directly addressable for legacy links but is no longer a workspace destination or rail entry.
export const RAIL_PAGES = ['spec', 'sessions', 'issues', 'settings']
// The pages a static publication can actually answer. A published tree carries the spec index and one
// document per node and nothing else, so Spec (with File and Graph as its neighbours) is the whole of what
// it can serve — the live-only destinations have no data behind them here.
export const PUBLIC_PAGES = ['spec', 'file', 'graph']

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

// '#/graph/node-a' → { page: 'graph', param: 'node-a' }. '#/sessions/abc' → { page: 'sessions', param: 'abc' }.
// '#/issues/<id>' → the issue detail. Anything after '?' inside the hash is the query axis.
// Anything unknown lands on sessions — the workspace's daily face. The graph remains an addressable legacy
// view, but no unknown or cold address should silently put it on screen.
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

// Session faces are URL state; a face-shaped link with a resource surface is normalized by the session view.
export function sessionSurfaceHash(hash) {
  const { page, param, query } = parseRoute(hash)
  if (page !== 'sessions' || !param || !query.surface) return null
  const resource = typeof query.surface === 'string' && query.surface.startsWith('resource:') && query.surface.length > 'resource:'.length
  if (query.surface !== 'conversation' && query.surface !== 'terminal' && query.surface !== 'diff' && !resource) return null
  return null
}

// the LEGACY structured review params ([[review-query]]): an old '#/issues' address carrying
// state/concluded/store/author/node/filer/freshness/kind/live/ok params replays as the
// FULL visible token text (the page default with each param surgically applied) — a DETAIL address keeps
// no list filters. Returns the canonical hash, or null when the address is
// already canonical (bare, or ?q= only).
export function legacyReviewHash(hash) {
  const { page, param, query } = parseRoute(hash)
  if (page !== 'issues') return null
  if (!hasLegacyParams(query)) return null
  if (param != null) return routeHash(page, param, null)
  const text = legacyQueryText(ISSUE_QUERY_DEFAULT, query)
  return routeHash(page, null, sameQuery(text, ISSUE_QUERY_DEFAULT) ? null : { q: text })
}

export function invalidReviewPageHash(hash) {
  const { page, param, query } = parseRoute(hash)
  if (page !== 'issues' || param != null || query.page == null) return null
  if (/^[1-9]\d*$/.test(query.page) && Number.isSafeInteger(Number(query.page))) return null
  const { page: _invalid, ...rest } = query
  return routeHash(page, null, rest)
}

// A param's '/'-separated segments are encoded one by one so each segment stays hash-safe.
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

// the live route — one hashchange subscription, parsed; legacy structured issue params normalize here
// (replace — idempotent across multiple mounted subscribers) before any
// page sees them.
const currentRoute = () => {
  // Normalize every incoming hash before the shell sees it, so a deep link cannot leave a published tree
  // claiming a review surface it has no data for. Spec is the landing face — the same address the
  // live dashboard opens a project on.
  if (PUBLIC_GRAPH_ONLY) {
    const face = parseRoute(window.location.hash)
    if (PUBLIC_PAGES.includes(face.page)) return face
    window.history.replaceState(null, '', '#/spec')
    return parseRoute('#/spec')
  }
  const legacy = sessionSurfaceHash(window.location.hash) || legacyReviewHash(window.location.hash) || invalidReviewPageHash(window.location.hash)
  if (legacy) {
    window.history.replaceState(null, '', legacy)
    return parseRoute(legacy)
  }
  const parsed = parseRoute(window.location.hash)
  // Cold/unknown hashes name the daily sessions face. Normalize them so the address bar agrees with the
  // view instead of merely rendering an implicit fallback; an explicit empty route is preserved.
  if (parsed.page === 'sessions' && !/^#\/sessions(?:\/|\?|$)/.test(window.location.hash || '')) {
    window.history.replaceState(null, '', '#/sessions')
    return parseRoute('#/sessions')
  }
  return parsed
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
