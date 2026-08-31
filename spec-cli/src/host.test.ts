// Integration tests for the host level ([[host-gateway]]): the instance-validated endpoint record, the
// reconciler's identity checks, the /p/:projectId/* proxy (HTTP path rewrite + WS pipe), the host
// project surface, and the real `spex serve` publish/remove loop.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  publishEndpoint, dropOwnEndpoint, endpointRecordPath, readCatalog, addKnownProject,
  browseProjectDirectories, addKnownProjectWithSetup, removeKnownProject, runSpex,
  reconcileProjects, reconcileNow, startHostDashboard, type EndpointRecord,
} from './host.js'
import { encodeProject } from '@spexcode/spec-core'
import { tsxBin } from './tsx-bin.js'
import { setAdminPassword, setProjectPassword, loadAuthStore } from './gateway-auth.js'

const here = dirname(fileURLToPath(import.meta.url))

const freshHome = (tag: string): string => {
  const home = mkdtempSync(join(tmpdir(), `spex-host-${tag}-`))
  process.env.SPEXCODE_HOME = home
  return home
}
const rec = (over: Partial<EndpointRecord> & { root: string; url: string }): EndpointRecord =>
  ({ version: 2, pid: 12345, instanceId: 'inst-x', identity: { title: over.root.split('/').pop() || over.root, icon: 'spexcode' }, startedAt: new Date().toISOString(), ...over })

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number; url: string }> {
  return new Promise((res) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      res({ server, port, url: `http://127.0.0.1:${port}` })
    })
  })
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address !== 'object') {
        server.close(() => reject(new Error('test port has no address')))
        return
      }
      server.close((error) => error ? reject(error) : resolvePort(address.port))
    })
  })
}

function childOutput(child: ReturnType<typeof spawn>): () => string {
  let output = ''
  child.stdout?.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  child.stderr?.setEncoding('utf8').on('data', (chunk) => { output += chunk })
  return () => output
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const signal = (name: 'SIGTERM' | 'SIGKILL') => {
    if (child.pid) {
      try { process.kill(-child.pid, name); return } catch { /* fall back to the direct child */ }
    }
    try { child.kill(name) } catch { /* already gone */ }
  }
  const waitForExit = () => new Promise<void>((resolveExit) => child.once('close', () => resolveExit()))
  signal('SIGTERM')
  await Promise.race([waitForExit(), new Promise<void>((resolveExit) => setTimeout(resolveExit, 5_000))])
  if (child.exitCode === null && child.signalCode === null) {
    signal('SIGKILL')
    await Promise.race([waitForExit(), new Promise<void>((resolveExit) => setTimeout(resolveExit, 5_000))])
  }
}

async function waitForHealth(base: string, child: ReturnType<typeof spawn>, output: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`backend exited before health (${child.exitCode})\n${output()}`)
    try {
      if ((await fetch(`${base}/health`)).ok) return
    } catch { /* backend is still booting */ }
    await new Promise((resolveReady) => setTimeout(resolveReady, 100))
  }
  throw new Error(`backend did not become healthy\n${output()}`)
}
// a fake project backend: answers /api/instance with the given identity and echoes any other /api path.
function fakeBackend(identity: { instanceId: string; root: string; identity?: { title: string; icon: string } }) {
  const seen: string[] = []
  const made = listen((req, res) => {
    seen.push(req.url || '')
    if (req.url === '/api/instance') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ...identity, identity: identity.identity ?? { title: identity.root.split('/').pop(), icon: 'spexcode' } }))
      return
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ echoedPath: req.url }))
  })
  return made.then((m) => ({ ...m, seen }))
}
const getJson = (url: string): Promise<{ status: number; body: any }> =>
  fetch(url).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))

const gitHead = (root: string): string | null => {
  const result = spawnSync('git', ['-C', root, 'rev-parse', '--verify', 'HEAD^{commit}'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

test('publishEndpoint writes atomically; dropOwnEndpoint removes only its own record', () => {
  freshHome('record')
  const root = '/proj/alpha'
  publishEndpoint(rec({ root, url: 'http://127.0.0.1:1', instanceId: 'gen-1' }))
  const onDisk = JSON.parse(readFileSync(endpointRecordPath(root), 'utf8'))
  assert.equal(onDisk.instanceId, 'gen-1')
  assert.equal(onDisk.root, root)
  // a newer serve overwrites; the OLD generation's drop must not delete the new record
  publishEndpoint(rec({ root, url: 'http://127.0.0.1:2', instanceId: 'gen-2' }))
  dropOwnEndpoint('gen-1', root)
  assert.equal(JSON.parse(readFileSync(endpointRecordPath(root), 'utf8')).instanceId, 'gen-2')
  dropOwnEndpoint('gen-2', root)
  assert.equal(existsSync(endpointRecordPath(root)), false)
})

test('reconcile validates instance identity and keeps the durable catalog explicit', async () => {
  const home = freshHome('reconcile')
  const repos = join(home, 'repos')
  const rootOk = join(repos, 'ok'), rootBad = join(repos, 'bad'), rootDead = join(repos, 'dead')
  const rootCatalog = join(repos, 'catalog-only'), rootMissing = join(repos, 'missing')
  for (const root of [rootOk, rootBad, rootDead, rootCatalog]) mkdirSync(root, { recursive: true })
  const okIdentity = { instanceId: 'inst-ok', root: rootOk, identity: { title: 'Alpha', icon: 'compass' } }
  const ok = await fakeBackend(okIdentity)
  const bad = await fakeBackend({ instanceId: 'DIFFERENT', root: rootBad })   // identity mismatch
  let restarted: Awaited<ReturnType<typeof fakeBackend>> | null = null
  try {
    publishEndpoint(rec({ root: rootOk, url: ok.url, instanceId: 'inst-ok', identity: okIdentity.identity }))
    publishEndpoint(rec({ root: rootBad, url: bad.url, instanceId: 'inst-bad' }))
    publishEndpoint(rec({ root: rootDead, url: 'http://127.0.0.1:1', instanceId: 'inst-dead' }))   // nothing listening
    // a record copied into a slot its root does not own is not trusted (no entry may come from it)
    const foreignSlot = join(home, 'projects', encodeProject('/proj/foreign'))
    mkdirSync(foreignSlot, { recursive: true })
    writeFileSync(join(foreignSlot, 'backend.json'), readFileSync(endpointRecordPath(rootOk)))
    // a legacy {url,pid} record (pre-identity) is ignored by the host
    const legacySlot = join(home, 'projects', encodeProject('/proj/legacy'))
    mkdirSync(legacySlot, { recursive: true })
    writeFileSync(join(legacySlot, 'backend.json'), JSON.stringify({ url: ok.url, pid: 1 }))
    writeFileSync(join(home, 'projects.json'), JSON.stringify({ projects: [
      { root: rootCatalog, addedAt: 'x' }, { root: rootMissing, addedAt: 'x' },
    ] }))

    const list = await reconcileProjects()
    const by = Object.fromEntries(list.map((p) => [p.root, p]))
    assert.equal(by[rootOk].online, true)
    assert.equal(by[rootOk].url, ok.url)
    assert.equal(by[rootOk].projectId, encodeProject(rootOk))
    assert.deepEqual(by[rootOk].identity, { title: 'Alpha', icon: 'compass' })
    assert.equal(by[rootBad].online, false, 'identity mismatch must read offline')
    assert.equal(by[rootBad].url, null)
    assert.equal(by[rootDead].online, false, 'dead url must read offline')
    assert.equal(by[rootCatalog].online, false, 'catalog-only project listed offline')
    assert.equal(by[rootMissing], undefined, 'a remembered root whose directory is gone is not listed')
    assert.equal(by['/proj/foreign'], undefined, 'a mis-slotted record must yield nothing')
    assert.equal(by['/proj/legacy'], undefined, 'a legacy record must yield nothing')
    // A transient served project remains reachable while live, but serving it does not permanently
    // clutter the offline project menu. Only POST /projects (the explicit add flow) owns the catalog.
    assert.equal(readCatalog().some((e) => e.root === rootOk), false)

    okIdentity.identity = { title: 'Alpha live', icon: 'spark' }
    assert.deepEqual((await reconcileProjects()).find((p) => p.root === rootOk)?.identity,
      { title: 'Alpha live', icon: 'spark' }, 'live /api/instance projection updates without a restart')

    restarted = await fakeBackend({ instanceId: 'inst-ok-2', root: rootOk, identity: { title: 'Alpha restarted', icon: 'package' } })
    publishEndpoint(rec({ root: rootOk, url: restarted.url, instanceId: 'inst-ok-2', identity: { title: 'Alpha restarted', icon: 'package' } }))
    const afterRestart = (await reconcileProjects()).find((p) => p.root === rootOk)
    assert.equal(afterRestart?.online, true)
    assert.deepEqual(afterRestart?.identity, { title: 'Alpha restarted', icon: 'package' })
  } finally { ok.server.close(); bad.server.close(); restarted?.server.close() }
})

test('addKnownProject normalizes to the main checkout and requires a git repo', () => {
  freshHome('catalog')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  mkdirSync(join(repo, 'sub'))
  const root = addKnownProject(join(repo, 'sub'))   // a path INSIDE the repo lands on the repo root
  assert.equal(readFileSync(join(root, '.git', 'HEAD'), 'utf8').length > 0, true)
  assert.deepEqual(readCatalog().map((e) => e.root), [root])
  addKnownProject(repo)   // dedupe
  assert.equal(readCatalog().length, 1)
  const notRepo = mkdtempSync(join(tmpdir(), 'spex-host-norepo-'))
  assert.throws(() => addKnownProject(notRepo), /not a git repository/)
})

test('removeKnownProject is catalog-only, exact-confirmed, and refuses live sessions/backend', async () => {
  const home = freshHome('remove')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-remove-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), 'keep me\n')
  const registeredRoot = addKnownProject(repo)
  setProjectPassword(encodeProject(registeredRoot), 'secret')
  await reconcileNow()

  assert.throws(() => removeKnownProject(registeredRoot, 'REMOVE wrong'), /confirmation must exactly equal/)
  assert.equal(readCatalog().length, 1)
  const removed = removeKnownProject(registeredRoot, `REMOVE ${basename(registeredRoot)}`)
  assert.deepEqual(removed, { root: registeredRoot, projectId: encodeProject(registeredRoot), sessions: 0, runtimeRecordRemoved: false })
  assert.equal(readCatalog().length, 0)
  assert.equal(loadAuthStore().projects[encodeProject(registeredRoot)], undefined, 'project credential is cleared with the registration')
  assert.equal(existsSync(join(registeredRoot, 'README.md')), true, 'source directory is untouched')
  assert.equal((await reconcileNow()).some((entry) => entry.root === registeredRoot), false)

  // A retained, safely closed record is not an active-session blocker. The current runtime schema uses
  // snake_case, so this also guards the migration boundary in the removal predicate.
  addKnownProject(registeredRoot)
  const closedDir = join(home, 'projects', encodeProject(registeredRoot), 'sessions', 'closed')
  mkdirSync(closedDir, { recursive: true })
  writeFileSync(join(closedDir, 'runtime.json'), JSON.stringify({ archived: false, stopped: false, closed_at: '2026-08-30T00:00:00.000Z' }))
  await reconcileNow()
  const closedRemoved = removeKnownProject(registeredRoot, `REMOVE ${basename(registeredRoot)}`)
  assert.equal(closedRemoved.sessions, 0)

  // An active legacy record is a blocker even when the user typed the right phrase. The catalog remains intact.
  addKnownProject(registeredRoot)
  const sessionDir = join(home, 'projects', encodeProject(registeredRoot), 'sessions', 'active')
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({ archived: false, stopped: false, closedAt: null }))
  await reconcileNow()
  assert.throws(() => removeKnownProject(registeredRoot, `REMOVE ${basename(registeredRoot)}`), /active session record/)
  assert.equal(readCatalog().length, 1)
})

test('host DELETE /projects/:id is an admin-gated, catalog-only lifecycle route', async () => {
  const home = freshHome('remove-http')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-remove-http-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), 'must survive\n')
  const registeredRoot = addKnownProject(repo)
  const dist = mkdtempSync(join(tmpdir(), 'spex-host-remove-http-dist-'))
  writeFileSync(join(dist, 'index.html'), '<html>shell</html>')
  const port = await new Promise<number>((resolvePort) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => { const p = (server.address() as net.AddressInfo).port; server.close(() => resolvePort(p)) })
  })
  const dashboard = startHostDashboard({ port, host: '127.0.0.1', distDir: dist })
  await new Promise<void>((resolveReady) => dashboard.server.once('listening', () => resolveReady()))
  const id = encodeProject(registeredRoot)
  try {
    const refused = await fetch(`http://127.0.0.1:${port}/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'REMOVE wrong' }),
    })
    assert.equal(refused.status, 400)
    const removed = await fetch(`http://127.0.0.1:${port}/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: `REMOVE ${basename(registeredRoot)}` }),
    })
    assert.equal(removed.status, 200)
    assert.equal((await removed.json()).ok, true)
    assert.equal(existsSync(join(registeredRoot, 'README.md')), true)
    const repeated = await fetch(`http://127.0.0.1:${port}/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
    assert.equal(repeated.status, 404)
  } finally { await dashboard.close() }
})

test('directory browse reports folder state; explicit setup initializes Git then the real SpexCode CLI before cataloging', async () => {
  freshHome('add-setup')
  const parent = mkdtempSync(join(tmpdir(), 'spex-host-browse-'))
  const plain = join(parent, 'plain-project')
  mkdirSync(plain)
  writeFileSync(join(plain, 'notes.md'), 'user content stays uncommitted\n')

  const parentListing = browseProjectDirectories(parent)
  assert.equal(parentListing.entries.find((entry) => entry.name === 'plain-project')?.git, false)
  const before = browseProjectDirectories(plain)
  assert.equal(before.gitRoot, null)
  assert.equal(before.initialized, false)

  const added = await addKnownProjectWithSetup(plain, { initGit: true, init: { harness: 'codex' } })
  assert.equal(added.ok, true)
  assert.equal(added.gitInitialized, true)
  assert.equal(added.initialCommitCreated, true)
  assert.equal(added.init?.code, 0)
  assert.equal(existsSync(join(plain, '.git')), true)
  assert.equal(existsSync(join(plain, '.spec')), true)
  assert.equal(execFileSync('git', ['-C', plain, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'main')
  assert.match(gitHead(plain) ?? '', /^[0-9a-f]{40,64}$/)
  assert.equal(execFileSync('git', ['-C', plain, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim(), 'chore: 初始化项目')
  assert.equal(execFileSync('git', ['-C', plain, 'log', '-1', '--format=%an <%ae>'], { encoding: 'utf8' }).trim(), 'SpexCode <spexcode@spexcode.invalid>')
  const plainTree = execFileSync('git', ['-C', plain, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' })
  assert.match(plainTree, /(^|\n)\.spec\//)
  assert.match(plainTree, /(^|\n)spexcode\.json\n/)
  assert.doesNotMatch(plainTree, /(^|\n)notes\.md\n/, 'the bootstrap commit does not stage user source')
  assert.match(execFileSync('git', ['-C', plain, 'status', '--short'], { encoding: 'utf8' }), /notes\.md/)
  assert.deepEqual(JSON.parse(readFileSync(join(plain, 'spexcode.json'), 'utf8')).harnesses, ['codex'])
  assert.deepEqual(readCatalog().map((entry) => entry.root), [realpathSync(plain)])

  const existingUnborn = join(parent, 'existing-unborn')
  mkdirSync(existingUnborn)
  writeFileSync(join(existingUnborn, 'draft.txt'), 'existing user content\n')
  execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: existingUnborn })
  const repaired = await addKnownProjectWithSetup(existingUnborn)
  assert.equal(repaired.ok, true)
  assert.equal(repaired.directoryCreated, false)
  assert.equal(repaired.gitInitialized, false)
  assert.equal(repaired.initialCommitCreated, true)
  assert.equal(execFileSync('git', ['-C', existingUnborn, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'master')
  assert.match(gitHead(existingUnborn) ?? '', /^[0-9a-f]{40,64}$/)
  assert.equal(execFileSync('git', ['-C', existingUnborn, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim(), '')
  assert.match(execFileSync('git', ['-C', existingUnborn, 'status', '--short'], { encoding: 'utf8' }), /draft\.txt/)

  // A previous `spex init` may have completed but its first commit may have been rejected by the hook.
  // Re-registering that unborn repository must recover the existing seed instead of creating an empty
  // commit that leaves the same source-of-truth error for the first session.
  const interrupted = join(parent, 'interrupted-adoption')
  mkdirSync(interrupted)
  writeFileSync(join(interrupted, 'draft.txt'), 'keep this user content uncommitted\n')
  execFileSync('git', ['init', '-q', '-b', 'master'], { cwd: interrupted })
  const seeded = await runSpex(interrupted, ['init', '--harness', 'codex'])
  assert.equal(seeded.code, 0, seeded.output)
  assert.equal(gitHead(interrupted), null)
  const recovered = await addKnownProjectWithSetup(interrupted)
  assert.equal(recovered.ok, true)
  assert.equal(recovered.initialCommitCreated, true)
  assert.equal(execFileSync('git', ['-C', interrupted, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'master')
  const recoveredTree = execFileSync('git', ['-C', interrupted, 'ls-tree', '-r', '--name-only', 'HEAD'], { encoding: 'utf8' })
  assert.match(recoveredTree, /(^|\n)\.spec\/project\/spec\.md\n/)
  assert.match(recoveredTree, /(^|\n)spexcode\.json\n/)
  assert.doesNotMatch(recoveredTree, /(^|\n)draft\.txt\n/)
  assert.match(execFileSync('git', ['-C', interrupted, 'status', '--short'], { encoding: 'utf8' }), /draft\.txt/)
  const recoveredLint = await runSpex(interrupted, ['spec', 'lint'])
  assert.equal(recoveredLint.code, 0, recoveredLint.output)
  assert.doesNotMatch(recoveredLint.output, /project source of truth is untracked/)

  const historical = join(parent, 'historical')
  mkdirSync(historical)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: historical })
  writeFileSync(join(historical, 'tracked.txt'), 'existing history\n')
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '--', 'tracked.txt'], { cwd: historical })
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'existing history'], { cwd: historical })
  const historicalHead = gitHead(historical)
  writeFileSync(join(historical, 'later.txt'), 'must stay uncommitted\n')
  const registeredHistorical = await addKnownProjectWithSetup(historical)
  assert.equal(registeredHistorical.initialCommitCreated, false)
  assert.equal(gitHead(historical), historicalHead)
  assert.match(execFileSync('git', ['-C', historical, 'status', '--short'], { encoding: 'utf8' }), /later\.txt/)

  const unborn = join(parent, 'new-project')
  const candidate = browseProjectDirectories(unborn)
  assert.equal(candidate.exists, false)
  assert.equal(candidate.path, unborn)
  // New-project setup must be independent of the operator's legacy Git default (`master`). The host owns
  // the `main` source-of-truth branch before `spex init` stamps the portable config.
  const gitConfigGlobal = join(parent, 'gitconfig-master-default')
  writeFileSync(gitConfigGlobal, '[init]\n\tdefaultBranch = master\n')
  const previousGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL
  process.env.GIT_CONFIG_GLOBAL = gitConfigGlobal
  const created = await (async () => {
    try { return await addKnownProjectWithSetup(unborn, { createDir: true, initGit: true }) }
    finally {
      if (previousGitConfigGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
      else process.env.GIT_CONFIG_GLOBAL = previousGitConfigGlobal
    }
  })()
  assert.equal(created.ok, true)
  assert.equal(created.directoryCreated, true)
  assert.equal(created.initialCommitCreated, true)
  assert.equal(created.init?.code, 0)
  assert.equal(existsSync(join(unborn, '.git')), true)
  assert.equal(execFileSync('git', ['-C', unborn, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'main')
  assert.equal(JSON.parse(readFileSync(join(unborn, 'spexcode.json'), 'utf8')).mainBranch, 'main')
  assert.deepEqual(JSON.parse(readFileSync(join(unborn, 'spexcode.json'), 'utf8')).harnesses, [])
  assert.match(gitHead(unborn) ?? '', /^[0-9a-f]{40,64}$/)
  assert.equal(readCatalog().some((entry) => entry.root === realpathSync(unborn)), true)

  const notCreated = join(parent, 'not-created')
  await assert.rejects(addKnownProjectWithSetup(notCreated, { createDir: true }), /requires Git initialization/)
  assert.equal(existsSync(notCreated), false)

  const broken = join(parent, 'broken-project')
  mkdirSync(broken)
  const failed = await addKnownProjectWithSetup(broken, { initGit: true, init: { harness: 'not-a-harness' } })
  assert.equal(failed.ok, false)
  assert.notEqual(failed.init?.code, 0)
  assert.match(failed.init?.output ?? '', /unknown harness/)
  assert.equal(existsSync(join(broken, '.git')), true, 'the explicitly requested bounded Git step remains visible')
  assert.equal(readCatalog().some((entry) => entry.root === broken), false, 'failed SpexCode setup never claims catalog success')
})

test('structured gateway and offline-project icon writes are admin-only', async () => {
  const home = freshHome('identity-auth')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-auth-repo-'))
  writeFileSync(join(home, 'projects.json'), JSON.stringify({ projects: [{ root: repo, addedAt: 'x' }] }))
  setAdminPassword('secret')
  const dist = mkdtempSync(join(tmpdir(), 'spex-host-auth-dist-'))
  writeFileSync(join(dist, 'index.html'), '<html>shell</html>')
  const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) }) })
  const gw = startHostDashboard({ port, host: '127.0.0.1', distDir: dist })
  await new Promise<void>((res) => gw.server.once('listening', () => res()))
  try {
    const deniedBrowse = await fetch(`http://127.0.0.1:${port}/projects/browse?path=${encodeURIComponent(repo)}`)
    assert.equal(deniedBrowse.status, 401)
    const deniedAdd = await fetch(`http://127.0.0.1:${port}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: repo, initGit: true }),
    })
    assert.equal(deniedAdd.status, 401)
    assert.equal(existsSync(join(repo, '.git')), false, 'authorization runs before the requested Git side effect')
    for (const path of ['/projects/icon', `/projects/${encodeProject(repo)}/icon`]) {
      const denied = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ icon: 'spark', revision: 'forged' }),
      })
      assert.equal(denied.status, 401)
    }
    assert.equal(existsSync(join(home, 'config.json')), false)
    assert.equal(existsSync(join(repo, 'spexcode.json')), false)
  } finally { await gw.close() }
})

test('host dashboard on the hub: admin list + stream, /p proxy, registration, config, ops, shell, WS pipe', async () => {
  const home = freshHome('gateway')
  const rootLive = join(home, 'live-one'), rootAsleep = join(home, 'asleep')
  mkdirSync(rootLive, { recursive: true }); mkdirSync(rootAsleep, { recursive: true })
  const backend = await fakeBackend({ instanceId: 'inst-live', root: rootLive, identity: { title: 'Live One', icon: 'compass' } })
  // the fake backend also answers a WS upgrade so the raw pipe can be proven end to end
  let upgradePath = ''
  backend.server.on('upgrade', (req, socket) => {
    upgradePath = req.url || ''
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello-from-backend')
  })
  publishEndpoint(rec({ root: rootLive, url: backend.url, instanceId: 'inst-live', identity: { title: 'Live One', icon: 'compass' } }))
  writeFileSync(join(home, 'projects.json'), JSON.stringify({ projects: [{ root: rootAsleep, addedAt: 'x' }] }))
  const dist = mkdtempSync(join(tmpdir(), 'spex-host-dist-'))
  writeFileSync(join(dist, 'index.html'), '<html>shell</html>')

  const gwPort = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) }) })
  const gw = startHostDashboard({ port: gwPort, host: '127.0.0.1', distDir: dist })
  await new Promise<void>((res) => gw.server.once('listening', () => res()))
  const base = `http://127.0.0.1:${gwPort}`
  const liveId = encodeProject(rootLive)
  try {
    // the hub's admin surface (implicit loopback admin — no admin password yet) serves the HOST list:
    // reconciled entries incl. the catalog-only offline project, each with the hub's gating flag.
    const list = await getJson(`${base}/projects`)
    assert.equal(list.status, 200)
    assert.equal(list.body.adminGated, false)
    const live = list.body.projects.find((p: any) => p.projectId === liveId)
    assert.equal(live.online, true)
    assert.equal(live.id, liveId, 'rows carry the hub row key too')
    assert.equal(live.gated, false)
    assert.deepEqual(live.identity, { title: 'Live One', icon: 'compass' })
    assert.equal(list.body.gateway.icon, 'gateway')
    assert.equal(typeof list.body.gateway.revision, 'string')
    assert.equal(list.body.projects.find((p: any) => p.root === rootAsleep).online, false)

    const gatewayIcon = await fetch(`${base}/projects/icon`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'simple-icons:github', revision: list.body.gateway.revision }),
    })
    assert.equal(gatewayIcon.status, 200)
    assert.deepEqual((await gatewayIcon.json()).gateway.identity, { title: 'Projects', icon: 'simple-icons:github' })
    assert.deepEqual(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')), { gateway: { icon: 'simple-icons:github' } })
    assert.equal((await getJson(`${base}/projects`)).body.gateway.icon, 'simple-icons:github', 'gateway write refreshes the normal catalog projection')
    const streamFirst = await new Promise<string>((res, rej) => {
      const req = http.get(`${base}/projects/stream`, (r) => {
        let buf = ''
        r.on('data', (d) => { buf += d; if (buf.includes('\n\n')) { req.destroy(); res(buf) } })
      })
      req.on('error', () => rej(new Error('stream failed before first event')))
      setTimeout(() => rej(new Error('no SSE event within 5s')), 5000).unref()
    })
    assert.match(streamFirst, /^data: \[/)
    assert.ok(streamFirst.includes(liveId))

    // /p routing is the HUB's: prefix stripped, query intact; a project with no live record — unknown
    // or catalog-only offline alike — answers 404 before any upstream contact.
    const proxied = await getJson(`${base}/p/${liveId}/api/graph?x=1`)
    assert.equal(proxied.status, 200)
    assert.equal(proxied.body.echoedPath, '/api/graph?x=1')
    assert.equal((await getJson(`${base}/p/no-such/api/graph`)).status, 404)
    assert.equal((await getJson(`${base}/p/${encodeProject(rootAsleep)}/api/graph`)).status, 404)
    // non-/p, non-/projects paths fall back to the dashboard shell; /p non-API paths reach the backend
    for (const p of ['/index.html', '/somepage']) {
      const r = await fetch(`${base}${p}`)
      assert.equal(r.status, 200)
      assert.match(await r.text(), /shell/)
    }
    // browser navigation to the Projects UI: / redirects to /projects, and the redirected GET — same
    // explicit text/html Accept a browser sends — serves the SPA shell on the ONE content-negotiated
    // route, while API fetches of the same path (asserted above with default Accept, and here with an
    // explicit application/json) keep the catalog envelope.
    const browserAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    const rootNav = await fetch(`${base}/`, { headers: { accept: browserAccept }, redirect: 'manual' })
    assert.equal(rootNav.status, 302)
    assert.equal(rootNav.headers.get('location'), '/projects')
    const nav = await fetch(`${base}/projects`, { headers: { accept: browserAccept } })
    assert.equal(nav.status, 200)
    assert.match(nav.headers.get('content-type') ?? '', /text\/html/)
    assert.match(await nav.text(), /shell/)
    const asJson = await fetch(`${base}/projects`, { headers: { accept: 'application/json' } })
    assert.match(asJson.headers.get('content-type') ?? '', /application\/json/)
    assert.equal((await asJson.json()).adminGated, false)
    const viaBackend = await getJson(`${base}/p/${liveId}/anything`)
    assert.equal(viaBackend.body.echoedPath, '/anything')

    // registration rides the admin surface: a real git repo adds (offline), a non-repo refuses,
    // an op on an unknown project 404s with the repair.
    const repo = mkdtempSync(join(tmpdir(), 'spex-host-addrepo-'))
    execFileSync('git', ['init', '-q'], { cwd: repo })
    const canonicalRepo = realpathSync(repo)
    const browse = await getJson(`${base}/projects/browse?path=${encodeURIComponent(repo)}`)
    assert.equal(browse.status, 200)
    assert.equal(browse.body.path, canonicalRepo)
    assert.equal(browse.body.gitRoot, canonicalRepo)
    assert.equal(Array.isArray(browse.body.entries), true)
    assert.equal(browse.body.exists, true)
    const added = await fetch(`${base}/projects`, { method: 'POST', body: JSON.stringify({ root: repo }) })
    assert.equal(added.status, 200)
    const addedBody = await added.json()
    assert.equal(addedBody.online, false)
    assert.equal(addedBody.setup.initialCommitCreated, true)

    const unborn = join(mkdtempSync(join(tmpdir(), 'spex-host-new-project-parent-')), 'new-project')
    const unbornBrowse = await getJson(`${base}/projects/browse?path=${encodeURIComponent(unborn)}`)
    assert.equal(unbornBrowse.status, 200)
    assert.equal(unbornBrowse.body.exists, false)
    assert.equal(unbornBrowse.body.path, unborn)
    const created = await fetch(`${base}/projects`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: unborn, createDir: true, initGit: true }),
    })
    assert.equal(created.status, 200)
    const createdBody = await created.json()
    assert.equal(createdBody.setup.initialCommitCreated, true)
    assert.equal(createdBody.setup.init.code, 0)
    assert.equal(existsSync(join(unborn, '.git')), true)
    assert.equal(JSON.parse(readFileSync(join(unborn, 'spexcode.json'), 'utf8')).mainBranch, 'main')
    assert.equal(execFileSync('git', ['-C', unborn, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'main')
    const repoId = encodeProject(canonicalRepo)

    // Raw portable config rides the same admin surface and works while the repo is offline. Missing is
    // an editable {}, saves are atomic + normalized, malformed content and a stale revision lose nothing.
    const initialConfig = await getJson(`${base}/projects/${repoId}/config`)
    assert.equal(initialConfig.status, 200)
    assert.equal(initialConfig.body.content, '{}\n')
    const configText = '{\n  "preset": "default",\n  "dashboard": { "title": "Offline Repo", "icon": "lucide:radar" }\n}'
    const savedConfigRes = await fetch(`${base}/projects/${repoId}/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: configText, revision: initialConfig.body.revision }),
    })
    assert.equal(savedConfigRes.status, 200)
    const savedConfig = await savedConfigRes.json()
    assert.equal(readFileSync(join(repo, 'spexcode.json'), 'utf8'), `${configText}\n`)
    const legacyRow = (await getJson(`${base}/projects`)).body.projects.find((p: any) => p.projectId === repoId)
    assert.deepEqual(legacyRow.identity, { title: 'Offline Repo', icon: 'lucide:radar' }, 'existing Iconify values remain canonical while offline')

    const iconSavedRes = await fetch(`${base}/projects/${repoId}/icon`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'spark', revision: savedConfig.revision }),
    })
    assert.equal(iconSavedRes.status, 200)
    const iconSaved = await iconSavedRes.json()
    assert.deepEqual(iconSaved.identity, { title: 'Offline Repo', icon: 'spark' })
    assert.equal(iconSaved.content, readFileSync(join(repo, 'spexcode.json'), 'utf8'), 'response is the canonical source bytes')
    assert.deepEqual(JSON.parse(iconSaved.content), { preset: 'default', dashboard: { title: 'Offline Repo', icon: 'spark' } })
    const iconifySavedRes = await fetch(`${base}/projects/${repoId}/icon`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'lucide:radar', revision: iconSaved.revision }),
    })
    assert.equal(iconifySavedRes.status, 200, 'structured writes restore the established Iconify namespace')
    const iconifySaved = await iconifySavedRes.json()
    assert.deepEqual(iconifySaved.identity, { title: 'Offline Repo', icon: 'lucide:radar' })
    assert.equal(iconifySaved.content, readFileSync(join(repo, 'spexcode.json'), 'utf8'))
    const rejectedIcon = await fetch(`${base}/projects/${repoId}/icon`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'not a catalog choice', revision: iconifySaved.revision }),
    })
    assert.equal(rejectedIcon.status, 400, 'structured writes reject values outside presets and Iconify')
    assert.equal(readFileSync(join(repo, 'spexcode.json'), 'utf8'), iconifySaved.content)
    const staleIcon = await fetch(`${base}/projects/${repoId}/icon`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icon: 'package', revision: savedConfig.revision }),
    })
    assert.equal(staleIcon.status, 409)
    const invalidConfig = await fetch(`${base}/projects/${repoId}/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '[]', revision: iconifySaved.revision }),
    })
    assert.equal(invalidConfig.status, 400)
    assert.equal(readFileSync(join(repo, 'spexcode.json'), 'utf8'), iconifySaved.content)
    writeFileSync(join(repo, 'spexcode.json'), '{"newer":true}\n')
    const staleConfig = await fetch(`${base}/projects/${repoId}/config`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '{"stale":true}', revision: savedConfig.revision }),
    })
    assert.equal(staleConfig.status, 409)
    assert.equal(readFileSync(join(repo, 'spexcode.json'), 'utf8'), '{"newer":true}\n')

    const refused = await fetch(`${base}/projects`, { method: 'POST', body: JSON.stringify({ root: join(repo, 'nope') }) })
    assert.equal(refused.status, 400)
    const noSuch = await fetch(`${base}/projects/no-such/init`, { method: 'POST', body: '{}' })
    assert.equal(noSuch.status, 404)
    assert.equal((await getJson(`${base}/projects/no-such/config`)).status, 404)

    // the WS upgrade raw-pipes to the project's backend with the same prefix strip (hub-authorized: open)
    const wsBytes = await new Promise<string>((res, rej) => {
      const sock = net.connect(gwPort, '127.0.0.1', () => {
        sock.write(`GET /p/${liveId}/api/sessions/s1/socket HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`)
      })
      let buf = ''
      sock.on('data', (d) => { buf += d; if (buf.includes('hello-from-backend')) { sock.destroy(); res(buf) } })
      sock.on('error', rej)
      setTimeout(() => { sock.destroy(); rej(new Error(`no WS bytes within 5s (got: ${buf.slice(0, 200)})`)) }, 5000).unref()
    })
    assert.match(wsBytes, /101 Switching Protocols/)
    assert.equal(upgradePath, '/api/sessions/s1/socket')
  } finally {
    await gw.close()
    backend.server.close()
  }
})

test('startHostDashboard passes tls through to the hub: the ONE host gateway serves HTTPS directly', async () => {
  const home = freshHome('tls')
  const rootLive = join(home, 'tls-live')
  mkdirSync(rootLive, { recursive: true })
  const backend = await fakeBackend({ instanceId: 'inst-tls', root: rootLive })
  publishEndpoint(rec({ root: rootLive, url: backend.url, instanceId: 'inst-tls' }))
  const dist = mkdtempSync(join(tmpdir(), 'spex-host-dist-'))
  writeFileSync(join(dist, 'index.html'), '<html>shell</html>')
  const tlsDir = mkdtempSync(join(tmpdir(), 'spex-host-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem'),
    '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdio: 'ignore' })
  const tls = { cert: readFileSync(join(tlsDir, 'cert.pem'), 'utf8'), key: readFileSync(join(tlsDir, 'key.pem'), 'utf8') }

  const gwPort = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) }) })
  const gw = startHostDashboard({ port: gwPort, host: '127.0.0.1', distDir: dist, tls })
  await new Promise<void>((res) => gw.server.once('listening', () => res()))
  // self-signed → verification off for the probe; what's proven is the transport + the same surfaces
  const getSecure = (path: string): Promise<{ status: number; body: string }> =>
    new Promise((res, rej) => {
      https.get({ host: '127.0.0.1', port: gwPort, path, rejectUnauthorized: false }, (r) => {
        let buf = ''
        r.on('data', (d) => { buf += d })
        r.on('end', () => res({ status: r.statusCode ?? 0, body: buf }))
      }).on('error', rej)
    })
  try {
    // the hub's admin surface answers over TLS (loopback stays implicit admin — auth is unchanged)
    const list = await getSecure('/projects')
    assert.equal(list.status, 200)
    const parsed = JSON.parse(list.body)
    assert.equal(parsed.adminGated, false)
    assert.equal(parsed.projects.find((p: any) => p.projectId === encodeProject(rootLive)).online, true)
    // /p proxying and the shell fallback ride the same TLS server — no second proxy anywhere
    const proxied = await getSecure(`/p/${encodeProject(rootLive)}/api/graph?x=1`)
    assert.equal(JSON.parse(proxied.body).echoedPath, '/api/graph?x=1')
    assert.match((await getSecure('/somepage')).body, /shell/)
    // a plaintext client on the TLS port gets a refusal, not a silent HTTP downgrade
    await assert.rejects(getJson(`http://127.0.0.1:${gwPort}/projects`))
  } finally {
    await gw.close()
    backend.server.close()
  }
})

test('a host-created project can create its first real session from the committed base', { timeout: 120_000 }, async () => {
  const home = freshHome('n')
  const parent = mkdtempSync(join(tmpdir(), 'spex-host-new-session-parent-'))
  const requested = join(parent, 'new-project')
  const setup = await addKnownProjectWithSetup(requested, { createDir: true, initGit: true })
  const project = realpathSync(requested)
  assert.equal(setup.ok, true)
  assert.equal(setup.root, project)
  assert.equal(setup.initialCommitCreated, true)
  assert.equal(gitHead(project) !== null, true)
  assert.equal(execFileSync('git', ['-C', project, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'main')
  assert.equal(JSON.parse(readFileSync(join(project, 'spexcode.json'), 'utf8')).mainBranch, 'main')
  assert.deepEqual(JSON.parse(readFileSync(join(project, 'spexcode.json'), 'utf8')).harnesses, [])

  // The path-only flow deliberately has no selected harness. A local fixture launcher models the later
  // scoped New Session `+` action without changing the portable empty selection that the host created.
  const fakeLauncher = join(here, '..', 'test', 'fixtures', 'fake-claude')
  writeFileSync(join(project, 'spexcode.local.json'), JSON.stringify({
    sessions: { launchers: { fixture: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fixture' },
  }, null, 2) + '\n')

  const port = await freePort()
  const tmux = `spex-host-new-session-${process.pid}-${Date.now()}`
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux }
  delete env.PORT; delete env.SPEXCODE_API_URL; delete env.SPEXCODE_SESSION_ID; delete env.SPEXCODE_INSTANCE_ID
  const backend = spawn(process.execPath, [tsxBin(join(here, '..')), join(here, 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const backendOutput = childOutput(backend)
  const base = `http://127.0.0.1:${port}`
  try {
    await waitForHealth(base, backend, backendOutput)
    const runner = spawn(process.execPath, [tsxBin(join(here, '..')), join(here, '..', 'test', 'session-terminal-fixture.ts')], {
      cwd: project, env: { ...env, BASE: base, LAUNCHER: 'fixture' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    const runnerOutput = childOutput(runner)
    await new Promise<void>((resolveRunner) => runner.once('close', () => resolveRunner()))
    assert.equal(runner.exitCode, 0, `real session fixture failed\n${runnerOutput()}\nbackend:\n${backendOutput()}`)
    assert.match(runnerOutput(), /PASS: POST \/api\/sessions -> online -> 101 -> PTY output -> close/)
    assert.doesNotMatch(runnerOutput(), /invalid reference/)
  } finally {
    await stopChild(backend)
  }
})

test('a linked-worktree `spex serve` registers its actual served root without replacing main', async () => {
  const home = freshHome('serve-e2e')
  const repo = mkdtempSync(join(tmpdir(), 'spex-host-serve-'))
  const canonicalRepo = realpathSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.email', 't@t.co'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), 'main\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repo })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: repo })
  const linked = join(mkdtempSync(join(tmpdir(), 'spex-host-linked-parent-')), 'feature-tree')
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'node/feature', linked], { cwd: repo })
  const canonicalLinked = realpathSync(linked)
  publishEndpoint(rec({ root: canonicalRepo, url: 'http://127.0.0.1:1', instanceId: 'main-generation', identity: { title: 'Main', icon: 'compass' } }))
  const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)) }) })
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home }
  delete env.PORT; delete env.SPEXCODE_API_URL; delete env.SPEXCODE_SESSION_ID; delete env.SPEXCODE_INSTANCE_ID
  const child = spawn(process.execPath, [tsxBin(join(here, '..')), join(here, 'cli.ts'), 'serve', '--port', String(port)], { cwd: canonicalLinked, env })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  try {
    // wait for the record — published only AFTER the public bind succeeds
    const file = endpointRecordPath(canonicalLinked)
    const deadline = Date.now() + 90_000
    while (!existsSync(file)) {
      assert.ok(Date.now() < deadline, `no endpoint record within 90s; serve output:\n${out}`)
      await new Promise((r) => setTimeout(r, 300))
    }
    const record = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(record.url, `http://127.0.0.1:${port}`)
    assert.equal(record.version, 2)
    assert.equal(record.root, canonicalLinked)
    assert.equal(JSON.parse(readFileSync(endpointRecordPath(canonicalRepo), 'utf8')).instanceId, 'main-generation', 'main slot was never touched')
    assert.equal(typeof record.instanceId, 'string')
    // the live backend answers the SAME identity the record claims → the reconciler lists it online
    const inst = await fetch(`${record.url}/api/instance`).then((r) => r.json()) as any
    assert.equal(inst.instanceId, record.instanceId)
    assert.equal(inst.root, canonicalLinked)
    const entry = (await reconcileNow()).find((p) => p.root === canonicalLinked)
    assert.equal(entry?.online, true)
    // clean stop removes ONLY its own record
    child.kill('SIGTERM')
    const gone = Date.now() + 20_000
    while (existsSync(file)) {
      assert.ok(Date.now() < gone, `record not removed on clean stop; serve output:\n${out}`)
      await new Promise((r) => setTimeout(r, 200))
    }
  } finally {
    try { child.kill('SIGKILL') } catch { /* already gone */ }
    dropOwnEndpoint('main-generation', canonicalRepo)
  }
})
