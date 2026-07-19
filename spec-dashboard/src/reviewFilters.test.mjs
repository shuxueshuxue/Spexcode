import test from 'node:test'
import assert from 'node:assert/strict'
import { evalFilterModel, filterMenuGroups, issueFilterModel, tokenFilterState } from './reviewFilters.js'

const t = (key) => key
// presence is board MEMBERSHIP, any zone: an offline-but-listed session is still PRESENT.
const sessions = [{ id: 'on-board', status: 'working', headline: 'worker' }, { id: 'dormant', status: 'offline' }]

test('issue adapter composes query, section, facets, and the one presence join', () => {
  const items = [
    { id: 'local:a', concern: 'alpha concern', status: 'open', store: 'local', by: 'vanished', nodes: ['alpha'], replies: [{ by: 'dormant' }] },
    { id: 'github#2', concern: 'beta concern', status: 'closed', store: 'github', by: 'human', nodes: ['beta'] },
    { id: 'local:c', concern: 'gamma landed', status: 'landed', store: 'local', by: 'on-board', nodes: [] },
  ]
  const base = issueFilterModel(items, { state: 'open' }, { sessions, t })
  assert.deepEqual(base.shown.map((item) => item.id), ['local:a'])
  assert.deepEqual(base.sections, { open: 1, closed: 2 })
  assert.deepEqual(base.facets.store.options.map((option) => option.value), ['', 'local', 'github'])

  assert.deepEqual(issueFilterModel(items, { q: 'BETA', state: 'closed' }, { sessions, t }).shown.map((item) => item.id), ['github#2'])
  // q as an ARRAY of substrings is conjunctive (the token text's bare words/phrases)
  assert.deepEqual(issueFilterModel(items, { q: ['gamma', 'landed'] }, { sessions, t }).shown.map((item) => item.id), ['local:c'])
  assert.deepEqual(issueFilterModel(items, { q: ['gamma', 'absent'] }, { sessions, t }).shown, [])
  // presence: originator or a reply author still on the board (any zone) — never liveness
  assert.deepEqual(issueFilterModel(items, { session: 'present' }, { sessions, t }).shown.map((item) => item.id), ['local:a', 'local:c'])
  assert.deepEqual(issueFilterModel(items, { session: 'missing' }, { sessions, t }).shown.map((item) => item.id), ['github#2'])
  // a concrete concluded spelling matches its status honestly
  assert.deepEqual(issueFilterModel(items, { state: 'landed' }, { sessions, t }).shown.map((item) => item.id), ['local:c'])
  assert.deepEqual(issueFilterModel(items, { author: 'human', node: 'beta' }, { sessions, t }).shown.map((item) => item.id), ['github#2'])
  // an impossible state (an unknown canonical qualifier) matches NOTHING
  assert.deepEqual(issueFilterModel(items, { impossible: true }, { sessions, t }).shown, [])
})

test('eval adapter gives blind rows only the fields they honestly own', () => {
  const rows = [
    { scenario: 'video pass', node: 'alpha', reading: true, by: 'on-board', fresh: true, verdict: { status: 'pass' }, evidence: [{ kind: 'video', hash: 'v' }] },
    { scenario: 'image fail', node: 'beta', reading: true, by: 'vanished', fresh: false, verdict: { status: 'fail' }, evidence: [{ kind: 'image', hash: 'i' }] },
    { scenario: 'never measured', node: 'alpha', reading: false },
  ]
  const shown = (state) => evalFilterModel(rows, state, { sessions, t, defaultKind: 'all' }).shown.map((item) => item.scenario)

  assert.deepEqual(shown({ kind: 'all' }), ['video pass', 'image fail', 'never measured'])
  assert.deepEqual(shown({ kind: 'video' }), ['video pass'])
  assert.deepEqual(shown({ freshness: 'stale' }), ['image fail'])
  assert.deepEqual(shown({ verdict: 'unscored' }), ['never measured'])
  assert.deepEqual(shown({ session: 'present' }), ['video pass'])
  assert.deepEqual(shown({ session: 'missing' }), ['image fail'])
  assert.deepEqual(shown({ q: 'ALPHA' }), ['video pass', 'never measured'])
  // section counts come out under the REST of the query: the blind row keeps counting toward Current
  // whichever section is displayed
  const model = evalFilterModel(rows, { ok: '1' }, { sessions, t, defaultKind: 'all' })
  assert.equal(model.sections.current, 3)
  assert.deepEqual(model.shown, [])
})

test('compact groups omit fake one-value facets and retain active off-switches', () => {
  const one = issueFilterModel([{ id: '1', concern: 'only', status: 'open', store: 'local', by: 'same', nodes: ['alpha'] }], {}, { t })
  assert.deepEqual(filterMenuGroups(one, () => {}, ['section', 'author', 'store', 'node', 'session']), [])

  const activeGone = issueFilterModel([], { author: 'gone' }, { t })
  const groups = filterMenuGroups(activeGone, () => {}, ['author'])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].options, [{ value: '', label: 'reviewList.all' }])

  // a fixed-value ENUM facet keeps its ACTIVE value as a real checked row even at zero data — the
  // Source session group never hides its own off-switch while session:present is active
  const activePresence = issueFilterModel([{ id: '1', concern: 'only', status: 'open', by: 'human' }], { session: 'present' }, { t, sessions: [] })
  assert.deepEqual(activePresence.shown, [])
  assert.deepEqual(activePresence.facets.session.options.map((option) => option.value), ['', 'present', 'missing'])
})

test('the canonical bridge maps token text into engine state without a second parser', () => {
  assert.deepEqual(tokenFilterState('is:issue state:closed store:github "long title" gate', 'issue'),
    { q: ['long title', 'gate'], state: 'closed', store: 'github' })
  assert.deepEqual(tokenFilterState('is:eval state:reviewed evidence:video scope:s-1', 'eval'),
    { q: [], ok: '1', kind: 'video' })
  assert.deepEqual(tokenFilterState('state:current session:missing filer:w-1', 'eval'),
    { q: [], ok: 'current', session: 'missing', filer: 'w-1' })
  // duplicate qualifiers are last-wins, same as every reader of the text
  assert.deepEqual(tokenFilterState('state:open state:closed', 'issue'), { q: [], state: 'closed' })
  // a quoted colon phrase stays ONE substring end to end (the migrated legacy free q)
  const colonItems = [{ id: '1', concern: 'run drift:check now', status: 'open' }, { id: '2', concern: 'other', status: 'open' }]
  assert.deepEqual(
    issueFilterModel(colonItems, tokenFilterState('is:issue "drift:check"', 'issue'), { sessions, t }).shown.map((item) => item.id),
    ['1'],
  )
  // an unknown qualifier, or the wrong is: identity, is the IMPOSSIBLE state — honest zero downstream
  assert.deepEqual(tokenFilterState('frobnicate:xyz', 'issue'), { impossible: true, q: [] })
  assert.deepEqual(tokenFilterState('is:eval', 'issue'), { impossible: true, q: [] })
  assert.deepEqual(issueFilterModel(colonItems, tokenFilterState('state:open frobnicate:xyz', 'issue'), { sessions, t }).shown, [])
})
