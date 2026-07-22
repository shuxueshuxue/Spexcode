import test from 'node:test'
import assert from 'node:assert/strict'
import { nodeFromPrompt, slugify, titleFromPrompt } from './sessions.js'

// the derivation newSession names a session by: slug = `${slugify(ref || titleFromPrompt(prompt))}-<shortid>`.
// A session's slug is its OWN identity — an @-mentioned session id or a bare UUID in the prompt must never
// become this session's branch/worktree name (the z-code collision: a cleanup worker named after its target
// matched its own worktree and deleted it from under its running process).
const OTHER = 'ce5362f3-ceb4-4f77-988f-197df214b15d'

test('the first [[id]] mention is the sole prompt node binding across the full id grammar', () => {
  assert.equal(nodeFromPrompt('lead [[alpha]] then [[beta]]'), 'alpha')
  assert.equal(nodeFromPrompt('处理 [[中文节点]]'), '中文节点')
  assert.equal(nodeFromPrompt('audit [[.plugins]]'), '.plugins')
  assert.equal(nodeFromPrompt('create [[not-yet-existing]]'), 'not-yet-existing')
  assert.equal(nodeFromPrompt('node-agnostic prompt'), null)
})

test('a prompt @-mentioning another session never slugs to that id', () => {
  const title = titleFromPrompt(`清理一下 @${OTHER}`)
  assert.equal(title, '清理一下')
  const slug = slugify(title)
  assert.equal(slug, '清理一下')
  assert.ok(!slug.includes('ce5362f3'), `slug wears the mentioned session's id: ${slug}`)
})

test('a bare UUID-shaped token is stripped even without the @ sigil', () => {
  const title = titleFromPrompt(`cleanup ${OTHER} worktree`)
  assert.equal(title, 'cleanup worktree')
  assert.equal(slugify(title), 'cleanup-worktree')
})

test('a pure-CJK prompt keeps its words as a meaningful unicode slug', () => {
  const title = titleFromPrompt('清理一下')
  assert.equal(title, '清理一下')
  assert.equal(slugify(title), '清理一下')
})

test('a mixed CJK/ASCII prompt keeps both scripts and drops the mention', () => {
  const title = titleFromPrompt(`fix 布局 bug @${OTHER}`)
  assert.equal(title, 'fix 布局 bug')
  assert.equal(slugify(title), 'fix-布局-bug')
})

test('a mention-only prompt falls back to the non-empty session slug', () => {
  assert.equal(titleFromPrompt(`@${OTHER}`), null)
  // newSession suffixes `-<id.slice(0,4)>`, so the fallback stays unique per session
  assert.equal(slugify(null), 'session')
})

test('a mention-only first line falls through to the next line of prose', () => {
  assert.equal(titleFromPrompt(`@${OTHER}\n清理旧的 worktree`), '清理旧的 worktree')
})
