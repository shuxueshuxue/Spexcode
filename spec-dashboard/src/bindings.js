// @@@ bindings.js - the override store + resolver over the keymap.js registry. The registry holds the
// DEFAULT keys for each action; this layer merges a per-user override (saved in localStorage) on top and
// answers the question the readers ask: "what KEYS fire action X?" — for the keydown handler (firesKey)
// and the settings editor (keysOf). One key change moves the dispatch and the legend together, because
// both read through here.
import { ACT } from './keymap.js'

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
