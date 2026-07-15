import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { scenarioListRows } from './cli.js'
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
