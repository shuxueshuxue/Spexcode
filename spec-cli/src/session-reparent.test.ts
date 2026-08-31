import test from 'node:test'

import { openProjectSessionApplication } from '@spexcode/session-application'
import { resolveDatabasePath } from '@spexcode/session-selflaunch'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')

type Run = { code: number | null; out: string; err: string }

function sessionDir(home: string, id: string, projectRoot = pkgRoot): string {
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: projectRoot, encoding: 'utf8' }).trim())
  return join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
}

function writeSession(home: string, id: string, parent: string | null, projectRoot = pkgRoot): string {
  const dir = sessionDir(home, id, projectRoot)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: pkgRoot, branch: `node/${id}`, node: 'session-reparent',
    title: id, name: '', parent: parent ?? '', status: 'active', proposal: '', merges: 0, note: '', sortkey: '',
    createdAt: Date.now(), harness: 'opencode', harness_session_id: '', stopped: false, archived: false,
    launcher: 'fixture', launch_cmd: 'true', launch_owner: '',
  }, null, 2) + '\n')
  return dir
}

// the legacy envelope is retired to runtime.json at the store's first canonical access; read whichever is there
const envelope = (dir: string): { session_id: string } => JSON.parse(readFileSync(join(dir, existsSync(join(dir, 'runtime.json')) ? 'runtime.json' : 'session.json'), 'utf8'))

function watchers(dir: string): { watcher: string; createdAt: string; sources?: string[] }[] {
  const raw = envelope(dir)
  const application = openProjectSessionApplication({ databasePath: resolveDatabasePath(), locality: () => {} })
  try {
    const grouped = new Map<string, { watcher: string; createdAt: string; sources: string[] }>()
    for (const edge of application.topology.parents(raw.session_id)) {
      if (edge.relationType !== 'parent' && !edge.relationType.startsWith('watch')) continue
      const source = edge.relationType === 'parent' || edge.relationType === 'watch:parent' ? 'parent' : 'manual'
      const current = grouped.get(edge.fromSessionId)
      if (current) { if (!current.sources.includes(source)) current.sources.push(source) }
      else grouped.set(edge.fromSessionId, { watcher: edge.fromSessionId, createdAt: new Date(edge.createdAtMs).toISOString(), sources: [source] })
    }
    return [...grouped.values()]
  } finally { application.close() }
}

function parentOf(dir: string): string | null {
  const raw = envelope(dir)
  const databasePath = resolveDatabasePath()
  const application = openProjectSessionApplication({ databasePath, locality: () => {} })
  try { return application.readState(raw.session_id)?.parentSessionId ?? null } finally { application.close() }
}

function pendingFrom(dir: string): string[] {
  const raw = envelope(dir)
  const application = openProjectSessionApplication({ databasePath: resolveDatabasePath(), locality: () => {} })
  try { return application.readPendingMessages(raw.session_id).map((entry) => entry.senderSessionId ?? '') }
  finally { application.close() }
}

function timelineText(dir: string): string {
  const raw = envelope(dir)
  const application = openProjectSessionApplication({ databasePath: resolveDatabasePath(), locality: () => {} })
  try { return application.readMessageHistory(raw.session_id).map((entry) => Buffer.from(entry.body).toString('utf8')).join('') }
  finally { application.close() }
}

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  server.close()
  await once(server, 'close')
  return address.port
}

function fixtureProject(root: string): string {
  const project = join(root, 'project')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 'README.md'), 'reparent fixture\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'reparent@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'reparent fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture base'], { cwd: project })
  execFileSync('git', ['checkout', '-qb', 'node/reparent-fixture'], { cwd: project })
  writeFileSync(join(project, 'fixture.txt'), 'ahead\n')
  execFileSync('git', ['add', 'fixture.txt'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture node branch'], { cwd: project })
  return project
}

async function waitFor(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

async function runCli(args: string[], env: NodeJS.ProcessEnv, cwd = pkgRoot): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = '', err = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { out += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { err += chunk })
  const [code] = await once(child, 'close') as [number | null]
  return { code, out, err }
}

async function stop(server: ReturnType<typeof spawn>): Promise<void> {
  if (server.exitCode !== null) return
  server.kill('SIGTERM')
  await once(server, 'close')
}

test('session reparent rewrites parent/watch through live backend and only falls back after a local refusal', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-reparent-'))
  const project = fixtureProject(home)
  const databasePath = join(home, 'sessions.sqlite')
  writeFileSync(`${databasePath}.json-migration.json`, JSON.stringify({ version: 1, sourceDigest: 'reparent-fixture' }) + '\n')
  const previousHome = process.env.SPEXCODE_HOME
  const previousDatabase = process.env.SPEX_SESSION_DATABASE_PATH
  process.env.SPEXCODE_HOME = home
  process.env.SPEX_SESSION_DATABASE_PATH = databasePath
  const port = await freePort()
  const oldParent = 'reparent-old-parent'
  const newParent = 'reparent-new-parent'
  const childA = 'reparent-child-a'
  const childB = 'reparent-child-b'
  const childADir = writeSession(home, childA, oldParent, project)
  const childBDir = writeSession(home, childB, oldParent, project)
  writeSession(home, oldParent, null, project)
  writeSession(home, newParent, null, project)
  const seed = openProjectSessionApplication({ databasePath, locality: () => {} })
  try {
    seed.createSession({ sessionId: childA, parentSessionId: oldParent })
    seed.createSession({ sessionId: childB, parentSessionId: oldParent })
    seed.createSession({ sessionId: oldParent })
    seed.createSession({ sessionId: newParent })
  } finally { seed.close() }
  writeFileSync(join(childADir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent', 'manual'] }]) + '\n')
  writeFileSync(join(childBDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
  writeFileSync(join(childADir, 'pending.json'), JSON.stringify([{ mid: 'old-parent-command', text: 'stale continue', from: oldParent }]) + '\n')
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_NO_WARNINGS: '1', SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: databasePath, SPEXCODE_API_URL: '', PORT: String(await freePort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const backend = spawn(process.execPath, [tsxCli, cli, 'serve', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  backend.stderr.setEncoding('utf8').on('data', (chunk) => { log += chunk })
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok === true, `backend did not become healthy: ${log}`)
    const online = await runCli(['session', 'reparent', childA, childB, '--to', newParent, '--api', `http://127.0.0.1:${port}`], env, project)
    assert.equal(online.code, 0, online.err)
    assert.match(online.out, new RegExp(`reparented .*${newParent}`))
    assert.equal(parentOf(childADir), newParent)
    assert.deepEqual(watchers(childADir).map(({ watcher, sources }) => [watcher, sources]).sort(), [
      [oldParent, ['manual']],
      [newParent, ['parent']],
    ].sort())
    assert.equal(parentOf(childBDir), newParent)
    assert.deepEqual(watchers(childBDir).map((entry) => [entry.watcher, entry.sources]), [[newParent, ['parent']]])
    const oldParentTimelineBefore = timelineText(sessionDir(home, oldParent, project))
    const newParentTimelineAtHandoff = timelineText(sessionDir(home, newParent, project))
    assert.match(newParentTimelineAtHandoff, new RegExp(childA), 'reparent delivers the first child current-state snapshot')
    assert.match(newParentTimelineAtHandoff, new RegExp(childB), 'reparent delivers an already-working child current-state snapshot')
    const manualWatchState = await runCli(['session', 'done', '--propose', 'merge', '--session', childA, '--api', `http://127.0.0.1:${port}`], env, project)
    assert.equal(manualWatchState.code, 0, manualWatchState.err)
    await waitFor(async () => timelineText(sessionDir(home, oldParent, project)).length > oldParentTimelineBefore.length,
      'the former parent\'s overlapping manual watch must survive reparent')
    await waitFor(async () => timelineText(sessionDir(home, newParent, project)).length > newParentTimelineAtHandoff.length,
      'the new parent must receive a later non-working child transition')
    assert.match(timelineText(sessionDir(home, oldParent, project)), /"proposal":"merge"/)
    assert.deepEqual(pendingFrom(childADir), [], 'a moved child does not retain an undelivered command from its former supervisor')
    const newParentTimeline = timelineText(sessionDir(home, newParent, project))
    assert.match(newParentTimeline, new RegExp(childA))
    assert.match(newParentTimeline, new RegExp(childB))
    assert.match(newParentTimeline, /"proposal":"merge"/)

    writeFileSync(join(childADir, 'pending.json'), JSON.stringify([{ mid: 'new-parent-command', text: 'stale continue', from: newParent }]) + '\n')
    const detached = await fetch(`http://127.0.0.1:${port}/api/sessions/reparent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ children: [childA], parent: null }),
    })
    assert.equal(detached.status, 200)
    assert.deepEqual(await detached.json(), { children: [childA], parent: null, notified: [] })
    assert.equal(parentOf(childADir), null)
    assert.deepEqual(watchers(childADir).map(({ watcher, sources }) => [watcher, sources]), [
      [oldParent, ['manual']],
    ], 'detaching removes only the former parent source')
    assert.deepEqual(pendingFrom(childADir), [], 'detaching revokes an undelivered command from the former parent')

    await stop(backend)
    const childCDir = writeSession(home, 'reparent-child-c', oldParent, project)
    writeFileSync(join(childCDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
    // A legacy envelope left in a marked store is residue: the CLI's first canonical access absorbs it (a row is
    // created from the envelope, the file is retired), and only then is the child a reparentable session.
    const local = await runCli(['session', 'reparent', 'reparent-child-c', '--to', newParent], env, project)
    assert.equal(local.code, 0, local.err)
    assert.ok(!existsSync(join(childCDir, 'session.json')) && existsSync(join(childCDir, 'runtime.json')), 'residue envelope is retired at the first canonical access')
    assert.equal(parentOf(childCDir), newParent, 'the absorbed child moves like any other')

    const childDDir = writeSession(home, 'reparent-child-d', oldParent, project)
    writeFileSync(join(childDDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
    const remote = await runCli(['session', 'reparent', 'reparent-child-d', '--to', newParent, '--api', `http://127.0.0.1:${await freePort()}`], env, project)
    assert.equal(remote.code, 1)
    assert.match(remote.err, /no backend reachable/)
    assert.equal(parentOf(childDDir), null)
    assert.deepEqual(watchers(childDDir), [], 'remote refusal leaves unmigrated JSON input untouched and non-authoritative')
  } finally {
    await stop(backend)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousDatabase === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabase
    rmSync(home, { recursive: true, force: true })
  }
})

test('session reparent updates the canonical projection after cutover', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'spex-reparent-cutover-'))
  const port = await freePort()
  const oldParent = 'cutover-old-parent'
  const newParent = 'cutover-new-parent'
  const child = 'cutover-child'
  const childDir = writeSession(home, child, oldParent)
  writeSession(home, oldParent, null)
  writeSession(home, newParent, null)
  writeFileSync(join(childDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
  const databasePath = join(home, 'sessions.sqlite')
  const seed = openProjectSessionApplication({ databasePath, locality: () => {} })
  seed.createSession({ sessionId: oldParent })
  seed.createSession({ sessionId: newParent })
  seed.createSession({ sessionId: child, parentSessionId: oldParent })
  seed.close()
  writeFileSync(`${databasePath}.json-migration.json`, JSON.stringify({ version: 1, sourceDigest: 'fixture' }) + '\n')
  // the test worker pins the canonical database beside its own home; this fixture's backend must open THIS store
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEX_SESSION_DATABASE_PATH: databasePath, SPEXCODE_API_URL: '', PORT: String(port) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const backend = spawn(process.execPath, [tsxCli, cli, 'serve', '--port', String(port)], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  backend.stderr.setEncoding('utf8').on('data', chunk => { log += chunk })
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok === true, `backend did not become healthy: ${log}`)
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/reparent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ children: [child], parent: newParent }),
    })
    assert.equal(response.status, 200, `${await response.text()}\nBACKEND LOG:\n${log}`)
    const replay = await fetch(`http://127.0.0.1:${port}/api/session-runtime/${child}/replay`)
    assert.equal(replay.status, 200)
    assert.equal((await replay.json() as { parentSessionId: string | null }).parentSessionId, newParent)
    const board = await fetch(`http://127.0.0.1:${port}/api/sessions?all=1`)
    assert.equal(board.status, 200)
    const boardChild = (await board.json() as Array<{ id: string; parent: string | null }>).find(row => row.id === child)
    assert.equal(boardChild?.parent, newParent)
    // the new supervisor is told the child's current state once; the former parent gets nothing new
    await stop(backend)
    const after = openProjectSessionApplication({ databasePath, locality: () => {} })
    try {
      const snapshots = after.readPendingMessages(newParent).filter(message => message.senderSessionId === child)
      assert.deepEqual(snapshots.map(message => Buffer.from(message.body).toString('utf8')), [`[spex watch] ${child} is created`])
      assert.deepEqual(after.topology.parents(child, 'watch:parent').map(edge => edge.fromSessionId), [newParent])
    } finally { after.close() }
  } finally {
    await stop(backend)
    rmSync(home, { recursive: true, force: true })
  }
})
