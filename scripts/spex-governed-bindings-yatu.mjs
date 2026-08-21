#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openProtocol } from '@spexcode/session-protocol'
import { openRuntimeBindings, RuntimeBindingError } from '@spexcode/session-runtime'
import {
  bindSpexGovernedRuntime,
  resolveSpexGovernedRuntime,
  unbindSpexGovernedRuntime,
} from '../spec-cli/dist/session-runtime-adapter.js'

const root = mkdtempSync(join(tmpdir(), 'spex-governed-bindings-'))
const databasePath = join(root, 'protocol.sqlite')
const source = readFileSync(new URL('../spec-cli/src/sessions.ts', import.meta.url), 'utf8')
let assertions = 0
const check = (condition, message) => {
  assertions += 1
  assert.ok(condition, message)
}

const protocol = openProtocol(databasePath)
try {
  protocol.initialize('governed-1')
  const bindings = openRuntimeBindings(protocol)
  const first = bindSpexGovernedRuntime(protocol, bindings, {
    protocolSessionId: 'governed-1',
    harnessId: 'codex',
    harnessSessionId: 'thread-1',
    nativeStartToken: 'generation-1',
    metadata: { launcher: 'codex' },
  }, { now: 100 })
  check(first.namespace === 'spex-governed', 'adapter must own one stable namespace')
  check(first.nativeSessionId === 'thread-1', 'adapter must preserve the exact native session id')
  check(first.nativeStartToken === 'generation-1', 'adapter must preserve the exact native start token')

  const second = bindSpexGovernedRuntime(protocol, bindings, {
    protocolSessionId: 'governed-1',
    harnessId: 'codex',
    harnessSessionId: 'thread-1',
    nativeStartToken: 'generation-2',
  }, { expectedGeneration: first.bindingGeneration, now: 200 })
  check(second.bindingGeneration === 2, 'native restart must advance the binding generation')
  check(resolveSpexGovernedRuntime(bindings, 'governed-1')?.nativeStartToken === 'generation-2',
    'resolve must return the latest fenced runtime instance')
  assert.throws(() => bindSpexGovernedRuntime(protocol, bindings, {
    protocolSessionId: 'governed-1',
    harnessId: 'codex',
    harnessSessionId: 'thread-stale',
    nativeStartToken: 'generation-stale',
  }, { expectedGeneration: first.bindingGeneration }), RuntimeBindingError)
  assertions += 1

  const unbound = unbindSpexGovernedRuntime(protocol, bindings, 'governed-1', {
    expectedGeneration: second.bindingGeneration,
    now: 300,
  })
  check(unbound.status === 'unbound', 'unbind must leave a fenced tombstone')
  check(protocol.listPending('governed-1').length === 0, 'runtime detach must not retire the protocol address')

  const harnessIdentitySites = source.match(/bindHarnessSessionIdUnlocked\(/g)?.length ?? 0
  const productionAdapterSites = source.match(/bindSpexGovernedRuntime\(/g)?.length ?? 0
  const productionProtocolOpenSites = source.match(/openProtocol\(/g)?.length ?? 0
  check(harnessIdentitySites >= 3, 'the governed source must still expose its real native identity commit sites')
  check(productionAdapterSites === 0, 'this branch must not claim a production binding call that is absent')
  check(productionProtocolOpenSites === 0, 'this branch must not claim a governed protocol database composition that is absent')

  console.log(JSON.stringify({
    scenario: 'spex-governed-runtime-binding-seam',
    assertions,
    bindingGeneration: second.bindingGeneration,
    harnessIdentitySites,
    productionAdapterSites,
    productionProtocolOpenSites,
    productionCutIn: 'NOT-MEASURED(explicit database path, locality verdict, and all-harness start token are absent)',
  }))
} finally {
  protocol.close()
  rmSync(root, { recursive: true, force: true })
}
