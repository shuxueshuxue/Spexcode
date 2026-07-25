import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  appendFileSync,
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
    if (Date.now() >= deadline) assert.fail(`SSE did not stay quiet for ${quietMs}ms`)
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
    ...process.env,
    PORT: String(port),
    SPEXCODE_HOME: spexHome,
    SPEXCODE_TMUX: 'spex-graph-stream-api-test',
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
    for (let read = 0; read < 3; read++) {
      const graph = await fetch(`${base}/api/graph`)
      assert.equal(graph.status, 200)
      await graph.arrayBuffer()
    }
    assert.equal(inotifyCount(child.pid!), baselineWatches, 'unchanged graph reads must reuse the same watch set')

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
    }
  } catch (error) {
    assert.fail(`${error instanceof Error ? error.stack : String(error)}\nevents:\n${eventTimeline.join('\n')}\nserver log:\n${serverLog}`)
  } finally {
    abort.abort()
    await streamRead?.catch(() => {})
    await stopChild(child)
    rmSync(fixture, { recursive: true, force: true })
  }
})
