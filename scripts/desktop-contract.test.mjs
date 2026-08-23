import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const desktopManifest = JSON.parse(readFileSync(join(root, 'spec-desktop', 'package.json'), 'utf8'))
const desktopSpec = readFileSync(join(root, '.spec', 'spexcode', 'spec-desktop', 'spec.md'), 'utf8')

test('desktop shell has explicit optional root entrypoints', () => {
  assert.equal(rootManifest.scripts['desktop:install'], 'npm --prefix spec-desktop install')
  assert.equal(rootManifest.scripts['desktop:start'], 'npm --prefix spec-desktop start')
  assert.equal(rootManifest.scripts['desktop:check'], 'node --test scripts/desktop-contract.test.mjs')
})

test('desktop remains optional and does not tax normal workspace installs', () => {
  assert.ok(!rootManifest.workspaces.includes('spec-desktop'))
  assert.equal(desktopManifest.scripts.start, 'electron .')
  assert.equal(desktopManifest.private, true)
  assert.ok(desktopManifest.devDependencies.electron)
})

test('desktop contract keeps browser and shell on the same served product', () => {
  assert.match(desktopSpec, /same origin/)
  assert.match(desktopSpec, /spex serve ui/)
  assert.match(desktopSpec, /desktop:install/)
})
