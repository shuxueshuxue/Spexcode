// fitTextarea — the shared auto-grow routine ([[session-console]]'s ❯ inbox + New prompt, issues-view's
// thread composer). Focused on the growth contract: height = CONTENT scrollHeight clamped [minH, maxH],
// and an EMPTY box is measured placeholder-blind — a wrapped placeholder must never grow the resting box
// (the session-console rest-strip-immune-to-placeholder-wrap scenario), while the placeholder itself is
// restored untouched. The stub models the one browser fact that matters: Chrome folds a rendered
// placeholder's wrap into scrollHeight when value is empty.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fitTextarea } from './textarea.js'

// a minimal textarea stand-in: scrollHeight follows value lines, or the placeholder's wrapped lines when
// empty (lineH per line), mimicking Chrome's placeholder-inclusive overflow measurement.
function makeTa({ value = '', placeholder = '', placeholderLines = 1, lineH = 20 } = {}) {
  return {
    value,
    placeholder,
    style: {},
    computedStyles: { boxSizing: 'content-box', borderTopWidth: '0px', borderBottomWidth: '0px' },
    get scrollHeight() {
      if (this.value) return this.value.split('\n').length * lineH
      return (this.placeholder ? placeholderLines : 1) * lineH
    },
  }
}

const fit = (ta, maxH, minH = 0) => fitTextarea(ta, maxH, minH, ta.computedStyles)

test('empty box with a WRAPPED placeholder rests at one line — placeholder never grows it', () => {
  const ta = makeTa({ placeholder: 'message this session · ⏎ to send', placeholderLines: 2 })
  fit(ta, 360)
  assert.equal(ta.style.height, '20px')
  assert.equal(ta.style.overflowY, 'hidden')
  assert.equal(ta.placeholder, 'message this session · ⏎ to send') // restored, not eaten
})

test('content-driven growth is untouched: a real multi-line draft still grows to its scrollHeight', () => {
  const ta = makeTa({ value: 'a\nb\nc\nd' })
  fit(ta, 360)
  assert.equal(ta.style.height, '80px')
  assert.equal(ta.style.overflowY, 'hidden')
})

test('past the cap the height pins to maxH and overflow flips to auto', () => {
  const ta = makeTa({ value: Array.from({ length: 40 }, (_, i) => `l${i}`).join('\n') })
  fit(ta, 360)
  assert.equal(ta.style.height, '360px')
  assert.equal(ta.style.overflowY, 'auto')
})

test('minH idle floor still applies to an empty box (thread-composer contract)', () => {
  const ta = makeTa({ placeholder: 'reply…', placeholderLines: 3 })
  fit(ta, 380, 62)
  assert.equal(ta.style.height, '62px') // the floor, not the wrapped placeholder's 60
  assert.equal(ta.placeholder, 'reply…')
})

test('border-box height includes block borders so uncapped content fits its client box', () => {
  const ta = makeTa({ value: 'a\nb' })
  ta.computedStyles = { boxSizing: 'border-box', borderTopWidth: '1px', borderBottomWidth: '1px' }
  fit(ta, 360)
  assert.equal(ta.style.height, '42px')
  const clientHeight = parseFloat(ta.style.height) - 2
  assert.ok(ta.scrollHeight <= clientHeight)
  assert.equal(ta.style.overflowY, 'hidden')
})

test('null target is a no-op', () => {
  fitTextarea(null, 100) // must not throw
})
