import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = resolve(root, '..', '..')
const vitePath = join(dependencyRoot, 'node_modules/vite/dist/node/index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/ownership-audit-e2e')
const freePort = () => new Promise((done, fail) => {
  const server = net.createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => done(port))
  })
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const port = await freePort()
const base = `http://127.0.0.1:${port}`
const { createServer } = await import(pathToFileURL(vitePath).href)
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const vite = await createServer({
  root: dashboardRoot,
  configFile: join(dashboardRoot, 'cvid.vite.config.mjs'),
  server: { host: '127.0.0.1', port, strictPort: true },
})
await vite.listen()

const sessions = [
  { id: 'session-a', title: 'Session A', label: 'Session A', status: 'working', liveness: 'working', parent: null, source: 'src/a', capabilities: { headless: true } },
  { id: 'session-b', title: 'Session B', label: 'Session B', status: 'working', liveness: 'working', parent: null, source: 'src/b', capabilities: { headless: true } },
]
const node = { id: 'node-1', title: 'Concrete Spec Document', status: 'active', parent: null, body: '# Concrete Spec Document\n\nReadable body.', code: ['src/app.js'] }
const board = { nodes: [node], sessions, issuesStamp: null }
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text())
})

await page.route('**/api/**', async (route) => {
  const { pathname } = new URL(route.request().url())
  if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
  if (pathname === '/api/specs/node-1/content') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: node.body, parts: null }) })
  if (pathname === '/api/source') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ size: 18, offset: 0, bytes: 18, text: 'export const app = 1', eof: true }) })
  if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})
await page.addInitScript(() => {
  localStorage.clear()
  localStorage.setItem('spexcode.dock', '1')
  localStorage.setItem('spexcode.dockMode', 'sessions')
  localStorage.setItem('spexcode.tabs', JSON.stringify([
    { page: 'sessions', param: 'session-a', query: null, pinned: true },
    { page: 'sessions', param: 'session-b', query: null, pinned: true },
  ]))
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})

try {
  await page.goto(`${base}/#/sessions/session-a`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-list').waitFor({ state: 'visible' })
  await page.locator('.si-item[data-sid="session-b"]').click()
  await page.waitForFunction(() => location.hash === '#/sessions/session-b')
  const focused = await page.evaluate(() => ({
    hash: location.hash,
    activeTab: document.querySelector('.tab.on')?.dataset.tabKey || null,
    activeTabLabel: document.querySelector('.tab.on .tab-face')?.textContent.trim() || null,
    activeSession: document.querySelector('.si-item.on')?.dataset.sid || null,
    tabs: [...document.querySelectorAll('.tab[data-tab-key]')].map((tab) => ({ key: tab.dataset.tabKey, active: tab.classList.contains('on') })),
    dockBody: !!document.querySelector('.dock-session-body'),
    projectionBody: !!document.querySelector('[data-session-list-projection="document"]'),
    rail: [...document.querySelectorAll('.side-rail a.rail-btn')].map((link) => ({ href: link.getAttribute('href'), label: link.getAttribute('aria-label'), tip: link.getAttribute('data-tip') })),
    title: document.title,
  }))
  assert.equal(focused.hash, '#/sessions/session-b', 'clicking B focuses B route')
  assert.equal(focused.activeTab, '#/sessions/session-b', 'B tab is active')
  assert.equal(focused.activeTabLabel, 'Session B', 'B tab keeps B title')
  assert.equal(focused.activeSession, 'session-b', 'content follows B')
  assert.deepEqual(focused.tabs, [
    { key: '#/sessions/session-a', active: false },
    { key: '#/sessions/session-b', active: true },
  ], 'A remains held while B is focused')
  assert.equal(focused.dockBody, false, 'Sessions document does not render an empty dock body')
  assert.equal(focused.projectionBody, false, 'retired document projection marker is absent')
  assert.deepEqual(focused.rail.map(({ href }) => href), ['#/spec', '#/sessions', '#/evals', '#/issues', '#/settings'])
  assert.equal(focused.rail[0].label, 'Spec', 'Spec rail label is localized')
  assert.equal(focused.rail[0].tip, 'Spec', 'Spec tooltip is localized')
  assert.match(focused.title, /Session B/, 'document title follows B')
  await page.screenshot({ path: join(out, 'sessions-b-focus.png'), fullPage: true })

  await page.goto(`${base}/#/spec/node-1`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-spec').waitFor({ state: 'visible' })
  await page.locator('.tab[data-tab-key="#/spec"] .tab-face').waitFor({ state: 'visible' })
  const spec = await page.evaluate(() => {
    const face = document.querySelector('.tab[data-tab-key="#/spec"] .tab-face')
    return {
      tabCount: document.querySelectorAll('.tab[data-tab-key="#/spec"]').length,
      text: face?.textContent.trim() || null,
      tip: face?.getAttribute('data-tip') || null,
      label: face?.getAttribute('aria-label') || null,
      icon: !!face?.querySelector('.tab-kind-icon'),
      rail: [...document.querySelectorAll('.side-rail a.rail-btn')].map((link) => link.getAttribute('href')),
    }
  })
  assert.equal(spec.tabCount, 1, 'Spec detail stays in one resident slot')
  assert.equal(spec.text, 'Concrete Spec Document')
  assert.equal(spec.tip, 'Concrete Spec Document')
  assert.equal(spec.label, 'Concrete Spec Document')
  assert.equal(spec.icon, true, 'Spec slot keeps the resident page icon')
  assert.deepEqual(spec.rail, ['#/spec', '#/sessions', '#/evals', '#/issues', '#/settings'])
  await page.screenshot({ path: join(out, 'spec-detail-title.png'), fullPage: true })

  await page.goto(`${base}/#/file/src/app.js`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tab[data-tab-key="#/file/src/app.js"] .tab-face').waitFor({ state: 'visible' })
  const file = await page.evaluate(() => ({
    text: document.querySelector('.tab[data-tab-key="#/file/src/app.js"] .tab-face')?.textContent.trim() || null,
    tip: document.querySelector('.tab[data-tab-key="#/file/src/app.js"] .tab-face')?.getAttribute('data-tip') || null,
    specTabs: document.querySelectorAll('.tab[data-tab-key="#/spec"]').length,
    specRailSelected: document.querySelector('.side-rail a[href="#/spec"]')?.getAttribute('aria-current') === 'page',
  }))
  assert.equal(file.text, 'app.js', 'file focus names the file document')
  assert.equal(file.tip, 'app.js')
  assert.equal(file.specTabs, 1, 'file focus does not mint a duplicate Spec tab')
  assert.equal(file.specRailSelected, true, 'file focus retains Spec top-level rail identity')
  await page.screenshot({ path: join(out, 'file-focus-title.png'), fullPage: true })
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ ok: true, focused, spec, file, evidence: out }))
} finally {
  await page.close()
  await context.close()
  await browser.close()
  await vite.close()
}
