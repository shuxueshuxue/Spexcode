import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const desktopManifest = JSON.parse(readFileSync(join(root, 'spec-desktop', 'package.json'), 'utf8'))
const desktopSpec = readFileSync(join(root, '.spec', 'spexcode', 'spec-desktop', 'spec.md'), 'utf8')
const desktopMain = readFileSync(join(root, 'spec-desktop', 'main.js'), 'utf8')
const gatewayDiscovery = readFileSync(join(root, 'spec-desktop', 'gateway-discovery.js'), 'utf8')

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
  assert.match(desktopSpec, /same dashboard dist/)
  assert.match(desktopSpec, /spex dashboard/)
  assert.match(desktopSpec, /desktop:install/)
})

test('macOS menu forwards native tab accelerators into the page key service', () => {
  assert.match(desktopMain, /process\.platform === 'darwin'/)
  assert.match(desktopMain, /accelerator: 'Command\+W'/)
  assert.match(desktopMain, /accelerator: `Command\+\$\{ordinal\}`/)
  assert.match(desktopMain, /executeJavaScript\(`window\.dispatchEvent\(new KeyboardEvent/)
  assert.match(desktopSpec, /Menu accelerators are the native, reliable/)
  assert.match(desktopSpec, /Each menu item injects the equivalent cancelable/)
})

test('desktop attach reads the shared host record without a port or record-name fallback', () => {
  assert.match(gatewayDiscovery, /dist.*host-record\.js/)
  assert.match(gatewayDiscovery, /\/host/)
  assert.match(gatewayDiscovery, /gateway\?\.instanceId === record\.instanceId/)
  assert.doesNotMatch(`${desktopMain}\n${gatewayDiscovery}`, /gateway\.json|SPEXCODE_DASHBOARD_PORT/)
})
