import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const file = readFileSync(new URL('./FileView.jsx', import.meta.url), 'utf8')
const source = readFileSync(new URL('./SourceView.jsx', import.meta.url), 'utf8')
const actions = readFileSync(new URL('./ProseActions.jsx', import.meta.url), 'utf8')

test('file selection mounts the shared action host for source right-click dispatch', () => {
  assert.match(file, /const sourceHostRef = useRef\(null\)/)
  assert.match(file, /<div className="fileview" ref=\{sourceHostRef\}>/)
  assert.match(file, /<ProseActions hostRef=\{sourceHostRef\} codeSelection=\{selection\}/)
  assert.match(actions, /const sourceSelection = codeSelection \|\| codeSelectionRef\.current[\s\S]*event\.preventDefault\(\)[\s\S]*const next = \{ lines: \{ startLine: sourceSelection\.startLine, endLine: sourceSelection\.endLine \}/)
  assert.match(actions, /const \[menuOpen, setMenuOpen\] = useState\(false\)/)
  assert.match(actions, /!panel && menuOpen && selection && <ActionGroup/)
  assert.match(actions, /const dismiss = useCallback\(\(\) => \{ setPanel\(null\); setMenuOpen\(false\);/)
})

test('source selection remains lossless and does not require DOM Selection for the right-click path', () => {
  assert.match(source, /const next = \{ path, startLine, endLine, text: u\.state\.sliceDoc\(from, to\)/)
  assert.match(actions, /CodeMirror owns source selections and may not expose them through the browser Selection API/)
})

test('an unselected spec right-click exposes current-node actions through the shared prose layer', () => {
  assert.match(actions, /if \(!lines\) \{[\s\S]*setNodeMenuOpen\(true\)/)
  assert.match(actions, /className="pa-group pa-node-group"/)
  assert.match(actions, /proseActions\.nodeSend/)
  assert.match(actions, /copyAddress\(specAddress\(node\.id\)\)/)
})
