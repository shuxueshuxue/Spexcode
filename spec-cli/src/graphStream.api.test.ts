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

function writeSessionRecord(spexHome: string, project: string, id: string, worktreePath: string, branch: string, status = 'active'): void {
  const enc = project.replace(/[/.]/g, '-')
  const dir = join(spexHome, 'projects', enc, 'sessions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id, governed: true, worktree_path: worktreePath, branch,
    node: null, title: '', name: '', parent: null, status, proposal: '',
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
test('a blinded leaf still reaches the graph through a loud patrol repair', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-graph-stream-patrol-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const sessionId = '66666666-6666-4666-8666-666666666666'
  const renamed = 'patrol projection must overtake full'
  const fullNodeId = 'patrol-structural-node'
  const hold = join(fixture, 'hold-patrol-full')
  const argvLog = join(fixture, 'patrol-git-argv.log')
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
  writeSessionRecord(spexHome, project, sessionId, project, 'main')

  const bin = join(fixture, 'bin')
  mkdirSync(bin, { recursive: true })
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  assert.ok(realGit, 'fixture could not resolve the real git binary')
  const shim = join(bin, 'git')
  writeFileSync(shim, `#!/bin/sh
printf '%s\\n' "$*" >> "${argvLog}"
if [ -e "${hold}" ]; then
  case " $* " in
    *" rev-parse --verify "*)
      printf 'HANG %s\\n' "$*" >> "${argvLog}"
      while [ -e "${hold}" ]; do sleep 0.01; done
      ;;
  esac
fi
exec "${realGit}" "$@"
`)
  chmodSync(shim, 0o755)

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: spexHome,
    SPEXCODE_TMUX: `spex-fixture-${port}`,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_BOARD_BUDGET_MS: '0',
    SPEXCODE_BOARD_BACKGROUND_START_DELAY_MS: '0',
    // This test intentionally holds one real producer through a second 15s cold tick. Keep the fixture
    // watchdog outside that causal window; it is not a product budget change.
    SPEXCODE_BOARD_BUILD_TIMEOUT_MS: '30000',
    SPEXCODE_DISABLE_WATCHERS: 'refs',
    PATH: `${bin}:${process.env.PATH || ''}`,
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
  const frames: Array<{ event: string; data: string; at: number }> = []
  const eventNames: string[] = []
  const heldTimeline = {
    fullHeldAt: 0,
    sessionFrameAt: 0,
    fullReleasedAt: 0,
    structuralBroadcastAt: 0,
    structuralFrameAt: 0,
  }

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
          if (event === 'graph-full' || event === 'graph-delta') {
            const data = block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
            frames.push({ event, data, at: Date.now() })
            eventNames.push(event)
          }
        }
      }
    })().catch((error) => { if (!abort.signal.aborted) throw error })
    await waitFor(() => eventNames.includes('graph-full'), `the delta subscriber never anchored:\n${serverLog}`)
    assert.match(serverLog, /graph watcher 'refs' disabled/, 'the injection must announce itself')

    // let the startup fires (each poller's first sample) drain: ANY rebuild sees everything, so a
    // concurrent 'sessions' fire would absorb the commit and the patrol would have nothing left to repair.
    await waitForQuiet(eventNames, 2_000)

    // Cross one unchanged cold tick first. With budget=0 every producer is visible in the log; validation
    // itself must not add one. This is the exact production regression: the old patrol rebuilt here every 15s.
    const buildCount = () => (serverLog.match(/\/api\/graph build took/g) ?? []).length
    const buildsBeforeQuietPatrol = buildCount()
    await new Promise((resolve) => setTimeout(resolve, 17_000))
    assert.equal(buildCount(), buildsBeforeQuietPatrol,
      `an unchanged patrol ran a board producer:\n${serverLog}`)
    assert.doesNotMatch(serverLog, /PATROL-REPAIR/, 'an unchanged patrol cannot report a repair')

    // a real commit: with refs blinded no leaf watcher can see it (the main checkout is not a linked worktree)
    const logBeforePatrol = serverLog.length
    const framesBefore = frames.length
    writeFileSync(hold, 'hold\n')
    const fullNode = join(project, '.spec', 'project', fullNodeId, 'spec.md')
    mkdirSync(dirname(fullNode), { recursive: true })
    writeFileSync(fullNode, [
      '---', 'title: Patrol Structural Node', 'status: active', 'hue: 195', 'desc: patrol held full', '---',
      `# ${fullNodeId}`, '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
    ].join('\n'))
    git(project, 'add', '.spec')
    git(project, 'commit', '-qm', 'blinded round')

    await waitFor(() => existsSync(argvLog) && /^HANG /m.test(readFileSync(argvLog, 'utf8'))
      && /graph patrol revision moved — scope=full/.test(serverLog),
    `the blinded patrol never entered the controlled full hold:\n${serverLog}`, 30_000)
    heldTimeline.fullHeldAt = Date.now()
    const buildsBeforeHeldPatrol = buildCount()

    const framesBeforeSession = frames.length
    const renameResponse = await fetch(`${base}/api/sessions/${sessionId}/rename`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: renamed }),
    })
    assert.equal(renameResponse.status, 200)
    assert.deepEqual(await renameResponse.json(), { ok: true })
    await waitFor(() => frames.slice(framesBeforeSession).some((frame) => frame.data.includes(renamed)),
      `the session projection waited for the patrol full release:\n${serverLog}`, 2_000)
    heldTimeline.sessionFrameAt = frames.slice(framesBeforeSession).find((frame) => frame.data.includes(renamed))!.at
    assert.equal(existsSync(hold), true, 'the session frame must overtake the held patrol full, not follow release')
    // Cross the following cold tick while the SAME patrol producer remains blocked. The tick may leave its
    // validation obligation owed, but it must not start a second structural producer or hold the session row.
    await new Promise((resolve) => setTimeout(resolve, 17_000))
    assert.equal(existsSync(hold), true, 'the controlled patrol producer must remain held across the second cold tick')
    assert.ok(Date.now() - heldTimeline.fullHeldAt >= 15_000,
      `the active patrol full did not span a full cold-tick interval: ${JSON.stringify(heldTimeline)}`)
    assert.equal(buildCount(), buildsBeforeHeldPatrol,
      `a second cold tick started another full while the controlled producer was held:\n${serverLog}`)
    heldTimeline.fullReleasedAt = Date.now()
    rmSync(hold, { force: true })

    await waitFor(() => frames.slice(framesBefore).some((frame) => frame.data.includes(fullNodeId)),
      `the released patrol full never reached SSE structural convergence:\n${serverLog}`, 10_000)
    heldTimeline.structuralFrameAt = frames.slice(framesBefore).find((frame) => frame.data.includes(fullNodeId))!.at
    let structuralBroadcast: { at?: number; stage?: string; sessionProjection?: boolean; tags?: string[]; changedKeys?: string[] } | undefined
    await waitFor(() => {
      structuralBroadcast = [...serverLog.matchAll(/spec-cli: graph latency (\{.+\})/g)]
        .flatMap((match) => { try { return [JSON.parse(match[1]) as { at?: number; stage?: string; sessionProjection?: boolean; tags?: string[]; changedKeys?: string[] }] } catch { return [] } })
        .find((trace) => trace.stage === 'broadcast' && trace.at && trace.at >= heldTimeline.fullReleasedAt
          && trace.tags?.includes('patrol') && trace.changedKeys?.some((key) => key === `node:${fullNodeId}` || key === 'nodes#order'))
      return !!structuralBroadcast?.at
    }, `the released patrol full had no server structural broadcast trace:\n${serverLog}`, 2_000)
    assert.ok(structuralBroadcast?.at, 'the bounded structural broadcast trace wait resolved without a timestamp')
    heldTimeline.structuralBroadcastAt = structuralBroadcast.at
    assert.ok(heldTimeline.sessionFrameAt < heldTimeline.fullReleasedAt && heldTimeline.sessionFrameAt < heldTimeline.structuralBroadcastAt,
      `the session projection did not overtake full release/completion: ${JSON.stringify(heldTimeline)}`)
    assert.ok(heldTimeline.structuralBroadcastAt >= heldTimeline.fullReleasedAt
      && heldTimeline.structuralFrameAt >= heldTimeline.structuralBroadcastAt,
    `structural server broadcast/frame preceded the controlled producer release: ${JSON.stringify(heldTimeline)}`)

    const fresh = await fetch(`${base}/api/graph`)
    assert.equal(fresh.status, 200)
    assert.equal(fresh.headers.get('x-spexcode-graph'), 'fresh', 'post-full API must not serve a stale session row')
    const freshBoard = await fresh.json() as { nodes?: Array<{ id?: string }>; sessions?: Array<{ id?: string; raw?: { name?: string | null } }> }
    assert.ok(freshBoard.nodes?.some((node) => node.id === fullNodeId), 'fresh API lost the completed full topology')
    assert.equal(freshBoard.sessions?.find((session) => session.id === sessionId)?.raw?.name, renamed,
      'fresh API rolled the completed full session row backward')

    await waitFor(() => /PATROL-REPAIR/.test(serverLog),
      `the patrol never reported the repair it had to make:\n${serverLog}`, 60_000)
    assert.match(serverLog, /PATROL-REPAIR .*changed units: \[[^\]]+\]/, 'the repair must name the diverged units')
    await waitForQuiet(eventNames, 1_000)
    assert.equal(buildCount(), buildsBeforeHeldPatrol + 1,
      `the second cold tick amplified the released patrol full into a successor producer:\n${serverLog}`)
    assert.ok(buildCount() > buildsBeforeQuietPatrol, 'the changed patrol revision must run one real producer')
    assert.ok(frames.length > framesBefore, 'the blinded change still reached the subscriber')
    const sessionFrames = frames.slice(framesBeforeSession)
    const sessionNames = sessionFrames.flatMap((frame) => {
      const payload = JSON.parse(frame.data) as { graph?: { sessions?: Array<{ id: string; raw?: { name?: string | null } }> }; set?: Record<string, { raw?: { name?: string | null } }> }
      const full = payload.graph?.sessions?.find((session) => session.id === sessionId)
      const delta = payload.set?.[`sess:${sessionId}`]
      return full || delta ? [(full ?? delta)?.raw?.name ?? null] : []
    })
    const firstNew = sessionNames.indexOf(renamed)
    assert.ok(firstNew >= 0, `no patrol SSE session unit carried the renamed value: ${JSON.stringify(sessionNames)}`)
    assert.ok(sessionNames.slice(firstNew).every((name) => name === renamed),
      `the released patrol full rolled session SSE backward: ${JSON.stringify(sessionNames)}`)
    const targetFrame = sessionFrames.findIndex((frame) => frame.data.includes(renamed))
    const structuralFrame = sessionFrames.findIndex((frame) => frame.data.includes(fullNodeId))
    assert.ok(targetFrame >= 0 && structuralFrame > targetFrame,
      `the target session frame must precede structural patrol convergence: ${JSON.stringify(sessionFrames)}`)
    const broadcasts = [...serverLog.slice(logBeforePatrol).matchAll(/graph broadcast .*triggers \{([^}]*)\}/g)]
      .map((match) => match[1].split(',').map((tag) => tag.trim()).filter(Boolean))
    const sessionBroadcasts = broadcasts.filter((tags) => tags.includes('sessions'))
    assert.equal(sessionBroadcasts.length, 1,
      `only the target rename may consume a sessions trigger in the patrol window: ${JSON.stringify(broadcasts)}`)
    const sessionsBroadcast = broadcasts.findIndex((tags) => tags.includes('sessions'))
    assert.ok(broadcasts.slice(sessionsBroadcast + 1).some((tags) => tags.includes('patrol')),
      `the session projection consumed patrol accountability before structural convergence: ${JSON.stringify(broadcasts)}`)
    assert.equal((serverLog.match(/PATROL-REPAIR/g) ?? []).length, 1,
      `the second cold tick reported a patrol successor instead of validating the completed board:\n${serverLog}`)
    if (process.env.SPEXCODE_PATROL_HOLD_TRACE === '1')
      console.log(`patrol-held-full ${JSON.stringify({ ...heldTimeline, activeFullMs: heldTimeline.structuralBroadcastAt - heldTimeline.fullHeldAt })}`)
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nheld timeline=${JSON.stringify(heldTimeline)}\nframes:\n${JSON.stringify(frames)}\nserver log:\n${serverLog}`)
  } finally {
    rmSync(hold, { force: true })
    abort.abort()
    await streamRead?.catch(() => {})
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('a failed refresh keeps watcher causes through patrol recovery', { timeout: 60_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-graph-stream-recovery-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const sessionId = '44444444-4444-4444-8444-444444444444'
  mkdirSync(dirname(spec), { recursive: true })
  writeFileSync(spec, [
    '---', 'title: Before failure', 'status: active', 'hue: 180', 'desc: recovery fixture', '---',
    '# project', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture graph.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')
  writeSessionRecord(spexHome, project, sessionId, project, 'main')

  const bin = join(fixture, 'bin')
  const hang = join(fixture, 'hang-history')
  const argvLog = join(fixture, 'git-argv.log')
  mkdirSync(bin, { recursive: true })
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  assert.ok(realGit, 'fixture could not resolve the real git binary')
  const shim = join(bin, 'git')
  writeFileSync(shim, `#!/bin/sh
printf '%s\\n' "$*" >> "${argvLog}"
if [ -e "${hang}" ]; then
  for arg in "$@"; do
    if [ "$arg" = "log" ] || [ "$arg" = "rev-list" ]; then
      printf 'HANG %s\\n' "$*" >> "${argvLog}"
      while :; do sleep 1; done
    fi
  done
fi
exec "${realGit}" "$@"
`)
  chmodSync(shim, 0o755)

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    PATH: `${bin}:${process.env.PATH || ''}`,
    SPEXCODE_HOME: spexHome,
    SPEXCODE_TMUX: `spex-recovery-${port}`,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_BOARD_BUDGET_MS: '0',
    SPEXCODE_BOARD_BUILD_TIMEOUT_MS: '1500',
    SPEXCODE_BOARD_RETRY_BACKOFF_MS: '100',
    SPEXCODE_GIT_TIMEOUT_MS: '5000',
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
  const abort = new AbortController()
  let streamRead: Promise<void> | null = null
  const frames: string[] = []
  const frameData: string[] = []

  try {
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      `backend did not become healthy:\n${serverLog}`)
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
          if (event) {
            frames.push(event)
            frameData.push(block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n'))
          }
        }
      }
    })().catch((error) => { if (!abort.signal.aborted) throw error })
    await waitFor(() => frames.includes('graph-full'), `the delta subscriber never anchored:\n${serverLog}`)
    await waitForQuiet(frames, 2_000)

    const logBeforeFailure = serverLog.length
    writeFileSync(hang, 'hang\n')
    writeFileSync(spec, readFileSync(spec, 'utf8').replace('Before failure', 'After recovery'))
    git(project, 'add', '.spec/project/spec.md')
    git(project, 'commit', '-qm', 'move graph input')
    await waitFor(() => existsSync(argvLog) && /HANG /.test(readFileSync(argvLog, 'utf8')),
      `the graph producer never entered the controlled wedge:\n${serverLog}`)

    const sessionPath = join(spexHome, 'projects', project.replace(/[/.]/g, '-'), 'sessions', sessionId, 'session.json')
    const record = JSON.parse(readFileSync(sessionPath, 'utf8'))
    record.name = 'Changed during failed flight'
    writeFileSync(sessionPath, JSON.stringify(record, null, 2) + '\n')

    await waitFor(() => /graph build did not settle .*aborting/.test(serverLog),
      `the board watchdog did not abort the wedged producer:\n${serverLog}`, 10_000)
    rmSync(hang, { force: true })
    const framesBeforeRecovery = frameData.length

    await waitFor(() => frameData.slice(framesBeforeRecovery).some((data) => data.includes('After recovery')),
      `the next patrol did not recover and broadcast the failed work:\n${serverLog}`, 25_000)
    const graph = await fetch(`${base}/api/graph`).then((result) => result.json()) as {
      nodes: Array<{ title: string }>
      sessions: Array<{ id: string; raw?: { name?: string } }>
    }
    assert.equal(graph.nodes[0]?.title, 'After recovery', 'the recovered stream swallowed the graph change')
    assert.equal(graph.sessions.find((session) => session.id === sessionId)?.raw?.name, 'Changed during failed flight',
      'the recovered stream swallowed the session event that arrived during the failed flight')
    assert.doesNotMatch(serverLog, /PATROL-REPAIR/,
      `a producer failure with healthy watcher causes is not a blind-watcher repair:\n${serverLog}`)
    const ledgers = [...serverLog.slice(logBeforeFailure).matchAll(/graph broadcast .*triggers \{([^}]*)\}/g)]
      .map((match) => match[1]!.split(',').map((tag) => tag.trim()).filter(Boolean))
    const sessionProjection = ledgers.findIndex((tags) => tags.includes('full') && tags.includes('sessions'))
    assert.ok(sessionProjection >= 0,
      `the successful session projection did not consume its own cause: ${JSON.stringify(ledgers)}`)
    const recovery = ledgers.findIndex((tags, index) => index > sessionProjection && tags.includes('full') && tags.includes('patrol'))
    assert.ok(recovery >= 0,
      `the later patrol recovery did not retain the structural obligation: ${JSON.stringify(ledgers)}`)
    assert.deepEqual([...new Set(ledgers[recovery])].sort(), ['full', 'patrol'],
      `the patrol recovery repeated the already-consumed session cause: ${JSON.stringify(ledgers[recovery])}`)
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nframes:\n${frames.join(', ')}\nserver log:\n${serverLog}`)
  } finally {
    rmSync(hang, { force: true })
    abort.abort()
    await streamRead?.catch(() => {})
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})

// A full graph flight is allowed to remain single-flight. It is not allowed to turn the close route's
// session deletion into its queue: a route-owned active full and a later lifecycle write owe two different
// pieces of work. This fixture holds a full-only layout revision. The graph, close mutation, GET route,
// and SSE transport are all the real production surfaces.
test('a closed session delta overtakes an active route-owned full cache flight', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-route-owned-flight-'))
  const project = join(fixture, 'project')
  const spexHome = join(fixture, 'home')
  const spec = join(project, '.spec', 'project', 'spec.md')
  const sessionId = '55555555-5555-4555-8555-555555555555'
  const sessionBranch = 'node/route-owned-close'
  const sessionWorktree = join(fixture, 'close-target-worktree')
  const fullNodeId = 'full-after-session'
  const hold = join(fixture, 'hold-history')
  const argvLog = join(fixture, 'git-argv.log')
  const timeline: string[] = []
  const mark = (event: string) => timeline.push(event)

  mkdirSync(dirname(spec), { recursive: true })
  writeFileSync(spec, [
    '---', 'title: Before route-owned full', 'status: active', 'hue: 180', 'desc: route-owned fixture', '---',
    '# project', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture graph.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')
  git(project, 'worktree', 'add', '-q', '-b', sessionBranch, sessionWorktree, 'main')
  writeSessionRecord(spexHome, project, sessionId, sessionWorktree, sessionBranch, 'queued')

  const bin = join(fixture, 'bin')
  mkdirSync(bin, { recursive: true })
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
  assert.ok(realGit, 'fixture could not resolve the real git binary')
  const shim = join(bin, 'git')
  writeFileSync(shim, `#!/bin/sh
printf '%s\\n' "$*" >> "${argvLog}"
if [ -e "${hold}" ]; then
  case " $* " in
    # Hold resolveLayout's main revision, not the close candidate's own branch preflight.
    *" rev-parse --verify main^{commit} "*)
      printf 'HANG %s\\n' "$*" >> "${argvLog}"
      while [ -e "${hold}" ]; do sleep 0.01; done
      ;;
  esac
fi
exec "${realGit}" "$@"
`)
  chmodSync(shim, 0o755)

  const port = await freePort()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    PATH: `${bin}:${process.env.PATH || ''}`,
    SPEXCODE_HOME: spexHome,
    SPEXCODE_TMUX: `spex-route-owned-${port}`,
    SPEXCODE_BOARD_DEBUG: '1',
    SPEXCODE_BOARD_BUDGET_MS: '0',
    SPEXCODE_BOARD_BACKGROUND_START_DELAY_MS: '0',
    SPEXCODE_BOARD_BUILD_TIMEOUT_MS: '10000',
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
  const frames: Array<{ event: string; data: string }> = []
  const eventNames: string[] = []

  const waitQuickly = async (predicate: () => boolean | Promise<boolean>, message: string, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs
    while (!await predicate()) {
      if (Date.now() >= deadline) assert.fail(message)
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
  }

  try {
    await waitFor(async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
      `backend did not become healthy:\n${serverLog}`)
    const stream = await fetch(`${base}/api/graph/stream?mode=delta`, { signal: abort.signal })
    assert.equal(stream.status, 200)
    streamRead = (async () => {
      const reader = stream.body!.getReader()
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
          if (event === 'graph-full' || event === 'graph-delta') {
            const data = block.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n')
            frames.push({ event, data })
            eventNames.push(event)
          }
        }
      }
    })().catch((error) => { if (!abort.signal.aborted) throw error })
    await waitFor(() => frames.some((frame) => frame.event === 'graph-full'), `the delta stream never anchored:\n${serverLog}`)
    await waitForQuiet(eventNames, 500)

    const fullWorktree = join(fixture, 'full-domain-worktree')
    writeFileSync(hold, 'hold\n')
    const fullNode = join(project, '.spec', 'project', fullNodeId, 'spec.md')
    mkdirSync(dirname(fullNode), { recursive: true })
    writeFileSync(fullNode, [
      '---', 'title: Full After Session', 'status: active', 'hue: 190', 'desc: held full fixture', '---',
      '# full-after-session', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
    ].join('\n'))
    git(project, 'worktree', 'add', '--detach', '-q', fullWorktree, 'HEAD')
    mark('created real worktree-registry full input')

    let stale: Response | null = null
    await waitQuickly(async () => {
      const response = await fetch(`${base}/api/graph`)
      const header = response.headers.get('x-spexcode-graph')
      await response.arrayBuffer()
      if (header !== 'stale, refreshing') return false
      stale = response
      return true
    }, `the GET route never owned a stale full flight:\n${serverLog}`, 1_000)
    assert.ok(stale, 'the stale GET response is the route-owned flight proof')
    mark('GET /api/graph returned stale, refreshing')

    await waitQuickly(() => existsSync(argvLog) && /^HANG /m.test(readFileSync(argvLog, 'utf8')),
      `the route-owned full never entered the controlled layout hold:\n${serverLog}`, 1_000)
    mark('route-owned full producer is held')
    await waitForQuiet(eventNames, 500)

    const renamed = 'renamed before close'
    const framesBeforeRename = frames.length
    const renameResponse = await fetch(`${base}/api/sessions/${sessionId}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: renamed }),
    })
    assert.equal(renameResponse.status, 200)
    assert.deepEqual(await renameResponse.json(), { ok: true })
    const carriesRename = (frame: { data: string }) => {
      const payload = JSON.parse(frame.data) as { set?: Record<string, { label?: string }>; graph?: { sessions?: Array<{ id: string; label?: string }> } }
      return payload.set?.[`sess:${sessionId}`]?.label === renamed
        || payload.graph?.sessions?.some((session) => session.id === sessionId && session.label === renamed) === true
    }
    await waitFor(() => frames.slice(framesBeforeRename).some(carriesRename),
      `the first session projection waited for releaseFull:\n${serverLog}`, 2_000)
    await waitForQuiet(eventNames, 100)

    const logBeforeClose = serverLog.length
    const framesBeforeClose = frames.length

    const closeResponse = await fetch(`${base}/api/sessions/${sessionId}/close`, { method: 'POST' })
    assert.equal(closeResponse.status, 200)
    assert.deepEqual(await closeResponse.json(), { ok: true })
    assert.equal(existsSync(sessionWorktree), false, 'the real close must retire its owned worktree')
    mark('POST /close committed session deletion')

    // Keep the full producer held until this assertion settles. This is a causal control, not a latency
    // threshold: the deleted session unit must arrive before releaseFull, whatever scheduler delay the host has.
    const deletesSession = (frame: { data: string }) => {
      const payload = JSON.parse(frame.data) as { del?: string[] }
      return payload.del?.includes(`sess:${sessionId}`) ?? false
    }
    await waitFor(() => frames.slice(framesBeforeClose).some(deletesSession),
      `the session projection/SSE waited for releaseFull; timeline=${JSON.stringify(timeline)}; frames=${JSON.stringify(frames.slice(framesBeforeClose))}; server=${serverLog}`,
      2_000)

    rmSync(hold, { force: true })
    mark('releaseFull')
    await waitFor(() => frames.slice(framesBeforeClose).some((frame) => frame.data.includes(fullNodeId)),
      `the held structural full never reached SSE after release:\n${serverLog}`, 5_000)
    await waitFor(async () => {
      const response = await fetch(`${base}/api/graph`)
      const graph = await response.json() as {
        nodes: Array<{ id: string }>
        sessions: Array<{ id: string }>
      }
      return response.headers.get('x-spexcode-graph') === 'fresh'
        && !graph.sessions.some((session) => session.id === sessionId)
        && graph.nodes.some((node) => node.id === fullNodeId)
    }, `the full completion rolled back the newer session projection:\n${serverLog}`, 5_000)
    const deletedAt = frames.findIndex(deletesSession)
    assert.ok(deletedAt >= 0, 'the close delete must be present before checking for a later resurrection')
    const resurrected = frames.slice(deletedAt + 1).flatMap((frame) => {
      const payload = JSON.parse(frame.data) as { graph?: { sessions?: Array<{ id: string }> }; set?: Record<string, unknown> }
      return payload.graph?.sessions?.some((session) => session.id === sessionId) || `sess:${sessionId}` in (payload.set ?? {})
        ? [frame.data] : []
    })
    assert.deepEqual(resurrected, [], `full completion rolled the closed session back into SSE: ${JSON.stringify(resurrected)}`)
    assert.equal(frames.slice(framesBeforeClose).filter(deletesSession).length, 1,
      'the same closed session projection broadcast twice')
    const broadcasts = [...serverLog.slice(logBeforeClose).matchAll(/graph broadcast .*triggers \{([^}]*)\}/g)]
      .map((match) => match[1].split(',').map((tag) => tag.trim()).filter(Boolean))
    const sessionBroadcast = broadcasts.findIndex((tags) => tags.includes('sessions'))
    assert.ok(sessionBroadcast >= 0, `the session projection had no attributable broadcast: ${JSON.stringify(broadcasts)}`)
    assert.ok(broadcasts.slice(sessionBroadcast + 1).some((tags) => tags.includes('full')),
      `the session projection consumed the full trigger before structural convergence: ${JSON.stringify(broadcasts)}`)
    if (process.env.SPEXCODE_ROUTE_OWNED_TRACE === '1')
      console.log(`route-owned-flight ${JSON.stringify({ timeline, closeDeletedBeforeRelease: true })}`)
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\ntimeline=${JSON.stringify(timeline)}\nframes=${JSON.stringify(frames)}\nserver log:\n${serverLog}`)
  } finally {
    rmSync(hold, { force: true })
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
