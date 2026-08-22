#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = mkdtempSync(join(tmpdir(), 'spex-adopter-integration-'))
const packs = join(fixture, 'packs')
const consumer = join(fixture, 'consumer')
const nodeBin = dirname(process.execPath)
const npm = join(nodeBin, 'npm')
const packageNames = ['session-protocol', 'session-topology', 'session-runtime']
let assertions = 0
mkdirSync(packs, { recursive: true })
mkdirSync(consumer, { recursive: true })

const check = (condition, message) => {
  assertions += 1
  assert.ok(condition, message)
}

const run = (command, args, cwd, env = process.env) => new Promise((resolveResult, reject) => {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  child.on('error', reject)
  child.on('close', status => resolveResult({ status, stdout, stderr }))
})

const pack = async name => {
  const result = await run(
    npm,
    ['pack', join(repository, 'packages', name), '--json', '--ignore-scripts', '--pack-destination', packs],
    repository,
  )
  check(result.status === 0, `${name} pack failed: ${result.stderr}`)
  const metadata = JSON.parse(result.stdout.trim())
  check(metadata.length === 1, `${name} pack must produce one tarball`)
  return join(packs, metadata[0].filename)
}

const manifests = root => {
  const names = []
  const visit = path => {
    let manifest
    try { manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) } catch { return }
    if (manifest.name) names.push(manifest.name)
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name === 'node_modules') {
        for (const child of readdirSync(join(path, entry.name), { withFileTypes: true })) {
          if (child.name.startsWith('@')) {
            for (const scoped of readdirSync(join(path, entry.name, child.name), { withFileTypes: true })) {
              if (scoped.isDirectory()) visit(join(path, entry.name, child.name, scoped.name))
            }
          } else if (child.isDirectory()) visit(join(path, entry.name, child.name))
        }
      }
    }
  }
  visit(root)
  return [...new Set(names)].sort()
}

const runConsumer = async () => {
  const runner = join(consumer, 'scenario.mjs')
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'adopter-integration-consumer', type: 'module' }))
  writeFileSync(runner, `
import assert from 'node:assert/strict'
import { openProtocol } from '@spexcode/session-protocol'
import { openTopology } from '@spexcode/session-topology'
import { openRuntimeBindings, RuntimeBindingError } from '@spexcode/session-runtime'

const protocol = openProtocol(${JSON.stringify(join(fixture, 'consumer.sqlite'))})
try {
  const topology = openTopology(protocol)
  const bindings = openRuntimeBindings(protocol)
  protocol.initialize('parent')
  protocol.initialize('child')
  const bound = protocol.withTransaction(tx => {
    const edge = topology.attach(tx, 'parent', 'child', 'worker')
    const binding = bindings.bind(tx, 'child', {
      namespace: 'adopter', runtimeKind: 'zswarm-worker', nativeSessionId: 'native-1',
      nativeStartToken: 'start-1', metadata: { workspace: 'fixture' },
    }, { now: 100 })
    const message = tx.enqueue('child', {
      kind: 'session.state.changed', body: Buffer.from('ready'), headers: { source: 'fixture' },
    })
    return { edge, binding, message }
  })
  assert.equal(topology.parents('child')[0].fromSessionId, 'parent')
  assert.equal(bindings.resolve('adopter', 'child').nativeSessionId, 'native-1')
  assert.equal(protocol.listPending('child').length, 1)
  assert.throws(() => protocol.withTransaction(tx => bindings.bind(tx, 'child', {
    namespace: 'adopter', runtimeKind: 'zswarm-worker', nativeSessionId: 'native-2',
    nativeStartToken: 'start-2',
  }, { expectedGeneration: bound.binding.bindingGeneration - 1 })), RuntimeBindingError)
  const message = protocol.dequeue('child')
  assert.equal(new TextDecoder().decode(message.body), 'ready')
  assert.equal(protocol.dequeue('child'), null)
  console.log(JSON.stringify({ edge: bound.edge.edgeId, generation: bound.binding.bindingGeneration,
    messageId: message.messageId, pendingAfterDrain: protocol.listPending('child').length }))
} finally { protocol.close() }
`)
  const result = await run(process.execPath, [runner], consumer)
  check(result.status === 0, `installed consumer failed: ${result.stderr}`)
  const output = JSON.parse(result.stdout.trim())
  check(typeof output.edge === 'string' && output.edge.length === 32, 'topology edge was not observed')
  check(output.generation === 1, 'binding generation was not persisted')
  check(typeof output.messageId === 'string', 'notification was not delivered')
  check(output.pendingAfterDrain === 0, 'pending queue did not drain')
  return output
}

const main = async () => {
  const env = { ...process.env, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' }
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'adopter-integration-consumer',
    private: true,
    type: 'module',
  }))
  const tarballs = []
  for (const name of packageNames) tarballs.push(await pack(name))
  const install = await run(npm, ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', ...tarballs], consumer, env)
  check(install.status === 0, `consumer install failed: ${install.stderr}`)
  const names = manifests(consumer)
  for (const name of ['@spexcode/session-protocol', '@spexcode/session-topology', '@spexcode/session-runtime']) {
    check(names.includes(name), `installed graph missing ${name}`)
  }
  for (const name of ['@spexcode/session-core', '@spexcode/spec-cli']) {
    check(!names.includes(name), `forbidden runtime package installed: ${name}`)
  }
  const output = await runConsumer()
  check(resolve(consumer, 'node_modules/@spexcode/session-runtime').startsWith(resolve(consumer)),
    'runtime package did not resolve inside consumer')
  console.log(JSON.stringify({ scenario: 'adopter-integration-clean-consumer', assertions, ...output,
    productionCutIn: 'NOT-MEASURED(external Spex/ZSwarm owner and lineage)' }))
}

await main()
