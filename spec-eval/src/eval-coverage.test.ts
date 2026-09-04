import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { hasEvalCoverage } from './scenarios.js'

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-eval-coverage-'))
  const write = (path: string, source: string) => {
    const full = join(root, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, source)
  }
  const spec = (id: string, code = '') => write(`.spec/project/${id}/spec.md`, `---\ntitle: ${id}\n${code ? `code:\n  - ${code}\n` : ''}---\n# ${id}\n`)
  return { root, write, spec }
}

test('hasEvalCoverage: a source-governing node with a valid eval scenario passes', () => {
  const { root, write, spec } = fixture()
  spec('governed', 'src/app.ts')
  write('.spec/project/governed/eval.md', '---\nscenarios:\n  - name: app-works\n    tags: [cli]\n    description: app works\n    expected: app works\n---\n')
  const result = hasEvalCoverage(root, 'governed')
  assert.deepEqual(result, {
    ok: true,
    nodeId: 'governed',
    exempt: false,
    evalPath: '.spec/project/governed/eval.md',
  })
})

test('hasEvalCoverage: a source-governing node without eval.md fails with a repair reason', () => {
  const { root, spec } = fixture()
  spec('missing', 'src/app.ts')
  const result = hasEvalCoverage(root, 'missing')
  assert.equal(result.ok, false)
  assert.match(result.reason, /missing.*eval\.md.*add one with a scenario/)
})

test('hasEvalCoverage: a node without code is explicitly exempt', () => {
  const { root, spec } = fixture()
  spec('intent-only')
  const result = hasEvalCoverage(root, 'intent-only')
  assert.deepEqual(result, { ok: true, nodeId: 'intent-only', exempt: true })
})

test('hasEvalCoverage: an unknown node fails loudly', () => {
  const { root } = fixture()
  const result = hasEvalCoverage(root, 'does-not-exist')
  assert.deepEqual(result, { ok: false, reason: "node 'does-not-exist' does not exist" })
})
