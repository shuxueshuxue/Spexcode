import test from 'node:test'
import assert from 'node:assert/strict'
import { applyRouteNav, defaultEvalKey, evalSelectionReport } from './session.js'

// applyRouteNav resolves a per-navigation route directive against the active tab ([[session-eval]] /
// [[address-routing]]): the URL entrance drives the console's right pane on every real navigation. It targets
// only its own session — a directive for another tab is a no-op (null).
test('applyRouteNav opens the Eval tab and jumps for an /eval entrance on the active session', () => {
  assert.deepEqual(applyRouteNav({ session: 'abc', tab: 'eval', node: 'shell-layout', scenario: 'ws-sidebar' }, 'abc'),
    { tab: 'eval', jump: { node: 'shell-layout', scenario: 'ws-sidebar' } })
  // a bare /eval entrance (no node/scenario) opens the Eval tab with NO jump — the pane picks its own default
  assert.deepEqual(applyRouteNav({ session: 'abc', tab: 'eval', node: null, scenario: null }, 'abc'),
    { tab: 'eval', jump: null })
})

test('applyRouteNav shows the Terminal for a bare tab entrance (a bare return resets a warm Eval tab)', () => {
  assert.deepEqual(applyRouteNav({ session: 'abc', tab: 'terminal', node: null, scenario: null }, 'abc'),
    { tab: 'terminal', jump: null })
})

test('applyRouteNav is a no-op for another session or no directive', () => {
  // a directive for a DIFFERENT session must not touch this tab
  assert.equal(applyRouteNav({ session: 'abc', tab: 'eval', node: 'n', scenario: 's' }, 'xyz'), null)
  // the 'new' placeholder / no directive → nothing to apply
  assert.equal(applyRouteNav({ session: 'abc', tab: 'terminal' }, 'new'), null)
  assert.equal(applyRouteNav(null, 'abc'), null)
})

test('evalSelectionReport preserves the route target until the eval model resolves', () => {
  // Loading is "not known yet", not an empty selection: callers must emit nothing and keep the exact hash.
  assert.equal(evalSelectionReport(null, null, null), undefined)
  // The first loaded render may still expose the default before the deep jump effect applies; suppress it
  // while a real route target is pending so the exact hash never flickers to that default.
  assert.equal(evalSelectionReport({}, 'ws-sidebar', 'default-fail', true), undefined)
  // Once loaded, the resolved row replaces the optimistic target; a genuinely empty pane reports null.
  assert.deepEqual(evalSelectionReport({}, 'session-eval', 'proof-renders'),
    { node: 'session-eval', scenario: 'proof-renders' })
  assert.equal(evalSelectionReport(false, null, null), null)
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
