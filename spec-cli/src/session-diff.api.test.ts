import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { sessionStoreDir } from '@spexcode/spec-core'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()))
  return address.port
}

async function waitForHealth(base: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if ((await fetch(`${base}/health`).catch(() => null))?.ok) return
    if (child.exitCode !== null) throw new Error(`backend exited early: ${log()}`)
    await new Promise((done) => setTimeout(done, 50))
  }
  throw new Error(`backend never became healthy: ${log()}`)
}

function record(id: string, worktreePath: string, branch: string): void {
  mkdirSync(sessionStoreDir(id), { recursive: true })
  writeFileSync(join(sessionStoreDir(id), 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: worktreePath, branch, title: 'diff API', name: '', parent: '',
    status: 'active', proposal: '', note: '', createdAt: Date.now(), harness: 'claude', harness_session_id: null,
  }) + '\n')
}

// The branch diff is a proof over commits: refs and objects are shared with the main checkout, so a session
// whose worktree directory is gone (landed and cleaned) must keep a provable diff as long as its branch ref
// survives, and a session whose branch ref is gone everywhere must refuse with a stable structured conflict —
// never an unhandled git ENOENT turning into an HTTP 500.
test('session diff anchors to refs: live worktree, removed worktree, and vanished branch all answer structurally', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-session-diff-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const liveWorktree = join(fixture, 'wt-live')
  const freshWorktree = join(fixture, 'wt-fresh')
  const port = await freePort()
  const previousCwd = process.cwd()
  const previousHome = process.env.SPEXCODE_HOME
  let backend: ChildProcess | null = null
  try {
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    writeFileSync(join(project, 'README.md'), 'fixture\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'diff@example.test')
    git(project, 'config', 'user.name', 'diff')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')

    // a live worktree with one unmerged commit
    git(project, 'worktree', 'add', '-q', '-b', 'node/diff-live', liveWorktree)
    writeFileSync(join(liveWorktree, 'live.txt'), 'live change\n')
    git(liveWorktree, 'add', '.')
    git(liveWorktree, 'commit', '-qm', 'live change')

    // a branch that never authored a commit, with uncommitted work: a tracked edit and an untracked add.
    // Its head is an ancestor of main exactly like a landed branch's — ancestry alone cannot separate them.
    git(project, 'worktree', 'add', '-q', '-b', 'node/diff-fresh', freshWorktree)
    writeFileSync(join(freshWorktree, 'README.md'), 'fixture\nedited but never committed\n')
    writeFileSync(join(freshWorktree, 'brand-new.txt'), 'untracked line one\nuntracked line two\n')

    // a landed branch whose worktree directory no longer exists: ref kept, head an ancestor of main
    git(project, 'checkout', '-q', '-b', 'node/diff-landed')
    writeFileSync(join(project, 'landed.txt'), 'landed change\n')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'landed change')
    const landedHead = git(project, 'rev-parse', 'node/diff-landed')
    git(project, 'checkout', '-q', 'main')
    git(project, 'merge', '-q', 'node/diff-landed')

    // A dispatched-worker shell carries live-session identity (SPEXCODE_PROJECT_ROOT, SPEX_SESSION_* …);
    // scrub it so the fixture backend serves the fixture project and its own store, never the operator's.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SPEXCODE_') || key.startsWith('SPEX_SESSION_')) delete process.env[key]
    }
    process.env.SPEXCODE_HOME = home
    process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
    process.chdir(project)
    record('live-diff-session', liveWorktree, 'node/diff-live')
    record('fresh-diff-session', freshWorktree, 'node/diff-fresh')
    record('landed-diff-session', join(fixture, 'gone-landed'), 'node/diff-landed')
    record('vanished-diff-session', join(fixture, 'gone-vanished'), 'node/diff-vanished')
    const { migrateJsonSessionRecords } = await import('@spexcode/session-application')
    migrateJsonSessionRecords({
      databasePath: join(home, 'sessions.sqlite'),
      recordsRoot: join(dirname(sessionStoreDir('live-diff-session'))),
      locality: () => {},
    })
    const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, PORT: String(port) }

    let log = ''
    // detached: the tsx wrapper leads its own process group, so teardown can kill the group — killing only
    // the wrapper orphans the actual server child (a leak this test shipped with once).
    backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'index.ts')], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitForHealth(base, backend, () => log)

    // live worktree: the existing contract is untouched
    const live = await fetch(`${base}/api/sessions/live-diff-session/diff`)
    assert.equal(live.status, 200, `live diff: ${await live.clone().text()}`)
    const liveBody = await live.json()
    assert.equal(liveBody.branch, 'node/diff-live')
    assert.equal(liveBody.branchState, 'open')
    assert.deepEqual(liveBody.files.map((file: { path: string }) => file.path), ['live.txt'])
    assert.equal(liveBody.working.readable, true)
    assert.deepEqual(liveBody.working.files, [])
    const livePatch = await fetch(`${base}/api/sessions/live-diff-session/diff?path=live.txt`).then((response) => response.json())
    assert.match(livePatch.files[0].patch, /\+live change/)

    // A branch that never authored a commit is an ancestor of main just like a landed one. It must be told
    // apart by its fork point, and its uncommitted work — tracked edit AND untracked add — must be readable.
    const fresh = await fetch(`${base}/api/sessions/fresh-diff-session/diff`)
    assert.equal(fresh.status, 200)
    const freshBody = await fresh.json()
    assert.equal(freshBody.branchState, 'no-commits', `a branch with no commits of its own must not be reported merged: ${JSON.stringify(freshBody.branchState)}`)
    assert.deepEqual(freshBody.files, [])
    assert.equal(freshBody.working.readable, true)
    assert.deepEqual(
      freshBody.working.files.map((file: { path: string; status: string }) => `${file.status} ${file.path}`).sort(),
      ['modified README.md', 'untracked brand-new.txt'],
    )
    assert.equal(freshBody.working.files.find((file: { path: string }) => file.path === 'brand-new.txt').additions, 2)
    const trackedPatch = await fetch(`${base}/api/sessions/fresh-diff-session/diff?scope=working&path=README.md`).then((response) => response.json())
    assert.match(trackedPatch.working.files[0].patch, /\+edited but never committed/)
    const untrackedPatch = await fetch(`${base}/api/sessions/fresh-diff-session/diff?scope=working&path=brand-new.txt`).then((response) => response.json())
    assert.match(untrackedPatch.working.files[0].patch, /\+untracked line one/)

    // removed worktree, surviving branch ref: the diff stays provable from the shared main checkout,
    // and the merged state carries the real head id instead of a 500.
    const landed = await fetch(`${base}/api/sessions/landed-diff-session/diff`)
    assert.equal(landed.status, 200, `landed session diff must answer structurally, got ${landed.status}: ${await landed.clone().text()}`)
    const landedBody = await landed.json()
    assert.equal(landedBody.branchState, 'merged')
    assert.equal(landedBody.head, landedHead)
    assert.deepEqual(landedBody.files, [])
    // the worktree is gone, so the working tree is UNKNOWABLE — never a claim that it is clean, and never
    // the main checkout's own dirty files borrowed as this session's
    assert.equal(landedBody.working.readable, false)
    assert.deepEqual(landedBody.working.files, [])

    // a review conversation must be retractable: create one, take it back, and find the second retract
    // honestly refused rather than silently succeeding
    const created = await fetch(`${base}/api/sessions/live-diff-session/diff-comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'live.txt', lineStart: 1, lineEnd: 1, body: 'retract me', diffIdentity: 'x' }),
    }).then((response) => response.json())
    assert.equal(typeof created.id, 'string')
    const withComment = await fetch(`${base}/api/sessions/live-diff-session/diff`).then((response) => response.json())
    assert.deepEqual(withComment.comments.map((comment: { id: string }) => comment.id), [created.id])
    const retracted = await fetch(`${base}/api/sessions/live-diff-session/diff-comments/${created.id}`, { method: 'DELETE' })
    assert.equal(retracted.status, 200)
    assert.equal((await retracted.json()).body, 'retract me')
    const afterRetract = await fetch(`${base}/api/sessions/live-diff-session/diff`).then((response) => response.json())
    assert.deepEqual(afterRetract.comments, [])
    const again = await fetch(`${base}/api/sessions/live-diff-session/diff-comments/${created.id}`, { method: 'DELETE' })
    assert.equal(again.status, 404, 'retracting a row that is already gone must be refused, not silently accepted')

    // no worktree and no branch ref anywhere: a stable conflict, never an unhandled 500
    const vanished = await fetch(`${base}/api/sessions/vanished-diff-session/diff`)
    assert.equal(vanished.status, 409, `vanished branch must be a structured conflict, got ${vanished.status}: ${await vanished.clone().text()}`)
    const vanishedBody = await vanished.json()
    assert.equal(vanishedBody.code, 'diff-unavailable')
    assert.match(vanishedBody.error, /no longer exists/)
  } finally {
    if (backend?.pid) {
      try { process.kill(-backend.pid, 'SIGTERM') } catch { /* group already gone */ }
      await new Promise((done) => setTimeout(done, 500))
      try { process.kill(-backend.pid, 'SIGKILL') } catch { /* group already gone */ }
    }
    process.chdir(previousCwd)
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    rmSync(fixture, { recursive: true, force: true })
  }
})
