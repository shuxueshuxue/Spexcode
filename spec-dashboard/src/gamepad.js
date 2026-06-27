// @@@ gamepad.js - the game-controller bridge: ONE decoupled leaf, mounted once as an import side-effect
// from main.jsx. It reads the keymap registry (through bindings.js) and turns a controller button into the
// SYNTHETIC KEYBOARD EVENT that action is bound to — so the board's existing capture-phase handler routes
// it, the controller never touches React state, and a rebind in Settings moves the controller with the
// keyboard. Delete this file and the dashboard is byte-for-byte unchanged.
//
// The Web Gamepad API has no button events (only connect/disconnect), so reading a press means diffing
// per-frame snapshots. That poll is irreducible but contained here: it runs in rAF, fires only on the
// rising edge, and is GATED ON CONNECTION — with no controller plugged in, not a frame is polled.
import { ACT, PAD_GLYPH } from './keymap.js'
import { padOf, keysOf, subscribe } from './bindings.js'

// standard-gamepad button index → our pad token (see keymap.js). D-pad is 12-15; the left stick is
// resolved from axes below into the same Up/Down/Left/Right tokens, so either drives navigation.
const BUTTON_TOKEN = {
  0: 'A', 1: 'B', 2: 'X', 3: 'Y', 4: 'LB', 5: 'RB', 6: 'LT', 7: 'RT',
  8: 'Select', 9: 'Start', 10: 'L3', 11: 'R3', 12: 'Up', 13: 'Down', 14: 'Left', 15: 'Right',
}
const DEADZONE = 0.55
const REPEAT_DELAY = 380 // ms a button is held before it starts auto-repeating
const REPEAT_RATE = 90   // ms between repeats while held — keyboard-like glide for d-pad / stick nav

// token → the key to synthesize, rebuilt from the registry whenever a binding changes.
let tokenKey = {}
function buildMap() {
  tokenKey = {}
  for (const a of ACT) {
    const tok = padOf(a.id)
    if (tok) tokenKey[tok] = keysOf(a.id)[0]
  }
}
buildMap()
subscribe(buildMap)

function fire(token) {
  const key = tokenKey[token]
  if (!key) return
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
}

// per-token press state for edge-detect + auto-repeat. now = performance.now() (real browser clock).
const held = new Map() // token → next-repeat timestamp
function edge(token, down, now) {
  if (down) {
    if (!held.has(token)) { held.set(token, now + REPEAT_DELAY); fire(token) }      // rising edge
    else if (now >= held.get(token)) { held.set(token, now + REPEAT_RATE); fire(token) } // repeat
  } else {
    held.delete(token)
  }
}

let raf = 0
function poll() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []
  const pad = Array.from(pads).find(Boolean)
  if (pad) {
    const now = performance.now()
    // physical buttons
    for (const [i, token] of Object.entries(BUTTON_TOKEN)) {
      edge(token, !!pad.buttons[i]?.pressed, now)
    }
    // left stick → virtual d-pad (so stick and d-pad both navigate). Each axis owns one opposed pair.
    const [x, y] = pad.axes
    edge('Left',  x < -DEADZONE, now); edge('Right', x > DEADZONE, now)
    edge('Up',    y < -DEADZONE, now); edge('Down',  y > DEADZONE, now)
  }
  raf = requestAnimationFrame(poll)
}

// connection-gated loop: poll only while at least one controller is connected.
let status = { connected: false, id: '' }
const statusSubs = new Set()
export function getStatus() { return status }
export function subscribeStatus(fn) { statusSubs.add(fn); return () => statusSubs.delete(fn) }
function setStatus(s) { status = s; statusSubs.forEach((fn) => fn(status)) }

function anyPad() { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).some(Boolean) }
function start() { if (!raf) raf = requestAnimationFrame(poll) }
function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0 } held.clear() }

if (typeof window !== 'undefined') {
  window.addEventListener('gamepadconnected', (e) => {
    setStatus({ connected: true, id: e.gamepad?.id || '' })
    start()
  })
  window.addEventListener('gamepaddisconnected', () => {
    if (!anyPad()) { stop(); setStatus({ connected: false, id: '' }) }
  })
  // a controller already present at load (Chromium fires connected only after the first input, so probe once)
  if (anyPad()) { const p = Array.from(navigator.getGamepads()).find(Boolean); setStatus({ connected: true, id: p?.id || '' }); start() }
}

// @@@ captureButton - used by the Settings rebinding editor: watch for the next controller button (or
// stick direction) and hand back its token, then stop. Returns a cancel fn. Runs its own short rAF probe
// so it works even when the main loop is idle (no other input happening).
export function captureButton(cb) {
  let id = 0
  const scan = () => {
    const pad = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean)
    if (pad) {
      for (const [i, token] of Object.entries(BUTTON_TOKEN)) {
        if (pad.buttons[i]?.pressed) { cb(token); return }
      }
      const [x, y] = pad.axes
      if (x < -DEADZONE) return cb('Left'); if (x > DEADZONE) return cb('Right')
      if (y < -DEADZONE) return cb('Up'); if (y > DEADZONE) return cb('Down')
    }
    id = requestAnimationFrame(scan)
  }
  id = requestAnimationFrame(scan)
  return () => cancelAnimationFrame(id)
}

export { PAD_GLYPH }
