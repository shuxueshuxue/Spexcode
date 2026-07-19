import { useEffect, useState } from 'react'

// The app's URL layer ([[side-nav]]): every top-level page has its own address, so a page can be
// bookmarked, reloaded, and history-navigated like any modern app. HASH routes (#/graph, #/sessions,
// #/sessions/<id>, #/sessions/<id>/eval/<node>/<scenario>, #/evals, #/evals/<node>/<scenario>, #/issues,
// #/settings) — deliberately not the
// History API: the dashboard ships
// as a static dist behind plain file servers/gateways with no index.html fallback, and a hash route needs
// nothing from the server. No router dependency for five pages.

export const PAGES = ['graph', 'sessions', 'evals', 'issues', 'settings']

// '#/sessions/abc' → { page: 'sessions', param: 'abc' }. '#/evals/<node>/<scenario>' → param
// 'node/scenario' (the canonical eval address — each segment decoded; the page splits on the first '/').
// '#/issues/<id>' deep-links to SpexCode's internal issue detail.
// A sessions param may carry segments PAST the id — '#/sessions/<id>/eval[/<node>/<scenario>]', the
// console's in-page deep link ([[session-eval]]'s Eval tab) — same multi-segment shape as evals; the
// sessions page splits off the id and applies the rest.
// Anything unknown lands on graph (the home page).
export function parseRoute(hash) {
  const parts = (hash || '').replace(/^#\/?/, '').split('/').filter(Boolean)
  const page = PAGES.includes(parts[0]) ? parts[0] : 'graph'
  const param = page === 'sessions' || page === 'evals' || page === 'issues'
    ? (parts.length > 1 ? parts.slice(1).map(decodeURIComponent).join('/') : null)
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

// The ONE encoder for the sessions-page param of a session-eval address: '<id>/eval[/<node>/<scenario>]'
// ([[address-routing]] / [[session-eval]]). The single source of that sub-route's URL shape — the href side
// (address.js addressHash) and the tab-echo side (sessionTabParam below) both go through here, so the two
// can't drift. Lives in route.js (the lower layer) so address.js can import it without a cycle.
export const sessionEvalParam = (sessionId, nodeId, scenario) =>
  [sessionId, 'eval', ...(nodeId && scenario ? [nodeId, scenario] : [])].join('/')

// The session-tab hash param ([[address-routing]]): the bare session id, OR the PERSISTENT, refreshable eval
// sub-route when the console's Eval tab is showing ([[session-eval]]). Driven by `evalView` — the console's
// REAL selection ({node,scenario}|null), reported up — so the address always matches what's on screen: a
// non-null evalView (Eval tab) yields '<id>/eval[/<node>/<scenario>]' via the shared sessionEvalParam encoder;
// null (Terminal / New) yields the bare id. The 'new' placeholder is ALWAYS bare — it has no eval surface, so
// a stale view can never ride it. Pure; the shell writes the result with replace.
export function sessionTabParam(sessionSel, evalView) {
  if (sessionSel === 'new' || !evalView) return sessionSel
  return sessionEvalParam(sessionSel, evalView.node, evalView.scenario)
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
