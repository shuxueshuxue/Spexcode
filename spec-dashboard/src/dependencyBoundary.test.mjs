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
    '@codemirror/view', '@lezer/highlight', '@spexcode/archify', '@spexcode/spec-cli', '@spexcode/spec-core', '@spexcode/transcript', '@spexcode/transcript-ui',
    '@xterm/xterm', '@xterm/addon-fit',
    '@xyflow/react', 'katex', 'markdown-it', 'react', 'react-dom', '@vitejs/plugin-react',
  ]
  for (const name of requiredImports) assert.ok(names.includes(name), `manifest lost required edge ${name}`)
  for (const name of requiredImports) assert.ok(source.includes(name), `dependency has no live importer: ${name}`)
  assert.equal(manifest.dependencies, undefined, 'dashboard runtime dependencies stay in devDependencies for the bundled app')
})

// The diagram is drawn by the backend; the dashboard takes only archify's browser half — its stylesheet and the
// focus/id helpers — and never the renderer, whose Node-only modules would otherwise land in the bundle.
test('the dashboard imports archify\'s browser half, never its renderer', () => {
  const entries = [...source.matchAll(/from '(@spexcode\/archify[^']*)'|import '(@spexcode\/archify[^']*)'/g)].map((m) => m[1] ?? m[2])
  assert.deepEqual([...new Set(entries)].sort(), ['@spexcode/archify/browser', '@spexcode/archify/diagram.css'])
})

test('new renderer dependencies carry an explicit no-predecessor exemption', () => {
  assert.match(dashboardSpec, /These arrivals have no predecessor to\s+remove/)
  for (const name of noPredecessorPackages) {
    assert.ok(dashboardSpec.includes(`\`${name}\``), `spec omission for ${name}`)
  }
})

test('the CLI spec carries the subtraction rule and owns its no-predecessor exceptions', () => {
  assert.match(specCliSpec, /## Dependency arrival and subtraction/)
  assert.match(specCliSpec, /No package predecessor/)
  for (const edge of ['@spexcode/spec-core', '@spexcode/spec-forge', '@spexcode/session-application', '@spexcode/session-selflaunch', '@spexcode/transcript'])
    assert.ok(specCliSpec.includes(`\`${edge}\``), `CLI spec omits its declared edge ${edge}`)
  for (const edge of ['@hono/node-ws', 'node-pty', '@spexcode/archify'])
    assert.ok(specCliSpec.includes(`\`${edge}\``), `CLI spec omits no-predecessor exception ${edge}`)
  assert.match(specCliSpec, /\[\[archify\]\]/, 'the archify exception lost its owner node')
  assert.match(specCliSpec, /packages\/archify\/test\/library\.test\.mjs/, 'the archify exception lost its boundary check')
})

// The rule, not a per-commit ledger: git answers when an edge arrived, the body answers what justifies it.
// A dependency history written as a table slips past lint's living rule, which only knows "## vN" headings.
test('no dependency spec body carries a per-commit ledger', () => {
  for (const [name, body] of [['spec-cli', specCliSpec], ['spec-dashboard', dashboardSpec]])
    assert.ok(!/^\| `?[0-9a-f]{7,40}`?[ )]/m.test(body), `${name}'s body grew a commit ledger again`)
})

test('optional desktop runtime is outside root workspaces', () => {
  const rootManifest = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8'))
  assert.ok(!rootManifest.workspaces.includes('spec-desktop'))
  const desktop = JSON.parse(readFileSync(join(root, '..', 'spec-desktop', 'package.json'), 'utf8'))
  assert.ok(desktop.devDependencies.electron)
})
