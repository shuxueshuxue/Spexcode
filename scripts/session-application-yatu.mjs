import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = await mkdtemp(join(tmpdir(), 'session-application-consumer-'))
const consumer = join(root, 'app')
const tarballs = join(root, 'tarballs')
execFileSync('npm', ['run', 'build', '--workspace=@spexcode/session-protocol'], { stdio: 'ignore' })
execFileSync('npm', ['run', 'build', '--workspace=@spexcode/session-topology'], { stdio: 'ignore' })
execFileSync('npm', ['run', 'build', '--workspace=@spexcode/session-application'], { stdio: 'ignore' })
await mkdir(consumer, { recursive: true })
await mkdir(tarballs, { recursive: true })
execFileSync('npm', ['pack', '--silent', '--workspace=@spexcode/session-protocol', '--pack-destination', tarballs])
execFileSync('npm', ['pack', '--silent', '--workspace=@spexcode/session-topology', '--pack-destination', tarballs])
execFileSync('npm', ['pack', '--silent', '--workspace=@spexcode/session-application', '--pack-destination', tarballs])
await writeFile(join(consumer, 'package.json'), '{"name":"session-application-consumer","private":true,"type":"module"}\n')
const packages = ['spexcode-session-protocol-0.6.7.tgz', 'spexcode-session-topology-0.6.7.tgz', 'spexcode-session-application-0.6.7.tgz']
execFileSync('npm', ['install', '--silent', '--no-audit', '--no-fund', ...packages.map(name => join(tarballs, name))], { cwd: consumer })
const require = createRequire(join(consumer, 'package.json'))
const { openProtocol } = await import(pathToFileURL(require.resolve('@spexcode/session-protocol')).href)
const { openTopology } = await import(pathToFileURL(require.resolve('@spexcode/session-topology')).href)
const { openSessionApplication } = await import(pathToFileURL(require.resolve('@spexcode/session-application')).href)
const protocol = openProtocol(join(consumer, 'consumer.sqlite'))
for (const id of ['parent', 'child']) protocol.initialize(id)
const topology = openTopology(protocol)
const app = openSessionApplication(protocol, topology)
const result = app.attachAndNotify('parent', 'child', 'watch', {
  kind: 'session.status.v1',
  body: Buffer.from('{"status":"review"}'),
})
assert.deepEqual(result.recipients, ['parent'])
const delivered = protocol.dequeue('parent')
assert.ok(delivered)
assert.equal(delivered.kind, 'session.status.v1')
assert.equal(delivered.senderSessionId, 'child')
console.log(JSON.stringify({ consumer, edge: result.edge?.edgeId, recipients: result.recipients, delivered: delivered.messageId }))
protocol.close()
