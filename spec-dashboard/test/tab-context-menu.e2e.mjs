// YATU proof for [[tab-layout]]'s strip context menu: every workspace tab answers a right-click with the SAME
// tab menu — close, close others, send to split pane — whichever strip it sits in and whatever it holds.
// One isolated backend over a fixture repository and one real session created through the create route the
// dashboard uses (launcher `true`, so it costs nothing). The browser then does what a person does:
//   1. On the Sessions document, right-click the session tab: the tab menu, not the session's lifecycle menu.
//   2. Right-click the spec tab in that same strip: the identical menu.
//   3. The shell strip (a spec route) offers the identical menu on the session tab.
//   4. "Split right" moves the document into a second region, and a drag brings it back.
//   5. "Close others" on the session tab leaves only that tab.
//   6. The session row in the forest still opens the session's own lifecycle menu (rename lives there).
// Every scene screenshots before it judges, so the A side of a repair pair still leaves its picture.
// `SPEXCODE_DASHBOARD_ROOT` points Vite at another checkout of `spec-dashboard` (the A side is the old
// committed source); the backend stays current.
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
const dashboardRoot = resolve(process.env.SPEXCODE_DASHBOARD_ROOT || join(root, 'spec-dashboard'))
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? root : sharedRoot
const tsxCli = join(dependencyRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const modules = join(dependencyRoot, 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || join(tmpdir(), 'tab-context-menu-e2e'))

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 15_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
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

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const node = (title, desc, body) => ['---', `title: ${title}`, 'status: active', 'hue: 180', `desc: ${desc}`, '---', `# ${title}`, '', ...body, ''].join('\n')
const TAB_MENU = ['Close', 'Close others', 'Split right', 'Split down']

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'index.html'))) throw new Error(`not a dashboard root: ${dashboardRoot}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-tab-menu-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-tab-menu-${process.pid}`
let backend
let vite
let browser

try {
  mkdirSync(join(project, '.spec', 'fixture', 'alpha'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), node('fixture', 'tab menu fixture', ['Fixture root.']))
  writeFileSync(join(project, '.spec', 'fixture', 'alpha', 'spec.md'), node('alpha', 'a node to hold beside the session', ['Alpha is a document tab.']))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: 'true' } }, defaultLauncher: 'fixture' },
  }, null, 2))
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const api = `http://127.0.0.1:${apiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const created = await fetch(`${api}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `tab-menu-${process.pid}` },
    body: JSON.stringify({ prompt: 'hold a tab for the menu probe', name: 'menu-probe' }),
  })
  assert.equal(created.ok, true, 'create the probe session')
  const sessionId = (await created.json()).id
  await waitFor(async () => (await fetch(`${api}/api/graph`).then((response) => response.json())).sessions?.some((row) => row.id === sessionId), 'the session row')

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
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: api, ws: true } } },
  })
  await vite.listen()

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console.error: ${message.text()}`) })
  const base = `http://127.0.0.1:${uiPort}`
  const sessionKey = `#/sessions/${sessionId}`
  const hash = () => page.evaluate(() => location.hash)
  const present = (selector) => page.locator(`${selector}:visible`).count().then((n) => n > 0)
  const tabs = () => page.locator('[role="tab"][data-tab-key]:visible').evaluateAll((els) => els.map((el) => el.dataset.tabKey))
  const settle = (selector) => page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  const menuItems = async () => {
    if (!await settle('.sess-menu')) return []
    return page.locator('.sess-menu:visible [role="menuitem"]').evaluateAll((els) => els.map((el) => el.textContent.trim()))
  }
  const dismiss = async () => { await page.keyboard.press('Escape'); await page.locator('.sess-menu').waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {}) }
  const rightClickTab = async (key) => {
    await page.locator(`[role="tab"][data-tab-key="${key}"]:visible`).click({ button: 'right' })
    return menuItems()
  }
  const isTabMenu = (items) => JSON.stringify(items) === JSON.stringify(TAB_MENU)
  const scenes = []
  const scene = (name, pass, facts) => scenes.push({ scene: name, pass: !!pass, ...facts })

  await page.addInitScript(({ sessionKey: held }) => {
    if (sessionStorage.getItem('tab-menu-seeded')) return
    sessionStorage.setItem('tab-menu-seeded', '1')
    localStorage.clear()
    localStorage.setItem('spexcode.tabs.root', JSON.stringify([
      { page: 'spec', param: 'alpha', query: null },
      { page: 'sessions', param: held.slice('#/sessions/'.length), query: null },
    ]))
  }, { sessionKey })
  await page.goto(`${base}/${sessionKey}`, { waitUntil: 'domcontentloaded' })
  await settle(`.region [role="tab"][data-tab-key="${sessionKey}"]`)
  await page.waitForTimeout(600)

  // 1 — the session tab on the Sessions document
  const sessionTabItems = await rightClickTab(sessionKey)
  await page.screenshot({ path: join(out, '1-session-tab-menu.png') })
  scene('the session tab answers a right-click with the tab menu, not the session lifecycle menu',
    isTabMenu(sessionTabItems), { items: sessionTabItems, strip: 'the region holding it' })
  await dismiss()

  // 2 — the spec tab in the same strip
  const specTabItems = await rightClickTab('#/spec/alpha')
  await page.screenshot({ path: join(out, '2-spec-tab-menu.png') })
  scene('a spec tab in the same strip answers with the identical menu', isTabMenu(specTabItems)
    && JSON.stringify(specTabItems) === JSON.stringify(sessionTabItems), { items: specTabItems, sessionTabItems })
  await dismiss()

  // 3 — the shell strip on a spec route, same session tab
  await page.locator('[role="tab"][data-tab-key="#/spec/alpha"]:visible .tab-face').click()
  await waitFor(async () => await hash() === '#/spec/alpha' && await present('.region > .tabstrip'), 'spec route with the shell strip', 5_000)
  await page.waitForTimeout(400)
  const shellItems = await rightClickTab(sessionKey)
  await page.screenshot({ path: join(out, '3-shell-strip-session-tab.png') })
  scene('the shell strip offers the identical menu on the same session tab', isTabMenu(shellItems), { items: shellItems, hash: await hash() })
  await dismiss()

  // 4 — split: the session tab MOVES into a second region, and a drag brings it home again
  await page.locator(`[role="tab"][data-tab-key="${sessionKey}"]:visible`).first().click({ button: 'right' })
  const split = page.locator('.sess-menu:visible [role="menuitem"]', { hasText: 'Split right' })
  const splitOffered = await split.count() > 0
  if (splitOffered) await split.click()
  const splitShown = splitOffered && await waitFor(async () => (await page.locator('.region').count()) > 1, 'a second region', 8_000).catch(() => false)
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, '4-split-region.png') })
  const secondPane = splitShown ? await page.locator('.region').last().locator('.viewhost').first().getAttribute('class') : null
  const strippedTabs = await tabs()
  scene('split right MOVES the tab into a second region', splitShown && /view-sessions/.test(secondPane || '')
    && strippedTabs.filter((key) => key === sessionKey).length === 1,
    { secondPane, hash: await hash(), tabs: strippedTabs })

  // drag it back: the region it empties collapses, and the workspace is one region again
  const homeStrip = await page.locator('.region').first().locator('.tabstrip-tabs').boundingBox()
  const movingTab = await page.locator(`.region:last-child [role="tab"][data-tab-key="${sessionKey}"]`).first().boundingBox()
  if (homeStrip && movingTab) {
    await page.mouse.move(movingTab.x + movingTab.width / 2, movingTab.y + movingTab.height / 2)
    await page.mouse.down()
    await page.mouse.move(movingTab.x + movingTab.width / 2 + 12, movingTab.y + movingTab.height / 2, { steps: 3 })
    await page.mouse.move(homeStrip.x + homeStrip.width - 8, homeStrip.y + homeStrip.height / 2, { steps: 12 })
    await page.mouse.up()
  }
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '4b-dragged-home.png') })
  const regionsAfterDrag = await page.locator('.region').count()
  scene('dragging it back collapses the region it emptied', regionsAfterDrag === 1 && (await tabs()).includes(sessionKey),
    { regions: regionsAfterDrag, tabs: await tabs() })

  // 5 — close others, from the session tab on the Sessions document
  await page.locator(`[role="tab"][data-tab-key="${sessionKey}"]:visible .tab-face`).click()
  await settle(`.region [role="tab"][data-tab-key="${sessionKey}"]`)
  await page.waitForTimeout(400)
  await page.locator(`.region [role="tab"][data-tab-key="${sessionKey}"]`).click({ button: 'right' })
  const closeOthers = page.locator('.sess-menu:visible [role="menuitem"]', { hasText: /^Close others$/ })
  const closeOffered = await closeOthers.count() > 0
  if (closeOffered) await closeOthers.click()
  if (!closeOffered) await dismiss()
  const leftTabs = await waitFor(async () => { const held = await tabs(); return held.length === 1 ? held : null }, 'one tab left', 3_000).catch(() => null)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '5-close-others.png') })
  scene('close others on the session tab leaves only that tab', closeOffered && JSON.stringify(leftTabs) === JSON.stringify([sessionKey]),
    { tabs: await tabs(), hash: await hash() })

  // 6 — the session's lifecycle verbs still live on its forest row
  await page.locator(`.si-item[data-sid="${sessionId}"]`).first().click({ button: 'right' })
  const rowItems = await menuItems()
  await page.screenshot({ path: join(out, '6-forest-row-menu.png') })
  scene('the forest row still opens the session lifecycle menu', rowItems.some((item) => /rename/i.test(item)) && !isTabMenu(rowItems), { items: rowItems })
  await dismiss()

  const kept = scenes.filter((s) => s.pass).length
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors, sessionId }
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'no product errors in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} tab-menu scenes held`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
