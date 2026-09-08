import test from 'node:test'
import assert from 'node:assert/strict'
import { PAGES, RAIL_PAGES, parseRoute, routeHash } from './route.js'

test('retired eval route falls through to a real sessions page', () => {
  assert.equal(parseRoute('#/evals').page, 'sessions')
  assert.equal(parseRoute('#/evals/node/scenario').page, 'sessions')
  assert.deepEqual(parseRoute('#/sessions'), { page: 'sessions', param: null, query: {} })
})

test('eval is absent from the dashboard page and rail maps', () => {
  assert.equal(PAGES.includes('evals'), false)
  assert.equal(RAIL_PAGES.includes('evals'), false)
  assert.equal(routeHash('sessions'), '#/sessions')
})
