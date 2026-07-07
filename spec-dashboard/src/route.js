import { useEffect, useState } from 'react'

// The app's URL layer ([[side-nav]]): every top-level page has its own address, so a page can be
// bookmarked, reloaded, and history-navigated like any modern app. HASH routes (#/graph, #/sessions,
// #/sessions/<id>, #/evals, #/evals/<node>/<scenario>, #/issues, #/settings) — deliberately not the
// History API: the dashboard ships
// as a static dist behind plain file servers/gateways with no index.html fallback, and a hash route needs
// nothing from the server. No router dependency for five pages.

export const PAGES = ['graph', 'sessions', 'evals', 'issues', 'settings']

// '#/sessions/abc' → { page: 'sessions', param: 'abc' }. '#/evals/<node>/<scenario>' → param
// 'node/scenario' (the canonical eval address — each segment decoded; the page splits on the first '/').
// '#/issues/<id>' deep-links to SpexCode's internal issue detail.
// Anything unknown lands on graph (the home page).
export function parseRoute(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
  const page = PAGES.includes(parts[0]) ? parts[0] : 'graph'
  const param = page === 'sessions' ? (parts[1] || null)
    : page === 'evals' ? (parts.length > 1 ? parts.slice(1).map(decodeURIComponent).join('/') : null)
    : page === 'issues' ? (parts.length > 1 ? parts.slice(1).map(decodeURIComponent).join('/') : null)
    : null
  return { page, param }
}

// a param's '/'-separated segments are encoded one by one so a multi-segment param (evals' node/scenario)
// keeps its path shape while each segment stays hash-safe.
export const routeHash = (page, param) =>
  `#/${page}${param ? `/${String(param).split('/').map(encodeURIComponent).join('/')}` : ''}`

// Navigate by writing the hash. A page switch PUSHES (back button walks pages); an in-page detail sync
// (e.g. the session board's selected tab) REPLACES, so tab-hopping doesn't bury history in tab entries.
export function navigate(page, param = null, { replace = false } = {}) {
  const h = routeHash(page, param)
  if (window.location.hash === h) return
  if (replace) window.history.replaceState(null, '', h)
  else window.location.hash = h
}

export const graphNodeAddress = (nodeId) => ({ kind: 'graph-node', nodeId })
export const sessionAddress = (sessionId) => ({ kind: 'session', sessionId })
export const issueAddress = (issueId) => ({ kind: 'issue', issueId })
export const evalAddress = (nodeId, scenario) => ({ kind: 'eval', nodeId, scenario })

// One app-internal address executor for jump-list style surfaces. Graph focus is the one route whose
// address carries view state outside the hash, so the caller supplies the focus/open callbacks.
export function navigateAddress(address, { onFocusNode, onOpenSession } = {}) {
  if (!address) return
  if (address.kind === 'graph-node') {
    onFocusNode?.(address.nodeId)
    navigate('graph')
  } else if (address.kind === 'session') {
    if (onOpenSession) onOpenSession(address.sessionId)
    else navigate('sessions', address.sessionId)
  } else if (address.kind === 'issue') {
    navigate('issues', address.issueId)
  } else if (address.kind === 'eval') {
    navigate('evals', `${address.nodeId}/${address.scenario}`)
  }
}

// the live route — one hashchange subscription, parsed. replaceState doesn't fire hashchange, which is
// fine: replace() is only used to echo state the app already holds.
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return route
}
