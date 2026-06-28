import { test } from 'node:test'
import assert from 'node:assert/strict'

import { selfSummary, paneActivity, sessionHeadline } from './sessions.js'
import type { Session } from './sessions.js'
import { claudeHarness, codexHarness } from './harness.js'

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

// paneActivity gates the raw pane title by the harness capability: claude's pane title IS its task summary,
// codex's is a spinner + the cwd FOLDER name (e.g. `⠙ codex-naming`) — NOT a self-summary, so it is refused
// and the headline falls through to the launch prompt instead of showing the worktree folder.
test('paneActivity: claude self-summarizes — the parsed pane title becomes the headline activity', () => {
  assert.equal(claudeHarness.paneTitleIsSelfSummary, true)
  assert.equal(paneActivity(claudeHarness, '✳ Implement codex session naming'), 'Implement codex session naming')
  assert.equal(paneActivity(claudeHarness, '⠐ Debug session naming'), 'Debug session naming')
  assert.equal(paneActivity(claudeHarness, 'ser581555022561'), null)   // glyph-less boot default still rejected
})

test('paneActivity: codex does NOT self-summarize — its folder-name pane title yields null (headline → prompt)', () => {
  assert.equal(codexHarness.paneTitleIsSelfSummary, false)
  // the codex pane title is `⠙ <cwd-basename>` — a braille spinner + the worktree folder. selfSummary alone
  // would strip the spinner and return the FOLDER ("codex-naming"); paneActivity refuses it for codex.
  assert.equal(paneActivity(codexHarness, '⠙ codex-naming'), null)
  assert.equal(paneActivity(codexHarness, '✳ anything at all'), null)
})

test('paneActivity: a missing pane title → null for either harness', () => {
  assert.equal(paneActivity(claudeHarness, null), null)
  assert.equal(paneActivity(claudeHarness, undefined), null)
  assert.equal(paneActivity(codexHarness, undefined), null)
})

// the full headline chain for both harnesses, given the SAME launch prompt and worktree folder name in the
// pane title. Proof the fix lands: codex's headline is its TASK, not its folder.
test('sessionHeadline: codex headline is the TASK (prompt), not the worktree folder; claude is its live summary', () => {
  const base: Session = {
    id: 'sess-x', node: null, title: null, name: null, branch: null, path: '', harness: 'codex',
    lifecycle: 'active', proposal: null, merges: 0, note: null, status: 'working', liveness: 'online',
    prompt: 'Implement codex session naming so the headline is the task',
    promptPreview: 'Implement codex session naming so the headline is the task',
    created: 0, activity: null, sortKey: null,
  }
  // codex: pane title is `⠙ codex-naming` (the folder). Gated → activity null → headline is the prompt preview.
  const codexActivity = paneActivity(codexHarness, '⠙ codex-naming')
  assert.equal(sessionHeadline({ ...base, harness: 'codex', activity: codexActivity }),
    'Implement codex session naming so the headline is the task')
  // claude: pane title is its live task summary → that IS the headline, prompt preview is overridden.
  const claudeActivity = paneActivity(claudeHarness, '✳ Reworking the launcher')
  assert.equal(sessionHeadline({ ...base, harness: 'claude', activity: claudeActivity }), 'Reworking the launcher')
})
