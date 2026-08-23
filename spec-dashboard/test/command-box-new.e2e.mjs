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
const dependencyRoot = existsSync(join(root, 'spec-dashboard', 'node_modules')) ? root : sharedRoot
const tsxCli = existsSync(join(root, 'spec-cli', 'node_modules', 'tsx', 'dist', 'cli.mjs'))
  ? join(root, 'spec-cli', 'node_modules', 'tsx', 'dist', 'cli.mjs')
  : join(sharedRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const modules = join(dependencyRoot, 'spec-dashboard', 'node_modules')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/command-box-new-e2e')
const events = []
let recordingStartedAt = null
const step = (name) => {
  assert.notEqual(recordingStartedAt, null, 'timeline steps require a recording start')
  events.push({ at: Date.now() - recordingStartedAt, step: name })
}

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 80))
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

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-command-box-new-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-command-box-new-${process.pid}`
let backend
let vite
let browser
let backendLog = ''

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\n# fixture\n\nfixture\n')
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const apiPort = await freePort()
  const uiPort = await freePort()
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '80' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')
  } catch (error) {
    throw new Error(`${error.message}\n${backendLog}`)
  }

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

  const api = `http://127.0.0.1:${apiPort}`
  const create = await fetch(`${api}/api/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'source session', launcher: 'fake' }),
  })
  const created = await create.json()
  assert.equal(create.status, 201, JSON.stringify(created))
  const { id: source } = created
  assert.ok(source, 'source session id')
  await waitFor(async () => {
    const session = await fetch(`${api}/api/sessions/${source}`).then((response) => response.json())
    return session.liveness === 'online'
  }, 'source session online')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: out, size: { width: 1280, height: 800 } },
  })
  const page = await context.newPage()
  recordingStartedAt = Date.now()
  await page.goto(`http://127.0.0.1:${uiPort}/#/sessions/${source}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-content').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
  await page.keyboard.press('Alt+i')
  await page.locator('.si-command-box').waitFor({ state: 'visible', timeout: 30_000 })
  step('open Command Box')
  const input = page.locator('.si-command-input')
  await input.waitFor({ state: 'visible' })
  await input.fill('@')
  const newWorker = page.locator('.si-command-box .mention-item.new', { hasText: '@new' }).first()
  await newWorker.waitFor({ state: 'visible' })
  await newWorker.click()
  step('choose @new')
  await page.waitForFunction(() => document.querySelector('.si-command-input')?.value === '@new:')
  const fakeLauncherRow = page.locator('.si-command-box .mention-item.new', { hasText: '@new:fake' }).first()
  await fakeLauncherRow.waitFor({ state: 'visible' })
  await fakeLauncherRow.click()
  step('choose launcher')
  const text = '@new:fake inspect the selected work ' + 'x '.repeat(80)
  assert.equal(await input.inputValue(), '@new:fake ')
  await input.fill(text)
  await page.locator('.si-command-send').click()
  step('submit worker request')
  const outcome = page.locator('.tn-notice.success', { hasText: 'new:fake' })
  await outcome.waitFor({ state: 'visible' })
  assert.match((await outcome.textContent()) || '', /new:fake.*->/)
  step('read spawned child receipt')

  await page.locator('.si-command-box').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  await page.keyboard.press('Alt+i')
  await page.waitForFunction(() => document.activeElement?.classList?.contains('si-command-input'))
  const secondText = '@new:fake verify notification stacking'
  await input.fill(secondText)
  await page.locator('.si-command-send').click()
  step('submit second worker request')
  await page.waitForFunction(() => document.querySelectorAll('.tn-notice.success').length >= 1)
  const stackedNotices = await page.locator('.tn-notice.success').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, width: rect.width, duration: getComputedStyle(node).getPropertyValue('--tn-duration') }
  }))
  assert.ok(stackedNotices.length >= 1)
  assert.ok(stackedNotices.every((notice) => notice.top >= 16 && notice.top < 100), `desktop notices start at the top-right edge: ${JSON.stringify(stackedNotices)}`)
  if (stackedNotices.length > 1) {
    assert.ok(stackedNotices.every((notice, index) => index === 0 || stackedNotices[index - 1].bottom <= notice.top), 'top-right notices do not overlap')
    assert.ok(stackedNotices.every((notice) => notice.width === stackedNotices[0].width), 'stacked notices share one width')
  }
  for (const notice of stackedNotices) assert.ok(Number.parseFloat(notice.duration) >= 5000 && Number.parseFloat(notice.duration) <= 14000)
  step('verify notice stack geometry')
  await page.locator('.si-command-box').waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  await page.screenshot({ path: join(out, 'command-box-new-spawned.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.keyboard.press('Alt+i')
  await page.keyboard.press('Alt+i')
  await page.waitForFunction(() => document.activeElement?.classList?.contains('si-command-input'))
  await input.fill('@new:fake mobile top-right notice ' + 'y '.repeat(80))
  await page.locator('.si-command-send').click()
  await page.locator('.tn-notice.success').last().waitFor({ state: 'visible', timeout: 15_000 })
  const mobileNotice = await page.locator('.tn-notice.success').last().evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return { bottom: rect.bottom, width: rect.width }
  })
  assert.ok(mobileNotice.width <= 370, `mobile notice width ${mobileNotice.width}`)
  assert.ok(mobileNotice.bottom < 844 / 2, `mobile notice remains in the top half ${mobileNotice.bottom}`)
  step('verify mobile notice placement')
  await page.screenshot({ path: join(out, 'command-box-new-mobile.png'), fullPage: true })

  const child = await waitFor(async () => {
    const sessions = await fetch(`${api}/api/sessions?all=1`).then((response) => response.json())
    return sessions.find((session) => session.parent === source && session.launcher === 'fake') || null
  }, 'child session spawned by Command Box')
  const sourceCapture = await fetch(`${api}/api/sessions/${source}/capture`).then((response) => response.text())
  const capturedInput = sourceCapture.replace(/\r?\n/g, '')
  assert.match(capturedInput, new RegExp(text))
  assert.match(capturedInput, new RegExp(secondText))
  assert.equal(child.parent, source)
  assert.equal(child.launcher, 'fake')

  const video = page.video()
  const recordingSpanMs = Date.now() - recordingStartedAt
  assert.ok(events.every(({ at }) => at >= 0 && at <= recordingSpanMs), 'timeline steps stay on the recorded video axis')
  await context.close()
  await video.saveAs(join(out, 'command-box-new.webm'))
  await browser.close()
  browser = null
  writeFileSync(join(out, 'result.json'), JSON.stringify({ source, child: child.id, launcher: child.launcher, text }, null, 2))
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
  console.log(JSON.stringify({ ok: true, out, source, child: child.id, video: join(out, 'command-box-new.webm') }))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
