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
