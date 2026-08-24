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
const dashboardRoot = join(root, 'spec-dashboard')
// The test runs both from a repository checkout and from a nested worktree. Keep the
// dependency root tied to the checkout that owns this test instead of assuming /home/node_modules.
const gitCommonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim()
const checkoutRoot = resolve(dirname(gitCommonDir))
const dependencyRoot = existsSync(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? root : checkoutRoot
const modules = join(dependencyRoot, 'node_modules')
const tsxCli = join(dependencyRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const fakeLauncher = join(root, 'spec-cli', 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/home/jeffry/spexcode-evidence/ded4-workspace-refactor')
const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolvePort(port)) })
})
const waitFor = async (read, label, timeout = 90_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stop = async (child) => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 3000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-source-selection-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-source-selection-${process.pid}`
let backend
let vite
let browser
try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\ncode:\n  - src/fixture.js\n---\n\n# fixture\n\nGoverned fixture.\n')
  writeFileSync(join(project, 'src', 'fixture.js'), 'export function first() {\n  return 1\n}\n\nexport function second() {\n  return 2\n}\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' } }, null, 2))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const apiPort = await freePort()
  const uiPort = await freePort()
  backend = spawn(process.execPath, [tsxCli, join(root, 'spec-cli', 'src', 'index.ts')], {
    cwd: project, env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let backendLog = ''
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((r) => r.ok).catch(() => false), 'backend')
  } catch (error) {
    throw new Error(`${error.message}\n${backendLog}`)
  }

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot, configFile: false, plugins: [react()],
    resolve: { alias: [
      { find: '@spexcode/spec-core/review', replacement: join(modules, '@spexcode', 'spec-core', 'dist', 'review', 'index.js') },
      { find: '@spexcode/spec-core/identity', replacement: join(modules, '@spexcode', 'spec-core', 'dist', 'identity-presets.js') },
      { find: '@spexcode/spec-core', replacement: join(modules, '@spexcode', 'spec-core') },
      { find: 'react', replacement: join(modules, 'react') }, { find: 'react-dom', replacement: join(modules, 'react-dom') },
      { find: '@xyflow/react', replacement: join(modules, '@xyflow', 'react') }, { find: '@xterm/xterm', replacement: join(modules, '@xterm', 'xterm') },
      { find: '@xterm/addon-fit', replacement: join(modules, '@xterm', 'addon-fit') }, { find: 'katex', replacement: join(modules, 'katex') },
      { find: 'markdown-it', replacement: join(modules, 'markdown-it') },
    ] },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } } },
  })
  await vite.listen()
  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(() => localStorage.setItem('si.launcher', 'fake'))
  const page = await context.newPage()
  // Keep the target-filter proof deterministic: one dormant row must be rejected while an idle row is
  // accepted by the same backend-shaped footer-state contract the dashboard uses in production.
  const seededTargets = [
    { id: 'idle-fixture', label: 'idle fixture', headline: 'idle fixture', title: 'idle fixture', status: 'idle', lifecycle: 'idle', liveness: 'online', archived: false, created: 2 },
    { id: 'offline-fixture', label: 'offline fixture', headline: 'offline fixture', title: 'offline fixture', status: 'asking', lifecycle: 'asking', liveness: 'offline', archived: false, created: 1 },
  ]
  // The stream's authoritative full snapshot would otherwise replace the seeded HTTP fixture immediately;
  // this scenario is measuring the target list, so let the ordinary graph poll own the board snapshot.
  await page.route('**/api/graph/stream*', (route) => route.abort())
  await page.route('**/api/graph*', async (route) => {
    if (route.request().method() !== 'GET' || new URL(route.request().url()).pathname !== '/api/graph') return route.continue()
    const response = await route.fetch()
    const board = await response.json()
    if (!board || !Array.isArray(board.sessions)) return route.fulfill({ response })
    const existing = new Set(board.sessions.map((row) => row?.id))
    const merged = { ...board, sessions: [...board.sessions, ...seededTargets.filter((row) => !existing.has(row.id))] }
    return route.fulfill({ response, body: JSON.stringify(merged) })
  })
  await page.goto(`http://127.0.0.1:${uiPort}/#/spec/fixture`, { waitUntil: 'domcontentloaded' })
  await page.locator('.gov-f').first().waitFor({ state: 'visible', timeout: 90_000 })
  assert.equal(await page.locator('.specview-code').count(), 0, 'SpecView has no embedded source face')
  assert.equal(await page.locator('.specview-split').count(), 0, 'SpecView has no source divider')
  assert.equal(await page.locator('.specview .srcview').count(), 0, 'SpecView does not auto-mount SourceView')
  await page.screenshot({ path: join(out, 'm4-spec-prose-only.png'), fullPage: true })
  await page.locator('.gov-f').first().click()
  await waitFor(() => page.evaluate(() => location.hash === '#/file/src/fixture.js'), 'governed file route')
  await page.locator('.srcview .cm-line').nth(1).waitFor({ state: 'visible', timeout: 90_000 })
  const first = await page.locator('.srcview .cm-line').nth(1).boundingBox()
  const last = await page.locator('.srcview .cm-line').nth(4).boundingBox()
  assert.ok(first && last, 'source lines have screen bounds')
  await page.mouse.move(first.x + 4, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + Math.min(last.width - 2, 110), last.y + last.height / 2, { steps: 8 })
  await page.mouse.up()
  const actions = page.locator('.pa-group .pa-act')
  await actions.first().waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal(await actions.count(), 4, 'source selections use the shared four-action group')
  assert.equal(await page.locator('.srcview-select-action').count(), 0, 'the old one-button affordance is gone')
  await page.screenshot({ path: join(out, 'm4-source-selection-actions.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(50)
  assert.equal(await page.locator('.pa-group').count(), 0, 'Escape closes the source-selection action group')
  await page.mouse.move(first.x + 4, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + Math.min(last.width - 2, 110), last.y + last.height / 2, { steps: 8 })
  await page.mouse.up()
  await actions.first().waitFor({ state: 'visible', timeout: 10_000 })
  await page.mouse.click(last.x + Math.min(last.width - 2, 110), last.y + last.height / 2, { button: 'right' })
  const contextActions = page.locator('.pa-group .pa-act')
  await contextActions.first().waitFor({ state: 'visible', timeout: 10_000 })
  assert.deepEqual(await contextActions.allTextContents(), ['Send to Session', 'Edit & Send', 'Explain', 'Edit Manually'],
    'source right-click uses the same four-action group as a selection')
  await page.screenshot({ path: join(out, 'm4-source-selection-context-actions.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(50)
  await page.mouse.move(first.x + 4, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + Math.min(last.width - 2, 110), last.y + last.height / 2, { steps: 8 })
  await page.mouse.up()
  await actions.first().waitFor({ state: 'visible', timeout: 10_000 })
  await actions.filter({ hasText: 'Send to Session' }).click()
  const card = page.locator('.pa-send')
  await card.waitFor({ state: 'visible' })
  assert.match((await card.locator('.selection-attachment').textContent()) || '', /lines 2–5/)
  assert.match((await card.locator('.selection-attachment').textContent()) || '', /src\/fixture\.js/)
  await card.locator('.pa-input').fill('Please inspect the selected implementation.')
  const targetOptions = await card.locator('.pa-session-picker .session-picker-row').evaluateAll((rows) => rows.map((row) => ({ value: row.dataset.sessionPickerId, text: row.textContent })))
  assert.ok(targetOptions.some((option) => option.value === 'idle-fixture'), `idle session remains a dispatch target: ${JSON.stringify(targetOptions)}`)
  assert.equal(targetOptions.some((option) => option.value === 'offline-fixture'), false, 'offline session is not a dispatch target')
  await page.screenshot({ path: join(out, 'm4-selection-target-filter.png'), fullPage: true })
  await card.locator('.pa-session-picker .session-picker-row[data-session-picker-id="new"]').click()
  await page.screenshot({ path: join(out, 'm4-selection-send-card.png'), fullPage: true })
  const createRequest = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/sessions')
  await card.locator('.pa-btn').filter({ hasText: 'Send' }).click()
  assert.equal((await createRequest).postDataJSON()?.launcher, 'fake', 'direct create respects the remembered launcher')
  const created = await waitFor(async () => {
    const rows = await fetch(`http://127.0.0.1:${apiPort}/api/sessions?all=1`).then((r) => r.json())
    return rows.find((row) => row.promptPreview?.includes('Please inspect the selected implementation.')) || null
  }, 'direct session creation from source selection')
  assert.ok(created, 'source selection created a session through the ordinary create path')
  await waitFor(() => page.evaluate((id) => location.hash === `#/sessions/${id}`, created.id), 'created session route')
  await page.screenshot({ path: join(out, 'm4-selection-session-timeline.png'), fullPage: true })

  await page.goto(`http://127.0.0.1:${uiPort}/#/graph/fixture`, { waitUntil: 'domcontentloaded' })
  await page.locator('.react-flow__node').filter({ hasText: 'fixture' }).first().waitFor({ state: 'visible', timeout: 90_000 })
  await page.keyboard.press('i')
  await page.locator('.ov-panel .pane-doc .doc-body').waitFor({ state: 'visible', timeout: 90_000 })
  const bodyText = page.locator('.ov-panel .pane-doc .doc-body p').first()
  const bodyBox = await bodyText.boundingBox()
  assert.ok(bodyBox, 'popup prose has a selectable body block')
  await page.mouse.move(bodyBox.x + 4, bodyBox.y + bodyBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(bodyBox.x + Math.min(bodyBox.width - 2, 140), bodyBox.y + bodyBox.height / 2, { steps: 6 })
  await page.mouse.up()
  const popupActions = page.locator('.ov-panel .pa-group .pa-act')
  await popupActions.first().waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal(await popupActions.count(), 4, 'popup spec pane mounts the same four actions')
  await popupActions.filter({ hasText: 'Edit & Send' }).click()
  const popupCard = page.locator('.pa-send')
  await popupCard.waitFor({ state: 'visible' })
  await popupCard.locator('.pa-session-picker .session-picker-row[data-session-picker-id="new"]').click()
  await popupCard.locator('.pa-btn').filter({ hasText: 'Send' }).click()
  const popupCreated = await waitFor(async () => {
    const rows = await fetch(`http://127.0.0.1:${apiPort}/api/sessions?all=1`).then((r) => r.json())
    return rows.find((row) => row.id !== created.id) || null
  }, 'popup prose direct create')
  assert.ok(popupCreated, 'popup prose created a session with its selected body range')
  await waitFor(() => page.evaluate((id) => location.hash === `#/sessions/${id}`, popupCreated.id), 'popup created session route')
  await page.screenshot({ path: join(out, 'm4-popup-selection-session.png'), fullPage: true })
  await context.close()
  console.log(JSON.stringify({ ok: true, out, session: created.id }))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}
