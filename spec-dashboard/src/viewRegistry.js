// The dashboard's view registry is the extension boundary. Built-ins and plugins use
// the same definition shape; plugins cannot replace a view owned by another plugin.
const NAME = /^[a-z][a-z0-9-]*$/

const isAddress = (value) => value && typeof value === 'object' && !Array.isArray(value)

function assertName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new TypeError(`view name must be lowercase kebab-case: ${String(name)}`)
  }
}

const REACT_COMPONENT_TYPES = new Set([
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
  Symbol.for('react.forward_ref'),
])

// React.lazy/memo/forwardRef are valid component values even though React represents them as
// tagged objects rather than callable functions. Keep the registry boundary strict: only these
// known React component tags cross it, while arbitrary objects still fail closed.
const isComponent = (component) => typeof component === 'function'
  || (component && typeof component === 'object' && REACT_COMPONENT_TYPES.has(component.$$typeof))

function copyDefinition(definition) {
  if (!definition || typeof definition !== 'object' || !isComponent(definition.component)) {
    throw new TypeError('view definition requires a component function or React component')
  }
  return Object.freeze({ ...definition })
}

/**
 * Create an isolated registry. `initial` is reserved for product-owned built-ins;
 * runtime callers must use registerView/registerPlugin so ownership is auditable.
 */
export function createViewRegistry(initial = {}) {
  const views = new Map()
  const owners = new Map()
  const plugins = new Map()

  for (const [name, definition] of Object.entries(initial)) {
    assertName(name)
    views.set(name, copyDefinition(definition))
    owners.set(name, 'core')
  }

  const registerView = (name, definition, owner = 'runtime') => {
    assertName(name)
    if (typeof owner !== 'string' || owner.length === 0) throw new TypeError('view owner is required')
    if (views.has(name)) throw new Error(`view already registered: ${name}`)
    views.set(name, copyDefinition(definition))
    owners.set(name, owner)
    return views.get(name)
  }

  const registerPlugin = (plugin) => {
    if (!plugin || typeof plugin !== 'object' || typeof plugin.id !== 'string' || plugin.id.length === 0) {
      throw new TypeError('plugin requires a non-empty id')
    }
    if (plugins.has(plugin.id)) throw new Error(`plugin already registered: ${plugin.id}`)
    if (!plugin.views || typeof plugin.views !== 'object' || Array.isArray(plugin.views)) {
      throw new TypeError(`plugin ${plugin.id} requires a views object`)
    }

    const names = Object.keys(plugin.views)
    for (const name of names) {
      assertName(name)
      if (views.has(name)) throw new Error(`view already registered: ${name}`)
    }

    const registered = []
    try {
      for (const name of names) {
        registerView(name, plugin.views[name], plugin.id)
        registered.push(name)
      }
      plugins.set(plugin.id, Object.freeze({ id: plugin.id, views: Object.freeze([...names]) }))
    } catch (error) {
      for (const name of registered) {
        views.delete(name)
        owners.delete(name)
      }
      throw error
    }
    return plugins.get(plugin.id)
  }

  const unregisterPlugin = (id) => {
    const plugin = plugins.get(id)
    if (!plugin) return false
    for (const name of plugin.views) {
      views.delete(name)
      owners.delete(name)
    }
    plugins.delete(id)
    return true
  }

  // The shell passes this contract to every ViewScope.  Keeping the lookup here means route
  // ownership and tab/document policy cannot drift into a second map maintained by the shell.
  const routeContract = Object.freeze({
    assertAddress: (address, label = 'address') => {
      if (!isAddress(address) || typeof address.page !== 'string' || !views.has(address.page)) {
        throw new TypeError(`${label}.page is not a registered view: ${String(address?.page)}`)
      }
      const param = address.param ?? null
      if (param != null && typeof param !== 'string') throw new TypeError(`${label}.param must be a string or null`)
      const definition = views.get(address.page)
      if (typeof definition.document === 'function' && param === 'new' && address.page === 'sessions') {
        // The launch form is a route, but deliberately not a document/tab.
        return address
      }
      return address
    },
    isDocument: (page, param = null) => {
      const definition = views.get(page)
      return typeof definition?.document === 'function' ? definition.document(page, param) : !!definition?.document
    },
    isResident: (page, param = null) => !!views.get(page)?.resident && param == null,
  })

  return Object.freeze({
    get: (name) => views.get(name),
    has: (name) => views.has(name),
    ownerOf: (name) => owners.get(name),
    entries: () => [...views.entries()],
    registerView,
    registerPlugin,
    unregisterPlugin,
    routeContract,
  })
}
