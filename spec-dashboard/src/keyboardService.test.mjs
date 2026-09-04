import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ACT, displayKeysOf, chordSequence } from './keymap.js'

const shell = readFileSync(new URL('./Shell.jsx', import.meta.url), 'utf8')
const graph = readFileSync(new URL('./GraphView.jsx', import.meta.url), 'utf8')
const workspace = readFileSync(new URL('./workspace.jsx', import.meta.url), 'utf8')
const eventDetail = readFileSync(new URL('./EventDetail.jsx', import.meta.url), 'utf8')
const reviewShell = readFileSync(new URL('./ReviewShell.jsx', import.meta.url), 'utf8')
const escStack = readFileSync(new URL('./escStack.js', import.meta.url), 'utf8')
const service = readFileSync(new URL('./KeyboardService.jsx', import.meta.url), 'utf8')
const keymap = readFileSync(new URL('./keymap.js', import.meta.url), 'utf8')
const publicAbout = readFileSync(new URL('./PublicGraphAbout.jsx', import.meta.url), 'utf8')
const evidence = readFileSync(new URL('./Evidence.jsx', import.meta.url), 'utf8')
const projects = readFileSync(new URL('./ProjectsPage.jsx', import.meta.url), 'utf8')
const tooltip = readFileSync(new URL('./Tooltip.jsx', import.meta.url), 'utf8')

test('help is a shell-owned overlay and remains global across routed views', () => {
  assert.match(workspace, /helpOpen/)
  assert.match(workspace, /toggleHelp/)
  assert.match(shell, /firesKey\('graph\.help', event\.key\)/)
  assert.match(shell, /helpOpen && <Legend/)
  assert.doesNotMatch(graph, /const \[legend, setLegend\]/)
  assert.doesNotMatch(graph, /legend && <Legend/)
})

test('all routed key owners use the one capture service', () => {
  assert.doesNotMatch(shell, /addEventListener\(['"]keydown/)
  assert.match(eventDetail, /useKeyboardScope\(/)
  assert.doesNotMatch(eventDetail, /addEventListener\(['"]keydown/)
  assert.match(reviewShell, /useKeyboardScope\(/)
  assert.doesNotMatch(reviewShell, /addEventListener\(['"]keydown/)
  assert.match(escStack, /export function consumeEscape/)
  assert.doesNotMatch(escStack, /addEventListener\(['"]keydown/)
  assert.match(service, /consumeEscape\(event\)/)
})

test('global dismissal surfaces register with the shared Escape stack', () => {
  for (const source of [publicAbout, evidence, projects, tooltip]) {
    assert.match(source, /useEscLayer\(/)
    assert.doesNotMatch(source, /addEventListener\(['"]keydown/)
  }
})

test('typing guard reaches graph and shared list/player owners', () => {
  assert.match(service, /export function isTypingTarget/)
  assert.match(service, /export function scopeOwnsEvent/)
  assert.match(service, /scopeOwnsEvent\(event, allowTyping\) && handlerRef\.current\(event\)/)
  assert.match(service, /allowTyping = false/)
  assert.match(service, /scopeOwnsEvent\(event, allowTyping\)/)
  assert.doesNotMatch(graph, /isTypingTarget/)
  assert.doesNotMatch(eventDetail, /isTypingTarget/)
  assert.doesNotMatch(reviewShell, /isTypingTarget/)
})

// THE POSITIONAL PAGE ROW IS WITHDRAWN, not merely unbound. Tab ordinals are a separate desktop-only family;
// they name workspace documents and never the activity rail slots.
test('tab ordinals use only Meta/Ctrl and never restore Alt page jumps', () => {
  const digits = ACT.filter((action) => (action.keys || []).some((key) => /Digit\d/.test(key)))
  assert.equal(digits.length, 9)
  assert.deepEqual(digits.map((action) => action.id), Array.from({ length: 9 }, (_, i) => `shell.tabFocus${i + 1}`))
  for (const action of digits) {
    assert.deepEqual(action.keys, [`Meta+Digit${action.id.slice(-1)}`, `Ctrl+Digit${action.id.slice(-1)}`])
  }
  assert.deepEqual(ACT.filter((action) => /^shell\.page/.test(action.id)).map((action) => action.id), [])
  assert.doesNotMatch(shell, /shell\.page(?:Sessions|Evals|Issues|Settings)/)
  // the named doors that survive a reorder are untouched
  for (const id of ['shell.newSession', 'shell.evals', 'shell.search'])
    assert.ok(ACT.some((action) => action.id === id), `${id} must remain a shell door`)
})

test('desktop tab close keeps the Alt chord and adds browser-style Meta/Ctrl W', () => {
  const close = ACT.find((action) => action.id === 'shell.tabClose')
  assert.deepEqual(close.keys, ['Alt+Shift+KeyX', 'Meta+KeyW', 'Ctrl+KeyW'])
  assert.match(shell, /firesEvent\('shell\.tabClose', event\)/)
  assert.match(shell, /runTabCommand\('focus', ordinal\)/)
})

test('fixed chord display is complete while rebindable display follows live keys', () => {
  const child = ACT.find((action) => action.id === 'graph.newChild')
  const del = ACT.find((action) => action.id === 'graph.del')
  const settings = ACT.find((action) => action.id === 'graph.settings')
  assert.deepEqual(chordSequence('graph.newChild'), ['n', 'n'])
  assert.deepEqual(chordSequence('graph.del'), ['d', 'd'])
  assert.deepEqual(displayKeysOf(child), ['nn'])
  assert.deepEqual(displayKeysOf(del), ['dd'])
  assert.deepEqual(displayKeysOf(settings, [';']), [';'])
})

test('structural chord dispatch is registry-owned, not a second literal grammar', () => {
  assert.match(graph, /import \{ chordSequence \} from '\.\/keymap\.js'/)
  assert.match(graph, /const NEW_CHILD_CHORD = chordSequence\('graph\.newChild'\)\.join\(''\)/)
  assert.match(graph, /const DELETE_CHORD = chordSequence\('graph\.del'\)\.join\(''\)/)
  assert.doesNotMatch(graph, /CHORDS\.nn|CHORDS\.dd/)
  assert.match(keymap, /export const chordSequence/) // the registry is the reader and dispatch source
})
