import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { overlaySessions, sessionSpecNodes, specDoorRows } from './session.js'

const opsOf = (...ids) => ({ ops: ids.map((nodeId) => ({ nodeId, op: 'edited' })) })

test('a session names the nodes its pending ops touch, each carrying its own op', () => {
  assert.deepEqual(sessionSpecNodes({ ops: [
    { nodeId: 'b', op: 'added' }, { nodeId: 'a', op: 'deleted' }, { nodeId: 'b', op: 'edited' },
  ] }), [{ id: 'b', op: 'added' }, { id: 'a', op: 'deleted' }])
  assert.deepEqual(sessionSpecNodes({ ops: [] }), [])
  assert.deepEqual(sessionSpecNodes(undefined), [])
  assert.deepEqual(sessionSpecNodes({ ops: [{ op: 'edited' }, { nodeId: '', op: 'added' }] }), [])
  // an op the board did not name still renders as SOMETHING rather than an `ov-undefined` row.
  assert.deepEqual(sessionSpecNodes({ ops: [{ nodeId: 'z' }] }), [{ id: 'z', op: 'edited' }])
})

test('the spec door caps its rows and reports what the cap held back', () => {
  const wide = opsOf(...Array.from({ length: 12 }, (_, i) => `n${i}`))
  const capped = specDoorRows(wide, 8)
  assert.equal(capped.rows.length, 8)
  assert.equal(capped.hidden, 4)
  assert.deepEqual(capped.rows[0], { id: 'n0', op: 'edited' })
  const narrow = specDoorRows(opsOf('a', 'b'), 8)
  assert.deepEqual(narrow, { rows: [{ id: 'a', op: 'edited' }, { id: 'b', op: 'edited' }], hidden: 0 })
  assert.deepEqual(specDoorRows(null, 8), { rows: [], hidden: 0 })
})

test('the crossing join is the same one both directions read', () => {
  const sessions = [{ id: 's1', source: '/wt/one' }, { id: 's2', source: '/wt/two' }]
  const node = { overlays: [{ source: '/wt/two' }, { source: '/wt/two' }, { source: '/wt/gone' }] }
  assert.deepEqual(overlaySessions(node, sessions).map((s) => s.id), ['s2'])
  assert.deepEqual(overlaySessions({ overlays: [] }, sessions), [])
})

test('the session menu spends the shared door, and find on graph is its fixed last row', () => {
  const menu = readFileSync(new URL('./SessionContextMenu.jsx', import.meta.url), 'utf8')
  assert.match(menu, /<ContextMenuSubmenu icon="graph" label=\{t\('sessionWindow\.specRelated'\)\}>/)
  assert.match(menu, /specDoorRows\(menu\?\.session, SPEC_ROWS_MAX\)/)
  // each row wears the BOARD's op mark, not one decorative icon repeated down the list.
  assert.match(menu, /leading=\{<span className=\{`ov-mark ov-\$\{op\}`\} aria-hidden="true">\{GLYPH\[op\] \|\| '•'\}<\/span>\}/)
  // the mark is decoration: the row's accessible name stays the node, with the op spelled out beside it.
  assert.match(menu, /aria-label=\{`\$\{id\} — \$\{t\(`legend\.opRows\.\$\{op\}`\)\}`\}/)
  assert.match(menu, /import \{ GLYPH \} from '\.\/specMeta\.js'/)
  // the fixed row is LAST inside the door, after the node rows and the cap note.
  const door = menu.slice(menu.indexOf('<ContextMenuSubmenu'), menu.indexOf('</ContextMenuSubmenu>'))
  assert.ok(door.indexOf("sessionWindow.findOnGraph") > door.indexOf("sessionWindow.specMore"))
  assert.match(door, /onClick=\{findOnGraph\}/)
  assert.doesNotMatch(menu, /sessionWindow\.lock'/)
})
