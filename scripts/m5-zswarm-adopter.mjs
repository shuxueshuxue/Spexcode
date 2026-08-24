#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

import { countFileSyscallHits } from './zswarm-sabotage/trace-gate.mjs'

const repository = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'))
const sourceConsumer = join(repository, 'scripts', 'zswarm-sabotage', 'consumer.mjs')
const nodeDirectory = dirname(process.execPath)
const npm = join(nodeDirectory, 'npm')
const strace = '/usr/bin/strace'
const injectLegacyRead = process.argv.includes('--inject-legacy-read')
let assertions = 0

function check(condition, message) {
  assertions += 1
  assert.ok(condition, message)
}

function equal(actual, expected, message) {
  assertions += 1
  assert.equal(actual, expected, message)
}

function deepEqual(actual, expected, message) {
  assertions += 1
  assert.deepEqual(actual, expected, message)
}

function notMeasured(reason) {
  const error = new Error(`NOT-MEASURED(${reason})`)
  error.code = 'NOT_MEASURED'
  throw error
}

function run(command, args, options = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', status => resolveResult({ status, stdout, stderr }))
  })
}

function parseJsonOutput(result, label) {
  if (result.status !== 0) notMeasured(`${label}-exit-${result.status}: ${result.stderr.trim()}`)
  try {
    return JSON.parse(result.stdout.trim())
  } catch {
    notMeasured(`${label}-invalid-json`)
  }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertInside(fixture, target, label) {
  const resolvedFixture = resolve(fixture)
  const resolvedTarget = resolve(target)
  check(
    resolvedTarget.startsWith(`${resolvedFixture}${sep}`),
    `${label} escaped fixture: ${resolvedTarget}`,
  )
  return resolvedTarget
}

function writeFixture(fixture, path, bytes) {
  const target = assertInside(fixture, path, 'write target')
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, bytes)
}

function installedPackageNames(nodeModules) {
  const manifests = []
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const child of readdirSync(join(nodeModules, entry.name), { withFileTypes: true })) {
        if (child.isDirectory()) manifests.push(join(nodeModules, entry.name, child.name, 'package.json'))
      }
    } else {
      manifests.push(join(nodeModules, entry.name, 'package.json'))
    }
  }
  return manifests.filter(existsSync).map(path => JSON.parse(readFileSync(path, 'utf8')).name).sort()
}

function dependencyNames(tree) {
  const names = new Set()
  const visit = dependencies => {
    for (const [name, value] of Object.entries(dependencies ?? {})) {
      names.add(name)
      visit(value.dependencies)
    }
  }
  visit(tree.dependencies)
  return [...names].sort()
}

function probeNodeSqlite() {
  const database = new DatabaseSync(':memory:')
  try {
    const row = database.prepare('SELECT 6 * 7 AS answer').get()
    equal(Number(row.answer), 42, 'node:sqlite fixed arithmetic vector failed')
    database.exec('CREATE TABLE capability(value TEXT NOT NULL) STRICT')
    database.prepare('INSERT INTO capability(value) VALUES (?)').run('fixed-known-vector')
    equal(
      database.prepare('SELECT value FROM capability').get().value,
      'fixed-known-vector',
      'node:sqlite fixed write/read vector failed',
    )
  } finally {
    database.close()
  }
  return 'MEASURED(in-memory-fixed-vector)'
}

async function probeNpm(fixture, env) {
  const root = assertInside(fixture, join(fixture, 'npm-capability'), 'npm capability root')
  const packageRoot = assertInside(fixture, join(root, 'package'), 'npm capability package')
  const packs = assertInside(fixture, join(root, 'packs'), 'npm capability packs')
  const consumer = assertInside(fixture, join(root, 'consumer'), 'npm capability consumer')
  mkdirSync(packageRoot, { recursive: true })
  mkdirSync(packs, { recursive: true })
  mkdirSync(consumer, { recursive: true })
  writeFixture(fixture, join(packageRoot, 'package.json'), JSON.stringify({
    name: 'm5-npm-capability-vector', version: '1.0.0', files: ['sentinel.txt'],
  }))
  writeFixture(fixture, join(packageRoot, 'sentinel.txt'), 'fixed-known-vector\n')
  writeFixture(fixture, join(consumer, 'package.json'), JSON.stringify({ name: 'm5-capability-consumer', private: true }))

  const packed = parseJsonOutput(
    await run(npm, ['pack', packageRoot, '--json', '--ignore-scripts', '--pack-destination', packs], { cwd: root, env }),
    'npm-capability-pack',
  )
  equal(packed.length, 1, 'npm pack capability vector must emit exactly one tarball')
  deepEqual(packed[0].files.map(file => file.path).sort(), ['package.json', 'sentinel.txt'])
  const tarball = assertInside(fixture, join(packs, packed[0].filename), 'npm capability tarball')
  check(existsSync(tarball), 'npm capability tarball was not created')
  const installed = await run(npm, [
    'install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball,
  ], { cwd: consumer, env })
  if (installed.status !== 0) notMeasured(`npm-capability-install-exit-${installed.status}`)
  const listed = parseJsonOutput(await run(npm, ['ls', '--all', '--json'], { cwd: consumer, env }), 'npm-capability-ls')
  deepEqual(dependencyNames(listed), ['m5-npm-capability-vector'])
  equal(
    readFileSync(join(consumer, 'node_modules', 'm5-npm-capability-vector', 'sentinel.txt'), 'utf8'),
    'fixed-known-vector\n',
    'npm capability install must preserve the known payload',
  )
  return { pack: 'MEASURED', install: 'MEASURED', ls: 'MEASURED' }
}

async function packProduct(fixture, packagePath, packs, env) {
  const result = parseJsonOutput(
    await run(npm, ['pack', packagePath, '--json', '--ignore-scripts', '--pack-destination', packs], {
      cwd: repository,
      env,
    }),
    `npm-pack-${basename(packagePath)}`,
  )
  equal(result.length, 1, `${packagePath} must produce one tarball`)
  const tarball = assertInside(fixture, join(packs, result[0].filename), 'product tarball')
  check(existsSync(tarball), `missing tarball ${tarball}`)
  return { path: tarball, sha256: sha256(tarball), files: result[0].files.length }
}

async function stageProductPackages(fixture, env) {
  const workspace = assertInside(fixture, join(fixture, 'package-build'), 'package build workspace')
  const stagedScripts = assertInside(fixture, join(workspace, 'scripts'), 'staged build scripts')
  const stagedModules = assertInside(fixture, join(workspace, 'node_modules'), 'staged build modules')
  mkdirSync(stagedScripts, { recursive: true })
  mkdirSync(stagedModules, { recursive: true })
  copyFileSync(join(repository, 'scripts', 'build-dist.mjs'), join(stagedScripts, 'build-dist.mjs'))

  for (const dependency of ['typescript', '@types', 'undici-types']) {
    const source = realpathSync(join(repository, 'node_modules', dependency))
    const target = assertInside(fixture, join(stagedModules, dependency), `staged ${dependency}`)
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(source, target, 'dir')
  }

  const packages = {}
  for (const name of ['session-protocol', 'session-topology']) {
    const source = join(repository, 'packages', name)
    const target = assertInside(fixture, join(workspace, 'packages', name), `staged ${name}`)
    mkdirSync(target, { recursive: true })
    copyFileSync(join(source, 'package.json'), join(target, 'package.json'))
    copyFileSync(join(source, 'tsconfig.build.json'), join(target, 'tsconfig.build.json'))
    cpSync(join(source, 'src'), join(target, 'src'), { recursive: true })
    packages[name] = target
  }

  const scope = assertInside(fixture, join(stagedModules, '@spexcode'), 'staged package scope')
  mkdirSync(scope, { recursive: true })
  symlinkSync(packages['session-protocol'], join(scope, 'session-protocol'), 'dir')

  for (const name of ['session-protocol', 'session-topology']) {
    const built = await run(process.execPath, [join(stagedScripts, 'build-dist.mjs')], {
      cwd: packages[name],
      env,
    })
    if (built.status !== 0) notMeasured(`${name}-fixture-build-exit-${built.status}: ${built.stderr.trim()}`)
    check(existsSync(join(packages[name], 'dist', 'index.js')), `${name} fixture build produced no package entry`)
  }
  return packages
}

async function runTracedScenario({ fixture, consumer, database, trace, selectors, env, label }) {
  for (const path of [database, trace]) assertInside(fixture, path, `${label} output`)
  mkdirSync(dirname(database), { recursive: true })
  const result = await run(strace, [
    '-f', '-qq', '-e', 'trace=%file,%process', '-s', '4096', '-o', trace, '--',
    process.execPath, consumer, 'scenario', database,
  ], { cwd: dirname(consumer), env })
  if (result.status !== 0) notMeasured(`${label}-traced-command-exit-${result.status}: ${result.stderr.trim()}`)
  const scenario = parseJsonOutput(result, label)
  const measured = countFileSyscallHits(trace, selectors)
  check(measured.fileSyscallLines > 0, `${label} produced no measured filesystem syscall lines`)
  equal(measured.hits.length, 0, `${label} legacy file syscall hits:\n${measured.hits.join('\n')}`)
  equal(scenario.registeredAddresses, 3)
  equal(scenario.children, 2)
  equal(scenario.independentWorkers, 2)
  equal(scenario.distinctWorkerPids, 2)
  equal(scenario.reader.adopterRows, 3)
  equal(scenario.reader.topologyEdges, 2)
  equal(scenario.reader.pendingMessages, 2)
  equal(scenario.reader.protocolAdopterColumns.length, 0)
  equal(scenario.firstDrain, 2)
  equal(scenario.secondDrain, 0)
  equal(scenario.remaining, 0)
  equal(scenario.history, 2)
  equal(scenario.dequeuedHistory, 2)
  return {
    legacyFileSyscallHits: measured.hits.length,
    fileSyscallLines: measured.fileSyscallLines,
    ...scenario,
  }
}

async function main() {
  equal(process.versions.node, '22.21.0', 'M5 proof requires the pinned Node 22.21.0 runtime')
  check(isAbsolute(repository), 'repository path must be absolute')
  check(existsSync(npm), `npm is unavailable beside Node: ${npm}`)
  check(existsSync(strace) && statSync(strace).isFile(), '/usr/bin/strace is unavailable')

  const fixture = mkdtempSync(join(tmpdir(), 'm5-zswarm-adopter-'))
  check(!fixture.startsWith(`${repository}${sep}`), 'clean consumer fixture must be outside the repository')
  const cleanEnv = {
    ...process.env,
    PATH: `${nodeDirectory}:/usr/bin:/bin`,
    NODE_PATH: '',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
  }

  let report
  try {
    const sqliteCapability = probeNodeSqlite()
    const capabilities = await probeNpm(fixture, cleanEnv)
    capabilities.nodeSqlite = sqliteCapability
    const stagedPackages = await stageProductPackages(fixture, cleanEnv)

    const packs = assertInside(fixture, join(fixture, 'packs'), 'product packs')
    mkdirSync(packs, { recursive: true })
    const protocolTarball = await packProduct(fixture, stagedPackages['session-protocol'], packs, cleanEnv)
    const topologyTarball = await packProduct(fixture, stagedPackages['session-topology'], packs, cleanEnv)

    const consumer = assertInside(fixture, join(fixture, 'consumer'), 'clean consumer')
    const consumerScript = assertInside(fixture, join(consumer, 'zswarm-consumer.mjs'), 'consumer script')
    mkdirSync(consumer, { recursive: true })
    writeFixture(fixture, join(consumer, 'package.json'), JSON.stringify({
      name: 'm5-zswarm-clean-consumer', private: true, type: 'module',
    }))
    copyFileSync(sourceConsumer, consumerScript)
    const install = await run(npm, [
      'install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund',
      protocolTarball.path, topologyTarball.path,
    ], { cwd: consumer, env: cleanEnv })
    if (install.status !== 0) notMeasured(`clean-consumer-install-exit-${install.status}: ${install.stderr.trim()}`)

    const listed = parseJsonOutput(await run(npm, ['ls', '--all', '--json'], { cwd: consumer, env: cleanEnv }), 'clean-consumer-npm-ls')
    const graphNames = dependencyNames(listed)
    const manifestNames = installedPackageNames(join(consumer, 'node_modules'))
    const allowed = ['@spexcode/session-protocol', '@spexcode/session-topology']
    deepEqual(graphNames, allowed, 'installed dependency graph contains packages outside the protocol stack')
    deepEqual(manifestNames, allowed, 'node_modules contains packages outside the protocol stack')
    const forbidden = ['@spexcode/session-core', '@spexcode/spec-cli', 'spexcode']
    const forbiddenGraphNames = graphNames.filter(name => forbidden.includes(name))
    equal(forbiddenGraphNames.length, 0, 'forbidden Spex runtime dependency entered the installed graph')

    const resolved = parseJsonOutput(
      await run(process.execPath, [consumerScript, 'resolve'], { cwd: consumer, env: cleanEnv }),
      'clean-consumer-resolve',
    )
    const nodeModules = realpathSync(join(consumer, 'node_modules'))
    for (const [name, path] of Object.entries(resolved)) {
      const actual = realpathSync(path)
      check(actual.startsWith(`${nodeModules}${sep}`), `${name} resolved outside consumer node_modules: ${actual}`)
      check(!actual.startsWith(`${repository}${sep}`), `${name} leaked workspace resolution: ${actual}`)
    }

    const legacy = {
      missing: assertInside(fixture, join(fixture, 'legacy-missing'), 'missing legacy root'),
      readonly: assertInside(fixture, join(fixture, 'legacy-readonly'), 'read-only legacy root'),
      poisoned: assertInside(fixture, join(fixture, 'legacy-poisoned'), 'poisoned legacy root'),
    }
    check(!existsSync(legacy.missing), 'missing legacy root precondition is false')
    mkdirSync(legacy.readonly, { recursive: true })
    chmodSync(legacy.readonly, 0o555)
    equal(statSync(legacy.readonly).mode & 0o222, 0, 'read-only legacy root remains writable by mode')
    const readonlyCanary = assertInside(fixture, join(legacy.readonly, 'must-not-write'), 'read-only canary')
    let readonlyError
    try {
      writeFileSync(readonlyCanary, 'unexpected write')
    } catch (error) {
      readonlyError = error
    }
    check(
      readonlyError?.code === 'EACCES' || readonlyError?.code === 'EPERM',
      `read-only legacy root accepted a real write or failed unexpectedly: ${readonlyError?.code ?? 'write-succeeded'}`,
    )
    check(!existsSync(readonlyCanary), 'read-only capability probe left a file behind')
    const poisonFile = assertInside(fixture, join(legacy.poisoned, 'sessions', 'z-parent', 'session.json'), 'poison file')
    writeFixture(fixture, poisonFile, JSON.stringify({
      runtimeOwner: 'zcode', runtimeState: 'completed', children: ['poison-child'], pending: ['poison-message'],
    }))

    const calibrationTrace = assertInside(fixture, join(fixture, 'calibration.strace'), 'calibration trace')
    const calibration = await run(strace, [
      '-f', '-qq', '-e', 'trace=%file,%process', '-s', '4096', '-o', calibrationTrace, '--', '/bin/cat', poisonFile,
    ], { cwd: consumer, env: cleanEnv })
    if (calibration.status !== 0) notMeasured(`strace-calibration-exit-${calibration.status}`)
    const calibrationMeasured = countFileSyscallHits(calibrationTrace, [poisonFile])
    check(calibrationMeasured.fileSyscallLines > 0, 'strace calibration measured no filesystem syscall lines')
    check(calibrationMeasured.hits.length > 0, 'strace calibration did not see poison path in a real filesystem syscall')

    const scenarios = {}
    for (const [name, legacyRoot] of Object.entries(legacy)) {
      const scenarioEnv = {
        ...cleanEnv,
        SPEXCODE_HOME: legacyRoot,
        SPEX_RUNTIME_ROOT: legacyRoot,
        SPEX_SESSION_STORE_ROOT: legacyRoot,
      }
      if (injectLegacyRead && name === 'poisoned') scenarioEnv.M5_ZSWARM_INJECT_LEGACY_READ = poisonFile
      scenarios[name] = await runTracedScenario({
        fixture,
        consumer: consumerScript,
        database: assertInside(fixture, join(consumer, 'state', `${name}.sqlite`), `${name} database`),
        trace: assertInside(fixture, join(fixture, `${name}.strace`), `${name} trace`),
        selectors: [legacyRoot],
        env: scenarioEnv,
        label: `${name}-sabotage`,
      })
    }

    report = {
      surface: 'repository-external clean ZSwarm-shaped consumer',
      node: process.version,
      fixtureOutsideRepository: true,
      capabilities,
      packages: {
        graphNames,
        manifestNames,
        forbiddenGraphNames,
        forbiddenGraphCount: forbiddenGraphNames.length,
        resolved,
        protocolTarball: { sha256: protocolTarball.sha256, files: protocolTarball.files },
        topologyTarball: { sha256: topologyTarball.sha256, files: topologyTarball.files },
      },
      calibration: {
        prerequisite: 'MEASURED(real-file-syscall)',
        fileSyscallLines: calibrationMeasured.fileSyscallLines,
        poisonPathHits: calibrationMeasured.hits.length,
      },
      sabotage: scenarios,
      assertions,
    }
  } finally {
    const cleanupTarget = resolve(fixture)
    equal(cleanupTarget, fixture, 'cleanup target must be the exact resolved fixture root')
    check(cleanupTarget.startsWith(resolve(tmpdir()) + sep), 'cleanup target must remain under the system temp root')
    check(!cleanupTarget.startsWith(`${repository}${sep}`), 'cleanup target must remain outside the repository')
    if (existsSync(join(fixture, 'legacy-readonly'))) chmodSync(join(fixture, 'legacy-readonly'), 0o755)
    rmSync(cleanupTarget, { recursive: true, force: true })
    check(!existsSync(cleanupTarget), 'fixture cleanup did not remove the fixture root')
  }
  report.assertions = assertions
  process.stdout.write(`${JSON.stringify(report)}\n`)
}

main().catch(error => {
  process.stderr.write(`${error?.stack ?? error}\n`)
  process.exitCode = error?.code === 'NOT_MEASURED' ? 77 : 1
})
