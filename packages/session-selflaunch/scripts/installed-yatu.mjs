import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const externalRoot = mkdtempSync(join(tmpdir(), 'session-selflaunch-installed-'))
const consumerRoot = join(externalRoot, 'consumer')
const packRoot = join(externalRoot, 'packs')
const npm = join(dirname(process.execPath), 'npm')
const transcript = []

assert.ok(!externalRoot.startsWith(`${repositoryRoot}${sep}`), 'consumer must be outside the repository')
mkdirSync(consumerRoot)
mkdirSync(packRoot)

const invoke = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? consumerRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  return result
}

const requireSuccess = (result, label) => {
  assert.equal(result.status, 0, `${label}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  return result
}

const pack = packagePath => {
  const result = requireSuccess(invoke(npm, [
    'pack', packagePath, '--pack-destination', packRoot, '--json', '--ignore-scripts',
  ]), `pack ${packagePath}`)
  const records = JSON.parse(result.stdout)
  assert.equal(records.length, 1)
  return records[0]
}

const protocolPack = pack(join(repositoryRoot, 'packages/session-protocol'))
const runtimePack = pack(join(repositoryRoot, 'packages/session-runtime'))
const selfLaunchPack = pack(join(repositoryRoot, 'packages/session-selflaunch'))
for (const file of selfLaunchPack.files.map(entry => entry.path)) {
  assert.ok(!file.startsWith('src/'), `source leaked into packed artifact: ${file}`)
  assert.ok(file === 'package.json' || file.startsWith('dist/') || file.startsWith('bin/'), `unexpected packed file: ${file}`)
}

writeFileSync(join(consumerRoot, 'package.json'), JSON.stringify({ name: 'selflaunch-yatu-consumer', private: true, type: 'module' }))
requireSuccess(invoke(npm, [
  'install', '--no-audit', '--no-fund',
  join(packRoot, protocolPack.filename),
  join(packRoot, runtimePack.filename),
  join(packRoot, selfLaunchPack.filename),
]), 'install tarballs')

const resolution = requireSuccess(invoke(process.execPath, ['-e', `
  const protocol = require.resolve('@spexcode/session-protocol/package.json')
  const runtime = require.resolve('@spexcode/session-runtime/package.json')
  const selflaunch = require.resolve('@spexcode/session-selflaunch/package.json')
  process.stdout.write(JSON.stringify({ protocol, runtime, selflaunch }))
`]), 'resolve installed packages')
const resolved = JSON.parse(resolution.stdout)
for (const path of Object.values(resolved)) {
  assert.ok(path.startsWith(`${join(consumerRoot, 'node_modules')}${sep}`), `package escaped consumer node_modules: ${path}`)
  assert.ok(!path.startsWith(`${repositoryRoot}${sep}`), `package resolved to repository source: ${path}`)
}

const entry = requireSuccess(invoke(process.execPath, ['-e', `
  import('@spexcode/session-selflaunch').then(entry => process.stdout.write(JSON.stringify(Object.keys(entry).sort())))
`]), 'import installed package')
assert.deepEqual(JSON.parse(entry.stdout), [
  'LocalityError',
  'bindSelfLaunchRuntime',
  'requireLocalDatabasePath',
  'resolveDatabasePath',
  'resolveSelfLaunchRuntime',
  'unbindSelfLaunchRuntime',
])

const bin = join(consumerRoot, 'node_modules/.bin/spex-session')
assert.ok(existsSync(bin), 'installed bin is missing')
assert.ok(realpathSync(bin).startsWith(`${join(consumerRoot, 'node_modules')}${sep}`), 'bin does not target the installed package')

const cleanEnvironment = overrides => {
  const env = { ...process.env }
  delete env.SPEX_SESSION_DATABASE_PATH
  delete env.SPEX_SESSION_CONFIG
  delete env.SPEX_SESSION_ASSUME_LOCAL_STORAGE
  delete env.SPEXCODE_HOME
  return { ...env, ...overrides }
}

const runCli = (args, options = {}) => {
  const result = invoke(bin, args, {
    env: cleanEnvironment(options.env ?? {}),
    cwd: options.cwd ?? consumerRoot,
  })
  const expectedStatus = options.status ?? 0
  assert.equal(result.status, expectedStatus, `${args.join(' ')}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`)
  transcript.push(`$ spex-session ${args.join(' ')}`)
  if (result.stdout) transcript.push(`stdout ${result.stdout.trimEnd()}`)
  if (result.stderr) transcript.push(`stderr ${result.stderr.trimEnd()}`)
  transcript.push(`exit ${result.status}`)
  return result
}

const parsed = result => JSON.parse(result.stdout)

const pathsRoot = join(externalRoot, 'path-precedence')
const explicitRoot = join(pathsRoot, 'explicit')
const environmentRoot = join(pathsRoot, 'environment')
const configRoot = join(pathsRoot, 'config')
const defaultRoot = join(pathsRoot, 'default-home')
const ignoredHome = join(pathsRoot, 'ignored-home')
for (const root of [explicitRoot, environmentRoot, configRoot, defaultRoot, ignoredHome]) mkdirSync(root, { recursive: true })
const explicitDb = join(explicitRoot, 'sessions.sqlite')
const environmentDb = join(environmentRoot, 'sessions.sqlite')
const configDb = join(configRoot, 'sessions.sqlite')
const defaultDb = join(defaultRoot, 'sessions.sqlite')
const configPath = join(pathsRoot, 'session.json')
writeFileSync(configPath, JSON.stringify({ databasePath: configDb, assumeLocalStorage: true }))

runCli(['initialize', '--session-id', 'path-explicit', '--database-path', explicitDb], {
  env: { SPEX_SESSION_DATABASE_PATH: environmentDb, SPEX_SESSION_CONFIG: configPath, SPEXCODE_HOME: defaultRoot },
})
assert.ok(existsSync(explicitDb))
assert.ok(!existsSync(environmentDb))
runCli(['initialize', '--session-id', 'path-environment'], {
  env: { SPEX_SESSION_DATABASE_PATH: environmentDb, SPEX_SESSION_CONFIG: configPath, SPEXCODE_HOME: defaultRoot },
})
assert.ok(existsSync(environmentDb))
runCli(['initialize', '--session-id', 'path-config'], {
  env: { SPEX_SESSION_CONFIG: configPath, SPEXCODE_HOME: defaultRoot },
})
assert.ok(existsSync(configDb))
runCli(['initialize', '--session-id', 'path-default'], {
  env: { SPEXCODE_HOME: defaultRoot, HOME: ignoredHome },
})
assert.ok(existsSync(defaultDb))

const relative = runCli(['initialize', '--session-id', 'relative', '--database-path', 'relative.sqlite'], { status: 1 })
assert.match(relative.stderr, /^spex-session: PROTOCOL_PATH_NOT_ABSOLUTE:/)
assert.ok(!existsSync(join(consumerRoot, 'relative.sqlite')))

const missingParent = join(pathsRoot, 'missing', 'child')
const missing = runCli([
  'initialize', '--session-id', 'missing', '--database-path', join(missingParent, 'sessions.sqlite'),
], { status: 1 })
assert.match(missing.stderr, /^spex-session: PROTOCOL_PATH_PARENT_MISSING:/)
assert.match(missing.stderr, /create the parent directory/)
assert.ok(!existsSync(missingParent), 'resolver or protocol created the missing parent')

const mainRoot = join(externalRoot, 'main-loop')
mkdirSync(mainRoot)
const databasePath = join(mainRoot, 'sessions.sqlite')
const databaseArgs = ['--database-path', databasePath]
const sessionArgs = ['--session-id', 'offline-target', ...databaseArgs]

const address = parsed(runCli(['initialize', ...sessionArgs]))
assert.equal(address.sessionId, 'offline-target')

const bindingProof = requireSuccess(invoke(process.execPath, ['--input-type=module', '-e', `
  import { openProtocol } from '@spexcode/session-protocol'
  import { bindSelfLaunchRuntime, resolveSelfLaunchRuntime } from '@spexcode/session-selflaunch'
  const protocol = openProtocol(${JSON.stringify(databasePath)})
  try {
    const binding = bindSelfLaunchRuntime(protocol, 'offline-target', {
      nativeSessionId: 'installed-harness-1',
      nativeStartToken: 'installed-start-1',
    })
    const resolved = resolveSelfLaunchRuntime(protocol, 'offline-target')
    process.stdout.write(JSON.stringify({ binding, resolved }))
  } finally { protocol.close() }
`]), 'bind installed self-launch runtime')
const installedBinding = JSON.parse(bindingProof.stdout)
assert.equal(installedBinding.binding.bindingGeneration, 1)
assert.equal(installedBinding.resolved.nativeSessionId, 'installed-harness-1')

const first = parsed(runCli(['enqueue', '--session-id', 'offline-target', '--kind', 'letter.v1', '--body', 'A', ...databaseArgs]))
const second = parsed(runCli(['enqueue', '--session-id', 'offline-target', '--kind', 'letter.v1', '--body', 'B', ...databaseArgs]))
assert.equal(first.bodyBase64, 'QQ==')
assert.equal(second.bodyBase64, 'Qg==')
assert.notEqual(first.messageId, second.messageId)

const pending = parsed(runCli(['pending', ...sessionArgs]))
assert.deepEqual(pending.map(message => message.messageId), [first.messageId, second.messageId])
assert.deepEqual(pending.map(message => message.bodyBase64), ['QQ==', 'Qg=='])
assert.equal(parsed(runCli(['dequeue', ...sessionArgs])).messageId, first.messageId)
assert.equal(parsed(runCli(['dequeue', ...sessionArgs])).messageId, second.messageId)
assert.equal(parsed(runCli(['dequeue', ...sessionArgs])), null)

const idempotencyArgs = [
  'enqueue', '--session-id', 'offline-target', '--kind', 'idempotent.v1', '--body', 'same',
  '--idempotency-key', 'exact-replay', ...databaseArgs,
]
const idempotentFirst = parsed(runCli(idempotencyArgs))
const idempotentReplay = parsed(runCli(idempotencyArgs))
assert.equal(idempotentReplay.messageId, idempotentFirst.messageId)
const conflict = runCli([
  'enqueue', '--session-id', 'offline-target', '--kind', 'idempotent.v1', '--body', 'same!',
  '--idempotency-key', 'exact-replay', ...databaseArgs,
], { status: 1 })
assert.match(conflict.stderr, /^spex-session: PROTOCOL_IDEMPOTENCY_CONFLICT:/)
assert.equal(parsed(runCli(['dequeue', ...sessionArgs])).messageId, idempotentFirst.messageId)

const restartMessage = parsed(runCli([
  'enqueue', '--session-id', 'offline-target', '--kind', 'restart.v1', '--body', 'survives', ...databaseArgs,
]))
assert.equal(restartMessage.bodyBase64, 'c3Vydml2ZXM=')
assert.equal(restartMessage.wake, undefined)
transcript.push('assert resident-processes=0 wake-hints=0 after enqueue process exited')
const restartedDequeue = parsed(runCli(['dequeue', ...sessionArgs]))
assert.equal(restartedDequeue.messageId, restartMessage.messageId)
assert.equal(parsed(runCli(['dequeue', ...sessionArgs])), null)

const rejectedMessageId = runCli([
  'enqueue', '--session-id', 'offline-target', '--kind', 'invalid.v1', '--body', 'x',
  '--message-id', 'producer-owned', ...databaseArgs,
], { status: 2 })
assert.equal(rejectedMessageId.stderr, 'spex-session: USAGE: unknown option --message-id\n')

transcript.unshift(
  `node ${process.version} sqlite ${process.versions.sqlite}`,
  `consumer ${consumerRoot}`,
  `tarball @spexcode/session-protocol ${protocolPack.filename} shasum=${protocolPack.shasum} integrity=${protocolPack.integrity}`,
  `tarball @spexcode/session-runtime ${runtimePack.filename} shasum=${runtimePack.shasum} integrity=${runtimePack.integrity}`,
  `tarball @spexcode/session-selflaunch ${selfLaunchPack.filename} shasum=${selfLaunchPack.shasum} integrity=${selfLaunchPack.integrity}`,
  `resolve protocol ${resolved.protocol}`,
  `resolve runtime ${resolved.runtime}`,
  `resolve selflaunch ${resolved.selflaunch}`,
  `resolve bin ${realpathSync(bin)}`,
  `public exports ${entry.stdout}`,
  'install source-fallback=absent',
)
transcript.push('installed-yatu assertions=passed')
process.stdout.write(`${transcript.join('\n')}\n`)

if (process.env.KEEP_SELF_LAUNCH_YATU !== '1') rmSync(externalRoot, { recursive: true, force: true })
