import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The browser leg of [[session-console]]'s latency contract. It uses the real route, stream, dashboard and
// persisted record; only the repository/session population is isolated so the A/B/C/D clock has one owner.
const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(cliRoot, 'node_modules')) ? root : sharedRoot
const tsxCli = join(dependencyRoot, 'spec-cli', 'node_modules', 'tsx', 'dist', 'cli.mjs')
const modules = join(dependencyRoot, 'spec-dashboard', 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-state-push-latency-e2e')
const sessionId = 'session-state-push-target'
const sseBudgetMs = Number(process.env.SPEXCODE_SESSION_PUSH_SSE_BUDGET_MS || 200)
const domBudgetMs = Number(process.env.SPEXCODE_SESSION_PUSH_DOM_BUDGET_MS || 100)

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!Number.isFinite(sseBudgetMs) || !Number.isFinite(domBudgetMs)) throw new Error('session push budgets must be finite milliseconds')

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 5_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 3_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const readRecord = (path) => JSON.parse(readFileSync(path, 'utf8'))
const hasRecordName = (path, name) => {
  try { return readRecord(path).name === name } catch { return false }
}
const recordPersistedAt = (path, name) => {
  try { return readRecord(path).name === name ? Math.round(statSync(path).mtimeMs) : 0 } catch { return 0 }
}
const latencyTraces = (log) => [...log.matchAll(/spec-cli: graph latency (\{.+\})/g)].flatMap((match) => {
  try { return [JSON.parse(match[1])] } catch { return [] }
})
const isExpectedCatalogProbe = ({ method, status, url }) => {
  try { return method === 'GET' && status === 404 && new URL(url).pathname === '/projects' } catch { return false }
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-session-push-latency-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const recordDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', sessionId)
const recordPath = join(recordDir, 'session.json')
const started = Date.now()
const timeline = []
const mark = (step, extra = {}) => timeline.push({ atMs: Date.now() - started, step, ...extra })

let backend
let vite
let browser
let context
let page
let failure = null
let backendLog = ''
let video = null
const runs = []
const graphRequests = []
const graphResponses = []
const browserErrors = []
const httpFailures = []
const expectedCatalogProbes = []
const expectedCatalogConsoleErrors = []
try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: session push latency fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(recordPath, JSON.stringify({
    session_id: sessionId, governed: true, worktree_path: project, branch: 'main',
    node: '', title: 'Session push latency target', name: '', parent: '', status: 'active', proposal: '',
    merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude', harness_session_id: '',
    stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: 'true',
    launch_owner: 'http://fixture.invalid', create_request_id: '', create_payload_hash: '', launch_readiness_pending: null,
  }, null, 2) + '\n')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const base = `http://127.0.0.1:${uiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: {
      ...process.env,
      PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-session-push-${process.pid}`,
      SPEXCODE_BOARD_DEBUG: '1', SPEXCODE_BOARD_BACKGROUND_START_DELAY_MS: '0', SPEXCODE_API_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += String(chunk) })
  backend.stderr.on('data', (chunk) => { backendLog += String(chunk) })
  await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } } },
  })
  await vite.listen()
  await waitFor(() => fetch(base).then((response) => response.ok).catch(() => false), 'isolated dashboard')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  await context.addInitScript(() => {
    const NativeEventSource = window.EventSource
    window.__sessionPushFrames = []
    window.EventSource = class InstrumentedEventSource extends NativeEventSource {
      constructor(...args) {
        super(...args)
        for (const type of ['graph-full', 'graph-delta']) this.addEventListener(type, (event) => {
          window.__sessionPushFrames.push({ at: Date.now(), type, data: event.data })
        })
      }
    }
  })
  page = await context.newPage()
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/graph') graphRequests.push({ at: Date.now(), method: request.method(), url: request.url() })
  })
  page.on('response', async (response) => {
    const url = new URL(response.url())
    const failure = { at: Date.now(), method: response.request().method(), status: response.status(), url: response.url() }
    if (response.status() >= 400) {
      if (isExpectedCatalogProbe(failure)) expectedCatalogProbes.push(failure)
      else httpFailures.push(failure)
    }
    if (url.pathname !== '/api/graph') return
    graphResponses.push({ at: Date.now(), status: response.status(), url: response.url(), body: await response.text().catch(() => '') })
  })
  page.on('pageerror', (error) => browserErrors.push({
    kind: 'pageerror', text: String(error), location: error.stack || null,
  }))
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const entry = { kind: 'console', text: message.text(), location: message.location() }
    if (isExpectedCatalogProbe({ method: 'GET', status: 404, url: entry.location.url })) expectedCatalogConsoleErrors.push(entry)
    else browserErrors.push(entry)
  })

  await page.goto(`${base}/#/sessions/${sessionId}`, { waitUntil: 'domcontentloaded' })
  const row = page.locator(`.si-item[data-sid="${sessionId}"]`)
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  await waitFor(() => page.evaluate(() => window.__sessionPushFrames.length > 0), 'initial graph stream anchor')
  mark('dashboard and graph stream anchored')

  for (let index = 1; index <= 3; index++) {
    const target = `push-latency-${index}-${Date.now()}`
    const priorGraphRequests = graphRequests.length
    const priorGraphResponses = graphResponses.length
    const priorTraces = latencyTraces(backendLog).length
    let persistedAt = 0
    const recordWatcher = watch(recordPath, () => {
      if (!persistedAt) persistedAt = recordPersistedAt(recordPath, target)
    })
    try {
      await row.click({ button: 'right' })
      await page.locator('.sess-menu-item', { hasText: /rename/i }).click()
      const input = page.locator('.sess-rename-input')
      await input.waitFor({ state: 'visible' })
      await input.fill(target)
      const actionAt = Date.now()
      const [response] = await Promise.all([
        page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/sessions/${sessionId}/rename` && candidate.request().method() === 'POST'),
        page.locator('.sess-rename-save').click(),
      ])
      assert.equal(response.ok(), true, `rename ${index} must commit`)
      if (!persistedAt) persistedAt = recordPersistedAt(recordPath, target)
      await waitFor(() => persistedAt || (persistedAt = recordPersistedAt(recordPath, target)), `rename ${index} record persist`)
      const frame = await waitFor(() => page.evaluate((name) => window.__sessionPushFrames.find((entry) => entry.data.includes(name)) || null, target), `rename ${index} target SSE frame`)
      await row.filter({ hasText: target }).waitFor({ state: 'visible' })
      const domAt = Date.now()
      await new Promise((resolveWait) => setTimeout(resolveWait, 75))
      const stages = await waitFor(() => {
        const traces = latencyTraces(backendLog).slice(priorTraces)
        const signal = traces.find((trace) => trace.stage === 'sessions-signal' && trace.at >= actionAt)
        const projection = signal && traces.find((trace) => trace.stage === 'session-projection-complete' && trace.at >= signal.at)
        const broadcast = projection && traces.find((trace) => trace.stage === 'broadcast' && trace.at >= projection.at
          && trace.event === 'graph-delta' && trace.changedKeys?.includes(`sess:${sessionId}`))
        return signal && projection && broadcast ? { signal, projection, broadcast } : null
      }, `rename ${index} backend signal/projection/broadcast trace`)
      const actionGraphRequests = graphRequests.slice(priorGraphRequests).filter((request) => request.at >= actionAt)
      const actionGraphResponses = graphResponses.slice(priorGraphResponses).filter((response) => response.at >= actionAt)
      const targetHttp = actionGraphResponses.find((response) => response.body.includes(target))
      const run = {
        name: target,
        A_actionToPersistMs: persistedAt - actionAt,
        B_persistToSignalMs: stages.signal.at - persistedAt,
        C_signalToProjectionMs: stages.projection.at - stages.signal.at,
        D_projectionCompleteToBrowserSseMs: frame.at - stages.projection.at,
        transport_broadcastToBrowserSseMs: frame.at - stages.broadcast.at,
        persistToBrowserSseMs: frame.at - persistedAt,
        sseToDomMs: domAt - frame.at,
        E_actionToDomMs: domAt - actionAt,
        sseType: frame.type,
        rawDelta: frame.data,
        backendStages: stages,
        successfulActionGraphRequests: actionGraphRequests,
        successfulActionGraphResponses: actionGraphResponses.map(({ at, status, url }) => ({ at, status, url })),
      }
      run.verdict = {
        rawDelta: frame.type === 'graph-delta',
        targetHttpAfterSse: !targetHttp || frame.at < targetHttp.at,
        sseBudget: run.persistToBrowserSseMs <= sseBudgetMs,
        domBudget: run.sseToDomMs <= domBudgetMs,
      }
      runs.push(run)
      mark('rename pushed', run)
    } finally {
      recordWatcher.close()
    }
  }
  assert.equal(new Set(runs.map((run) => run.name)).size, 3, 'each real rename must produce its own visible projection')
  const badRuns = runs.filter((run) => Object.values(run.verdict).some((value) => !value))
  assert.equal(badRuns.length, 0, `rename distribution failed: ${JSON.stringify(badRuns)}`)
  assert.ok(expectedCatalogProbes.length > 0, 'single-project boot must classify the real /projects 404 as catalog=absent')
  assert.deepEqual(httpFailures, [], `unexpected HTTP failures: ${JSON.stringify(httpFailures)}`)
  assert.deepEqual(browserErrors, [], `unexpected browser console/page errors: ${JSON.stringify(browserErrors)}`)
  await page.screenshot({ path: join(out, 'session-console-final.png'), fullPage: true })
  mark('captured final console state')
} catch (error) {
  failure = error
  mark('failure', { error: String(error?.stack || error) })
  await page?.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  video = page?.video() || null
  await context?.close().catch(() => {})
  const videoPath = video ? await video.path().catch(() => null) : null
  await browser?.close().catch(() => {})
  await vite?.close().catch(() => {})
  await stop(backend)
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 1, axis: 'time', events: timeline }, null, 2) + '\n')
  writeFileSync(join(out, 'result.json'), JSON.stringify({
    ok: !failure, error: failure ? String(failure.stack || failure) : null, video: videoPath,
    terminalImage: join(out, 'session-console-final.png'), budgets: { sseBudgetMs, domBudgetMs },
    runs, graphRequests, graphResponses, latencyTraces: latencyTraces(backendLog),
    browserErrors, httpFailures, expectedCatalogProbes, expectedCatalogConsoleErrors, backendLog,
  }, null, 2) + '\n')
  rmSync(fixture, { recursive: true, force: true })
}

if (failure) throw failure
console.log(JSON.stringify({ ok: true, out }))
