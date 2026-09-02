import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { encodeProject } from '@spexcode/spec-core'
import {
  addHarnessTarget,
  addKnownProjectWithSetup,
  startHostDashboard,
} from './host.js'

const freshHome = (tag: string): string => {
  const home = mkdtempSync(join(tmpdir(), `spex-host-${tag}-`))
  process.env.SPEXCODE_HOME = home
  return home
}

const freePort = () => new Promise<number>((resolvePort) => {
  const server = net.createServer()
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as net.AddressInfo).port
    server.close(() => resolvePort(port))
  })
})

test('harness target addition persists targets, materializes, and is exposed through the admin route', async () => {
  const home = freshHome('harness-target')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-harness-target-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  const setup = await addKnownProjectWithSetup(repo, { init: { harness: 'claude' } })
  assert.equal(setup.ok, true)

  const before = JSON.parse(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8'))
  assert.deepEqual(before.harnesses, ['claude'])
  const root = setup.root
  const added = await addHarnessTarget(root, 'codex')
  assert.equal(added.ok, true)
  assert.deepEqual(added.target, 'codex')
  assert.deepEqual(JSON.parse(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8')).harnesses, ['claude', 'codex'])
  assert.equal(added.launcher?.harness, 'codex')
  assert.equal(typeof added.launcher?.cmd, 'string')
  const after = JSON.parse(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8'))
  assert.equal(after.sessions.launchers[added.launcher!.name].harness, 'codex')
  assert.equal(after.sessions.defaultLauncher, before.sessions.defaultLauncher, 'adding a target keeps the existing default')

  await assert.rejects(addHarnessTarget(root, { plugin: '.adopter-a' }), /EXCLUSIVE/)
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.spec/spexcode.json'), 'utf8')).harnesses, ['claude', 'codex'])
  await assert.rejects(addHarnessTarget(root, 'pi', 'stale-revision'), /changed on disk/)

  const pluginRepo = mkdtempSync(join(tmpdir(), 'spex-host-plugin-target-'))
  execFileSync('git', ['init', '-q'], { cwd: pluginRepo })
  const pluginSetup = await addKnownProjectWithSetup(pluginRepo, { init: { harness: 'none' } })
  assert.equal(pluginSetup.ok, true)
  const plugin = await addHarnessTarget(pluginRepo, { plugin: '.adopter-a' })
  assert.equal(plugin.ok, true)
  assert.deepEqual(plugin.target, { plugin: '.adopter-a' })
  assert.equal(plugin.launcher, undefined)
  assert.deepEqual(JSON.parse(readFileSync(join(pluginRepo, '.spec/spexcode.json'), 'utf8')).harnesses, [{ plugin: '.adopter-a' }])

  const dist = mkdtempSync(join(tmpdir(), 'spex-host-harness-http-dist-'))
  writeFileSync(join(dist, 'index.html'), '<html>shell</html>')
  const port = await freePort()
  const dashboard = startHostDashboard({ port, host: '127.0.0.1', distDir: dist })
  await new Promise<void>((resolveReady) => dashboard.server.once('listening', () => resolveReady()))
  const id = encodeProject(root)
  try {
    const source = await fetch(`http://127.0.0.1:${port}/projects/${encodeURIComponent(id)}/config`)
    assert.equal(source.status, 200)
    const sourceBody = await source.json() as { revision: string }
    const routeAdded = await fetch(`http://127.0.0.1:${port}/projects/${encodeURIComponent(id)}/harnesses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'pi', revision: sourceBody.revision }),
    })
    assert.equal(routeAdded.status, 200)
    const routeBody = await routeAdded.json() as { ok: boolean; harnesses: unknown[]; launcher?: { harness: string } }
    assert.equal(routeBody.ok, true)
    assert.deepEqual(routeBody.harnesses, ['claude', 'codex', 'pi'])
    assert.equal(routeBody.launcher?.harness, 'pi')

    const stale = await fetch(`http://127.0.0.1:${port}/projects/${encodeURIComponent(id)}/harnesses`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target: 'opencode', revision: sourceBody.revision }),
    })
    assert.equal(stale.status, 409)
  } finally {
    await dashboard.close()
  }
  assert.equal(existsSync(join(home, 'projects.json')), true)
})

test('harness target addition refuses a missing persisted selection instead of inventing one', async () => {
  freshHome('harness-target-missing')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-harness-target-missing-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  writeFileSync(join(repo, '.spec/spexcode.json'), '{}\n')
  await assert.rejects(addHarnessTarget(repo, 'codex'), /no "harnesses" field.*spex init --harness/i)
  assert.deepEqual(JSON.parse(readFileSync(join(repo, '.spec/spexcode.json'), 'utf8')), {})
})
