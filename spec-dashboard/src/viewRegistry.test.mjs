import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lazy } from 'react'
import { createViewRegistry } from './viewRegistry.js'
import { createSettingsViewPlugin } from './builtInViewPlugins.js'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')

test('registry views receive route props and do not acquire the global route', () => {
  const registry = read('views.jsx')
  const shell = read('Shell.jsx')
  const workspace = read('workspace.jsx')

  // Shell is the route owner. ViewPool/ViewHost pass the captured address down explicitly.
  assert.match(shell, /<View param=\{entry\.param\} query=\{entry\.query\} \/>/)
  assert.match(shell, /<View key=\{poolKey\(page, param\)\} param=\{param\} query=\{query\} \/>/)
  assert.doesNotMatch(registry, /(?:import[^\n]*useRoute|\buseRoute\s*\()/)
  assert.doesNotMatch(workspace, /VIEW_ROUTE_CONTRACT/)
})

const component = () => null

test('registry exposes immutable built-ins and rejects replacement', () => {
  const registry = createViewRegistry({ sessions: { component } })
  assert.equal(registry.ownerOf('sessions'), 'core')
  assert.equal(registry.get('sessions').component, component)
  assert.throws(() => registry.registerView('sessions', { component }), /already registered/)
  assert.throws(() => registry.registerView('Bad Name', { component }), /kebab-case/)
})

test('registry accepts React.lazy component objects and rejects unknown tagged objects', () => {
  const lazyComponent = lazy(() => Promise.resolve({ default: component }))
  const registry = createViewRegistry({ evals: { component: lazyComponent } })
  assert.equal(registry.get('evals').component, lazyComponent)
  assert.throws(() => createViewRegistry({ broken: { component: { $$typeof: Symbol('react.lazy') } } }), /component function/)
})

test('plugin registration is atomic and records ownership', () => {
  const registry = createViewRegistry({ sessions: { component } })
  const plugin = registry.registerPlugin({ id: 'review-tools', views: { timeline: { component } } })
  assert.deepEqual(plugin, { id: 'review-tools', views: ['timeline'] })
  assert.equal(registry.ownerOf('timeline'), 'review-tools')
  assert.equal(registry.unregisterPlugin('review-tools'), true)
  assert.equal(registry.has('timeline'), false)

  assert.throws(() => registry.registerPlugin({ id: 'broken', views: {
    valid: { component },
    sessions: { component },
  } }), /already registered/)
  assert.equal(registry.has('valid'), false)
})

test('invalid plugin definitions cannot leave an earlier view registered', () => {
  const registry = createViewRegistry()
  assert.throws(() => registry.registerPlugin({ id: 'broken', views: {
    valid: { component },
    invalid: {},
  } }), /component function/)
  assert.deepEqual(registry.entries(), [])
  assert.equal(registry.ownerOf('valid'), undefined)
})

test('plugin ids and view definitions are validated before mutation', () => {
  const registry = createViewRegistry()
  assert.throws(() => registry.registerPlugin({ views: {} }), /non-empty id/)
  assert.throws(() => registry.registerPlugin({ id: 'bad', views: { x: {} } }), /component function/)
  assert.deepEqual(registry.entries(), [])
})

test('settings is installed as a real built-in plugin on the canonical view path', () => {
  const registry = createViewRegistry({ sessions: { component } })
  const plugin = registry.registerPlugin(createSettingsViewPlugin(component))
  const settings = registry.get('settings')

  assert.deepEqual(plugin, { id: 'dashboard-settings', views: ['settings'] })
  assert.equal(registry.ownerOf('settings'), 'dashboard-settings')
  assert.deepEqual({
    component: settings.component,
    surface: settings.surface,
    document: settings.document,
    resident: settings.resident,
    icon: settings.icon,
    className: settings.className,
  }, {
    component,
    surface: 'workspace',
    document: true,
    resident: true,
    icon: 'settings',
    className: 'view-settings',
  })

  const product = read('views.jsx')
  const coreSeed = product.slice(product.indexOf('export const VIEWS'), product.indexOf('// Product-owned views'))
  assert.doesNotMatch(coreSeed, /^\s*settings:/m)
  assert.match(product, /registerPlugin\(createSettingsViewPlugin\(SettingsView\)\)/)
})
