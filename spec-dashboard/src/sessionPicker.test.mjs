import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const picker = readFileSync(new URL('./SessionPicker.jsx', import.meta.url), 'utf8')
const prose = readFileSync(new URL('./ProseActions.jsx', import.meta.url), 'utf8')
const menu = readFileSync(new URL('./NodeContextMenu.jsx', import.meta.url), 'utf8')
const mentions = readFileSync(new URL('./mentions.jsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')

test('one session picker owns target selection and keyboard choice', () => {
  assert.match(picker, /export default function SessionPicker\(/)
  assert.match(picker, /ArrowDown/)
  assert.match(picker, /ArrowUp/)
  assert.match(picker, /event\.key === 'Enter'/)
  assert.match(picker, /<Avatar seed=\{session\.id\}/)
  assert.match(picker, /sessionDisplayState\(session\)/)
  assert.match(prose, /<SessionPicker sessions=\{sessions\}/)
  assert.doesNotMatch(prose, /className="pa-select"/)
  assert.match(menu, /<SessionPicker sessions=\{sessions\}/)
  assert.match(mentions, /<SessionPickerRow key=\{it\.id\}/)
})

test('picker rows paint the shared visible title while retaining the handle for matching', () => {
  assert.match(picker, /function labelFor\(session\) \{[\s\S]*return sessionHeadline\(session\)/)
  assert.match(picker, /\[labelFor\(session\), sessionHandle\(session\), session\.id\]/)
})

test('picker and graph badge use shared compact geometry', () => {
  assert.match(css, /\.session-picker-row\s*\{[\s\S]*\.session-picker-status/s)
  assert.match(css, /\.sess-badge\s*\{[\s\S]*position: absolute/s)
  assert.match(css, /\.dock-head-act-new\s*\{[\s\S]*background: var\(--blue\)/s)
  assert.match(css, /\.si-code-selection-chip\s*\{[\s\S]*border-left: 3px solid var\(--blue\)/s)
})
