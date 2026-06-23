import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isUiPath, nodeChanged } from './cli.js'

// ---- the loss-signal coverage classifiers scan uses (isUiPath → uncovered-frontend; nodeChanged → --changed scope) ----

test('isUiPath: a UI file (component/style anywhere, or anything in the dashboard package) is a frontend surface', () => {
  for (const p of [
    'spec-dashboard/src/NodeView.jsx',
    'spec-dashboard/src/score.tsx',
    'spec-dashboard/src/styles.css',
    'spec-dashboard/src/i18n/en.js',   // non-UI extension, but in the dashboard package → still frontend
    'foo/Bar.vue',
    'x/y.svelte',
  ]) assert.equal(isUiPath(p), true, p)
})

test('isUiPath: pure backend / non-UI code is not a frontend surface', () => {
  for (const p of [
    'spec-cli/src/sessions.ts',
    'spec-cli/hooks/stop-gate.sh',
    'spec-yatsu/src/cli.ts',
    'README.md',
  ]) assert.equal(isUiPath(p), false, p)
})

test('nodeChanged: matches a touched node dir (spec.md / yatsu.md / sidecar all live there)', () => {
  const changed = new Set(['.spec/spexcode/spec-yatsu/yatsu-core/spec.md'])
  assert.equal(nodeChanged('.spec/spexcode/spec-yatsu/yatsu-core', [], changed), true)
  assert.equal(nodeChanged('.spec/spexcode/spec-yatsu/yatsu-show', [], changed), false)
  // a node whose dir name is a PREFIX of the changed one must not false-match
  assert.equal(nodeChanged('.spec/spexcode/spec-yatsu/yatsu', [], changed), false)
})

test('nodeChanged: matches a governed code path — exact, directory prefix, or a * glob', () => {
  const exact = new Set(['spec-cli/src/sessions.ts'])
  assert.equal(nodeChanged('n', ['spec-cli/src/sessions.ts'], exact), true)
  assert.equal(nodeChanged('n', ['spec-cli/src/other.ts'], exact), false)

  const underDir = new Set(['spec-dashboard/src/panes/Eval.jsx'])
  assert.equal(nodeChanged('n', ['spec-dashboard/src'], underDir), true)   // code: is a directory
  assert.equal(nodeChanged('n', ['spec-dashboard/src'], new Set(['spec-cli/src/x.ts'])), false)

  const glob = new Set(['spec-cli/src/hooks/mark-active.sh'])
  assert.equal(nodeChanged('n', ['spec-cli/src/hooks/*.sh'], glob), true)
  assert.equal(nodeChanged('n', ['spec-cli/src/hooks/*.ts'], glob), false)
})

test('nodeChanged: no overlap → not changed (the scope filter that stops cross-node nagging)', () => {
  const changed = new Set(['spec-yatsu/src/cli.ts'])
  assert.equal(nodeChanged('.spec/spexcode/spec-cli/sessions', ['spec-cli/src/sessions.ts'], changed), false)
})
