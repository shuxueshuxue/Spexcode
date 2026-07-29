import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(cliRoot, 'node_modules')) ? root : sharedRoot
const tsxCli = join(dependencyRoot, 'spec-cli', 'node_modules', 'tsx', 'dist', 'cli.mjs')
const dependencyDashboardRoot = join(dependencyRoot, 'spec-dashboard')
const dependencyModules = join(dependencyDashboardRoot, 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-close-freshness-e2e')
const sessionId = 'close-freshness-target'

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await read()) return
    await new Promise((done) => setTimeout(done, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((done) => setTimeout(() => done(false), 3_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-close-freshness-'))
const project = join(fixture, 'project')
const worktree = join(fixture, 'target-worktree')
const home = join(fixture, 'home')
const branch = 'node/close-freshness-target'
const recordDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', sessionId)
const started = Date.now()
const events = []
const step = (label) => events.push({ at: Date.now() - started, step: label })

let backend
let viteServer
let browser
let context
let page
let failure = null
let backendLog = ''
try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: close freshness fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')
  git(project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main')
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(join(recordDir, 'session.json'), JSON.stringify({
    session_id: sessionId, governed: true, worktree_path: worktree, branch,
    node: '', title: 'close freshness target', name: '', parent: '', status: 'launch-queued', proposal: '',
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
      PORT: String(apiPort),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: `spex-close-freshness-${process.pid}`,
      SPEXCODE_DISABLE_WATCHERS: 'store,worktrees,refs',
      SPEXCODE_BOARD_DEBUG: '1',
      SPEXCODE_API_URL: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += String(chunk) })
  backend.stderr.on('data', (chunk) => { backendLog += String(chunk) })
  await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((r) => r.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(dependencyModules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(dependencyModules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  viteServer = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(dependencyModules, 'react'),
      'react-dom': join(dependencyModules, 'react-dom'),
      '@xyflow/react': join(dependencyModules, '@xyflow', 'react'),
      katex: join(dependencyModules, 'katex'),
      'markdown-it': join(dependencyModules, 'markdown-it'),
      '@xterm/xterm': join(dependencyModules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(dependencyModules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } } },
  })
  await viteServer.listen()
  await waitFor(() => fetch(base).then((r) => r.ok).catch(() => false), 'isolated dashboard')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })

  await page.goto(`${base}/#/sessions/${sessionId}`, { waitUntil: 'domcontentloaded' })
  const row = page.locator(`.si-item[data-sid="${sessionId}"]`)
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  await waitFor(() => /graph watcher 'store' disabled/.test(backendLog) && /graph watcher 'worktrees' disabled/.test(backendLog), 'disabled board watchers')
  await page.screenshot({ path: join(out, 'before-close.png'), fullPage: true })
  step('row visible with board watchers disabled')

  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /^close$/i }).click()
  const confirm = page.getByRole('dialog', { name: /close/i })
  await confirm.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(out, 'close-confirm.png'), fullPage: true })
  const [response] = await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname === `/api/sessions/${sessionId}/close` && r.request().method() === 'POST'),
    confirm.locator('button.sess-rename-btn.danger').click(),
  ])
  assert.equal(response.ok(), true, 'close response must succeed before freshness is measured')
  const responseAt = Date.now()
  step('close response received')
  await row.waitFor({ state: 'detached', timeout: 2_000 })
  const removedInMs = Date.now() - responseAt
  assert.ok(removedInMs <= 2_000, `closed row took ${removedInMs}ms to leave the live dashboard`)
  assert.ok(browserErrors.every((message) => /404 \(Not Found\)/.test(message)), `unexpected browser errors: ${browserErrors.join('\n')}`)
  await page.screenshot({ path: join(out, 'after-close.png'), fullPage: true })
  step(`row removed from dashboard in ${removedInMs}ms`)
} catch (error) {
  failure = error
  step(`failure: ${String(error?.message || error)}`)
  if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  const video = page?.video()
  await context?.close().catch(() => {})
  const videoPath = video ? await video.path().catch(() => null) : null
  await browser?.close().catch(() => {})
  await viteServer?.close().catch(() => {})
  await stop(backend)
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2) + '\n')
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: !failure, error: failure ? String(failure.stack || failure) : null, video: videoPath, backendLog }, null, 2) + '\n')
  rmSync(fixture, { recursive: true, force: true })
}

if (failure) throw failure
console.log(JSON.stringify({ ok: true, out }))
