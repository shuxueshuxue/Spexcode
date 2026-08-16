import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import * as sessionCore from '@spexcode/session-core'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('the public package entry resolves compiled artifacts and exposes the durable protocol', () => {
  assert.equal(typeof sessionCore.acceptMessage, 'function')
  assert.equal(typeof sessionCore.drain, 'function')
  assert.equal(typeof sessionCore.timelineTail, 'function')
  assert.equal(typeof sessionCore.advanceFollow, 'function')
})

test('the package source has no CLI, HTTP, dashboard, or harness dependency', () => {
  const source = readdirSync(join(root, 'src'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => readFileSync(join(root, 'src', name), 'utf8'))
    .join('\n')
  assert.doesNotMatch(source, /@spexcode\/spec-cli|\bhono\b|spec-dashboard|from ['"].*harness/)
})

test('compiled package output contains runtime modules, not test modules', () => {
  assert.ok(readdirSync(join(root, 'dist')).some((name) => name === 'index.js'))
  assert.ok(!readdirSync(join(root, 'dist')).some((name) => name.includes('.test.')))
})
