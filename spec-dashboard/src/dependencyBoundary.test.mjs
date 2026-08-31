import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const dashboardSpec = readFileSync(join(root, '..', '.spec', 'spexcode', 'spec-dashboard', 'spec.md'), 'utf8')
const specCliSpec = readFileSync(join(root, '..', '.spec', 'spexcode', 'spec-cli', 'spec.md'), 'utf8')
const source = [
  ...readdirSync(join(root, 'src')).filter((name) => /\.(js|jsx|mjs)$/.test(name)).map((name) => join('src', name)),
  'src/terminal/SessionTerminal.tsx', 'src/terminal/transport.ts', 'src/terminal/index.ts',
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
    '@codemirror/view', '@lezer/highlight', '@spexcode/spec-cli', '@spexcode/spec-core', '@spexcode/transcript', '@spexcode/transcript-ui',
    '@xterm/xterm', '@xterm/addon-fit',
    '@xyflow/react', 'katex', 'markdown-it', 'react', 'react-dom', '@vitejs/plugin-react',
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

test('cross-package arrivals carry an immutable predecessor ledger', () => {
  assert.match(specCliSpec, /## Dependency arrival and subtraction ledger/)
  for (const commit of [
    '2a5560b11', 'f19ce3af2', '59f51a6b0', 'bbd00164a', '0962fb0e0',
    '7e90b791d', '023e91b4c', 'dff2d31c7', '2f8d5fb71', '3d0e60e6b',
    '377c832f4', 'b1c36fb04',
  ]) assert.match(specCliSpec, new RegExp('`' + commit + '`'), `arrival ledger omitted ${commit}`)
  for (const edge of [
    '@hono/node-ws', 'node-pty', '@spexcode/spec-core', '@spexcode/spec-eval',
    '@spexcode/spec-forge', '@spexcode/session-application',
    '@spexcode/session-selflaunch', '@vscode/tree-sitter-wasm',
  ]) assert.ok(specCliSpec.includes(`\`${edge}\``), `arrival ledger omitted ${edge}`)
  assert.match(specCliSpec, /No package predecessor/)
  assert.match(specCliSpec, /Same-change subtraction/)
})

test('optional desktop runtime is outside root workspaces', () => {
  const rootManifest = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8'))
  assert.ok(!rootManifest.workspaces.includes('spec-desktop'))
  const desktop = JSON.parse(readFileSync(join(root, '..', 'spec-desktop', 'package.json'), 'utf8'))
  assert.ok(desktop.devDependencies.electron)
})
