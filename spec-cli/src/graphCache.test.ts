import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const project = mkdtempSync(join(tmpdir(), 'spex-graph-cache-'))
const home = mkdtempSync(join(tmpdir(), 'spex-graph-cache-home-'))
const bin = mkdtempSync(join(tmpdir(), 'spex-graph-cache-bin-'))
const trigger = join(bin, 'hang')
const permitTrigger = join(bin, 'permit-hang')
const permitRelease = join(bin, 'permit-release')
const shim = join(bin, 'git')
const argvLog = join(bin, 'argv.log')
const pidLog = join(bin, 'pids.log')
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const run = (...args: string[]) => execFileSync(realGit, ['-C', project, ...args], { encoding: 'utf8' })

run('init', '-q', '-b', 'main')
run('config', 'user.email', 'test@example.com')
run('config', 'user.name', 'test')
mkdirSync(join(project, '.spec', 'project'), { recursive: true })
writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: Fixture\nstatus: active\n---\n\nFixture body.\n')
run('add', '-A')
run('commit', '-qm', 'fixture')
writeFileSync(shim, `#!/bin/sh
printf '%s %s\\n' "$$" "$*" >> "${argvLog}"
printf '%s\\n' "$$" >> "${pidLog}"
if [ -e "${trigger}" ]; then
  for arg in "$@"; do
    if [ "$arg" = "log" ] || [ "$arg" = "rev-list" ]; then
      while :; do sleep 1; done
    fi
  done
fi
if [ -e "${permitTrigger}" ]; then
  while [ ! -e "${permitRelease}" ]; do sleep 0.02; done
fi
exec "${realGit}" "$@"
`)
chmodSync(shim, 0o755)
process.env.PATH = `${bin}:${process.env.PATH || ''}`
process.env.SPEXCODE_HOME = home
process.env.SPEXCODE_TMUX = 'spex-graph-cache-test'
process.env.SPEXCODE_BOARD_BUILD_TIMEOUT_MS = '1000'
process.env.SPEXCODE_BOARD_RETRY_BACKOFF_MS = '50'
process.env.SPEXCODE_GIT_TIMEOUT_MS = '5000'
delete process.env.SPEXCODE_API_URL
process.chdir(project)

const cache = await import('./graphCache.js')
const graph = await import('./graph.js')
const git = await import('./git.js')

// Production graph-cache always lives behind a referenced server socket. Keep the fixture at that same
// lifecycle altitude so its deliberately-unref'ed background-start timer can run before test teardown.
const backendLifetime = setInterval(() => {}, 60_000)
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function descendants(root: number): number[] {
  const out: number[] = []
  const visit = (pid: number) => {
    let raw = ''
    try { raw = readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8') } catch { return }
    for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
      const child = Number(token)
      out.push(child)
      visit(child)
    }
  }
  visit(root)
  return out
}
function shimPids(): number[] {
  if (!existsSync(pidLog)) return []
  return readFileSync(pidLog, 'utf8').split(/\s+/).filter(Boolean).map(Number).filter((pid) => existsSync(`/proc/${pid}`))
}
function hungHistoryPids(): number[] {
  if (!existsSync(argvLog)) return []
  return readFileSync(argvLog, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
    const [pid, ...args] = line.split(' ')
    return args.some((arg) => arg === 'log' || arg === 'rev-list') && existsSync(`/proc/${pid}`) ? [Number(pid)] : []
  })
}

test('dirty stale readers are immediate while one fresh flight owns completion', { concurrency: false }, async () => {
  rmSync(trigger, { force: true })
  cache.invalidateBoard('full')
  const warm = await cache.getBoard()
  assert.equal(warm.nodes.length, 1)
  await delay(100)

  const [quietPatrolA, quietPatrolB] = await Promise.all([cache.patrolBoard(), cache.patrolBoard()])
  assert.equal(quietPatrolA, warm, 'an unchanged patrol must return the cached board object, not rebuild it')
  assert.equal(quietPatrolB, warm, 'concurrent patrol callers must join the same validation flight')

  run('commit', '-q', '--allow-empty', '-m', 'move head before wedge')
  writeFileSync(trigger, 'hang\n')
  cache.invalidateBoard('full')
  const started = performance.now()
  const stale = await cache.getBoardJson('stale-ok')
  assert.ok(performance.now() - started < 100, 'stale HTTP read did not return immediately')
  assert.equal(stale.freshness, 'stale')
  assert.equal(stale.refreshing, true)
  assert.equal(stale.json, JSON.stringify(warm))

  const spawnDeadline = Date.now() + 500
  while (hungHistoryPids().length === 0 && Date.now() < spawnDeadline) await delay(10)
  assert.ok(hungHistoryPids().length > 0, `wedge fixture did not spawn a hung history child; argv=${existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : '<none>'}`)
  rmSync(trigger, { force: true })
  await assert.rejects(cache.getBoard(), (error: unknown) => /did not settle|aborting|aborted/i.test(String((error as Error)?.message || error)))
  await delay(250)
  assert.equal(shimPids().length, 0, 'watchdog left a git child running')
  // No second invalidation: the failed producer itself restores the full scope it consumed.
  const recovered = await cache.getBoard()
  assert.equal(recovered.nodes.length, 1)
  assert.equal((await cache.getBoardJson('fresh')).freshness, 'fresh')

  // No invalidateBoard call: this is the patrol's self-heal case, as if a healthy-looking worktree watcher
  // silently missed an ordinary spec edit. A fresh reader arriving during validation joins that flight; a
  // stale-ok reader may return immediately but must say that the refresh is still unresolved.
  const specPath = join(project, '.spec', 'project', 'spec.md')
  writeFileSync(specPath, '---\ntitle: Fixture repaired by patrol\nstatus: active\n---\n\nFixture body.\n')
  const patrolRepair = cache.patrolBoard()
  const staleDuringValidation = await cache.getBoardJson('stale-ok')
  const freshDuringValidation = cache.getBoard()
  assert.equal(staleDuringValidation.freshness, 'stale')
  assert.equal(staleDuringValidation.refreshing, true)
  assert.equal(staleDuringValidation.json, JSON.stringify(recovered))
  const repaired = await patrolRepair
  assert.equal(await freshDuringValidation, repaired, 'a fresh read must join the patrol validation/producer flight')
  assert.notEqual(repaired, recovered, 'a changed patrol revision must not reuse the old board object')
  assert.equal(repaired.nodes[0].title, 'Fixture repaired by patrol')

  // Restoring mtime and size must not defeat the repair fingerprint. ctime is non-user-settable and records
  // this same-length edit even after utimes puts the visible modification time back.
  const oldStat = statSync(specPath)
  const sameLength = readFileSync(specPath, 'utf8').replace('repaired', 'restored')
  writeFileSync(specPath, sameLength)
  utimesSync(specPath, oldStat.atime, oldStat.mtime)
  const restored = await cache.patrolBoard()
  assert.equal(restored.nodes[0].title, 'Fixture restored by patrol')

  await graph.buildBoard()
  const before = git.historyCacheStats()
  run('commit', '-q', '--allow-empty', '-m', 'profile head one')
  await graph.buildBoard()
  run('commit', '-q', '--allow-empty', '-m', 'profile head two')
  await graph.buildBoard()
  const after = git.historyCacheStats()
  assert.ok(after.historyHeads <= before.historyHeads + 1, `history heads retained: ${JSON.stringify({ before, after })}`)
  assert.ok(after.driftHeads <= before.driftHeads + 1, `drift heads retained: ${JSON.stringify({ before, after })}`)
  assert.ok(after.historyRoots <= 1 && after.driftRoots <= 1, `fixture root slots grew: ${JSON.stringify(after)}`)
})

test('one graph build bounds git spawn fanout and abort removes queued work', { concurrency: false }, async () => {
  rmSync(trigger, { force: true })
  rmSync(permitRelease, { force: true })
  writeFileSync(permitTrigger, 'hang\n')
  const before = existsSync(argvLog) ? readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).length : 0
  const controller = new AbortController()
  const calls = git.BOARD_GIT_CONCURRENCY + 7
  const run = git.withGitAbortSignal(controller.signal, () => Promise.all(
    Array.from({ length: calls }, () => git.gitA(['-C', project, 'rev-parse', 'HEAD'])),
  ))

  const spawnDeadline = Date.now() + 1000
  while (shimPids().length < git.BOARD_GIT_CONCURRENCY && Date.now() < spawnDeadline) await delay(10)
  assert.equal(shimPids().length, git.BOARD_GIT_CONCURRENCY, 'graph build spawned beyond its permit capacity')
  await delay(100)
  const spawned = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).length - before
  assert.equal(spawned, git.BOARD_GIT_CONCURRENCY, 'queued git work spawned before acquiring a permit')

  controller.abort()
  await assert.rejects(run, (error: unknown) => (error as Error)?.name === 'AbortError')
  const reapDeadline = Date.now() + 1000
  while (shimPids().length && Date.now() < reapDeadline) await delay(10)
  assert.equal(shimPids().length, 0, 'abort left an active git child')
  await delay(50)
  const afterAbort = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean).length - before
  assert.equal(afterAbort, git.BOARD_GIT_CONCURRENCY, 'an aborted queued waiter spawned after cancellation')

  rmSync(permitTrigger, { force: true })
  assert.ok((await git.gitA(['-C', project, 'rev-parse', 'HEAD'])).trim(), 'ordinary git remained blocked by the graph pool')
})

test.after(() => {
  clearInterval(backendLifetime)
  rmSync(project, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
  rmSync(bin, { recursive: true, force: true })
})
