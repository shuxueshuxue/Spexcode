// YATU proof for [[workspace-shell]]'s region tree and [[tab-strip]]'s groups. One isolated backend over a
// fixture repository with two spec nodes and one real session (launcher `true`, so it costs nothing). The
// browser does what a reader does with "send to split pane":
//   1. One group is one strip: the ordinary window, one navigator, no seam.
//   2. Splitting MOVES the tab into a new group beside the first, which takes focus and the address bar.
//   3. Splitting again makes a grid — three cells, each with its own strip and its own document.
//   4. Each spec cell carries its own context dock, describing its own node.
//   5. A tab dragged onto another cell's strip moves there; the cell it empties collapses.
//   6. A session in a grid cell is the console alone — and the window's own dock lists sessions beside it.
//   7. A reload keeps the grid, with no document in two cells.
//   8. Closing a cell's last tab collapses the cell.
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
  const settle = (selector, timeout = 15_000) => page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
  const scenes = []
  const scene = (name, pass, facts) => scenes.push({ scene: name, pass: !!pass, ...facts })
  // THE SHAPE OF THE WINDOW, as a reader sees it: what each region draws, and what the frame draws once.
  const shape = () => page.evaluate(() => {
    const painted = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    const visible = (root, selector) => [...(root?.querySelectorAll(selector) || [])].filter(painted)
    const regions = visible(document, '.region').map((region) => ({
      group: region.dataset.group || null,
      focused: !!region.querySelector('.tabstrip-focused'),
      tabs: visible(region.querySelector('.tabstrip'), '[role="tab"][data-tab-key]').map((tab) => tab.dataset.tabKey),
      forest: visible(region, '.si-list').length,
      strips: visible(region, ':scope > .tabstrip').length,
      context: region.querySelector('.context-dock .ctx-node-id')?.textContent || null,
      box: region.getBoundingClientRect().toJSON(),
    }))
    return {
      regions,
      cells: regions.length,
      rails: visible(document, '.sidebar, .rail').length,
      docks: visible(document, '.dock').length,
      dividers: visible(document, '.content-divider').length,
      hash: location.hash,
    shell: window.__dockDebug || null,
    }
  })
  const rightClickStripTab = async (key) => {
    await page.locator(`.region .tabstrip [role="tab"][data-tab-key="${key}"]`).first().click({ button: 'right' })
    const opened = await settle('.sess-menu', 5_000)
    if (!opened) {
      await page.screenshot({ path: join(out, `no-menu-${key.replace(/[^a-z0-9]+/gi, '-')}.png`) })
      const seen = await page.locator('.region .tabstrip [role="tab"]').evaluateAll((els) => els.map((el) => el.dataset.tabKey))
      throw new Error(`no tab menu for ${key}; strips hold ${JSON.stringify(seen)}`)
    }
  }
  const splitItem = (side = 'right') => page.locator('.sess-menu:visible [role="menuitem"]',
    { hasText: side === 'bottom' ? /Split down|分屏到下方/ : /Split right|分屏到右侧/ }).first()

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
  await page.waitForTimeout(900)

  // 1 — one group is one strip: the ordinary window, unchanged
  const one = await shape()
  await page.screenshot({ path: join(out, '1-one-group.png') })
  scene('a workspace with one group is one strip, one navigator, no seam',
    one.cells === 1 && one.dividers === 0 && one.regions[0].strips === 1
    && one.regions[0].tabs.length === 3 && one.regions[0].focused,
    { cells: one.cells, tabs: one.regions[0]?.tabs, dividers: one.dividers })

  // 2 — split right: the tab MOVES into a new group, which takes focus and the address bar
  await rightClickStripTab(sessionKey)
  await splitItem('right').click()
  await waitFor(async () => (await shape()).cells === 2, 'two groups', 8_000)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '2-split-right.png') })
  const two = await shape()
  const [left, right] = two.regions
  scene('splitting moves the tab into a new group beside the first, and that group takes focus',
    two.cells === 2 && two.dividers === 1 && one.rails === two.rails && two.docks <= 1
    && !left.tabs.includes(sessionKey) && right.tabs.length === 1 && right.tabs[0] === sessionKey
    && right.focused && !left.focused && two.hash === sessionKey
    && right.strips === 1 && right.forest === 0,
    { left: left.tabs, right: right.tabs, hash: two.hash, focused: right.focused, forest: right.forest })

  // 3 — a third cell: the grid is the same rule applied again
  await rightClickStripTab('#/spec/beta')
  await splitItem('bottom').click()
  await waitFor(async () => (await shape()).cells === 3, 'three groups', 8_000)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '3-three-cells.png') })
  const three = await shape()
  const below = three.regions.find((region) => region.tabs.includes('#/spec/beta'))
  const above = three.regions.find((region) => region.tabs.includes('#/spec/alpha'))
  scene('splitting again makes a grid: three cells, each with its own strip and one document',
    three.cells === 3 && three.dividers === 2 && three.rails === one.rails
    && three.regions.every((region) => region.strips === 1)
    && Math.round(below.box.top) >= Math.round(above.box.bottom)
    && Math.round(below.box.left) === Math.round(above.box.left),
    { cells: three.cells, boxes: three.regions.map((region) => ({ tabs: region.tabs, top: Math.round(region.box.top), left: Math.round(region.box.left) })) })

  // 4 — each cell answers context for its own document
  for (const region of three.regions) {
    const toggle = page.locator(`.region[data-group="${region.group}"] .context-toggle`)
    if (await toggle.count()) await toggle.first().click()
    await page.waitForTimeout(300)
  }
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, '4-context-per-cell.png') })
  const contexts = (await shape()).regions.map((region) => region.context).filter(Boolean).sort()
  scene('a spec cell carries its own context dock, describing its own node',
    JSON.stringify(contexts) === JSON.stringify(['alpha', 'beta']), { contexts })

  // 5 — a tab dragged onto another cell's strip moves there
  const dragTabTo = async (key, targetGroup) => {
    const tab = await page.locator(`.tabstrip [role="tab"][data-tab-key="${key}"]`).first().boundingBox()
    const strip = await page.locator(`.region[data-group="${targetGroup}"] .tabstrip-tabs`).first().boundingBox()
    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2)
    await page.mouse.down()
    await page.mouse.move(tab.x + tab.width / 2 + 12, tab.y + tab.height / 2, { steps: 3 })
    await page.mouse.move(strip.x + strip.width - 8, strip.y + strip.height / 2, { steps: 12 })
    await page.mouse.up()
  }
  const sessionCell = (await shape()).regions.find((region) => region.tabs.includes(sessionKey))
  const alphaCell = (await shape()).regions.find((region) => region.tabs.includes('#/spec/alpha'))
  await dragTabTo('#/spec/alpha', sessionCell.group)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '5-dragged-across.png') })
  const dragged = await shape()
  const target = dragged.regions.find((region) => region.group === sessionCell.group)
  scene('a tab dragged onto another cell\'s strip moves there, and the cell it emptied collapses',
    target?.tabs.includes('#/spec/alpha') && target?.tabs.includes(sessionKey)
    && dragged.regions.every((region) => region.group === sessionCell.group || !region.tabs.includes('#/spec/alpha'))
    && dragged.cells === 2 && !dragged.regions.some((region) => region.group === alphaCell.group),
    { cells: dragged.cells, regions: dragged.regions.map((region) => region.tabs) })

  // 6 — a session cell in a grid is the console alone
  const sessionRegion = dragged.regions.find((region) => region.tabs.includes(sessionKey))
  await page.locator(`.region[data-group="${sessionRegion.group}"] [role="tab"][data-tab-key="${sessionKey}"] .tab-face`).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '6-session-cell.png') })
  const withSession = await shape()
  const cell = withSession.regions.find((region) => region.tabs.includes(sessionKey))
  const frameSessionList = await page.locator('.dock .si-item, .dock [data-sid]').count()
  scene('a session held in a grid cell is the console alone — and the window still lists sessions beside it',
    cell.forest === 0 && cell.strips === 1 && withSession.hash === sessionKey && frameSessionList > 0,
    { forest: cell.forest, strips: cell.strips, hash: withSession.hash, frameSessionList })

  // 7 — the grid survives a reload, and no document is in two cells
  await page.reload({ waitUntil: 'domcontentloaded' })
  await settle('.region .tabstrip', 10_000)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(out, '7-after-reload.png') })
  const reloaded = await shape()
  const everyTab = reloaded.regions.flatMap((region) => region.tabs)
  scene('a reload keeps the grid, and no document is in two cells',
    reloaded.cells === dragged.cells && new Set(everyTab).size === everyTab.length
    && everyTab.includes('#/spec/alpha') && everyTab.includes(sessionKey),
    { cells: reloaded.cells, regions: reloaded.regions.map((region) => region.tabs) })

  // 8 — closing the last tab of a cell collapses it
  const lonely = reloaded.regions.find((region) => region.tabs.length === 1)
  let closedOnFirstClick = null
  if (lonely) {
    const closeControl = page.locator(`.region[data-group="${lonely.group}"] [role="tab"] .tab-x`).first()
    await closeControl.click()
    await page.waitForTimeout(700)
    closedOnFirstClick = (await shape()).cells === reloaded.cells - 1
    if (!closedOnFirstClick && await closeControl.count()) { await closeControl.click(); await page.waitForTimeout(700) }
  }
  await page.screenshot({ path: join(out, '8-collapsed.png') })
  const collapsed = await shape()
  scene('closing a cell\'s last tab collapses the cell and gives its space back',
    !!lonely && collapsed.cells === reloaded.cells - 1 && collapsed.dividers === reloaded.dividers - 1,
    { before: reloaded.cells, after: collapsed.cells, dividers: collapsed.dividers, closedOnFirstClick })

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
