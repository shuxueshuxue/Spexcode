// YATU proof for [[context-dock]]'s history panel and [[spec-view]]'s version face. One isolated backend over a
// fixture repository whose `alpha` node has three versions, each committed with its own subject; the browser
// then does what a reader does:
//   1. On #/spec/alpha, the context dock lists the three versions newest first, the newest marked current.
//   2. A version row opens that version's text in the same spec tab: its own words, its own desc, no line
//      provenance, and the dock marks that row.
//   3. A version's change door opens the change that version made — the line diff the popup's history shows.
//   4. The document's face switch and the tab row's git-compare action both move between text and change.
//   5. "Back to current" returns to the bare node address and its current body.
//   6. A hash that is not one of alpha's versions says so in the document instead of rendering a blank page.
//   7. The backend answers a per-version read only for alpha's own versions: an option-shaped "hash" is a 404
//      and writes nothing, and another node's commit is not alpha's version.
//   8. The graph popup's history pane lists the same versions and expands the same version diff.
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
const out = resolve(process.env.OUT || join(tmpdir(), 'spec-history-dock-e2e'))

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

// alpha's three versions. Each sentence exists in exactly the versions named, so the text face can be judged
// by which sentences it shows, and the v2 change by the line it added and the word it removed.
const V1 = ['Alpha began as a single promise about reading.']
const V2 = ['Alpha began as one promise about reading.', '', 'Alpha later learned to keep its history.']
const V3 = ['Alpha now keeps two promises: reading and history.', '', 'Alpha later learned to keep its history.']
const DESC_OLD = 'the node before its desc was rewritten'
const DESC_NEW = 'the node whose history the dock lists'

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'index.html'))) throw new Error(`not a dashboard root: ${dashboardRoot}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-history-dock-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-history-dock-${process.pid}`
let backend
let vite
let browser

try {
  const alphaPath = join(project, '.spec', 'fixture', 'alpha', 'spec.md')
  mkdirSync(dirname(alphaPath), { recursive: true })
  mkdirSync(join(project, '.spec', 'fixture', 'beta'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), node('fixture', 'history fixture', ['Fixture root.']))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({ harnesses: ['claude'] }, null, 2))
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  const commit = (message) => { git(project, 'add', '.'); git(project, 'commit', '-qm', message); return git(project, 'rev-parse', 'HEAD') }
  writeFileSync(alphaPath, node('alpha', DESC_OLD, V1))
  const h1 = commit('alpha: a single promise')
  writeFileSync(alphaPath, node('alpha', DESC_OLD, V2))
  const h2 = commit('alpha: learn to keep history')
  writeFileSync(join(project, '.spec', 'fixture', 'beta', 'spec.md'), node('beta', 'a neighbour with its own commit', ['Beta is not alpha.']))
  const betaOnly = commit('beta: a neighbour')
  writeFileSync(alphaPath, node('alpha', DESC_NEW, V3))
  const h3 = commit('alpha: two promises')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const api = `http://127.0.0.1:${apiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')
  await waitFor(async () => (await fetch(`${api}/api/graph`).then((response) => response.json())).nodes?.find((n) => n.id === 'alpha')?.version === 3, 'alpha at v3')

  const scenes = []
  const scene = (name, pass, facts) => scenes.push({ scene: name, pass: !!pass, ...facts })

  // 7 first — the backend's own gate, judged over HTTP before any browser exists
  const planted = join(fixture, 'planted-by-diff')
  const optionShaped = await fetch(`${api}/api/specs/alpha/diff/${encodeURIComponent(`--output=${planted}`)}`)
  const foreignDiff = await fetch(`${api}/api/specs/alpha/diff/${betaOnly}`)
  const foreignVersion = await fetch(`${api}/api/specs/alpha/version/${betaOnly}`)
  const ownVersion = await fetch(`${api}/api/specs/alpha/version/${h1}`)
  const ownBody = ownVersion.ok ? await ownVersion.json() : null
  scene('per-version reads answer only for the node\'s own versions, and an option-shaped hash writes nothing',
    optionShaped.status === 404 && !existsSync(planted) && foreignDiff.status === 404 && foreignVersion.status === 404
    && ownVersion.status === 200 && ownBody?.body?.includes(V1[0]) && ownBody?.version === 1 && ownBody?.versions === 3,
  { optionShaped: optionShaped.status, planted: existsSync(planted), foreignDiff: foreignDiff.status, foreignVersion: foreignVersion.status,
    ownVersion: ownVersion.status, ownVersionOrdinal: ownBody?.version, ownVersions: ownBody?.versions })

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
  const hash = () => page.evaluate(() => location.hash)
  const present = (selector) => page.locator(`${selector}:visible`).count().then((n) => n > 0)
  const tabs = () => page.locator('[role="tab"][data-tab-key]:visible').evaluateAll((els) => els.map((el) => el.dataset.tabKey))
  const settle = (selector, timeout = 10_000) => page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false)
  const docText = () => page.locator('.specview-prose:visible').first().textContent().catch(() => '')
  const versionRows = () => page.locator('.context-dock .ctx-version').evaluateAll((els) => els.map((el) => ({
    v: el.querySelector('.ctx-version-v')?.textContent,
    reason: el.querySelector('.ctx-row-label')?.textContent,
    text: el.querySelector('.ctx-version-text')?.getAttribute('href'),
    change: el.querySelector('.ctx-version-change')?.getAttribute('href'),
    on: el.classList.contains('on'),
    textCurrent: el.querySelector('.ctx-version-text')?.getAttribute('aria-current') === 'page',
    changeCurrent: el.querySelector('.ctx-version-change')?.getAttribute('aria-current') === 'page',
  })))
  const stamped = () => page.locator('.specview-prose:visible [data-l0]').count()

  await page.addInitScript(() => {
    if (sessionStorage.getItem('history-dock-seeded')) return
    sessionStorage.setItem('history-dock-seeded', '1')
    localStorage.clear()
    localStorage.setItem('spexcode.ctxOpen', '1')
  })
  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await settle('.pane-doc .doc-body')
  await settle('.context-dock .ctx-version', 5_000)
  await page.waitForTimeout(600)

  // 1 — the dock lists alpha's versions, newest first, newest current
  await page.screenshot({ path: join(out, '1-history-dock.png') })
  const listed = await versionRows()
  scene('the context dock lists the node\'s versions newest first, the newest marked current',
    JSON.stringify(listed.map((row) => row.v)) === JSON.stringify(['v3', 'v2', 'v1'])
    && JSON.stringify(listed.map((row) => row.reason)) === JSON.stringify(['alpha: two promises', 'alpha: learn to keep history', 'alpha: a single promise'])
    && listed[0]?.text === '#/spec/alpha' && listed[0]?.on && listed[0]?.textCurrent
    && listed[2]?.text === `#/spec/alpha?version=${h1}` && listed[1]?.change === `#/spec/alpha?surface=diff&version=${h2}`,
  { listed })

  // 2 — a version row opens that version's text in the same spec tab
  const tabsBefore = await tabs()
  if (listed.length === 3) await page.locator('.context-dock .ctx-version').nth(2).locator('.ctx-version-text').click()
  else await page.goto(`${base}/#/spec/alpha?version=${h1}`, { waitUntil: 'domcontentloaded' })
  await settle('.spec-version .doc-body')
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '2-version-text.png') })
  const v1Text = await docText()
  const v1Rows = await versionRows()
  scene('a version row opens that version\'s own text in the same spec tab, unaddressable, and the dock marks it',
    await hash() === `#/spec/alpha?version=${h1}`
    && v1Text.includes(V1[0]) && !v1Text.includes(V3[0]) && !v1Text.includes(V2[2]) && v1Text.includes(DESC_OLD) && v1Text.includes('v1')
    && await stamped() === 0
    && JSON.stringify(await tabs()) === JSON.stringify(tabsBefore)
    && v1Rows[2]?.on && v1Rows[2]?.textCurrent && !v1Rows[0]?.on,
  { hash: await hash(), tabs: await tabs(), tabsBefore, stamps: await stamped(), rows: v1Rows })

  // 3 — v2's change door opens the change it made
  if (v1Rows.length === 3) await page.locator('.context-dock .ctx-version').nth(1).locator('.ctx-version-change').click()
  else await page.goto(`${base}/#/spec/alpha?surface=diff&version=${h2}`, { waitUntil: 'domcontentloaded' })
  await settle('.spec-version .ev-diff')
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '3-version-change.png') })
  const added = await page.locator('.spec-version .dl-add').evaluateAll((els) => els.map((el) => el.textContent))
  const removed = await page.locator('.spec-version .dl-del').evaluateAll((els) => els.map((el) => el.textContent))
  const v2Rows = await versionRows()
  scene('a change door opens the line diff that version introduced, and the dock lights that door',
    await hash() === `#/spec/alpha?surface=diff&version=${h2}`
    && added.includes(V2[2]) && added.includes(V2[0]) && removed.includes(V1[0])
    && v2Rows[1]?.on && v2Rows[1]?.changeCurrent && !v2Rows[1]?.textCurrent,
  { hash: await hash(), added, removed, rows: v2Rows })

  // 4 — the face switch and the tab-row action both move between text and change
  const segmented = page.locator('.spec-version .seg-option', { hasText: /^(Text|全文)$/ })
  const hadSwitch = await segmented.count() > 0
  if (hadSwitch) await segmented.click()
  const toText = await waitFor(async () => await hash() === `#/spec/alpha?version=${h2}` && await present('.spec-version .doc-body'), 'text face', 5_000).catch(() => false)
  const action = page.locator('[data-action="change-switcher"]')
  const actionPressedOnText = await present('[data-action="change-switcher"]') ? await action.getAttribute('aria-pressed') : null
  if (actionPressedOnText) await action.click()
  const toChange = await waitFor(async () => await hash() === `#/spec/alpha?surface=diff&version=${h2}` && await present('.spec-version .ev-diff'), 'change face', 5_000).catch(() => false)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '4-face-switch.png') })
  const actionPressedOnChange = await present('[data-action="change-switcher"]') ? await action.getAttribute('aria-pressed') : null
  scene('the document\'s face switch and the tab-row git-compare action move between a version\'s text and its change',
    hadSwitch && toText && actionPressedOnText === 'false' && toChange && actionPressedOnChange === 'true',
  { hadSwitch, toText, actionPressedOnText, toChange, actionPressedOnChange, tabs: await tabs() })

  // 5 — back to the current document
  const back = page.locator('.spec-version .stat-back')
  const hadBack = await back.count() > 0
  if (hadBack) await back.click()
  const home_ = await waitFor(async () => await hash() === '#/spec/alpha' && await present('.pane-doc .doc-body') && !await present('.spec-version'), 'current document', 5_000).catch(() => false)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '5-back-to-current.png') })
  const currentText = await docText()
  const homeRows = await versionRows()
  scene('"back to current" returns to the bare node address and its current body, and the newest row is current again',
    hadBack && home_ && currentText.includes(V3[0]) && currentText.includes(DESC_NEW) && await stamped() > 0 && homeRows[0]?.on && homeRows[0]?.textCurrent,
  { hadBack, hash: await hash(), stamps: await stamped(), rows: homeRows })

  // 6 — a hash that is not alpha's version
  await page.goto(`${base}/#/spec/alpha?version=${betaOnly}`, { waitUntil: 'domcontentloaded' })
  const refused = await settle('.spec-version .version-missing')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '6-not-a-version.png') })
  const refusal = refused ? await page.locator('.spec-version .version-missing').textContent() : null
  scene('a hash that is not one of the node\'s versions is refused in the document, with the way back',
    refused && refusal.includes(betaOnly) && await present('.spec-version .stat-back') && !(await docText()).includes('Beta is not alpha'),
  { refusal })

  // 8 — the graph popup's history pane is the same log and the same version diff
  await page.goto(`${base}/#/graph/alpha`, { waitUntil: 'domcontentloaded' })
  await settle('.react-flow__node')
  await page.waitForTimeout(800)
  await page.keyboard.press('i')
  await settle('.ov-panel')
  await page.locator('.ov-tab', { hasText: 'history' }).click()
  await settle('.ov-body .ver-row')
  await page.locator('.ov-body .ver-row').nth(1).locator('.rec-toggle').click()
  await settle('.ov-body .ver-row:nth-child(2) .ev-diff')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '8-popup-history.png') })
  const popupVersions = await page.locator('.ov-body .rec-v').evaluateAll((els) => els.map((el) => el.textContent))
  const popupAdded = await page.locator('.ov-body .ver-row').nth(1).locator('.dl-add').evaluateAll((els) => els.map((el) => el.textContent))
  scene('the popup history pane lists the same versions and expands the same version diff',
    JSON.stringify(popupVersions) === JSON.stringify(['v3', 'v2', 'v1']) && popupAdded.includes(V2[2]), { popupVersions, popupAdded })

  const kept = scenes.filter((s) => s.pass).length
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors, versions: { h1, h2, h3, betaOnly } }
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'no product errors in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} history scenes held`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
