import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selfSummary } from './sessions.js'

// The headline only shows the agent's OWN self-summary, never tmux's default pane title. The discriminator
// is the leading status glyph Claude Code always emits; a glyph-less title is the boot-time default the row
// must NOT flicker through (see [[session-activity]]).

test('selfSummary: a glyph-less pane title is the tmux default, not the agent → null', () => {
  assert.equal(selfSummary('ser581555022561'), null)   // host name at pane birth — the "weird numbers"
  assert.equal(selfSummary('Claude Code'), null)        // bare splash before the first task (no glyph)
  assert.equal(selfSummary(''), null)
  assert.equal(selfSummary('   '), null)
})

test('selfSummary: a glyph-led title IS the agent self-summary, glyph stripped', () => {
  assert.equal(selfSummary('✳ 更新Zcode项目'), '更新Zcode项目')               // idle glyph + space
  assert.equal(selfSummary('⠐ Debug session naming'), 'Debug session naming') // braille spinner frame
  assert.equal(selfSummary('✶ Refactoring'), 'Refactoring')                   // a blink frame
  assert.equal(selfSummary('✳更新'), '更新')                                   // no space after the glyph
})

test('selfSummary: a glyph with no summary text → null (idle, nothing said yet)', () => {
  assert.equal(selfSummary('✳'), null)
  assert.equal(selfSummary('✳   '), null)
})
