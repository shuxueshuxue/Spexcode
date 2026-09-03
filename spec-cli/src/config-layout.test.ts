import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readConfig } from '@spexcode/spec-core'

function project() {
  const root = mkdtempSync(join(tmpdir(), 'spex-config-'))
  mkdirSync(join(root, '.spec'), { recursive: true })
  return root
}

test('readConfig reads committed and local config from .spec', () => {
  const root = project()
  writeFileSync(join(root, '.spec', 'spexcode.json'), JSON.stringify({ dashboard: { title: 'new' }, sessions: { maxActive: 3 } }))
  writeFileSync(join(root, '.spec', 'spexcode.local.json'), JSON.stringify({ sessions: { maxActive: 5 } }))
  assert.deepEqual(readConfig(root), { dashboard: { title: 'new' }, sessions: { maxActive: 5 } })
})

test('readConfig accepts a root-only legacy config and warns loudly', () => {
  const root = project()
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ dashboard: { title: 'legacy' } }))
  const errors: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => errors.push(args.join(' '))
  try { assert.equal(readConfig(root).dashboard?.title, 'legacy') }
  finally { console.error = original }
  assert.ok(errors.some((line) => line.includes('Config moved to .spec/')))
  assert.ok(errors.every((line) => !line.includes('spexcode.local.json')), errors.join('\n'))
})

test('the migration notice names only the legacy file that is actually there', () => {
  const root = project()
  writeFileSync(join(root, 'spexcode.local.json'), JSON.stringify({ sessions: { maxActive: 9 } }))
  const errors: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => errors.push(args.join(' '))
  try { assert.equal(readConfig(root).sessions?.maxActive, 9) }
  finally { console.error = original }
  const notice = errors.find((line) => line.includes('Config moved to .spec/'))
  assert.ok(notice, errors.join('\n'))
  assert.ok(notice.includes('spexcode.local.json'), notice)
  assert.ok(!notice.includes('git mv'), notice)
})

test('readConfig prefers .spec config when both locations exist', () => {
  const root = project()
  writeFileSync(join(root, '.spec', 'spexcode.json'), JSON.stringify({ dashboard: { title: 'new' } }))
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ dashboard: { title: 'legacy' } }))
  const errors: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => errors.push(args.join(' '))
  try { assert.equal(readConfig(root).dashboard?.title, 'new') }
  finally { console.error = original }
  assert.equal(errors.length, 0)
})
