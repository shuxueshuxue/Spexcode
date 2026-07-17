import { navigate, parseRoute, routeHash } from './route.js'

export const graphNodeAddress = (nodeId) => ({ kind: 'graph-node', nodeId })
export const sessionAddress = (sessionId) => ({ kind: 'session', sessionId })
export const issueAddress = (issueId) => ({ kind: 'issue', issueId })
export const evalAddress = (nodeId, scenario) => ({ kind: 'eval', nodeId, scenario })
// a session's IN-SESSION eval detail ([[session-eval]]): the console with the Eval tab active, optionally
// landed on one scenario's worktree-rooted reading — the address an MR/CI note pastes for one-click review.
export const sessionEvalAddress = (sessionId, nodeId, scenario) => ({ kind: 'session-eval', sessionId, nodeId, scenario })

export function addressHash(address) {
  if (!address) return routeHash('graph')
  if (address.kind === 'graph-node') return routeHash('graph')
  if (address.kind === 'session') return routeHash('sessions', address.sessionId)
  if (address.kind === 'session-eval') {
    return routeHash('sessions', [address.sessionId, 'eval', ...(address.nodeId && address.scenario ? [address.nodeId, address.scenario] : [])].join('/'))
  }
  if (address.kind === 'issue') return routeHash('issues', address.issueId)
  if (address.kind === 'eval') return routeHash('evals', `${address.nodeId}/${address.scenario}`)
  return routeHash('graph')
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
  } else if (address.kind === 'session-eval') {
    // hash-only: the sessions page applies the /eval sub-route itself (parseRoute would drop it here).
    window.location.hash = addressHash(address)
  } else {
    const { page, param } = parseRoute(addressHash(address))
    navigate(page, param)
  }
}
