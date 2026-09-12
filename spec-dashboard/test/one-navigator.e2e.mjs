// YATU proof for [[dock-modes]]'s ONE NAVIGATOR: the window has exactly one session list, the frame draws
// it, and it is the full forest on every route. The window used to have two — a complete forest inside the
// Sessions page, and a thinner copy beside every other page reachable only by a chord — which meant a split
// workspace had none at all.
//   1. A spec document draws the explorer projection; there is one navigator panel, and it is the frame's.
//   2. The rail's sessions anchor swaps that panel for the forest and nothing mounts on the document in
//      between: one handover, observed as mounts rather than paints.
//   3. The forest beside a SPEC document is the full one — real rows, zones, its own row of doors — and the
//      explorer is GONE rather than stacked beside it: one slot, reprojected.
//   4. A session row's right-click opens the session lifecycle menu from a non-sessions page.
//   5. On the Sessions page the forest stands beside the console; the console itself draws no list.
//   6. Dragging a row onto another row reparents it — the forest's own gesture, now reachable everywhere.
//   7. Dragging a row onto the archive door asks the menu's close confirm ([[dock-modes]]'s drop door).
// Every scene screenshots before it judges. `SPEXCODE_DASHBOARD_ROOT` points Vite at another checkout.
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
const out = resolve(process.env.OUT || join(tmpdir(), 'one-navigator-e2e'))

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 20_000) => {
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
const fixture = mkdtempSync(join(tmpdir(), 'spex-one-navigator-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-one-navigator-${process.pid}`
let backend
let vite
let browser

try {
  mkdirSync(join(project, '.spec', 'fixture', 'alpha'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), node('fixture', 'navigator fixture', ['Fixture root.']))
  writeFileSync(join(project, '.spec', 'fixture', 'alpha', 'spec.md'), node('alpha', 'the document read beside the navigator', ['Alpha is the document.']))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: 'true' } }, defaultLauncher: 'fixture' },
  }, null, 2))
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed: alpha')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const api = `http://127.0.0.1:${apiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')
  // two sessions, so a reparent has somewhere to land and the forest has a tree to disclose
  const make = async (name) => {
    const created = await fetch(`${api}/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `one-navigator-${name}-${process.pid}` },
      body: JSON.stringify({ prompt: `navigator probe ${name}`, name }),
    })
    assert.equal(created.ok, true, `create session ${name}`)
    const { id } = await created.json()
    await waitFor(async () => (await fetch(`${api}/api/graph`).then((response) => response.json())).sessions?.some((row) => row.id === id), `the ${name} row`)
    return id
  }
  const firstId = await make('navigator-one')
  const secondId = await make('navigator-two')

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
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, ignoreHTTPSErrors: true })
  await context.addInitScript(() => {
    try {
      localStorage.setItem('spexcode.dock', '1')
      localStorage.setItem('spexcode.dockMode', 'explorer')
    } catch { /* private mode */ }
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console.error: ${message.text()}`) })
  const base = `http://127.0.0.1:${uiPort}`
  const scenes = []
  const scene = (name, pass, facts) => scenes.push({ scene: name, pass: !!pass, ...facts })
  const settle = (selector, timeout = 20_000) => page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
  // THE A SIDE MUST STILL REPORT. On the old build the frame draws no forest at all, so every gesture below
  // aims at something that is not there; a probe that throws there leaves a repair pair with one half.
  const present = async (selector) => (await page.locator(`${selector}:visible`).count()) > 0

  // WHAT THE WINDOW SHOWS AS A NAVIGATOR. The frame's panel is the frame's own child; a panel inside a
  // region would be page chrome, which is the defect this proof exists to forbid.
  const shape = () => page.evaluate(() => {
    const painted = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    const visible = (root, selector) => [...(root?.querySelectorAll(selector) || [])].filter(painted)
    const panel = visible(document, '.app > .dock, .app > .si-list')
    return {
      panels: panel.length,
      // three answers, so the A side describes itself: the frame's forest, the retired thin list the dock
      // drew inside itself, or the explorer tree.
      kind: panel[0]
        ? (panel[0].classList.contains('si-list') ? 'forest'
          : panel[0].querySelector('.dock-session-body, .dock-session-list') ? 'dock-sessions' : 'explorer')
        : null,
      explorers: visible(document, '.app > .dock').length,
      rows: visible(document, '.app > .si-list [data-sid]').map((el) => el.dataset.sid),
      zones: visible(document, '.app > .si-list .si-zone').length,
      folds: visible(document, '.app > .si-list .sess-fold-control').length,
      doors: visible(document, '.app > .si-list .si-pill').length,
      insideRegions: visible(document, '.region .si-list, .region .dock').length,
      hash: location.hash,
    }
  })
  // 1 — a spec document: one navigator, the explorer
  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await settle('.region .tabstrip')
  await settle('.app > .dock')
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(out, '1-explorer.png') })
  const onSpec = await shape()
  scene('a spec document draws one navigator, and it is the explorer the frame owns',
    onSpec.panels === 1 && onSpec.kind === 'explorer' && onSpec.insideRegions === 0,
    { panels: onSpec.panels, kind: onSpec.kind, insideRegions: onSpec.insideRegions, hash: onSpec.hash })

  // 2 — the handover is ONE swap, watched as mounts. A forest appearing while the address is still the spec
  // document is the defect: the navigator changing on a document that did not change.
  await page.evaluate(() => {
    window.__navMounts = []
    const record = () => {
      const forest = document.querySelector('.app > .si-list')
      if (forest) window.__navMounts.push({ at: location.hash, panels: document.querySelectorAll('.app > .dock, .app > .si-list').length })
    }
    window.__navObserver = new MutationObserver(record)
    window.__navObserver.observe(document.querySelector('.app'), { childList: true, subtree: true })
  })
  await page.locator('.side-rail a[href="#/sessions"]').click()
  await settle('.app > .si-list', 8_000)
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '2-forest.png') })
  const mounts = await page.evaluate(() => {
    window.__navObserver?.disconnect()
    return window.__navMounts || []
  })
  const onSessions = await shape()
  const earlyForest = mounts.filter((m) => !m.at.startsWith('#/sessions'))
  const twoPanels = mounts.filter((m) => m.panels > 1)
  scene('the rail swaps the one panel for the forest, with no second list in between',
    onSessions.panels === 1 && onSessions.kind === 'forest' && earlyForest.length === 0 && twoPanels.length === 0,
    { panels: onSessions.panels, kind: onSessions.kind, mounts: mounts.length, earlyForest: earlyForest.length, twoPanels: twoPanels.length })

  // 3 — REPROJECTED, NOT STACKED: the projection chord lists sessions beside the document being read. What
  // arrives is the FULL forest — real rows, zones, disclosure, its own row of doors — and the explorer is
  // gone rather than pushed aside, while the document itself does not move. (The two projections are two
  // components, so the swap replaces the panel element; what must stay one is the SLOT.)
  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await settle('.app > .dock')
  await page.waitForTimeout(500)
  await page.keyboard.press('Alt+Shift+M')      // the projection chord: list sessions beside this document
  await settle('.app > .si-list', 8_000)
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(out, '3-forest-beside-spec.png') })
  const beside = await shape()
  scene('the forest beside a spec document is the full one, and the explorer is gone rather than stacked',
    beside.panels === 1 && beside.kind === 'forest' && beside.explorers === 0
    && beside.rows.length >= 2 && beside.zones >= 1 && beside.doors >= 3
    && beside.insideRegions === 0 && beside.hash === '#/spec/alpha',
    { kind: beside.kind, explorers: beside.explorers, rows: beside.rows.length, zones: beside.zones,
      folds: beside.folds, doors: beside.doors, insideRegions: beside.insideRegions, hash: beside.hash })

  // 4 — the session row menu, from a document route
  const rowSelector = `.app > .si-list [data-sid="${firstId}"]`
  const haveRow = await present(rowSelector)
  if (haveRow) {
    await page.locator(rowSelector).click({ button: 'right' })
    await settle('.sess-menu', 5_000)
  }
  await page.screenshot({ path: join(out, '4-row-menu.png') })
  const menuItems = await page.locator('.sess-menu button, .sess-menu [role="menuitem"]').count()
  const menuOnDocument = (await shape()).hash === '#/spec/alpha'
  scene('a session row answers a right-click with the session lifecycle menu, on a document route',
    haveRow && menuItems > 0 && menuOnDocument, { frameRow: haveRow, menuItems, hash: '#/spec/alpha' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // 5 — the Sessions page: the forest beside the console, and the console draws no list of its own
  await page.goto(`${base}/#/sessions/${firstId}`, { waitUntil: 'domcontentloaded' })
  await settle('.app > .si-list', 8_000)
  await settle('.si-page')
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(out, '5-sessions-page.png') })
  const onPage = await shape()
  const listsInConsole = await page.locator('.si-page .si-list').count()
  const activeRow = await page.locator(`.app > .si-list [data-sid="${firstId}"].on`).count()
  scene('the Sessions page reads its session beside the one forest, and the console draws no list',
    onPage.panels === 1 && onPage.kind === 'forest' && listsInConsole === 0 && activeRow === 1,
    { panels: onPage.panels, kind: onPage.kind, listsInConsole, activeRow })

  // 6 — reparent by drag, the forest's own gesture
  const dragRow = async (fromId, target) => {
    const from = page.locator(`.app > .si-list [data-sid="${fromId}"]`)
    if (!(await from.count()) || !(await target.count())) return false
    const fromBox = await from.boundingBox()
    const toBox = await target.boundingBox()
    await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(fromBox.x + fromBox.width / 2 + 12, fromBox.y + fromBox.height / 2 + 10, { steps: 6 })
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 12 })
    await page.waitForTimeout(250)
    await page.mouse.up()
    await page.waitForTimeout(1200)
    return true
  }
  const dragged = await dragRow(secondId, page.locator(`.app > .si-list [data-sid="${firstId}"]`))
  await page.screenshot({ path: join(out, '6-reparented.png') })
  const parented = await fetch(`${api}/api/graph`).then((response) => response.json())
  const childRow = (parented.sessions || []).find((row) => row.id === secondId)
  // and the list REDRAWS as a tree: the row that took the child grows the disclosure control it needs. That
  // is the half a thinner copy of this list never had.
  const afterDrag = await shape()
  scene('a row dragged onto another row becomes its child, and the list redraws as a tree',
    dragged && childRow?.parent === firstId && afterDrag.folds >= 1 && afterDrag.panels === 1,
    { dragged, parent: childRow?.parent || null, expected: firstId, folds: afterDrag.folds })

  // 7 — the archive door is also a drop door, and it asks the menu's close confirm
  const droppedOnDoor = await dragRow(secondId, page.locator('.app > .si-list .si-pill.archive'))
  const confirmVisible = droppedOnDoor ? await settle('.sess-confirm', 5_000) : false
  await page.screenshot({ path: join(out, '7-archive-drop-confirm.png') })
  const stillThere = await fetch(`${api}/api/graph`).then((response) => response.json())
  scene('a row dropped on the archive door asks the close confirm, and closes nothing until it is answered',
    droppedOnDoor && confirmVisible && (stillThere.sessions || []).some((row) => row.id === secondId),
    { droppedOnDoor, confirmVisible, sessionStillOpen: (stillThere.sessions || []).some((row) => row.id === secondId) })

  const kept = scenes.filter((s) => s.pass).length
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors, firstId, secondId }
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'no product errors in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} one-navigator scenes held`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
