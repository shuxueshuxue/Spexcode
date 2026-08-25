import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')
const menu = read('./ExplorerContextMenu.jsx')
const chrome = read('./ContextMenu.jsx')
const tree = read('./FileTree.jsx')
const disk = read('./DiskTree.jsx')
const keymap = read('./keymap.js')
const en = read('./i18n/en.js')
const css = read('./styles.css')

test('every explorer row declares its menu subject, and one seam reads them all', () => {
  // the three spec-tree row kinds plus both disk-tree rows
  assert.match(tree, /subject=\{\{ kind: 'node', id: node\.id \}\}/)
  assert.match(tree, /subject=\{\{ kind: 'file', path: f \}\}/)
  assert.match(tree, /subject=\{\{ kind: 'file', path: `\.spec\/\$\{node\.id\}\/\$\{f\.name\}` \}\}/)
  assert.match(disk, /data-menu-kind="dir" data-menu-path=\{entry\.path\}/)
  assert.match(disk, /data-menu-kind="file" data-menu-path=\{entry\.path\}/)
  // ONE handler pair on the shared body — no per-tree, per-row-kind menu wiring
  assert.match(tree, /<div className="ft-body" onContextMenu=\{onRowContextMenu\} onKeyDown=\{onRowKeyDown\}>/)
  assert.match(tree, /target\?\.closest\?\.\('\[data-menu-kind\]'\)/)
  assert.equal(disk.includes('ExplorerContextMenu'), false, 'the disk tree owns no menu of its own')
})

test('the row menu offers a spec node and a file their own verbs, and reveals only a claimed owner', () => {
  assert.match(menu, /pinTab\('spec', menu\.id\)/)
  assert.match(menu, /navigateAddress\(graphNodeAddress\(menu\.id\)\)/)
  assert.match(menu, /pinTab\('file', menu\.path\)/)
  assert.match(menu, /copyText\(menu\.path\)/)
  assert.match(menu, /owner && \(/, 'reveal-owner appears only for a path some node claims')
  assert.match(tree, /if \(!owners\.has\(path\)\) owners\.set\(path, s\.id\)/)
})

test('the menu is keyboard-walkable when the keyboard opened it and inert when the pointer did', () => {
  // focus is taken only once the clamped position has PAINTED — focusing a `visibility: hidden` surface is
  // a silent no-op, which is exactly how the first attempt failed in a real browser.
  assert.match(chrome, /if \(keyboard && position\.visibility === 'visible'\) commandsIn\(ref\.current\)\[0\]\?\.focus\(\)/)
  assert.match(chrome, /event\.key === 'ArrowDown' \? 1 : event\.key === 'ArrowUp' \? -1 : 0/)
  assert.match(chrome, /onMouseDownCapture=\{inertChromePress\}/, 'pointer opening stays inert chrome')
  assert.match(tree, /if \(menu\?\.keyboard\) menu\.row\?\.focus\?\.\(\)/, 'closing returns focus to the row')
})

test('both explorer verbs live in the one key registry and the menu prints what it says', () => {
  assert.match(keymap, /id: 'explorer\.menu',\s+keys: \['Shift\+F10', 'ContextMenu'\]/)
  assert.match(keymap, /id: 'explorer\.openInNewTab', keys: \['Alt\+Enter'\]/)
  assert.match(en, /explorer: \{\s+menu: /)
  // the hint is READ from the registry, never typed into a label
  assert.match(menu, /shortcutHint\('explorer\.openInNewTab'\)/)
  assert.match(tree, /firesEvent\('explorer\.menu', event\)/)
  assert.match(tree, /firesEvent\('explorer\.openInNewTab', event\)/)
  assert.match(chrome, /hint \? <span className="sess-menu-hint"/)
  assert.match(css, /grid-template-columns: 17px minmax\(0, 1fr\) auto;/)
  assert.match(css, /\.sess-menu-hint \{/)
})
