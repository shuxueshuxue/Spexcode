import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bindSpexGovernedRuntime,
  resolveSpexGovernedRuntime,
  unbindSpexGovernedRuntime,
  type GovernedRuntimeBinding,
  type GovernedRuntimeBindingStore,
} from './session-runtime-adapter.js'

function binding(overrides: Partial<GovernedRuntimeBinding> = {}): GovernedRuntimeBinding {
  return {
    namespace: 'spex-governed',
    protocolSessionId: 'governed-1',
    runtimeKind: 'codex',
    nativeSessionId: 'thread-1',
    nativeStartToken: 'generation-1',
    bindingGeneration: 1,
    status: 'bound',
    boundAtMs: 100,
    unboundAtMs: null,
    metadata: {},
    ...overrides,
  }
}

test('governed adapter binds the exact harness identity in one supplied protocol transaction', () => {
  const transaction = { id: 'tx-1' }
  let transactionCalls = 0
  let observed: unknown[] = []
  const protocol = {
    withTransaction<T>(body: (tx: typeof transaction) => T): T {
      transactionCalls += 1
      return body(transaction)
    },
  }
  const bindings: GovernedRuntimeBindingStore<typeof transaction> = {
    bind(...args) {
      observed = args
      return binding()
    },
    resolve: () => null,
    unbind: () => binding({ status: 'unbound', bindingGeneration: 2, unboundAtMs: 200 }),
  }

  const result = bindSpexGovernedRuntime(protocol, bindings, {
    protocolSessionId: 'governed-1',
    harnessId: 'codex',
    harnessSessionId: 'thread-1',
    nativeStartToken: 'generation-1',
    metadata: { launcher: 'codex' },
  }, { expectedGeneration: 0, now: 100 })

  assert.equal(result.nativeSessionId, 'thread-1')
  assert.equal(transactionCalls, 1)
  assert.deepEqual(observed, [transaction, 'governed-1', {
    namespace: 'spex-governed',
    runtimeKind: 'codex',
    nativeSessionId: 'thread-1',
    nativeStartToken: 'generation-1',
    metadata: { launcher: 'codex' },
  }, { expectedGeneration: 0, now: 100 }])
})

test('governed adapter refuses an absent start token before opening a transaction', () => {
  let entered = false
  const protocol = {
    withTransaction<T>(_body: (tx: unknown) => T): T {
      entered = true
      throw new Error('unreachable')
    },
  }
  const bindings = {} as GovernedRuntimeBindingStore
  assert.throws(() => bindSpexGovernedRuntime(protocol, bindings, {
    protocolSessionId: 'governed-1',
    harnessId: 'claude',
    harnessSessionId: 'native-1',
    nativeStartToken: '',
  }), /nativeStartToken/)
  assert.equal(entered, false)
})

test('resolve and unbind use the fixed Spex namespace', () => {
  const transaction = { id: 'tx-2' }
  const calls: unknown[][] = []
  const expected = binding()
  const bindings: GovernedRuntimeBindingStore<typeof transaction> = {
    bind: () => expected,
    resolve(...args) {
      calls.push(args)
      return expected
    },
    unbind(...args) {
      calls.push(args)
      return binding({ status: 'unbound', bindingGeneration: 2, unboundAtMs: 200 })
    },
  }
  const protocol = { withTransaction: <T>(body: (tx: typeof transaction) => T) => body(transaction) }

  assert.equal(resolveSpexGovernedRuntime(bindings, 'governed-1')?.nativeSessionId, 'thread-1')
  assert.equal(unbindSpexGovernedRuntime(protocol, bindings, 'governed-1', { expectedGeneration: 1 }).status, 'unbound')
  assert.deepEqual(calls, [
    ['spex-governed', 'governed-1', undefined],
    [transaction, 'spex-governed', 'governed-1', { expectedGeneration: 1 }],
  ])
})
