// The shell-owned route boundary. Views receive a narrow, runtime-checked intent API instead of a
// navigation callback that can write arbitrary addresses or mutate another view's state.
const PAGE_NAME = /^[a-z][a-z0-9-]*$/
const QUERY_KEY = /^[A-Za-z0-9_-]+$/
const INTENTS = Object.freeze(['open', 'hold', 'own-query'])

const isPlainObject = (value) => {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function normalizeQuery(query, label = 'query') {
  if (query == null) return null
  if (!isPlainObject(query)) throw new TypeError(`${label} must be a plain object or null`)
  const copy = {}
  for (const [key, value] of Object.entries(query)) {
    if (!QUERY_KEY.test(key)) throw new TypeError(`${label} key must be URL-safe: ${key}`)
    if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError(`${label}.${key} must be a primitive value`)
    }
    copy[key] = value
  }
  return Object.freeze(copy)
}

export function normalizeAddress(address, label = 'address') {
  if (!isPlainObject(address)) throw new TypeError(`${label} must be an address object`)
  const { page, param = null, query = null } = address
  if (typeof page !== 'string' || !PAGE_NAME.test(page)) throw new TypeError(`${label}.page must be lowercase kebab-case`)
  if (param != null && typeof param !== 'string') throw new TypeError(`${label}.param must be a string or null`)
  return Object.freeze({ page, param, query: normalizeQuery(query, `${label}.query`) })
}

function accepted(intent, result) {
  return result === undefined ? { accepted: true, intent } : result
}

// Returns a public scope and a shell-only updater. The updater is deliberately not part of the public
// object, so a view can request route work but cannot rewrite the route it was mounted with or reactivate a
// hidden pane. Shell reuses the same scope when a pooled document changes address.
export function createViewScope({ route, dispatch, active = true } = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('view scope requires a dispatch function')
  let current = normalizeAddress(route, 'route')
  let enabled = active !== false

  const emit = (type, address) => {
    if (!enabled) return { accepted: false, reason: 'inactive', type }
    const intent = Object.freeze({ type, address: normalizeAddress(address, `${type}.address`) })
    return accepted(intent, dispatch(intent))
  }
  const scope = {}
  Object.defineProperties(scope, {
    route: { enumerable: true, get: () => current },
    active: { enumerable: true, get: () => enabled },
  })
  scope.open = (address) => emit('open', address)
  scope.hold = (address) => emit('hold', address)
  scope.ownQuery = (query) => {
    if (!enabled) return { accepted: false, reason: 'inactive', type: 'own-query' }
    const address = { page: current.page, param: current.param, query: normalizeQuery(query, 'own-query.query') }
    const intent = Object.freeze({ type: 'own-query', address: normalizeAddress(address, 'own-query.address') })
    return accepted(intent, dispatch(intent))
  }

  const update = ({ route = current, active: nextActive = enabled } = {}) => {
    current = normalizeAddress(route, 'route')
    enabled = nextActive !== false
  }
  return { scope: Object.freeze(scope), update, intents: INTENTS }
}

export const VIEW_INTENTS = INTENTS
