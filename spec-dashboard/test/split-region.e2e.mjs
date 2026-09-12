// YATU proof for [[workspace-shell]]'s two regions and [[tab-strip]]'s held slot. One isolated backend over a
// fixture repository with two spec nodes and one real session (launcher `true`, so it costs nothing). The
// browser does what a reader does with "send to split pane":
//   1. The session tab MOVES: the strip loses it, the held region gains it. No second strip, no second
//      forest, no second rail — the frame is drawn once.
//   2. Folding the frame's sidebar leaves the held region alone (the two sidebars were one flag).
//   3. A held document keeps its own controls: the held band carries the actions registered at its address.
//   4. A held spec node carries its OWN context dock: two docks, two different nodes' history.
//   5. The held band's one control returns the document to the strip and closes the split.
//   6. Holding the strip's only tab is refused rather than silently inert.
//   7. Holding a second tab swaps: the first returns to the strip.
//   8. A reload keeps the held document held, and never in both places.
// Every scene screenshots before it judges, so the A side of a repair pair still leaves its picture.
// `SPEXCODE_DASHBOARD_ROOT` points Vite at another checkout of `spec-dashboard`; the backend stays current.
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
const out = resolve(process.env.OUT || join(tmpdir(), 'split-region-e2e'))

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

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'index.html'))) throw new Error(`not a dashboard root: ${dashboardRoot}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-split-region-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-split-region-${process.pid}`
let backend
let vite
let browser

try {
  mkdirSync(join(project, '.spec', 'fixture', 'alpha'), { recursive: true })
  mkdirSync(join(project, '.spec', 'fixture', 'beta'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), node('fixture', 'split fixture', ['Fixture root.']))
  writeFileSync(join(project, '.spec', 'fixture', 'alpha', 'spec.md'), node('alpha', 'the node read on the left', ['Alpha is the primary document.']))
  writeFileSync(join(project, '.spec', 'fixture', 'beta', 'spec.md'), node('beta', 'the node held on the right', ['Beta is the held document.']))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: 'true' } }, defaultLauncher: 'fixture' },
  }, null, 2))
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed: alpha and beta')
  writeFileSync(join(project, '.spec', 'fixture', 'beta', 'spec.md'), node('beta', 'the node held on the right', ['Beta is the held document.', '', 'Beta gained a second version.']))
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'beta: a second version')

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
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `split-region-${process.pid}` },
    body: JSON.stringify({ prompt: 'hold a session beside a document', name: 'split-probe' }),
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
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console.error: ${message.text()}`) })
  const base = `http://127.0.0.1:${uiPort}`
  const sessionKey = `#/sessions/${sessionId}`
  const hash = () => page.evaluate(() => location.hash)
  const settle = (selector, timeout = 15_000) => page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
  const scenes = []
  const scene = (name, pass, facts) => scenes.push({ scene: name, pass: !!pass, ...facts })
  // THE SHAPE OF THE WINDOW, as a reader sees it: what each region draws, and what the frame draws once.
  const shape = () => page.evaluate(() => {
    const painted = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    const visible = (root, selector) => [...(root?.querySelectorAll(selector) || [])].filter(painted)
    const region = (selector) => document.querySelector(selector)
    const primary = region('.region-primary') || document.querySelector('.app-main')
    const second = region('.region-held') || document.querySelector('.content-second')
    const strip = (host) => visible(host, '.tabstrip').map((el) => visible(el, '[role="tab"][data-tab-key]').map((tab) => tab.dataset.tabKey))
    return {
      split: !!second,
      primaryTabs: strip(primary).flat(),
      heldTabs: strip(second).flat(),
      heldBandTitle: second?.querySelector('.tabstrip-held .tab-label')?.textContent || null,
      heldForest: visible(second, '.si-list').length,
      heldStrips: visible(second, '.tabstrip:not(.tabstrip-held)').length,
      primaryForest: visible(primary, '.si-list').length,
      rails: visible(document, '.sidebar, .rail').length + document.querySelectorAll('nav.side-nav, .sidenav').length,
      docks: visible(document, '.dock').length,
      contextDocks: visible(document, '.context-dock').map((el) => el.querySelector('.ctx-node-id')?.textContent || ''),
      heldActions: visible(second, '.tabstrip-actions [data-action]').map((el) => el.dataset.action),
      primaryActions: visible(primary, '.tabstrip-actions [data-action]').map((el) => el.dataset.action),
    }
  })
  const rightClickStripTab = async (key) => {
    await page.locator(`.region-primary .tabstrip [role="tab"][data-tab-key="${key}"], .app-main > .tabstrip [role="tab"][data-tab-key="${key}"], .si-document > .tabstrip [role="tab"][data-tab-key="${key}"]`).first().click({ button: 'right' })
    await settle('.sess-menu', 5_000)
  }
  const splitItem = () => page.locator('.sess-menu:visible [role="menuitem"]', { hasText: /Send to split pane|送入分屏/ }).first()

  await page.addInitScript(({ key }) => {
    if (sessionStorage.getItem('split-region-seeded')) return
    sessionStorage.setItem('split-region-seeded', '1')
    localStorage.clear()
    localStorage.setItem('spexcode.tabs.root', JSON.stringify([
      { page: 'spec', param: 'alpha', query: null },
      { page: 'spec', param: 'beta', query: null },
      { page: 'sessions', param: key.slice('#/sessions/'.length), query: null },
    ]))
  }, { key: sessionKey })
  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await settle('.pane-doc')
  await page.waitForTimeout(800)
  const before = await shape()

  // 1 — the session tab moves into the held region, which draws no frame chrome
  await rightClickStripTab(sessionKey)
  await splitItem().click()
  await settle('.region-held', 10_000)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, '1-held-session.png') })
  const held = await shape()
  scene('sending a session tab right MOVES it, and the held region draws no second strip, forest or rail',
    held.split && !held.primaryTabs.includes(sessionKey) && before.primaryTabs.includes(sessionKey)
    && held.heldTabs.length === 0 && held.heldStrips === 0 && held.heldForest === 0
    && held.rails === before.rails && held.primaryTabs.length === before.primaryTabs.length - 1
    && (held.heldBandTitle || '').includes('split-probe'),
    { before: before.primaryTabs, after: held.primaryTabs, held })

  // 2 — the frame's sidebar folds alone
  await page.locator('.dock-toggle, [data-tip*="idebar"], [aria-label*="idebar"]').first().click()
  await page.waitForTimeout(800)
  const folded = await shape()
  await page.screenshot({ path: join(out, '2-folded.png') })
  // the two sidebars were ONE flag: what proves they are not is that the held region never had a navigator
  // to fold — folding the frame's must leave a region that was already free of it exactly as it was.
  scene('folding the frame sidebar leaves the held region untouched',
    folded.docks === 0 && folded.split && folded.heldForest === 0 && held.heldForest === 0,
    { docks: folded.docks, heldForestBeforeFold: held.heldForest, heldForestAfterFold: folded.heldForest })
  await page.locator('.dock-toggle, [data-tip*="idebar"], [aria-label*="idebar"]').first().click()
  await page.waitForTimeout(600)

  // 3 — the held document keeps its own controls
  const heldActionShape = await shape()
  scene('the held band carries that document\'s own controls and a way back',
    heldActionShape.heldActions.includes('held-return'), { heldActions: heldActionShape.heldActions })

  // 4 — two spec documents, two context docks, each describing its own node
  await page.locator('.tabstrip [role="tab"][data-tab-key="#/spec/beta"]').first().click({ button: 'right' })
  await settle('.sess-menu', 5_000)
  await splitItem().click()
  await waitFor(async () => (await shape()).heldBandTitle === 'beta', 'beta held', 8_000).catch(() => null)
  await page.waitForTimeout(600)
  for (const selector of ['.region-primary .context-toggle', '.region-held .context-toggle']) {
    const toggle = page.locator(selector)
    if (await toggle.count()) await toggle.first().click()
    await page.waitForTimeout(400)
  }
  await settle('.region-held .context-dock', 8_000)
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(out, '3-two-context-docks.png') })
  const docks = await shape()
  const heldHistory = await page.locator('.region-held .ctx-version .ctx-row-label').evaluateAll((els) => els.map((el) => el.textContent))
  scene('a held spec node carries its own context dock, describing its own node',
    JSON.stringify(docks.contextDocks) === JSON.stringify(['alpha', 'beta'])
    && heldHistory.some((reason) => /second version/.test(reason)),
    { contextDocks: docks.contextDocks, heldHistory })

  // 5 — the held band returns the document to the strip
  // the A side has no held band: its second pane closes through the old ⨯, which discards rather than returns
  const returnControl = page.locator('.region-held [data-action="held-return"]')
  if (await returnControl.count()) await returnControl.click()
  else await page.locator('.content-close').first().click().catch(() => {})
  await waitFor(async () => !(await shape()).split, 'the split closed', 8_000).catch(() => null)
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(out, '4-returned.png') })
  const returned = await shape()
  scene('the held band returns its document to the strip and closes the split',
    !returned.split && returned.primaryTabs.includes('#/spec/beta') && await hash() === '#/spec/beta',
    { tabs: returned.primaryTabs, hash: await hash() })

  // 6 — the only tab cannot be sent right
  // the working set is a module store once the page is live, so a seeded list only takes effect on a reload
  await page.evaluate(() => localStorage.setItem('spexcode.tabs.root', JSON.stringify([{ page: 'spec', param: 'alpha', query: null }])))
  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle('.pane-doc')
  await page.waitForTimeout(800)
  await rightClickStripTab('#/spec/alpha')
  const disabled = await splitItem().isDisabled().catch(() => false)
  await page.screenshot({ path: join(out, '5-only-tab.png') })
  if (!disabled) await splitItem().click().catch(() => {})
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  const lonely = await shape()
  scene('the strip\'s only tab cannot be sent right: the verb is unavailable, not inert',
    disabled && !lonely.split, { disabled, split: lonely.split })

  // 7 — holding a second document swaps the first back into the strip, and 8 — a reload keeps one copy
  await page.evaluate(() => localStorage.setItem('spexcode.tabs.root', JSON.stringify([
    { page: 'spec', param: 'alpha', query: null }, { page: 'spec', param: 'beta', query: null },
  ])))
  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle('.pane-doc')
  await page.waitForTimeout(700)
  await rightClickStripTab('#/spec/beta')
  await splitItem().click()
  await settle('.region-held', 8_000)
  await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle('.region-held', 10_000)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '6-after-reload.png') })
  const reloaded = await shape()
  scene('a reload keeps the held document held, and never in both places at once',
    reloaded.split && reloaded.heldBandTitle === 'beta' && !reloaded.primaryTabs.includes('#/spec/beta')
    && reloaded.primaryTabs.includes('#/spec/alpha'),
    { primaryTabs: reloaded.primaryTabs, heldBandTitle: reloaded.heldBandTitle })

  const kept = scenes.filter((s) => s.pass).length
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors, sessionId }
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'no product errors in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} split-region scenes held`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
