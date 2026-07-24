import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const project = mkdtempSync(join(tmpdir(), 'spex-graph-cache-'))
const home = mkdtempSync(join(tmpdir(), 'spex-graph-cache-home-'))
const bin = mkdtempSync(join(tmpdir(), 'spex-graph-cache-bin-'))
const trigger = join(bin, 'hang')
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

test('dirty stale readers are immediate while one fresh flight owns completion', { concurrency: false }, async () => {
  rmSync(trigger, { force: true })
  cache.invalidateBoard('full')
  const warm = await cache.getBoard()
  assert.equal(warm.nodes.length, 1)
  await delay(100)

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
  while (shimPids().length === 0 && Date.now() < spawnDeadline) await delay(10)
  assert.ok(shimPids().length > 0, `wedge fixture did not spawn a git child; argv=${existsSync(argvLog) ? readFileSync(argvLog, 'utf8') : '<none>'}`)
  rmSync(trigger, { force: true })
  await assert.rejects(cache.getBoard(), (error: unknown) => /did not settle|aborting|aborted/i.test(String((error as Error)?.message || error)))
  await delay(250)
  assert.equal(shimPids().length, 0, 'watchdog left a git child running')
  cache.invalidateBoard('full')
  const recovered = await cache.getBoard()
  assert.equal(recovered.nodes.length, 1)
  assert.equal((await cache.getBoardJson('fresh')).freshness, 'fresh')

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

test.after(() => {
  rmSync(project, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
  rmSync(bin, { recursive: true, force: true })
})
