import test from 'node:test'
import assert from 'node:assert/strict'
import { createViewScope, normalizeAddress, VIEW_INTENTS } from './viewScope.js'

const route = { page: 'evals', param: 'node-a/scenario-a', query: { q: 'state:current' } }

test('scope validates addresses and exposes only typed route intents', () => {
  const received = []
  const { scope } = createViewScope({ route, dispatch: (intent) => { received.push(intent) } })
  assert.deepEqual(VIEW_INTENTS, ['open', 'hold', 'own-query'])
  assert.deepEqual(scope.route, normalizeAddress(route))
  assert.equal(scope.open({ page: 'issues', param: '42' }).accepted, true)
  assert.equal(scope.hold({ page: 'sessions', param: 's-1' }).accepted, true)
  assert.equal(scope.ownQuery({ q: 'is:open' }).accepted, true)
  assert.deepEqual(received.map((intent) => intent.type), ['open', 'hold', 'own-query'])
  assert.deepEqual(received[2].address, { page: 'evals', param: route.param, query: { q: 'is:open' } })
  assert.throws(() => scope.open({ page: 'Bad Page' }), /lowercase kebab-case/)
  assert.throws(() => scope.ownQuery({ q: { nested: true } }), /primitive value/)
})

test('inactive pooled scopes suspend dispatch until the shell reactivates them', () => {
  const received = []
  const { scope, update } = createViewScope({ route, active: false, dispatch: (intent) => received.push(intent) })
  assert.equal(scope.active, false)
  assert.deepEqual(scope.open({ page: 'issues' }), { accepted: false, reason: 'inactive', type: 'open' })
  assert.equal(received.length, 0)
  update({ route: { page: 'issues', param: null, query: null }, active: true })
  assert.equal(scope.active, true)
  scope.open({ page: 'sessions', param: 's-2' })
  assert.equal(received[0].address.page, 'sessions')
  assert.equal(scope.route.page, 'issues')
})

test('scope snapshots are immutable and dispatch receives one atomic intent', () => {
  const received = []
  const { scope } = createViewScope({ route, dispatch: (intent) => { received.push(intent); return { accepted: true, transaction: 'shell-1' } } })
  const result = scope.open({ page: 'issues', param: null, query: null })
  assert.deepEqual(result, { accepted: true, transaction: 'shell-1' })
  assert.equal(Object.isFrozen(received[0]), true)
  assert.equal(Object.isFrozen(received[0].address), true)
  assert.throws(() => { received[0].address.page = 'sessions' }, TypeError)
})
