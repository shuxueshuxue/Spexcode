import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitFor(predicate: () => boolean | Promise<boolean>, message: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await predicate()) {
    if (Date.now() >= deadline) assert.fail(message)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function waitForQuiet(events: string[], quietMs: number, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let count = events.length
  let quietSince = Date.now()
  while (Date.now() - quietSince < quietMs) {
    if (Date.now() >= deadline) assert.fail(`SSE did not stay quiet for ${quietMs}ms; events: ${events.join(', ')}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
    if (events.length !== count) {
      count = events.length
      quietSince = Date.now()
    }
  }
}

function inotifyCount(pid: number): number | null {
  const dir = `/proc/${pid}/fdinfo`
  if (!existsSync(dir)) return null
  let count = 0
  for (const file of readdirSync(dir)) {
    try { count += readFileSync(join(dir, file), 'utf8').match(/^inotify wd:/gm)?.length ?? 0 }
    catch { /* fd closed between enumeration and read */ }
  }
  return count
}

// The backend's own census, read off its debug log. /proc/<pid>/fdinfo only exists on Linux, so a plateau
// assertion that depends on it is VACUOUS on the platform where the registration budget actually bites —
// the census is the cross-platform reading of the same fact.
function census(log: string): { sources: number; registrations: number } | null {
  const line = [...log.matchAll(/graph watchers — sources=(\d+) registrations=(\d+)/g)].at(-1)
  return line ? { sources: Number(line[1]), registrations: Number(line[2]) } : null
}

// A liveness probe that dies by signal is a probe FAILURE ([[sessions]]): every session then reads
// `unknown`, never a false `offline`, so every linked worktree is one the graph must observe. That is the
// state an overloaded adopter box is in, and it is what puts every worktree on the watcher budget at once.
function fakeTmuxDir(fixture: string): string {
  const bin = join(fixture, 'bin')
  mkdirSync(bin, { recursive: true })
  const tmux = join(bin, 'tmux')
  writeFileSync(tmux, '#!/bin/sh\nkill -9 $$\n')
  chmodSync(tmux, 0o755)
  return bin
}

function writeSessionRecord(spexHome: string, project: string, id: string, worktreePath: string, branch: string): void {
  const enc = project.replace(/[/.]/g, '-')
  const dir = join(spexHome, 'projects', enc, 'sessions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: worktreePath, branch,
    node: null, title: '', name: '', parent: null, status: 'active', proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude',
    harness_session_id: '', launcher: 'fixture', launch_cmd: 'true',
  }, null, 2) + '\n')
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = once(child, 'exit')
  const timedOut = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test('backend watcher plateaus and delivers three consecutive ref changes exactly once', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-graph-stream-api-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  mkdirSync(dirname(spec), { recursive: true })
  mkdirSync(join(project, 'src', 'nested'), { recursive: true })
  writeFileSync(spec, [
    '---',
    'title: project',
    'status: active',
    'hue: 180',
    'desc: graph stream fixture',
    '---',
    '# project',
    '',
    '## raw source',
    '',
    'Fixture.',
    '',
    '## expanded spec',
    '',
    'Fixture graph.',
    '',
  ].join('\n'))
  writeFileSync(join(project, 'src', 'nested', 'value.ts'), 'export const value = 1\n')
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    // a private tmux socket name, or the fixture backend probes the BOX's real sessions and their moving
    // pane titles push a 'sessions' change every warm tick — the quiet window would be measuring the
    // machine, not the fixture. Keyed by port so two runs on one box cannot share a socket either.
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: spexHome,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_TMUX: `spex-graph-stream-api-test-${port}`,
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_DISABLE_WATCHERS
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
    cwd: project,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  child.stdout?.on('data', (chunk) => { serverLog += String(chunk) })
  child.stderr?.on('data', (chunk) => { serverLog += String(chunk) })
  const base = `http://127.0.0.1:${port}`
  const abort = new AbortController()
  let streamRead: Promise<void> | null = null
  const events: string[] = []
  const eventTimeline: string[] = []

  try {
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      `backend did not become healthy:\n${serverLog}`)
    const initial = await fetch(`${base}/api/graph`)
    assert.equal(initial.status, 200)
    await initial.arrayBuffer()

    const response = await fetch(`${base}/api/graph/stream`, { signal: abort.signal })
    assert.equal(response.status, 200)
    assert.ok(response.body)
    streamRead = (async () => {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffered += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffered.indexOf('\n\n')) >= 0) {
          const block = buffered.slice(0, boundary)
          buffered = buffered.slice(boundary + 2)
          const event = block.split('\n').find((line) => line.startsWith('event: '))?.slice(7)
          if (event) {
            events.push(event)
            eventTimeline.push(`${Date.now()}: ${event}`)
          }
        }
      }
    })().catch((error) => {
      if (!abort.signal.aborted) throw error
    })
    await waitFor(() => events.includes('ready'), 'plain SSE did not become ready')
    await waitForQuiet(events, 1_500)

    const baselineWatches = inotifyCount(child.pid!)
    const baselineCensus = census(serverLog)
    assert.ok(baselineCensus, `the backend never reported its watcher census:\n${serverLog}`)
    for (let read = 0; read < 3; read++) {
      const graph = await fetch(`${base}/api/graph`)
      assert.equal(graph.status, 200)
      await graph.arrayBuffer()
    }
    assert.equal(inotifyCount(child.pid!), baselineWatches, 'unchanged graph reads must reuse the same watch set')
    assert.deepEqual(census(serverLog), baselineCensus, 'unchanged graph reads must not move the census')

    for (let round = 1; round <= 3; round++) {
      const before = events.filter((event) => event === 'graph-changed').length
      appendFileSync(spec, `round ${round}\n`)
      git(project, 'add', '.spec/project/spec.md')
      git(project, 'commit', '-qm', `round ${round}`)
      await waitFor(() => events.filter((event) => event === 'graph-changed').length === before + 1,
        `commit ${round} did not produce exactly one graph change`)
      await new Promise((resolve) => setTimeout(resolve, 80))
      assert.equal(events.filter((event) => event === 'graph-changed').length, before + 1,
        `commit ${round} produced overlapping graph change events`)

      const stale = await fetch(`${base}/api/graph`)
      assert.equal(stale.headers.get('x-spexcode-graph'), 'stale, refreshing')
      await stale.arrayBuffer()
      await waitFor(async () => {
        const graph = await fetch(`${base}/api/graph`)
        await graph.arrayBuffer()
        return graph.headers.get('x-spexcode-graph') === 'fresh'
      }, `commit ${round} never returned to fresh`)
      assert.equal(inotifyCount(child.pid!), baselineWatches, `commit ${round} changed the stable watch set`)
      assert.deepEqual(census(serverLog), baselineCensus, `commit ${round} changed the stable census`)
    }
    assert.equal(/graph watcher '.*' failed/.test(serverLog), false, `a healthy run registers cleanly:\n${serverLog}`)
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nserver log:\n${serverLog}`)
  } finally {
    abort.abort()
    await streamRead?.catch(() => {})
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})

// The second half of the adopter incident: once a source is refused, whatever NOTICES the failure must not
// be what retries it. Here one live worktree's tree is gone, so its attach can only fail; the graph is then
// read repeatedly. A per-read reattach would re-walk every worktree per request — that is how one refused
// registration became a storm that held gigabytes.
test('a refused watcher source fails loud once and repairs on a bounded schedule, never per read', { timeout: 40_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-graph-stream-hold-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  mkdirSync(dirname(spec), { recursive: true })
  writeFileSync(spec, [
    '---', 'title: project', 'status: active', 'hue: 180', 'desc: watcher hold fixture', '---',
    '# project', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture graph.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  // a real linked worktree, registered in .git/worktrees, whose working tree we then delete: git's
  // birth-ledger still lists it, so the graph must observe it, and every attach can only fail.
  const gone = join(fixture, 'gone')
  git(project, 'worktree', 'add', '-q', '-b', 'node/gone', gone)
  const entry = readdirSync(join(project, '.git', 'worktrees'))[0]
  rmSync(gone, { recursive: true, force: true })
  writeSessionRecord(spexHome, project, '11111111-1111-4111-8111-111111111111', gone, 'node/gone')

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: spexHome,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_TMUX: `spex-fixture-${port}`,
    PATH: `${fakeTmuxDir(fixture)}:${process.env.PATH}`,
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_DISABLE_WATCHERS
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  child.stdout?.on('data', (chunk) => { serverLog += String(chunk) })
  child.stderr?.on('data', (chunk) => { serverLog += String(chunk) })
  const base = `http://127.0.0.1:${port}`

  const failures = (): string[] => serverLog.match(/graph watcher '[^']*' failed at [^\n]*/g) ?? []
  const repairs = (): string[] => serverLog.match(/graph watcher repair — \d+ source\(s\) held[^\n]*/g) ?? []

  try {
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      `backend did not become healthy:\n${serverLog}`)
    // the sources attach on the first graph read — that is when the refusal happens
    await (await fetch(`${base}/api/graph`)).arrayBuffer()
    await waitFor(() => failures().length > 0, `the missing worktree was never reported:\n${serverLog}`, 10_000)

    const loud = failures()[0]
    assert.match(loud, new RegExp(`worktree:${entry}|${gone.replace(/[/\\]/g, '.')}`),
      'the failure must name its source and path')
    assert.match(loud, /ENOENT/, 'the failure must name the errno')

    const repairsAfterFirstFailure = repairs().length
    for (let read = 0; read < 12; read++) {
      const graph = await fetch(`${base}/api/graph`)
      assert.equal(graph.status, 200, 'a held source must not take the graph down')
      await graph.arrayBuffer()
    }
    assert.equal(failures().length, 1, `a refused source is loud ONCE, not once per read:\n${failures().join('\n')}`)
    assert.ok(repairs().length - repairsAfterFirstFailure <= 2,
      `12 reads must not each schedule a repair:\n${repairs().join('\n')}`)

    // the schedule backs off rather than hammering: successive repairs name strictly growing delays
    await waitFor(() => repairs().length >= 3, `the repair schedule stalled:\n${serverLog}`)
    const delays = repairs().map((line) => Number(line.match(/retrying in (\d+)ms/)![1]))
    for (let i = 1; i < delays.length; i++)
      assert.ok(delays[i] > delays[i - 1], `repair delays must back off, got ${delays.join(',')}`)

    // and the source recovers on its own once the tree is back: the repair pass attaches it, the census
    // gains that root, and no further failure is reported — no restart, no operator step.
    const sourcesHeld = census(serverLog)?.sources ?? 0
    const failuresBeforeRecovery = failures().length
    mkdirSync(gone, { recursive: true })
    await waitFor(() => (census(serverLog)?.sources ?? 0) > sourcesHeld,
      `the held source never reattached after its tree came back:\n${serverLog}`, 30_000)
    assert.equal(failures().length, failuresBeforeRecovery, 'recovery must not add a failure line')
    assert.ok((await fetch(`${base}/health`)).ok, 'the server survives the whole episode')
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nserver log:\n${serverLog}`)
  } finally {
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})

// Coverage may degrade to the patrol's cadence; it may never degrade to silence. With the refs leaf
// deliberately blinded, a real commit reaches no leaf watcher — the cold tick must still land it AND say
// it repaired something, because a repair means a leaf went blind and repairs are supposed to be zero.
test('a blinded leaf still reaches the graph through a loud patrol repair', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-graph-stream-patrol-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  mkdirSync(dirname(spec), { recursive: true })
  writeFileSync(spec, [
    '---', 'title: project', 'status: active', 'hue: 180', 'desc: patrol fixture', '---',
    '# project', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture graph.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: spexHome,
    SPEXCODE_TMUX: `spex-fixture-${port}`,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_BOARD_BUDGET_MS: '0',
    SPEXCODE_DISABLE_WATCHERS: 'refs',
  }
  delete env.SPEXCODE_API_URL
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  child.stdout?.on('data', (chunk) => { serverLog += String(chunk) })
  child.stderr?.on('data', (chunk) => { serverLog += String(chunk) })
  const base = `http://127.0.0.1:${port}`
  const abort = new AbortController()
  let streamRead: Promise<void> | null = null
  const frames: string[] = []

  try {
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      `backend did not become healthy:\n${serverLog}`)
    // the patrol is delta-gated: it only runs while a delta subscriber holds the chain
    const response = await fetch(`${base}/api/graph/stream?mode=delta`, { signal: abort.signal })
    assert.equal(response.status, 200)
    streamRead = (async () => {
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffered += decoder.decode(value, { stream: true })
        let boundary: number
        while ((boundary = buffered.indexOf('\n\n')) >= 0) {
          const block = buffered.slice(0, boundary)
          buffered = buffered.slice(boundary + 2)
          const event = block.split('\n').find((line) => line.startsWith('event: '))?.slice(7)
          if (event) frames.push(event)
        }
      }
    })().catch((error) => { if (!abort.signal.aborted) throw error })
    await waitFor(() => frames.includes('graph-full'), `the delta subscriber never anchored:\n${serverLog}`)
    assert.match(serverLog, /graph watcher 'refs' disabled/, 'the injection must announce itself')

    // let the startup fires (each poller's first sample) drain: ANY rebuild sees everything, so a
    // concurrent 'sessions' fire would absorb the commit and the patrol would have nothing left to repair.
    await waitForQuiet(frames, 2_000)

    // Cross one unchanged cold tick first. With budget=0 every producer is visible in the log; validation
    // itself must not add one. This is the exact production regression: the old patrol rebuilt here every 15s.
    const buildCount = () => (serverLog.match(/\/api\/graph build took/g) ?? []).length
    const buildsBeforeQuietPatrol = buildCount()
    await new Promise((resolve) => setTimeout(resolve, 17_000))
    assert.equal(buildCount(), buildsBeforeQuietPatrol,
      `an unchanged patrol ran a board producer:\n${serverLog}`)
    assert.doesNotMatch(serverLog, /PATROL-REPAIR/, 'an unchanged patrol cannot report a repair')

    // a real commit: with refs blinded no leaf watcher can see it (the main checkout is not a linked worktree)
    const framesBefore = frames.length
    appendFileSync(spec, '\nA commit no leaf watcher will see.\n')
    git(project, 'add', '.spec/project/spec.md')
    git(project, 'commit', '-qm', 'blinded round')

    await waitFor(() => /PATROL-REPAIR/.test(serverLog),
      `the patrol never reported the repair it had to make:\n${serverLog}`, 60_000)
    assert.match(serverLog, /PATROL-REPAIR .*changed units: \[[^\]]+\]/, 'the repair must name the diverged units')
    assert.ok(buildCount() > buildsBeforeQuietPatrol, 'the changed patrol revision must run one real producer')
    assert.ok(frames.length > framesBefore, 'the blinded change still reached the subscriber')
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nframes:\n${frames.join(', ')}\nserver log:\n${serverLog}`)
  } finally {
    abort.abort()
    await streamRead?.catch(() => {})
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})

// A blinded leaf must be blind from EVERY entry point. Reconciliation is reached from the liveness poller
// and from registry events too, so gating only the ensure pass left the per-worktree observers attaching
// anyway — the injection reads as applied while the leaf still sees everything, which would quietly make
// the patrol's accountability untestable.
test('disabling the worktree leaf blinds it from every entry point', { timeout: 60_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-graph-stream-blind-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  mkdirSync(dirname(spec), { recursive: true })
  writeFileSync(spec, [
    '---', 'title: project', 'status: active', 'hue: 180', 'desc: blind fixture', '---',
    '# project', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture graph.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  const worktree = join(fixture, 'live')
  git(project, 'worktree', 'add', '-q', '-b', 'node/live', worktree)
  writeSessionRecord(spexHome, project, '33333333-3333-4333-8333-333333333333', worktree, 'node/live')

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: spexHome,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_TMUX: `spex-blind-${port}`,
    SPEXCODE_DISABLE_WATCHERS: 'worktrees',
    // the liveness probe fails, so every session reads `unknown` and its worktree is one the graph would
    // otherwise observe — exactly the state that used to slip past the injection through the poller
    PATH: `${fakeTmuxDir(fixture)}:${process.env.PATH}`,
  }
  delete env.SPEXCODE_API_URL
  const child = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverLog = ''
  child.stdout?.on('data', (chunk) => { serverLog += String(chunk) })
  child.stderr?.on('data', (chunk) => { serverLog += String(chunk) })
  const base = `http://127.0.0.1:${port}`
  const abort = new AbortController()

  try {
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      `backend did not become healthy:\n${serverLog}`)
    // a delta subscriber starts the liveness pollers, which is the entry point that used to slip through
    const response = await fetch(`${base}/api/graph/stream?mode=delta`, { signal: abort.signal })
    assert.equal(response.status, 200)
    void response.body!.getReader().read().catch(() => {})
    await (await fetch(`${base}/api/graph`)).arrayBuffer()
    await waitFor(() => /graph watcher 'worktrees' disabled/.test(serverLog),
      `the injection never announced itself:\n${serverLog}`)

    // give the pollers several ticks to try to reconcile behind the injection's back
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    for (let read = 0; read < 3; read++) await (await fetch(`${base}/api/graph`)).arrayBuffer()
    await new Promise((resolve) => setTimeout(resolve, 1_500))

    assert.equal(/\(worktree:/.test(serverLog), false,
      `a blinded leaf must register no worktree observer:\n${serverLog}`)
    assert.equal(/\(worktree-index:/.test(serverLog), false,
      `a blinded leaf must register no worktree index observer:\n${serverLog}`)
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nserver log:\n${serverLog}`)
  } finally {
    abort.abort()
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})
