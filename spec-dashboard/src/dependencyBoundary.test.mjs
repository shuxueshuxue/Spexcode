import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dashboardSpec = readFileSync(join(root, '..', '.spec', 'spexcode', 'spec-dashboard', 'spec.md'), 'utf8')
const source = [
  ...readdirSync(join(root, 'src')).filter((name) => /\.(js|jsx|mjs)$/.test(name)).map((name) => join('src', name)),
  'vite.config.js', 'vite.config.iso.mjs', 'cvid.vite.config.mjs',
].map((path) => readFileSync(join(root, path), 'utf8')).join('\n')

const noPredecessorPackages = [
  '@codemirror/lang-javascript', '@codemirror/language', '@codemirror/merge', '@codemirror/state',
  '@codemirror/view', '@lezer/highlight', 'katex', 'markdown-it',
]

test('direct dashboard dependencies have a live owner or explicit boundary', () => {
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
  const requiredImports = [
    '@codemirror/lang-javascript', '@codemirror/language', '@codemirror/merge', '@codemirror/state',
    '@codemirror/view', '@lezer/highlight', '@spexcode/spec-cli', '@spexcode/spec-core',
    '@xterm/addon-fit', '@xyflow/react', 'katex', 'markdown-it', 'react', 'react-dom', '@vitejs/plugin-react',
  ]
  for (const name of requiredImports) assert.ok(names.includes(name), `manifest lost required edge ${name}`)
  for (const name of requiredImports) assert.ok(source.includes(name), `dependency has no live importer: ${name}`)
  assert.equal(manifest.dependencies, undefined, 'dashboard runtime dependencies stay in devDependencies for the bundled app')
})

test('new renderer dependencies carry an explicit no-predecessor exemption', () => {
  assert.match(dashboardSpec, /These arrivals have no predecessor to\s+remove/)
  for (const name of noPredecessorPackages) {
    assert.ok(dashboardSpec.includes(`\`${name}\``), `spec omission for ${name}`)
  }
})

test('optional desktop runtime is outside root workspaces', () => {
  const rootManifest = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8'))
  assert.ok(!rootManifest.workspaces.includes('spec-desktop'))
  const desktop = JSON.parse(readFileSync(join(root, '..', 'spec-desktop', 'package.json'), 'utf8'))
  assert.ok(desktop.devDependencies.electron)
})
