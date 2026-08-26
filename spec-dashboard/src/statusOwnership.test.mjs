import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertStatusOwnership } from './statusOwnership.js'

const view = { kind: 'view', page: 'evals' }

test('view status contributions stay in the focused-document group', () => {
  assert.doesNotThrow(() => assertStatusOwnership({ id: 'eval-count', side: 'right', text: '1' }, view))
  assert.throws(() => assertStatusOwnership({ id: 'rail', side: 'left', text: 'x' }, view), /right group/)
})

// The markup ban carried a by-name exception for one page, which made the guard a record of the current
// usage rather than a rule. A document's glance is markup in the document-actions registry already; the
// status registry states the same rule, so no view needs to be named to contribute one.
test('a document may contribute its own glance, from any view', () => {
  for (const page of ['graph', 'sessions', 'evals']) {
    const item = { id: `${page}-glance`, side: 'right', node: {} }
    assert.equal(assertStatusOwnership(item, { kind: 'view', page }), item)
  }
  const source = readFileSync(new URL('./statusOwnership.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /page !== 'graph'|mount markup/, 'no page may be named in the guard')
})

test('shell-owned status items retain full chrome permissions', () => {
  const item = { id: 'project', side: 'left', node: {} }
  assert.equal(assertStatusOwnership(item), item)
})
