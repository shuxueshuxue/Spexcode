
import { ACT, keyCap } from './keymap.js'

const LS_KEY = 'spex.keybindings.v1'
const byId = Object.fromEntries(ACT.map((a) => [a.id, a]))

// overrides: { [id]: { keys?: string[] } } — sparse; absent fields fall back to the registry default.
function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
let overrides = load()

// resolved keyboard keys for an action: the override's keys if set, else the registry default.
export function keysOf(id) {
  const o = overrides[id]
  return (o && o.keys) || byId[id]?.keys || []
}
// true when a user has changed this action away from its registry default.
export function isCustom(id) {
  return !!overrides[id]
}

// reverse lookup the keydown handler uses: does this physical key fire `id` right now (rebindable only —
// a remap of a structural action is ignored so the relationship-walk can't be unbound by accident).
export function firesKey(id, key) {
  return keysOf(id).includes(key)
}

// Chords use physical codes so Option dead-key glyphs and keyboard layouts do not change their meaning.
export function eventKey(event) {
  const mods = []
  if (event.altKey) mods.push('Alt')
  if (event.ctrlKey) mods.push('Ctrl')
  if (event.metaKey) mods.push('Meta')
  if (event.shiftKey) mods.push('Shift')
  return `${mods.length ? `${mods.join('+')}+` : ''}${event.code || event.key}`
}

export function firesEvent(id, event) {
  return keysOf(id).includes(eventKey(event)) || (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey(id, event.key))
}

// THE HINT READER. A control that a key can also reach says so in its own tooltip, and it asks the registry
// what that key is RIGHT NOW rather than carrying a copy.
//
// The copies were the bug. Every hint used to be typed into the translated label — `'Search (/)'`,
// `'Evals (⌥3 / ⌥F)'`, `'…(Alt+I)'` — in two languages, in three different glyph dialects, and unreachable
// by a rebind. So a tooltip could name a key the keyboard no longer fired, and a chord the registry held
// could reach the reader with its modifiers stripped or not at all. Resolving here means a hint cannot be
// stale, cannot disagree with the legend, and cannot exist for an action that has no binding.
//
// One cap per action — the action's PRIMARY key. Aliases (`i`/`I`/`Enter`) are the legend's business, not a
// tooltip's. Several ids in one call is the honest way to say "these keys reach this control".
export function shortcutHint(...ids) {
  const caps = []
  for (const id of ids) {
    const cap = keyCap(keysOf(id)[0])
    if (cap && !caps.includes(cap)) caps.push(cap)
  }
  return caps.join(' · ')
}

// `label (hint)`, or the bare label when nothing is bound. The label stays a pure i18n string; the hint is
// appended by the reader, so a translator never owns a key name.
export function withShortcut(label, ...ids) {
  const hint = shortcutHint(...ids)
  return hint ? `${label} (${hint})` : label
}

// save / clear an override. No notify layer: the keydown handler calls keysOf() fresh on every event,
// and the settings editor re-renders from its own interaction state.
export function setBinding(id, patch) {
  overrides = { ...overrides, [id]: { ...overrides[id], ...patch } }
  localStorage.setItem(LS_KEY, JSON.stringify(overrides))
}
export function resetBindings() {
  overrides = {}
  localStorage.removeItem(LS_KEY)
}
