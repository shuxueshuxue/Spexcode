import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

test('the package entry exposes only adopter-owned resolver capabilities', async () => {
  const entry = await import('./index.js')
  assert.deepEqual(Object.keys(entry).sort(), [
    'LocalityError',
    'requireLocalDatabasePath',
    'resolveDatabasePath',
  ])

  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(packageJson.name, '@spexcode/session-selflaunch')
  assert.equal(packageJson.private, true)
  assert.deepEqual(packageJson.files, ['dist', 'bin'])
  assert.deepEqual(packageJson.bin, { 'spex-session': './bin/spex-session.mjs' })
  assert.deepEqual(packageJson.exports, { '.': './dist/index.js', './package.json': './package.json' })
  assert.deepEqual(packageJson.dependencies, { '@spexcode/session-protocol': '0.6.7' })
  assert.equal(packageJson.engines.node, '>=22')

  const declarations = readFileSync(join(packageRoot, 'dist', 'index.d.ts'), 'utf8')
  for (const name of [
    'LocalityRefusalCode', 'LocalityError', 'requireLocalDatabasePath',
    'ResolveDatabasePathOptions', 'SelfLaunchEnvironment', 'resolveDatabasePath',
  ]) {
    assert.match(declarations, new RegExp(`\\b${name}\\b`), `${name} is absent from declarations`)
  }
  for (const name of ['openProtocol', 'SessionProtocol', 'classifyFilesystemType', 'runCli']) {
    assert.doesNotMatch(declarations, new RegExp(`\\b${name}\\b`), `${name} leaked through the package entry`)
  }
})

test('the bin is only a shebang, compiled CLI import, and one run', () => {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  assert.equal(
    readFileSync(join(packageRoot, 'bin', 'spex-session.mjs'), 'utf8'),
    "#!/usr/bin/env node\nimport { runCli } from '../dist/cli.js'\n\nprocess.exitCode = await runCli()\n",
  )
})
