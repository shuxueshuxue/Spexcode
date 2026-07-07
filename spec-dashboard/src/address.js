import { navigate, parseRoute, routeHash } from './route.js'

export const graphNodeAddress = (nodeId) => ({ kind: 'graph-node', nodeId })
export const sessionAddress = (sessionId) => ({ kind: 'session', sessionId })
export const issueAddress = (issueId) => ({ kind: 'issue', issueId })
export const evalAddress = (nodeId, scenario) => ({ kind: 'eval', nodeId, scenario })

export function addressHash(address) {
  if (!address) return routeHash('graph')
  if (address.kind === 'graph-node') return routeHash('graph')
  if (address.kind === 'session') return routeHash('sessions', address.sessionId)
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
  } else {
    const { page, param } = parseRoute(addressHash(address))
    navigate(page, param)
  }
}
