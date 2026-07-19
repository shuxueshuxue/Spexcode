import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const spexBin = join(root, 'spec-cli', 'bin', 'spex.mjs')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH
if (!playwrightPath) throw new Error('SPEXCODE_PLAYWRIGHT_PATH must point at playwright/index.mjs')
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const out = resolve(process.env.IDENTITY_E2E_OUT || join(tmpdir(), `spex-identity-e2e-${Date.now()}`))
mkdirSync(out, { recursive: true })

const home = mkdtempSync(join(tmpdir(), 'spex-identity-home-'))
const repos = mkdtempSync(join(tmpdir(), 'spex-identity-repos-'))
const serviceLog = []
const services = new Set()
const encodeProject = (path) => path.replace(/[/.]/g, '-')

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolvePort(port))
  })
})

function makeProject(folder, title, icon) {
  const dir = join(repos, folder)
  mkdirSync(join(dir, '.spec', 'project'), { recursive: true })
  writeFileSync(join(dir, '.spec', 'project', 'spec.md'), `---\ntitle: ${title}\ndesc: browser identity fixture\n---\n# project\n\n${title} fixture.\n`)
  writeFileSync(join(dir, 'spexcode.json'), `${JSON.stringify({ harnesses: ['codex'], dashboard: { title, icon } }, null, 2)}\n`)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'identity@test'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'identity'], { cwd: dir })
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: dir })
  return { dir, id: encodeProject(dir), title }
}

function service(name, args, cwd) {
  const env = { ...process.env, SPEXCODE_HOME: home }
  delete env.PORT
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  delete env.SPEXCODE_INSTANCE_ID
  const child = spawn(process.execPath, [spexBin, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' })
  services.add(child)
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => {
    const line = String(chunk).trim()
    if (line) serviceLog.push(`[${name}] ${line}`)
  })
  child.once('exit', (code, signal) => serviceLog.push(`[${name}] exit ${code ?? signal}`))
  return child
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch { /* already gone */ }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 8000)),
  ])
  if (child.exitCode === null) {
    try {
      if (process.platform === 'win32') child.kill('SIGKILL')
      else process.kill(-child.pid, 'SIGKILL')
    } catch { /* already gone */ }
  }
  services.delete(child)
}

async function waitFor(fn, label, timeout = 45_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { if (await fn()) return } catch (error) { last = error }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`${label} did not settle${last ? `: ${last.message}` : ''}`)
}

const getCatalog = async (base) => {
  const response = await fetch(`${base}/projects`, { headers: { Accept: 'application/json' } })
  if (!response.ok) return null
  return response.json()
}

const configIcon = (project) => JSON.parse(readFileSync(join(project.dir, 'spexcode.json'), 'utf8')).dashboard.icon
const favicon = (page) => page.locator("link[rel~='icon']").evaluate((link) => link.href)

async function assertSwitcherMarks(page) {
  const menu = page.locator('.proj-menu')
  await menu.waitFor()
  const atlasItem = menu.getByRole('menuitem', { name: 'Atlas Lab', exact: true })
  const rocketItem = menu.getByRole('menuitem', { name: 'Rocket Yard', exact: true })
  const allItem = menu.getByRole('menuitem', { name: 'All projects', exact: true })
  assert.equal(await menu.getByRole('menuitem').count(), 3)
  for (const item of [atlasItem, rocketItem, allItem]) {
    const mark = item.locator(':scope > .proj-menu-mark')
    assert.equal(await mark.count(), 1)
    const box = await mark.boundingBox()
    assert.deepEqual(box && { width: box.width, height: box.height }, { width: 16, height: 16 })
  }
  assert.equal(await atlasItem.locator(':scope > svg').count(), 2, 'current project keeps its trailing checkmark')
  assert.notEqual(await atlasItem.locator('.proj-menu-mark').innerHTML(), await rocketItem.locator('.proj-menu-mark').innerHTML())
  assert.notEqual(await allItem.locator('.proj-menu-mark').innerHTML(), await rocketItem.locator('.proj-menu-mark').innerHTML())
  return { menu, rocketItem }
}

const atlas = makeProject('atlas', 'Atlas Lab', 'compass')
const rocket = makeProject('rocket', 'Rocket Yard', 'mdi:rocket-launch')
writeFileSync(join(home, 'config.json'), '{\n  "gateway": { "icon": "database" }\n}\n')
const atlasPort = await freePort()
const rocketPort = await freePort()
const gatewayPort = await freePort()
let atlasBackend
let rocketBackend
let gateway
let browser

const startAtlas = async () => {
  atlasBackend = service('atlas', ['serve', '--port', String(atlasPort)], atlas.dir)
  await waitFor(async () => (await fetch(`http://127.0.0.1:${atlasPort}/health`)).ok, 'atlas backend')
}
const startRocket = async () => {
  rocketBackend = service('rocket', ['serve', '--port', String(rocketPort)], rocket.dir)
  await waitFor(async () => (await fetch(`http://127.0.0.1:${rocketPort}/health`)).ok, 'rocket backend')
}
const startGateway = async () => {
  gateway = service('gateway', ['dashboard', '--port', String(gatewayPort)], root)
  await waitFor(async () => !!(await getCatalog(`http://127.0.0.1:${gatewayPort}`)), 'host gateway')
}

try {
  await startAtlas()
  await startRocket()
  await startGateway()
  const base = `http://127.0.0.1:${gatewayPort}`
  await waitFor(async () => (await getCatalog(base))?.projects?.filter((project) => project.online).length === 2, 'two online projects')

  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
  const page = await context.newPage()
  const video = page.video()
  const started = Date.now()
  const events = []
  const step = (name) => events.push({ at: Date.now() - started, step: name })
  const consoleErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })

  step('open projects')
  await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Projects' }).waitFor()
  assert.equal(await page.title(), 'Projects · SpexCode')
  const gatewayBefore = await favicon(page)
  assert.match(gatewayBefore, /^data:image\/svg\+xml,/)
  await page.screenshot({ path: join(out, 'projects-desktop-minimal.png'), fullPage: true })

  step('change gateway icon by keyboard')
  const gatewayPicker = page.getByRole('group', { name: 'gateway icon' })
  await gatewayPicker.getByRole('radio', { name: 'Database' }).focus()
  await page.keyboard.press('ArrowLeft')
  await waitFor(() => gatewayPicker.getByRole('radio', { name: 'Package' }).isChecked(), 'gateway keyboard pick')
  await waitFor(() => Promise.resolve(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).gateway.icon === 'package'), 'gateway config write')

  step('change project icon by keyboard')
  const atlasRow = page.locator('.proj-row').filter({ hasText: 'Atlas Lab' })
  await atlasRow.getByRole('button', { name: 'edit spexcode.json' }).click()
  const atlasPicker = atlasRow.getByRole('group', { name: 'project icon' })
  await atlasPicker.getByRole('radio', { name: 'Compass' }).focus()
  await page.keyboard.press('ArrowRight')
  await waitFor(() => atlasPicker.getByRole('radio', { name: 'Terminal' }).isChecked(), 'project keyboard pick')
  await waitFor(() => Promise.resolve(configIcon(atlas) === 'terminal'), 'project config write')

  await page.evaluate(() => { localStorage.setItem('spexcode.theme', 'dracula') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Projects' }).waitFor()
  await page.screenshot({ path: join(out, 'projects-desktop-dracula.png'), fullPage: true })

  step('open atlas scope')
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.side-rail').waitFor()
  await waitFor(async () => (await page.title()) === 'Atlas Lab · SpexCode', 'atlas title')
  const atlasHref = await favicon(page)
  assert.notEqual(atlasHref, gatewayBefore)
  assert.match(await page.locator('.proj-chip').getAttribute('aria-label'), /Atlas Lab/)

  step('switcher identity marks')
  await page.locator('.proj-chip').click()
  const desktopSwitcher = await assertSwitcherMarks(page)
  await page.screenshot({ path: join(out, 'atlas-switcher-desktop-dracula.png'), fullPage: true })

  step('switch to rocket')
  await desktopSwitcher.rocketItem.click()
  await page.locator('.side-rail').waitFor()
  await waitFor(async () => (await page.title()) === 'Rocket Yard · SpexCode', 'rocket title')
  const rocketHref = await favicon(page)
  assert.notEqual(rocketHref, atlasHref)
  assert.match(await page.locator('.proj-chip').getAttribute('aria-label'), /Rocket Yard/)

  step('return atlas after rocket')
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.side-rail').waitFor()
  await waitFor(async () => (await page.title()) === 'Atlas Lab · SpexCode', 'atlas title after rocket')
  assert.equal(await favicon(page), atlasHref, 'last visited project never leaks into atlas')

  step('side nav route contract')
  assert.equal(await page.locator('.side-rail .rail-btn:not(.proj-chip)').count(), 5)
  assert.equal(await page.getByRole('button', { name: 'Projects', exact: true }).count(), 0)
  const routes = [
    { name: /^Sessions/, hash: '#/sessions' },
    { name: /^Evals/, hash: '#/evals' },
    { name: /^Issues/, hash: '#/issues' },
    { name: /^Settings/, hash: '#/settings' },
    { name: /^Spec Node Graph/, hash: '#/graph' },
  ]
  for (const route of routes) {
    await page.getByRole('button', { name: route.name }).click()
    await waitFor(() => Promise.resolve(page.url().includes(route.hash)), `rail route ${route.hash}`)
  }
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await waitFor(() => Promise.resolve(page.url().includes('#/settings')), 'browser back to settings')
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/settings`, { waitUntil: 'domcontentloaded' })
  await page.locator('.side-rail').waitFor()
  assert.equal(await page.getByRole('button', { name: /^Settings/ }).getAttribute('aria-current'), 'page')
  await page.goto('about:blank')
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/projects`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL((url) => url.pathname === '/projects')
  await page.getByRole('heading', { name: 'Projects' }).waitFor()
  assert.equal(new URL(page.url()).pathname, '/projects')
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.side-rail').waitFor()

  step('live catalog update')
  const changed = await page.evaluate(async ({ id }) => {
    const catalog = await fetch('/projects', { headers: { Accept: 'application/json' } }).then((response) => response.json())
    const project = catalog.projects.find((row) => row.id === id)
    return fetch(`/projects/${encodeURIComponent(id)}/icon`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icon: 'package', revision: project.configRevision }),
    }).then((response) => response.json())
  }, { id: atlas.id })
  assert.equal(changed.identity.icon, 'package')
  await waitFor(async () => (await favicon(page)) !== atlasHref, 'scoped live favicon update', 10_000)
  const atlasLiveHref = await favicon(page)

  step('offline project edit')
  await stop(atlasBackend)
  await waitFor(async () => (await getCatalog(base))?.projects?.find((project) => project.id === atlas.id)?.online === false, 'atlas offline')
  await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Projects' }).waitFor()
  const offlineAtlas = page.locator('.proj-row').filter({ hasText: 'Atlas Lab' })
  await offlineAtlas.getByRole('button', { name: 'edit spexcode.json' }).click()
  await offlineAtlas.getByRole('group', { name: 'project icon' }).locator('label').filter({ hasText: 'Spark' }).click()
  await waitFor(() => Promise.resolve(configIcon(atlas) === 'spark'), 'offline project icon write')
  await startAtlas()
  await waitFor(async () => (await getCatalog(base))?.projects?.find((project) => project.id === atlas.id)?.online === true, 'atlas restart')

  step('restart gateway')
  await stop(gateway)
  await startGateway()
  await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Projects' }).waitFor()
  assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).gateway.icon, 'package')
  assert.equal(configIcon(atlas), 'spark')
  assert.equal(configIcon(rocket), 'mdi:rocket-launch')
  const gatewayFinalHref = await favicon(page)
  assert.notEqual(gatewayFinalHref, gatewayBefore)

  step('narrow themed switcher')
  await page.setViewportSize({ width: 700, height: 844 })
  await page.evaluate(() => { localStorage.setItem('spexcode.theme', 'everforest') })
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.side-rail').waitFor()
  await page.locator('.proj-chip').click()
  await assertSwitcherMarks(page)
  await page.screenshot({ path: join(out, 'atlas-switcher-narrow-everforest.png'), fullPage: true })

  step('mobile themed views')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'Projects' }).waitFor()
  await page.screenshot({ path: join(out, 'projects-mobile-everforest.png'), fullPage: true })
  await page.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/graph`, { waitUntil: 'domcontentloaded' })
  await waitFor(async () => (await page.title()) === 'Atlas Lab · SpexCode', 'mobile atlas title')
  await page.screenshot({ path: join(out, 'atlas-mobile-everforest.png'), fullPage: true })
  assert.notEqual(await favicon(page), atlasLiveHref, 'offline edit persisted through backend and gateway restart')

  step('project-only guest')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(async ({ id }) => {
    await fetch('/projects/admin-password', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'admin-pass' }) })
    await fetch(`/projects/${encodeURIComponent(id)}/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'project-pass' }) })
  }, { id: atlas.id })
  const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const guestPage = await guest.newPage()
  await guestPage.goto(`${base}/p/${encodeURIComponent(atlas.id)}/#/graph`, { waitUntil: 'domcontentloaded' })
  await guestPage.getByLabel('password').fill('project-pass')
  await guestPage.getByRole('button', { name: 'unlock' }).click()
  await guestPage.locator('.side-rail').waitFor()
  assert.equal(await guestPage.locator('.proj-chip').getAttribute('aria-haspopup'), null)
  assert.equal(await guestPage.evaluate(() => fetch('/projects', { headers: { Accept: 'application/json' } }).then((response) => response.status)), 401)
  assert.equal(await guestPage.locator('.proj-menu').count(), 0)
  await guest.close()

  const unexpectedConsoleErrors = consoleErrors.filter((message) =>
    !/Failed to load resource: the server responded with a status of (401|404)/.test(message) &&
    !/EventSource's response has a MIME type .*text\/event-stream/.test(message))
  assert.deepEqual(unexpectedConsoleErrors, [])
  const catalog = await page.evaluate(() => fetch('/projects', { headers: { Accept: 'application/json' } }).then((response) => response.json()))
  assert.deepEqual(Object.fromEntries(catalog.projects.filter((project) => [atlas.id, rocket.id].includes(project.id)).map((project) => [project.id, project.identity.icon])), {
    [atlas.id]: 'spark',
    [rocket.id]: 'mdi:rocket-launch',
  })
  assert.equal(catalog.gateway.icon, 'package')

  step('complete')
  writeFileSync(join(out, 'timeline.json'), `${JSON.stringify({ v: 2, axis: 'time', events }, null, 2)}\n`)
  writeFileSync(join(out, 'identity-chain.timeline.json'), `${JSON.stringify({
    events: [
      { atMs: 0, kind: 'narrate', label: '▶ complete-identity-chain · Complete identity chain' },
      ...events.map((event) => ({ atMs: event.at, kind: 'frame', label: `📷 ${event.step}` })),
    ],
  }, null, 2)}\n`)
  writeFileSync(join(out, 'result.txt'), [
    'PASS isolated identity chain',
    `gateway=${catalog.gateway.icon}`,
    `atlas=${atlas.id}:spark`,
    `rocket=${rocket.id}:mdi:rocket-launch`,
    'gatewayTitle=Projects · SpexCode',
    'atlasTitle=Atlas Lab · SpexCode',
    'rocketTitle=Rocket Yard · SpexCode',
    `gatewayFavicon=${gatewayFinalHref}`,
    `atlasFavicon=${await favicon(page)}`,
    `rocketFavicon=${rocketHref}`,
    'desktop=minimal,dracula',
    'mobile=everforest@390px',
    'keyboard=gateway+project native radios',
    'switcher=project+gateway marks, 16px aligned, current check retained',
    'persistence=offline edit+backend restart+gateway restart',
    'guest=catalog 401, no switcher menu',
  ].join('\n') + '\n')
  await context.close()
  const originalVideo = await video.path()
  const finalVideo = join(out, 'identity-chain.webm')
  renameSync(originalVideo, finalVideo)
  console.log(JSON.stringify({ ok: true, out, video: finalVideo, timeline: join(out, 'identity-chain.timeline.json'), result: join(out, 'result.txt') }, null, 2))
} finally {
  if (browser) await browser.close().catch(() => {})
  await Promise.all([...services].map(stop))
  if (!existsSync(join(out, 'result.txt'))) writeFileSync(join(out, 'services.log'), `${serviceLog.join('\n')}\n`)
}
