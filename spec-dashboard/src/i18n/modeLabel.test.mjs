import test from 'node:test'
import assert from 'node:assert/strict'
import en from './en.js'
import zh from './zh.js'

// The headless mode label is plain "headless" on EVERY surface that presents it (the .si-mode-seg
// segment, the pill's ◇ mark, the board row's ◇ tooltip) — no " — chat view" suffix. The suffix once
// crept in as a DUPLICATE session.modeHeadless key later in the same object, silently overriding the
// plain label everywhere; this pins the resolved value so any re-introduced duplicate fails loud.
test('headless mode label is plain, with no chat-view suffix', () => {
  assert.equal(en.session.modeHeadless, 'headless')
  assert.equal(zh.session.modeHeadless, '无头')
})
