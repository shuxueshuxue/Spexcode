import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { daemonRuntime } from './daemon-runtime.js'

// [[packaging]] — the daemon's runtime ships with the dashboard package, so a CLI-only install carries no server
// and no native addon, and `spex serve` loads the runtime through the dashboard.
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = (dir: string) => JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8'))
const DAEMON = ['@hono/node-server', '@hono/node-ws', 'hono', 'node-pty']

test('the spexcode and CLI packages declare no daemon runtime; the dashboard package carries it', () => {
  for (const dir of ['.', 'spec-cli']) {
    const m = manifest(dir)
    const declared = Object.keys({ ...m.dependencies, ...m.optionalDependencies, ...m.peerDependencies })
    assert.deepEqual(declared.filter((name) => DAEMON.includes(name)), [], `${m.name} declares no daemon runtime`)
  }
  assert.deepEqual(Object.keys(manifest('spec-dashboard').dependencies).sort(), DAEMON)
})

test('the daemon runtime loads through the dashboard package', async () => {
  const runtime = await daemonRuntime()
  for (const name of ['Hono', 'cors', 'etag', 'streamSSE', 'serve', 'createNodeWebSocket'] as const)
    assert.equal(typeof runtime[name], 'function', `${name} is exported by the dashboard's daemon entry`)
  assert.equal(await daemonRuntime(), runtime, 'one load per process')
})
