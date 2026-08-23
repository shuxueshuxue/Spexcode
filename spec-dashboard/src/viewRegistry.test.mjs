import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, name), 'utf8')

test('registry views receive route props and do not acquire the global route', () => {
  const registry = read('views.jsx')
  const shell = read('Shell.jsx')
  const workspace = read('workspace.jsx')

  // Shell is the route owner. ViewPool/ViewHost pass the captured address down explicitly.
  assert.match(shell, /<View param=\{entry\.param\} query=\{entry\.query\} \/>/)
  assert.match(shell, /<View key=\{poolKey\(page, param\)\} param=\{param\} query=\{query\} \/>/)
  assert.doesNotMatch(registry, /(?:import[^\n]*useRoute|\buseRoute\s*\()/)
  assert.doesNotMatch(workspace, /VIEW_ROUTE_CONTRACT/)
})
