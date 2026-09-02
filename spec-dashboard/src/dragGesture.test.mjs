import test from 'node:test'
import assert from 'node:assert/strict'
import { startDrag } from './dragGesture.js'

class EventHub {
  constructor() { this.listeners = new Map() }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener)) }
  dispatch(type, event = {}) { for (const listener of [...(this.listeners.get(type) || [])]) listener(event) }
}

test('no movement leaves the ordinary click delivered', () => {
  const priorWindow = globalThis.window
  const priorDocument = globalThis.document
  const window = new EventHub()
  const document = { body: { classList: { add() {}, remove() {} } } }
  let captures = 0
  let releases = 0
  const pressed = {
    setPointerCapture() { captures += 1 },
    hasPointerCapture() { return false },
    releasePointerCapture() { releases += 1 },
  }
  globalThis.window = window
  globalThis.document = document
  let clicks = 0
  let starts = 0
  let drops = 0
  window.addEventListener('click', () => { clicks += 1 })
  try {
    startDrag({ button: 0, clientX: 100, clientY: 100, pointerId: 7, currentTarget: pressed }, {
      onStart: () => { starts += 1 },
      onDrop: () => { drops += 1 },
    })
    window.dispatch('pointermove', { clientX: 103, clientY: 104 })
    window.dispatch('pointerup', { clientX: 103, clientY: 104 })
    window.dispatch('click')
    assert.equal(captures, 0)
    assert.equal(releases, 0)
    assert.equal(starts, 0)
    assert.equal(drops, 0)
    assert.equal(clicks, 1)
  } finally {
    globalThis.window = priorWindow
    globalThis.document = priorDocument
  }
})
