// @@@ bindings.js - the override store + resolver over the keymap.js registry. The registry holds the
// DEFAULT binding for each action; this layer merges a per-user override (saved in localStorage) on top
// and answers the two questions the readers ask: "what KEYS fire action X?" (the keydown handler) and
// "what PAD button fires action X?" (the controller + the editor). One key change moves the keyboard,
// the controller and the legend together, because all three read through here.
import { ACT } from './keymap.js'

const LS_KEY = 'spex.keybindings.v1'
const byId = Object.fromEntries(ACT.map((a) => [a.id, a]))

// overrides: { [id]: { keys?: string[], pad?: string } } — sparse; absent fields fall back to the default.
function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
let overrides = load()

// resolved keyboard keys for an action: the override's keys if set, else the registry default.
export function keysOf(id) {
  const o = overrides[id]
  return (o && o.keys) || byId[id]?.keys || []
}
// resolved pad button token for an action ('' = none).
export function padOf(id) {
  const o = overrides[id]
  return o && o.pad != null ? o.pad : byId[id]?.pad ?? ''
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

// save / clear an override, then notify the live readers (the editor re-renders, the controller rebuilds
// its button map). The keydown handler needs no notify — it calls keysOf() fresh on every event.
export function setBinding(id, patch) {
  overrides = { ...overrides, [id]: { ...overrides[id], ...patch } }
  localStorage.setItem(LS_KEY, JSON.stringify(overrides))
  emit()
}
export function resetBindings() {
  overrides = {}
  localStorage.removeItem(LS_KEY)
  emit()
}

const subs = new Set()
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn) }
function emit() { subs.forEach((fn) => fn()) }
