import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveEvalSeed, defaultEvalKey } from './session.js'

// resolveEvalSeed gates an eval deep-link seed against the async board load ([[session-eval]]): it must not
// apply before its own session tab is active (the [active] reset would clobber it), and never leak onto
// another tab.
test('resolveEvalSeed waits while the target tab is still the loading placeholder', () => {
  assert.deepEqual(resolveEvalSeed({ session: 'abc', node: 'n', scenario: 's' }, 'new'),
    { action: 'wait' })
  // no seed at all → nothing to do (wait)
  assert.deepEqual(resolveEvalSeed(null, 'abc'), { action: 'wait' })
})

test('resolveEvalSeed applies once the deep-linked session IS the active tab', () => {
  assert.deepEqual(resolveEvalSeed({ session: 'abc', node: 'shell-layout', scenario: 'ws-sidebar' }, 'abc'),
    { action: 'apply', jump: { node: 'shell-layout', scenario: 'ws-sidebar' } })
  // a bare /eval seed (no node/scenario) applies with NO jump — the pane picks its own default
  assert.deepEqual(resolveEvalSeed({ session: 'abc', node: null, scenario: null }, 'abc'),
    { action: 'apply', jump: null })
})

test('resolveEvalSeed drops a stale seed once the user moved to a different session', () => {
  // active settled on a DIFFERENT real session → consume without applying, so it never flips the wrong tab
  assert.deepEqual(resolveEvalSeed({ session: 'abc', node: 'n', scenario: 's' }, 'xyz'),
    { action: 'drop' })
})

// defaultEvalKey — the bare /eval default selection prefers THIS session's own reading, failing first, over
// the blind-spot row that merely leads the visual order ([[session-eval]]).
const blind = (node, scenario) => ({ kind: 'blind', key: `blind:${node}·${scenario}`, item: { node, scenario } })
const reading = (node, scenario, { inSession, state }) =>
  ({ kind: 'eval', key: `eval:${node}·${scenario}`, item: { node, scenario, inSession, state } })

test('defaultEvalKey picks the in-session FAILING reading over a leading blind spot', () => {
  const visible = [
    blind('shell-layout', 'ws-sidebar'),                                   // blind spots LEAD the visual order
    reading('shell-layout', 'passing', { inSession: true, state: 'pass' }),
    reading('shell-layout', 'broken', { inSession: true, state: 'fail' }),
  ]
  assert.equal(defaultEvalKey(visible), 'eval:shell-layout·broken')        // the failing in-session reading
})

test('defaultEvalKey falls back to any in-session reading, then to the first visible row', () => {
  // no failing reading → the first in-session reading (not the blind spot)
  const passing = [
    blind('n', 'blind'),
    reading('n', 'ok', { inSession: true, state: 'pass' }),
  ]
  assert.equal(defaultEvalKey(passing), 'eval:n·ok')

  // an inherited-only session (no reading of its own) → the first visible row stands (a blind spot)
  const inheritedOnly = [
    blind('n', 'blind'),
    reading('n', 'other', { inSession: false, state: 'pass' }),
  ]
  assert.equal(defaultEvalKey(inheritedOnly), 'blind:n·blind')

  // staleFail counts as failing too
  const stale = [reading('n', 'a', { inSession: true, state: 'pass' }), reading('n', 'b', { inSession: true, state: 'staleFail' })]
  assert.equal(defaultEvalKey(stale), 'eval:n·b')

  assert.equal(defaultEvalKey([]), null)
})
