import test from 'node:test'
import assert from 'node:assert/strict'
import { evalFilterModel, filterMenuGroups, issueFilterModel } from './reviewFilters.js'

const t = (key) => key
const sessions = [{ id: 'live', status: 'working', headline: 'live worker' }, { id: 'gone', status: 'offline' }]

test('issue adapter composes query, section, facets, and the one liveness join', () => {
  const items = [
    { id: 'local:a', concern: 'alpha concern', status: 'open', store: 'local', by: 'gone', nodes: ['alpha'], replies: [{ by: 'live' }] },
    { id: 'github#2', concern: 'beta concern', status: 'closed', store: 'github', by: 'human', nodes: ['beta'] },
  ]
  const base = issueFilterModel(items, {}, { sessions, t, defaultSection: 'open' })
  assert.deepEqual(base.shown.map((item) => item.id), ['local:a'])
  assert.deepEqual(base.sections, { open: 1, closed: 1 })
  assert.deepEqual(base.facets.store.options.map((option) => option.value), ['', 'local', 'github'])

  assert.deepEqual(issueFilterModel(items, { q: 'BETA', state: 'closed' }, { sessions, t }).shown.map((item) => item.id), ['github#2'])
  assert.deepEqual(issueFilterModel(items, { live: '1' }, { sessions, t }).shown.map((item) => item.id), ['local:a'])
  assert.deepEqual(issueFilterModel(items, { author: 'human', node: 'beta' }, { sessions, t }).shown.map((item) => item.id), ['github#2'])
})

test('eval adapter gives blind rows only the fields they honestly own', () => {
  const rows = [
    { scenario: 'video pass', node: 'alpha', reading: true, by: 'live', fresh: true, verdict: { status: 'pass' }, evidence: [{ kind: 'video', hash: 'v' }] },
    { scenario: 'image fail', node: 'beta', reading: true, by: 'gone', fresh: false, verdict: { status: 'fail' }, evidence: [{ kind: 'image', hash: 'i' }] },
    { scenario: 'never measured', node: 'alpha', reading: false },
  ]
  const shown = (state) => evalFilterModel(rows, state, { sessions, t, defaultKind: 'all' }).shown.map((item) => item.scenario)

  assert.deepEqual(shown({ kind: 'all' }), ['video pass', 'image fail', 'never measured'])
  assert.deepEqual(shown({ kind: 'video' }), ['video pass'])
  assert.deepEqual(shown({ freshness: 'stale' }), ['image fail'])
  assert.deepEqual(shown({ verdict: 'unscored' }), ['never measured'])
  assert.deepEqual(shown({ live: '1' }), ['video pass'])
  assert.deepEqual(shown({ q: 'ALPHA' }), ['video pass', 'never measured'])
})

test('compact groups omit fake one-value facets and retain active off-switches', () => {
  const one = issueFilterModel([{ id: '1', concern: 'only', status: 'open', store: 'local', by: 'same', nodes: ['alpha'] }], {}, { t })
  assert.deepEqual(filterMenuGroups(one, () => {}, ['section', 'author', 'store', 'node', 'live']), [])

  const activeGone = issueFilterModel([], { author: 'gone' }, { t })
  const groups = filterMenuGroups(activeGone, () => {}, ['author'])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].options, [{ value: '', label: 'reviewList.all' }])
})
