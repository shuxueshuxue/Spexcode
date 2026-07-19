import { navigate, parseRoute, routeHash } from './route.js'
import { readToken, scopedEvalQuery } from './reviewQuery.js'

export const graphNodeAddress = (nodeId) => ({ kind: 'graph-node', nodeId })
export const sessionAddress = (sessionId) => ({ kind: 'session', sessionId })
export const issueAddress = (issueId) => ({ kind: 'issue', issueId })
export const evalAddress = (nodeId, scenario) => ({ kind: 'eval', nodeId, scenario })
// a session's SCOPED eval address ([[session-eval]]): the Evals pages carrying the `scope:<id>` token —
// the scoped default list, or one scenario's worktree-rooted reading (`?q=scope:<id>` alone, never list
// filters) — the address an MR/CI note pastes for one-click review.
export const sessionEvalAddress = (sessionId, nodeId, scenario) => ({ kind: 'session-eval', sessionId, nodeId, scenario })

export function addressHash(address) {
  if (!address) return routeHash('graph')
  if (address.kind === 'graph-node') return routeHash('graph')
  if (address.kind === 'session') return routeHash('sessions', address.sessionId)
  if (address.kind === 'session-eval') {
    const param = address.nodeId && address.scenario ? `${address.nodeId}/${address.scenario}` : null
    return routeHash('evals', param, { q: param ? `scope:${address.sessionId}` : scopedEvalQuery(address.sessionId) })
  }
  if (address.kind === 'issue') return routeHash('issues', address.issueId)
  if (address.kind === 'eval') return routeHash('evals', `${address.nodeId}/${address.scenario}`)
  return routeHash('graph')
}

// The review details' RETURN GATE ([[review-chrome]]'s compact back anchor): the href derives ONLY from
// the detail's own canonical address — never history.back, a referrer sniff, or originator presence — so
// a pushed visit, a direct open, and a reload share one destination. A trunk eval detail returns to
// #/evals, an issue detail to #/issues; an eval detail whose canonical query carries `scope:<id>` is a
// worktree-rooted reading whose home is that session's terminal console, #/sessions/<id>.
export function detailBackHash(page, queryText = '') {
  if (page === 'evals') {
    const scope = readToken(queryText || '', 'scope')
    return scope ? routeHash('sessions', scope) : routeHash('evals')
  }
  return routeHash('issues')
}

// Graph focus and session tab selection are shell-owned view state; hash-only targets can navigate directly.
export function navigateAddress(address, { onFocusNode, onOpenSession } = {}) {
  if (!address) return
  if (address.kind === 'graph-node') {
    onFocusNode?.(address.nodeId)
    navigate('graph')
  } else if (address.kind === 'session') {
    if (onOpenSession) onOpenSession(address.sessionId)
    else navigate('sessions', address.sessionId)
  } else {
    const { page, param, query } = parseRoute(addressHash(address))
    navigate(page, param, { query })
  }
}
