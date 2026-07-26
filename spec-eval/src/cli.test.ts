import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { scenarioListRows } from './cli.js'
import { parseScenarios, scenarioProjection } from './scenarios.js'
import type { EvalNode } from './scenarios.js'

test('scenario-list JSON preserves a normalized concrete test reference', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eval-cli-test-'))
  const node: EvalNode = {
    id: 'auth',
    dir,
    evalPath: '.spec/auth/eval.md',
    sidecarPath: join(dir, 'evals.ndjson'),
    scenarios: [{
      name: 'login', description: 'log in', expected: 'dashboard', tags: ['frontend-e2e'],
      test: { path: 'tests/auth.spec.ts', name: 'accepts a valid session' },
    }],
  }
  const json = JSON.parse(JSON.stringify(scenarioListRows([node])))
  assert.deepEqual(json, [{
    node: 'auth', scenario: 'login', tags: ['frontend-e2e'],
    test: { path: 'tests/auth.spec.ts', name: 'accepts a valid session' },
    measured: false,
  }])
})

test('canonical scenario projection separates semantic and measurement identity', () => {
  const node = (scenario: EvalNode['scenarios'][number]): EvalNode => ({
    id: 'z-node', dir: '/tmp/z-node', evalPath: '.spec/z-node/eval.md', sidecarPath: '/tmp/z-node/evals.ndjson', scenarios: [scenario],
  })
  const base = {
    name: 'loop', description: 'measure the loop', expected: 'it converges',
    code: ['src/app.ts#run', 'src/app.ts#finish'], related: ['docs/loop.md'], tags: ['cli', 'desktop'],
    test: { path: 'tests/loop.spec.ts', name: 'full loop' },
  }
  const a = scenarioProjection([node(base)], { head: 'head-a', treeSha: 'tree-a' })
  const aAgain = scenarioProjection([node({ ...base })], { head: 'head-a', treeSha: 'tree-a' })
  assert.equal(JSON.stringify(a), JSON.stringify(aAgain))
  assert.deepEqual(a.rows, [{
    semantic: {
      node: 'z-node', name: 'loop', description: 'measure the loop', expected: 'it converges',
      scenarioHash: a.rows[0].semantic.scenarioHash,
      code: [{ path: 'src/app.ts', selectors: ['run', 'finish'] }],
      related: [{ path: 'docs/loop.md', selectors: [] }], tags: ['cli', 'desktop'],
    },
    measurement: { test: { path: 'tests/loop.spec.ts', name: 'full loop' } },
  }])
  assert.deepEqual(a.provenance, { head: 'head-a', treeSha: 'tree-a' })

  const testOnly = scenarioProjection([node({ ...base, test: { path: 'tests/loop.spec.ts', name: 'smoke' } })], { head: 'head-a', treeSha: 'tree-a' })
  assert.equal(testOnly.semanticIndexHash, a.semanticIndexHash)
  assert.notEqual(testOnly.fullIndexHash, a.fullIndexHash)

  const metadata = scenarioProjection([node({ ...base, tags: ['desktop', 'cli'], related: ['docs/other.md'], code: ['src/other.ts'] })], { head: 'head-a', treeSha: 'tree-a' })
  assert.notEqual(metadata.semanticIndexHash, a.semanticIndexHash)
  assert.notEqual(metadata.fullIndexHash, a.fullIndexHash)
  assert.equal(metadata.rows[0].semantic.scenarioHash, a.rows[0].semantic.scenarioHash)

  const semantic = scenarioProjection([node({ ...base, expected: 'it diverges' })], { head: 'head-a', treeSha: 'tree-a' })
  assert.notEqual(semantic.rows[0].semantic.scenarioHash, a.rows[0].semantic.scenarioHash)
  assert.notEqual(semantic.semanticIndexHash, a.semanticIndexHash)
  assert.notEqual(semantic.fullIndexHash, a.fullIndexHash)

  const modeOnly = scenarioProjection([node({ ...base })], { head: 'head-b', treeSha: 'tree-b' })
  assert.equal(modeOnly.semanticIndexHash, a.semanticIndexHash)
  assert.equal(modeOnly.fullIndexHash, a.fullIndexHash)
  assert.notDeepEqual(modeOnly.provenance, a.provenance)
})

test('canonical scenario projection sorts rows and uses stable empty shapes', () => {
  const mk = (id: string, name: string): EvalNode => ({
    id, dir: `/tmp/${id}`, evalPath: `.spec/${id}/eval.md`, sidecarPath: `/tmp/${id}/evals.ndjson`,
    scenarios: [{ name, description: 'd', expected: 'e' }],
  })
  const projection = scenarioProjection([mk('z-node', 'zeta'), mk('a-node', 'omega')])
  assert.deepEqual(projection.rows.map((r) => [r.semantic.node, r.semantic.name]), [['a-node', 'omega'], ['z-node', 'zeta']])
  assert.deepEqual(projection.rows[0].semantic.code, [])
  assert.deepEqual(projection.rows[0].semantic.related, [])
  assert.deepEqual(projection.rows[0].semantic.tags, [])
  assert.deepEqual(projection.rows[0].measurement, { test: null })
  assert.deepEqual(projection.provenance, { head: null, treeSha: null })
})

test('canonical scenario projection rejects malformed declaration bytes before hashing', () => {
  const malformed = [
    `---\nscenarios:\n  - description: missing name\n    expected: e\n    tags: [cli]\n---`,
    `---\nscenarios:\n  - name: unknown\n    description: d\n    expected: e\n    tags: [cli]\n    typo: x\n---`,
    `---\nscenarios:\n  - name: missing-expected\n    description: d\n    tags: [cli]\n---`,
    `---\nscenarios:\n  - name: duplicate\n    description: d\n    expected: e\n    tags: [cli]\n  - name: duplicate\n    description: d2\n    expected: e2\n    tags: [cli]\n---`,
    `---\nscenarios:\n  - name: mixed\n    description: d\n    expected: e\n    tags: [cli]\n    code: [src/a.ts, src/a.ts#run]\n---`,
  ]
  for (const source of malformed) {
    assert.throws(() => scenarioProjection([{
      id: 'bad', scenarios: parseScenarios(source), evalSource: source,
    }]), /malformed eval\.md/)
  }
})
