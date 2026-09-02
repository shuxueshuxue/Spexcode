'use strict'

const DASHBOARD_PAGES = new Set(['graph', 'spec', 'file', 'sessions', 'evals', 'issues', 'settings', 'empty'])

function invalid(reason) {
  return { ok: false, reason: `Invalid SpexCode link: ${reason}` }
}

function gatewayOrigin(value) {
  try {
    const url = new URL(value)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null
    return url.origin
  } catch {
    return null
  }
}

function parseAddress(hash) {
  if (!hash.startsWith('#/')) return invalid('the dashboard address must begin with #/.')
  const raw = hash.slice(2)
  const queryAt = raw.indexOf('?')
  const path = queryAt < 0 ? raw : raw.slice(0, queryAt)
  const query = queryAt < 0 ? '' : raw.slice(queryAt + 1)
  const segments = path.split('/')
  if (segments.some((segment) => !segment)) return invalid('the dashboard address contains an empty path segment.')
  if (!DASHBOARD_PAGES.has(segments[0])) return invalid(`unknown dashboard page '${segments[0] || ''}'.`)
  if ((segments[0] === 'settings' || segments[0] === 'empty') && segments.length !== 1) {
    return invalid(`dashboard page '${segments[0]}' does not accept an address parameter.`)
  }
  try {
    for (const segment of segments) decodeURIComponent(segment)
    for (const part of query.split('&').filter(Boolean)) {
      const [key, ...rest] = part.split('=')
      decodeURIComponent(key.replace(/\+/g, ' '))
      decodeURIComponent(rest.join('=').replace(/\+/g, ' '))
    }
  } catch {
    return invalid('the dashboard address contains malformed percent encoding.')
  }
  return { ok: true, address: hash }
}

function mapDeepLink(value, origin, knownProjectIds) {
  const mappedOrigin = gatewayOrigin(origin)
  if (!mappedOrigin) return invalid('the gateway origin is not HTTP(S).')

  let link
  try { link = new URL(value) } catch { return invalid('the URL cannot be parsed.') }
  if (link.protocol !== 'spexcode:') return invalid("the scheme must be 'spexcode:'.")
  if (link.hostname !== 'p') return invalid("the host must be 'p'.")
  if (link.search) return invalid('query parameters belong inside the dashboard hash address.')

  const match = /^\/([^/]+)\/$/.exec(link.pathname)
  if (!match) return invalid('expected spexcode://p/<projectId>/#/address.')
  let projectId
  try { projectId = decodeURIComponent(match[1]) } catch { return invalid('the project id contains malformed percent encoding.') }
  if (!projectId) return invalid('the project id is empty.')

  const parsedAddress = parseAddress(link.hash)
  if (!parsedAddress.ok) return parsedAddress
  if (knownProjectIds && !knownProjectIds.has(projectId)) {
    return { ok: false, reason: `Unknown project '${projectId}'.` }
  }

  return {
    ok: true,
    projectId,
    address: parsedAddress.address,
    url: `${mappedOrigin}/p/${encodeURIComponent(projectId)}/${parsedAddress.address}`,
  }
}

function hubNoticeUrl(origin, reason) {
  const mappedOrigin = gatewayOrigin(origin)
  if (!mappedOrigin) throw new Error('gateway origin is not HTTP(S)')
  const query = new URLSearchParams({ notice: String(reason) })
  return `${mappedOrigin}/projects?${query}`
}

module.exports = { DASHBOARD_PAGES, hubNoticeUrl, mapDeepLink, parseAddress }
