import test from 'node:test'
import assert from 'node:assert/strict'

import { acceptSessionEvalBoard } from './data.js'

const projection = (epoch, generation, measured = generation) => ({
  epoch,
  generation,
  phase: 'ready',
  revision: `${epoch}-${generation}`,
  value: { measured, total: measured, pass: measured, fail: 0, review: 0, blind: 0, unknown: 0 },
})
const board = (value) => ({ nodes: [], sessions: [{ id: 's', evalSummary: value }] })

test('session summary generations never regress inside one graph epoch', () => {
  const seen = new Map()
  const current = acceptSessionEvalBoard(board(projection('a', 2)), seen, true)
  const late = acceptSessionEvalBoard(board(projection('a', 1)), seen, false)

  assert.equal(current.sessions[0].evalSummary.generation, 2)
  assert.equal(late.sessions[0].evalSummary.generation, 2)
  assert.equal(late.sessions[0].evalSummary.value.measured, 2)
})

test('only an authoritative full snapshot may rebase the summary epoch', () => {
  const seen = new Map()
  acceptSessionEvalBoard(board(projection('a', 7)), seen, true)

  const stray = acceptSessionEvalBoard(board(projection('b', 0, 10)), seen, false)
  assert.equal(stray.sessions[0].evalSummary.epoch, 'a')

  const reconnected = acceptSessionEvalBoard(board(projection('b', 0, 10)), seen, true)
  assert.equal(reconnected.sessions[0].evalSummary.epoch, 'b')
  assert.equal(reconnected.sessions[0].evalSummary.value.measured, 10)
})

test('a cold authoritative reconnect preserves the prior epoch only as last-known', () => {
  const seen = new Map()
  acceptSessionEvalBoard(board(projection('a', 7, 4)), seen, true)
  const cold = board({ epoch: 'b', generation: 0, phase: 'loading' })

  const reconnected = acceptSessionEvalBoard(cold, seen, true)
  const accepted = reconnected.sessions[0].evalSummary
  assert.equal(accepted.epoch, 'b')
  assert.equal(accepted.generation, 0)
  assert.equal(accepted.phase, 'loading')
  assert.equal(accepted.value, undefined)
  assert.equal(accepted.lastKnown.value.measured, 4)
})
