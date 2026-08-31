// The catalog is the registry's ADDRESS-SIDE face: which page kinds exist, which of them are documents,
// which are resident, and what icon each one wears. It imports no view component, and nothing that renders.
// [[view-registry]]'s implementations live in views.jsx, which seeds this catalog with them.
//
// The split is not tidiness. `tabs.js` needs `isDocument` to decide whether an address is worth a tab, and
// TabStrip needs `iconFor`/`isResident` to draw one. Both reached for those through views.jsx — which
// statically imports SessionsView so a dispatched compose always has a mounted receiver. That made
// views.jsx -> SessionsView -> SessionInterface -> TabStrip -> views.jsx a twelve-module import cycle,
// closed around three questions that never needed a component to answer them. Asking the catalog instead
// keeps the eager receiver and leaves the tab machinery downstream of the registry, not inside it.
import { createViewRegistry } from './viewRegistry.js'

export const viewRegistry = createViewRegistry()
export const viewRouteContract = viewRegistry.routeContract

export const registerView = (...args) => viewRegistry.registerView(...args)
export const registerPlugin = (plugin) => viewRegistry.registerPlugin(plugin)
export const unregisterPlugin = (id) => viewRegistry.unregisterPlugin(id)

// The product's own views enter as `core`, from the one module that holds them. Everything else arrives
// through registerView/registerPlugin, so ownership stays visible instead of being a seeding accident.
export const seedCoreViews = (views) => {
  for (const [name, definition] of Object.entries(views)) viewRegistry.registerView(name, definition, 'core')
}

export const iconFor = (page) => viewRegistry.get(page)?.icon || null
// One definition of each question, delegated to the route contract the shell already passes to every
// ViewScope — a second copy here is how a tab and its own view start disagreeing about what a document is.
export const isDocument = (page, param = null) => viewRouteContract.isDocument(page, param)
export const isResident = (page, param = null) => viewRouteContract.isResident(page, param)
