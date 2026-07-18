import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoute, routeHash, sessionTabParam } from './route.js'

// the session-eval deep link ([[address-routing]] / [[session-eval]]) — the console's in-page eval address.
test('parseRoute splits a session-eval deep link into id + eval sub-route', () => {
  assert.deepEqual(parseRoute('#/sessions/abc/eval/shell-layout/ws-sidebar'),
    { page: 'sessions', param: 'abc/eval/shell-layout/ws-sidebar' })
  // bare /eval form (no node/scenario) still parses to the sub-route
  assert.deepEqual(parseRoute('#/sessions/abc/eval'), { page: 'sessions', param: 'abc/eval' })
  // a plain session tab has no sub-route
  assert.deepEqual(parseRoute('#/sessions/abc'), { page: 'sessions', param: 'abc' })
})

test('a session-eval hash round-trips through routeHash (each segment re-encoded)', () => {
  const { param } = parseRoute('#/sessions/abc/eval/shell-layout/tab%20switch')
  assert.equal(param, 'abc/eval/shell-layout/tab switch')     // decoded per segment
  assert.equal(routeHash('sessions', param), '#/sessions/abc/eval/shell-layout/tab%20switch')  // re-encoded
})

// sessionTabParam is the tab-echo's target: PURE and driven by the SEED STATE (never by re-reading the
// mutable hash, which a transient write can clobber). It keeps the eval sub-route addressable (refreshable/
// shareable) whenever the seed targets the selected tab, else echoes the bare id.
test('sessionTabParam keeps the eval sub-route when the seed targets the selected tab', () => {
  assert.equal(sessionTabParam('abc', { session: 'abc', node: 'shell-layout', scenario: 'ws-sidebar' }),
    'abc/eval/shell-layout/ws-sidebar')
  // a bare /eval seed (no node/scenario) keeps just '<id>/eval' — the shareable root link
  assert.equal(sessionTabParam('abc', { session: 'abc', node: null, scenario: null }), 'abc/eval')
})

test('sessionTabParam echoes the bare id when no seed targets this tab', () => {
  assert.equal(sessionTabParam('abc', null), 'abc')
  // a seed for a DIFFERENT session doesn't leak its sub-route onto this tab
  assert.equal(sessionTabParam('xyz', { session: 'abc', node: 'n', scenario: 's' }), 'xyz')
  // the 'new' placeholder never carries an eval sub-route
  assert.equal(sessionTabParam('new', { session: 'abc', node: 'n', scenario: 's' }), 'new')
})

