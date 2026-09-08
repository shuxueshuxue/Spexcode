import { navigate, parseRoute, routeHash } from './route.js'

export const graphNodeAddress = (nodeId) => ({ kind: 'graph-node', nodeId })
export const specAddress = (nodeId) => ({ kind: 'spec', nodeId })
export const sessionAddress = (sessionId) => ({ kind: 'session', sessionId })
// A session face is one URL axis. Resource faces use the existing resourceTabKey as their value
// (`resource:<sessionId>:<kind>:<key>`), so they remain ordinary session object addresses.
export const sessionSurfaceAddress = (sessionId, surface) => ({ kind: 'session-surface', sessionId, surface })
export const issueAddress = (issueId) => ({ kind: 'issue', issueId })
export const reviewListAddress = (page, query) => ({ kind: 'review-list', page, query })

// An address a caller ALREADY HOLDS as a hash — a list row's own `href`, minted through the projections
// below and then handed to a menu that has to act on it. Re-deriving an address object from the row's data
// would mint the same address a second way, which is exactly the drift these helpers exist to prevent.
export const hashAddress = (hash) => ({ kind: 'hash', hash })

export function addressHash(address) {
  if (!address) return routeHash('graph')
  if (address.kind === 'hash') return address.hash
  if (address.kind === 'graph-node') return routeHash('graph', address.nodeId)
  if (address.kind === 'spec') return routeHash('spec', address.nodeId)
  if (address.kind === 'session') return routeHash('sessions', address.sessionId)
  if (address.kind === 'session-surface') {
    return routeHash('sessions', address.sessionId, { surface: address.surface })
  }
  if (address.kind === 'issue') return routeHash('issues', address.issueId)
  if (address.kind === 'review-list') return routeHash(address.page, null, address.query ? { q: address.query } : null)
  return routeHash('graph')
}

// Views hand this pure projection to their ViewScope. Keeping address conversion separate from the
// route writer lets hosted views preserve the shared address vocabulary without importing navigation.
export function routeAddress(address) {
  const { page, param, query } = parseRoute(addressHash(address))
  return { page, param, query }
}

export const addressUrl = (address, base = window.location.href) => new URL(addressHash(address), base).href

function copyFallback(text) {
  const active = document.activeElement
  const field = document.createElement('textarea')
  field.value = text
  field.style.cssText = 'position:fixed;left:-9999px;top:0'
  document.body.append(field)
  field.select()
  let copied = false
  try { copied = document.execCommand('copy') } catch { /* the caller displays the failed copy state */ }
  field.remove()
  active?.focus?.()
  return copied
}

// One clipboard path for everything this vocabulary hands a reader. An address copies as its URL; a plain
// subject (a repository path) copies as itself. Both take the same Clipboard-API-then-textarea route, so a
// denied or insecure clipboard degrades identically wherever a copy is offered.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* insecure or denied Clipboard API falls through to the browser copy path */ }
  return copyFallback(text)
}

export const copyAddress = (address) => copyText(addressUrl(address))

export function detailBackHash(page) {
  return page === 'issues' ? routeHash('issues') : routeHash('spec')
}

// The address is the route authority. Session selection has a warm-page callback for immediate local application;
// graph focus comes from the graph route itself, so direct opens and in-app references share one path.
export function navigateAddress(address, { onOpenSession } = {}) {
  if (!address) return
  if (address.kind === 'session') {
    if (onOpenSession) onOpenSession(address.sessionId)
    else navigate('sessions', address.sessionId)
  } else {
    const { page, param, query } = parseRoute(addressHash(address))
    navigate(page, param, { query })
  }
}
