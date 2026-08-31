// YATU proof for [[tab-routing]]'s balance: ordinary navigation replaces ONLY the focused tab of the same
// kind, an inactive same-kind tab survives, and every tab — however it arrived — is an ordinary tab.
//
// Four scenes, one browser, one isolated backend whose launcher is `true` (so a created session costs
// nothing and exits at once). Each scene reads the VISIBLE strip after the product settles:
//   1. A is the only session tab; ctrl/⌘-click B (appended, now focused); plain-click D. A must survive,
//      and D must REPLACE B: the tab ctrl-click appended is not protected by how it arrived. The old rule
//      pinned B forever, so D was appended beside it and the strip grew on every plain click after that.
//   2. With D focused, plain-click E. D is the focused same-kind tab, so it IS replaced; the count does not
//      move. This is the other half of the balance: a plain click still does not mint a tab.
//   3. Type a prompt into New Session. The published session must arrive as a new tab beside A and E;
//      creation is a gesture, and the launch page has no focused document to replace.
//   4. With the created session focused, plain-click B. The created tab is an ordinary tab: B replaces it
//      and the count does not move. The old rule held the created tab, which is the tab a reader could never
//      get rid of by clicking elsewhere.
// The run writes a report, one screenshot per scene, the recorded clip and its step ruler, then asserts.
// `SPEXCODE_DASHBOARD_ROOT` points Vite at another checkout of `spec-dashboard` (the A side of a repair
// pair is measured against the old committed source; the backend stays current).
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
const out = resolve(process.env.OUT || '/tmp/tab-inactive-survives-e2e')
const HOLD = process.platform === 'darwin' ? 'Meta' : 'Control'

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
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
if (!existsSync(join(dashboardRoot, 'index.html'))) throw new Error(`not a dashboard root: ${dashboardRoot}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-tab-inactive-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-tab-inactive-${process.pid}`
let backend
let vite
let browser

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: tab inactive survives fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: 'true' } }, defaultLauncher: 'fixture' },
  }, null, 2))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const apiPort = await freePort()
  const uiPort = await freePort()
  const api = `http://127.0.0.1:${apiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  // Four sessions through the same create route the dashboard uses; the names make the strip readable.
  const create = async (name) => {
    const response = await fetch(`${api}/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `seed-${name}-${process.pid}` },
      body: JSON.stringify({ prompt: `seed session ${name}`, name: `seed ${name}` }),
    })
    assert.equal(response.ok, true, `create ${name}`)
    return (await response.json()).id
  }
  const A = await create('A'), B = await create('B'), D = await create('D'), E = await create('E')

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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out } })
  // An unhandled rejection inside a create promise is a product error that `pageerror` does not surface; the
  // composer once shipped exactly that (a hold call without its import) and stayed on the launch page.
  await context.addInitScript(() => {
    window.__rejections = []
    addEventListener('unhandledrejection', (event) => window.__rejections.push(String(event.reason?.stack || event.reason)))
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console.error: ${message.text()}`) })
  const productErrors = async () => [...errors, ...await page.evaluate(() => window.__rejections)]
  const started = Date.now()
  const steps = []
  const mark = (step) => steps.push({ at: Date.now() - started, step })
  const base = `http://127.0.0.1:${uiPort}`

  const sessionRow = (id) => page.locator(`.si-list .si-item[data-sid="${id}"]`)
  const tabState = () => page.locator('[role="tab"][data-tab-key]:visible')
    .evaluateAll((tabs) => tabs.map((tab) => ({ key: tab.dataset.tabKey, slotFace: tab.classList.contains('slot'), active: tab.classList.contains('on') })))
  const show = (tabs) => tabs.map((t) => `${t.key}${t.slotFace ? ' (slot face)' : ''}${t.active ? ' *' : ''}`)
  const sessionKey = (id) => `#/sessions/${id}`
  const settledTabs = async (predicate, label) => waitFor(async () => {
    const tabs = await tabState()
    return predicate(tabs) ? tabs : null
  }, label, 20_000)

  // Known workspace: no persisted tabs, then one plain navigation that mints A's slot.
  await page.goto(`${base}/#/sessions/${A}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('spexcode.tabs'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  for (const id of [A, B, D, E]) await sessionRow(id).waitFor({ state: 'visible', timeout: 60_000 })
  await settledTabs((tabs) => tabs.length === 1 && tabs[0].key === sessionKey(A), 'A as the only session tab')
  mark('A is the only session tab')

  const scenes = []
  const noSlotFace = (tabs) => tabs.every((t) => !t.slotFace)

  // 1 — ctrl/⌘-click B (appended, focused), then plain-click D. A survives inactive; D replaces B.
  await sessionRow(B).click({ modifiers: [HOLD] })
  const afterB = await settledTabs((tabs) => tabs.some((t) => t.key === sessionKey(B) && t.active) && tabs.length === 2, 'B appended and focused')
  mark('ctrl/⌘-click B: appended, focused')
  await sessionRow(D).click()
  await waitFor(() => page.evaluate(() => location.hash).then((hash) => hash === `#/sessions/${D}`), 'route on D')
  await page.waitForTimeout(600)
  const afterD = await tabState()
  await page.screenshot({ path: join(out, '1-inactive-tab-survives-appended-tab-replaced.png') })
  mark('plain-click D: A survives, D replaces B')
  scenes.push({
    scene: 'inactive same-kind tab survives a plain click; the ctrl-click-appended tab is replaced',
    before: show(afterB), after: show(afterD),
    pass: afterD.some((t) => t.key === sessionKey(A) && !t.active)
      && !afterD.some((t) => t.key === sessionKey(B))
      && afterD.some((t) => t.key === sessionKey(D) && t.active)
      && afterD.length === afterB.length
      && noSlotFace(afterD),
  })

  // 2 — D is the focused session tab; a plain click on E replaces it and the count holds.
  await sessionRow(E).click()
  await waitFor(() => page.evaluate(() => location.hash).then((hash) => hash === `#/sessions/${E}`), 'route on E')
  await page.waitForTimeout(600)
  const afterE = await tabState()
  await page.screenshot({ path: join(out, '2-focused-tab-replaced.png') })
  mark('plain-click E: focused tab D is replaced')
  scenes.push({
    scene: 'focused same-kind tab is replaced by a plain click',
    before: show(afterD), after: show(afterE),
    pass: afterE.length === afterD.length
      && !afterE.some((t) => t.key === sessionKey(D))
      && afterE.some((t) => t.key === sessionKey(E) && t.active)
      && afterE.some((t) => t.key === sessionKey(A) && !t.active)
      && noSlotFace(afterE),
  })

  // 3 — create from New Session; the published session must arrive as a new tab, evicting nothing.
  await page.goto(`${base}/#/sessions/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-input').waitFor({ state: 'visible', timeout: 15_000 })
  const beforeCreate = await tabState()
  mark('New Session: type a prompt')
  const prompt = 'created from the New Session composer'
  await page.locator('.si-input').fill(prompt)
  await page.locator('.si-input').press('Enter')
  const created = await waitFor(async () => {
    const response = await fetch(`${api}/api/sessions?all=1`)
    if (!response.ok) return null
    return (await response.json()).find((session) => session.promptPreview === prompt) || null
  }, 'the composer-created session')
  await waitFor(() => page.evaluate(() => location.hash).then((hash) => hash === `#/sessions/${created.id}`), 'route on the created session')
    .catch(async (error) => {
      await page.screenshot({ path: join(out, '3-created-session-appended.png') })
      const hash = await page.evaluate(() => location.hash)
      throw new Error(`${error.message}: hash=${hash} created=${created.id} tabs=${JSON.stringify(show(await tabState()))} errors=${JSON.stringify(await productErrors())}`)
    })
  await page.waitForTimeout(800)
  const afterCreate = await tabState()
  await page.screenshot({ path: join(out, '3-created-session-appended.png') })
  mark('created session arrives as a new tab beside A and E')
  scenes.push({
    scene: 'creation appends a new tab and evicts nothing',
    before: show(beforeCreate), after: show(afterCreate),
    pass: afterCreate.length === beforeCreate.length + 1
      && afterCreate.some((t) => t.key === sessionKey(created.id) && t.active)
      && [A, E].every((id) => afterCreate.some((t) => t.key === sessionKey(id) && !t.active))
      && noSlotFace(afterCreate),
  })

  // 4 — the created tab is focused; a plain click on B must replace it. This is the reader's complaint:
  // a tab that arrived by creation could never be replaced, only closed.
  await sessionRow(B).waitFor({ state: 'visible', timeout: 15_000 })
  await sessionRow(B).click()
  await waitFor(() => page.evaluate(() => location.hash).then((hash) => hash === `#/sessions/${B}`), 'route on B')
  await page.waitForTimeout(600)
  const afterPlainB = await tabState()
  await page.screenshot({ path: join(out, '4-created-tab-replaced.png') })
  mark('plain-click B: the created tab is replaced')
  scenes.push({
    scene: 'the created tab is an ordinary tab: a plain click replaces it',
    before: show(afterCreate), after: show(afterPlainB),
    pass: afterPlainB.length === afterCreate.length
      && !afterPlainB.some((t) => t.key === sessionKey(created.id))
      && afterPlainB.some((t) => t.key === sessionKey(B) && t.active)
      && [A, E].every((id) => afterPlainB.some((t) => t.key === sessionKey(id) && !t.active))
      && noSlotFace(afterPlainB),
  })

  const kept = scenes.filter((s) => s.pass).length
  const seen = await productErrors()
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors: seen, sessions: { A, B, D, E, created: created.id } }
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events: steps }, null, 2))
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(seen, [], 'no product errors or unhandled rejections in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} scenes kept the balance`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
