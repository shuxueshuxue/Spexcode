import test from 'node:test'

import { openProjectSessionApplication } from '@spexcode/session-application'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')

type Run = { code: number | null; out: string; err: string }

function sessionDir(home: string, id: string): string {
  const project = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: pkgRoot, encoding: 'utf8' }).trim())
  return join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
}

function writeSession(home: string, id: string, parent: string | null): string {
  const dir = sessionDir(home, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: pkgRoot, branch: `node/${id}`, node: 'session-reparent',
    title: id, name: '', parent: parent ?? '', status: 'active', proposal: '', merges: 0, note: '', sortkey: '',
    createdAt: Date.now(), harness: 'opencode', harness_session_id: '', stopped: false, archived: false,
    launcher: 'fixture', launch_cmd: 'true', launch_owner: '',
  }, null, 2) + '\n')
  return dir
}

function watchers(dir: string): { watcher: string; createdAt: string; sources?: string[] }[] {
  const path = join(dir, 'watchers.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : []
}

function parentOf(dir: string): string | null {
  const raw = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'))
  return raw.parent || null
}

function pendingFrom(dir: string): string[] {
  const path = join(dir, 'pending.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).map((entry: { from?: string | null }) => entry.from ?? '') : []
}

function timelineText(dir: string): string {
  const legacy = join(dir, 'timeline.ndjson')
  const segments = join(dir, 'timeline')
  const files = [
    ...(existsSync(legacy) ? [legacy] : []),
    ...(existsSync(segments) ? readdirSync(segments).filter((name) => /^\d+\.ndjson$/.test(name)).sort().map((name) => join(segments, name)) : []),
  ]
  return files.map((path) => readFileSync(path, 'utf8')).join('')
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

async function waitFor(check: () => Promise<boolean>, message: string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  const child = spawn(process.execPath, [tsxCli, cli, ...args], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const port = await freePort()
  const oldParent = 'reparent-old-parent'
  const newParent = 'reparent-new-parent'
  const childA = 'reparent-child-a'
  const childB = 'reparent-child-b'
  const childADir = writeSession(home, childA, oldParent)
  const childBDir = writeSession(home, childB, oldParent)
  writeSession(home, oldParent, null)
  writeSession(home, newParent, null)
  writeFileSync(join(childADir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent', 'manual'] }]) + '\n')
  writeFileSync(join(childBDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
  writeFileSync(join(childADir, 'pending.json'), JSON.stringify([{ mid: 'old-parent-command', text: 'stale continue', from: oldParent }]) + '\n')
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(await freePort()) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const backend = spawn(process.execPath, [tsxCli, cli, 'serve', '--port', String(port)], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  backend.stderr.setEncoding('utf8').on('data', (chunk) => { log += chunk })
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok === true, `backend did not become healthy: ${log}`)
    const online = await runCli(['session', 'reparent', childA, childB, '--to', newParent, '--api', `http://127.0.0.1:${port}`], env)
    assert.equal(online.code, 0, online.err)
    assert.match(online.out, new RegExp(`reparented .*${newParent}`))
    assert.equal(parentOf(childADir), newParent)
    assert.deepEqual(watchers(childADir), [
      { watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['manual'] },
      { watcher: newParent, createdAt: watchers(childADir)[1].createdAt, sources: ['parent'] },
    ])
    assert.equal(parentOf(childBDir), newParent)
    assert.deepEqual(watchers(childBDir).map((entry) => [entry.watcher, entry.sources]), [[newParent, ['parent']]])
    const oldParentTimelineBefore = timelineText(sessionDir(home, oldParent))
    const newParentTimelineAtHandoff = timelineText(sessionDir(home, newParent))
    assert.match(newParentTimelineAtHandoff, new RegExp(childA), 'reparent delivers the first child current-state snapshot')
    assert.match(newParentTimelineAtHandoff, new RegExp(childB), 'reparent delivers an already-working child current-state snapshot')
    const manualWatchState = await runCli(['session', 'done', '--propose', 'merge', '--session', childA, '--api', `http://127.0.0.1:${port}`], env)
    assert.equal(manualWatchState.code, 0, manualWatchState.err)
    await waitFor(async () => timelineText(sessionDir(home, oldParent)).length > oldParentTimelineBefore.length,
      'the former parent\'s overlapping manual watch must survive reparent')
    await waitFor(async () => timelineText(sessionDir(home, newParent)).length > newParentTimelineAtHandoff.length,
      'the new parent must receive a later non-working child transition')
    assert.match(timelineText(sessionDir(home, oldParent)), /review/)
    assert.deepEqual(pendingFrom(childADir), [], 'a moved child does not retain an undelivered command from its former supervisor')
    const newParentTimeline = timelineText(sessionDir(home, newParent))
    assert.match(newParentTimeline, new RegExp(childA))
    assert.match(newParentTimeline, new RegExp(childB))
    assert.match(newParentTimeline, /review/)

    writeFileSync(join(childADir, 'pending.json'), JSON.stringify([{ mid: 'new-parent-command', text: 'stale continue', from: newParent }]) + '\n')
    const detached = await fetch(`http://127.0.0.1:${port}/api/sessions/reparent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ children: [childA], parent: null }),
    })
    assert.equal(detached.status, 200)
    assert.deepEqual(await detached.json(), { children: [childA], parent: null, notified: [] })
    assert.equal(parentOf(childADir), null)
    assert.deepEqual(watchers(childADir), [
      { watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['manual'] },
    ], 'detaching removes only the former parent source')
    assert.deepEqual(pendingFrom(childADir), [], 'detaching revokes an undelivered command from the former parent')

    await stop(backend)
    const childCDir = writeSession(home, 'reparent-child-c', oldParent)
    writeFileSync(join(childCDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
    const local = await runCli(['session', 'reparent', 'reparent-child-c', '--to', newParent], env)
    assert.equal(local.code, 0, local.err)
    assert.match(local.err, /reparenting in-process/)
    assert.equal(parentOf(childCDir), newParent)
    assert.deepEqual(watchers(childCDir).map((entry) => [entry.watcher, entry.sources]), [[newParent, ['parent']]])

    const childDDir = writeSession(home, 'reparent-child-d', oldParent)
    writeFileSync(join(childDDir, 'watchers.json'), JSON.stringify([{ watcher: oldParent, createdAt: '2026-08-04T00:00:00.000Z', sources: ['parent'] }]) + '\n')
    const remote = await runCli(['session', 'reparent', 'reparent-child-d', '--to', newParent, '--api', `http://127.0.0.1:${await freePort()}`], env)
    assert.equal(remote.code, 1)
    assert.match(remote.err, /no backend reachable/)
    assert.equal(parentOf(childDDir), oldParent)
    assert.deepEqual(watchers(childDDir).map((entry) => [entry.watcher, entry.sources]), [[oldParent, ['parent']]])
  } finally {
    await stop(backend)
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
  writeFileSync(`${databasePath}.json-migration.json`, '{}\n')
  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_API_URL: '', PORT: String(port) }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete env[key]
  const backend = spawn(process.execPath, [tsxCli, cli, 'serve', '--port', String(port)], { cwd: pkgRoot, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  backend.stderr.setEncoding('utf8').on('data', chunk => { log += chunk })
  try {
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`).catch(() => null))?.ok === true, `backend did not become healthy: ${log}`)
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/reparent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ children: [child], parent: newParent }),
    })
    assert.equal(response.status, 200, await response.text())
    const replay = await fetch(`http://127.0.0.1:${port}/api/session-runtime/${child}/replay`)
    assert.equal(replay.status, 200)
    assert.equal((await replay.json() as { parentSessionId: string | null }).parentSessionId, newParent)
    const board = await fetch(`http://127.0.0.1:${port}/api/sessions?all=1`)
    assert.equal(board.status, 200)
    const boardChild = (await board.json() as Array<{ id: string; parent: string | null }>).find(row => row.id === child)
    assert.equal(boardChild?.parent, newParent)
  } finally {
    await stop(backend)
    rmSync(home, { recursive: true, force: true })
  }
})
