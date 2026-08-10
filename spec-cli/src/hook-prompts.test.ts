import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HookPromptCatalog } from './hook-prompts.js'

test('HookPromptCatalog is frozen, deterministic, and exposes every lifecycle hook', () => {
  const first = new HookPromptCatalog()
  const second = new HookPromptCatalog()
  assert.deepEqual(first.entries, second.entries)
  assert.equal(first.entries.length, 6)
  assert.ok(Object.isFrozen(first.entries))
  for (const entry of first.entries) {
    assert.ok(Object.isFrozen(entry))
    assert.ok(entry.content.length > 0)
  }
})

test('runtime prompt rendering uses the same templates published to the catalog', () => {
  const prompts = new HookPromptCatalog()
  const first = prompts.render('spec-first', { path: 'src/app.ts', owner: '.spec/project/app/spec.md [app]' })
  assert.match(first, /src\/app\.ts/)
  assert.match(first, /Read the relevant NEIGHBORS/)

  const details = 'src/app.ts is governed by app — the application contract.'
  assert.equal(prompts.render('spec-of-file', { details }), `Contract context for this edit:\n${details}`)

  const stop = prompts.render('stop-gate', { variant: 'terse', cli: '/opt/spex' })
  assert.match(stop, /\/opt\/spex session/)
  assert.doesNotMatch(stop, /\{cli\}|\{variant\}/)
  assert.throws(() => prompts.render('mark-active'), /does not emit prompt text/)
})
