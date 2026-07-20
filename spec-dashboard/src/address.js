import { navigate, parseRoute, routeHash } from './route.js'
import { nodeEvalQuery, scopedEvalQuery } from './reviewQuery.js'

export const graphNodeAddress = (nodeId) => ({ kind: 'graph-node', nodeId })
export const sessionAddress = (sessionId) => ({ kind: 'session', sessionId })
export const issueAddress = (issueId) => ({ kind: 'issue', issueId })
// with a scenario: the canonical full-page eval DETAIL (path only — the detail hash carries no list
// filters). Without one: the node's AGGREGATE entry — the Evals LIST filtered to that node
// (`?q=is:eval state:current node:<id>`, [[review-query]]'s canonical token text). Every aggregate
// score/count affordance mints its href through THIS helper, so the list-filter grammar lives in
// exactly one place.
export const evalAddress = (nodeId, scenario = null) => ({ kind: 'eval', nodeId, scenario })
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
  if (address.kind === 'eval') {
    return address.scenario
      ? routeHash('evals', `${address.nodeId}/${address.scenario}`)
      : routeHash('evals', null, { q: nodeEvalQuery(address.nodeId) })
  }
  return routeHash('graph')
}

// The review details' RETURN GATE ([[review-chrome]]'s compact back anchor): the href derives ONLY from
// the detail's own page — never history.back, a referrer sniff, or originator presence — so a pushed
// visit, a direct open, and a reload share one destination. EVERY eval detail returns to the bare
// #/evals list and an issue detail to #/issues; a scoped (worktree-rooted) eval detail does NOT divert
// the back anchor to the session console — its session door is the detail's source BANNER ([[evals-view]]),
// so "back" always means the list and the terminal is an explicit, labelled destination.
export function detailBackHash(page) {
  return routeHash(page === 'issues' ? 'issues' : 'evals')
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
