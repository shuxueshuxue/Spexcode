import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import net from 'node:net'

const root = resolve(new URL('../..', import.meta.url).pathname)
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : resolve(root, '..', '..')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/selection-tab-audit')
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })

const { preview } = await import(pathToFileURL(viteEntry).href)
const uiPort = Number(process.env.PORT || await new Promise((done, fail) => {
  const server = net.createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) })
}))
const base = `http://127.0.0.1:${uiPort}`
const ui = await preview({ root: dashboardRoot, configFile: false, preview: { host: '127.0.0.1', port: uiPort, strictPort: true } })
const node = { id: 'root', title: 'Root spec', status: 'active', parent: null, body: '# Root spec\n\nReadable prose.', code: ['src/app.js'] }
const board = { nodes: [node], sessions: [], issuesStamp: null }
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
const sockets = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text()) })
page.on('websocket', (socket) => sockets.push(socket.url()))
const state = () => page.evaluate(() => ({
  hash: location.hash,
  tabs: [...document.querySelectorAll('[role="tab"][data-tab-key]')].map((tab) => ({ key: tab.dataset.tabKey, selected: tab.getAttribute('aria-selected') === 'true' })),
  sections: [...document.querySelectorAll('.ft-section-name')].map((node) => node.textContent.trim()),
  graphActions: document.querySelectorAll('.graph-selection-actions').length,
  specHosts: [...document.querySelectorAll('.viewhost.view-spec')].map((host) => {
    if (!host.dataset.auditHostId) host.dataset.auditHostId = String(Math.random())
    return { id: host.dataset.auditHostId, hidden: host.getAttribute('aria-hidden') === 'true' }
  }),
  navigationCount: performance.getEntriesByType('navigation').length,
}))
const visit = async (hash, selector) => {
  await page.evaluate((next) => { location.hash = next }, hash)
  await page.waitForFunction((next) => location.hash === next, hash)
  if (selector) await page.locator(selector).first().waitFor({ state: 'visible', timeout: 60_000 })
  return state()
}
try {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
    if (pathname === '/api/specs/root/content') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: node.body, parts: null }) })
    if (pathname === '/api/source') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ size: 18, offset: 0, bytes: 18, text: 'export const app = 1', eof: true }) })
    if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.addInitScript(() => localStorage.removeItem('spexcode.tabs'))
  const sessions = await (async () => {
    await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
    await page.locator('.viewhost.view-sessions').waitFor({ state: 'attached' })
    return state()
  })()
  assert.deepEqual(sessions.tabs, [], 'cold Sessions has no board tabs')
  const spec = await visit('#/spec', '.viewhost.view-spec .graphview')
  assert.deepEqual(spec.tabs, [{ key: '#/spec', selected: true }])
  assert.deepEqual(spec.sections, ['Specs', 'Files'])
  assert.equal(spec.graphActions, 0, 'rejected graph marquee toolbar stays absent')
  await visit('#/spec/root', '.viewhost.view-spec .specview')
  const file = await visit('#/file/src/app.js', '.viewhost.view-file .cm-editor')
  assert.deepEqual(file.tabs, [
    { key: '#/spec', selected: false }, { key: '#/file/src/app.js', selected: true },
  ])
  assert.ok(file.specHosts.length >= 1, 'Spec host remains in the pool beside the file')
  assert.ok(file.specHosts.some((host) => host.id === spec.specHosts[0].id), 'Spec host identity survives opening a file')
  const evals = await visit('#/evals', '.viewhost.view-evals')
  assert.deepEqual(evals.tabs, [
    { key: '#/spec', selected: false }, { key: '#/file/src/app.js', selected: false }, { key: '#/evals', selected: true },
  ])
  const issues = await visit('#/issues', '.viewhost.view-issues')
  assert.deepEqual(issues.tabs, [
    { key: '#/spec', selected: false }, { key: '#/file/src/app.js', selected: false },
    { key: '#/evals', selected: false }, { key: '#/issues', selected: true },
  ])
  const settings = await visit('#/settings', '.viewhost.view-settings')
  assert.deepEqual(settings.tabs, [
    { key: '#/spec', selected: false }, { key: '#/file/src/app.js', selected: false },
    { key: '#/evals', selected: false }, { key: '#/issues', selected: false }, { key: '#/settings', selected: true },
  ])
  const specAgain = await visit('#/spec', '.viewhost.view-spec .graphview')
  assert.deepEqual(specAgain.tabs, settings.tabs.map((tab) => ({ ...tab, selected: tab.key === '#/spec' })))
  assert.equal(specAgain.specHosts.length, 2, 'Spec graph/detail hosts remain pooled after board switches')
  assert.ok(specAgain.specHosts.some((host) => host.id === spec.specHosts[0].id), 'Spec host survives board switches without remount')
  const sessionsAgain = await visit('#/sessions', '.viewhost.view-sessions')
  assert.deepEqual(sessionsAgain.tabs, settings.tabs.map((tab) => ({ ...tab, selected: false })), 'Sessions keeps the opened working set but no board tab focused')
  assert.equal(file.navigationCount, 1, 'route transitions do not reload the document')
  assert.deepEqual(sockets, [], 'board-only route walk opens no terminal sockets')
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  await page.screenshot({ path: join(out, 'selection-tab-audit.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, base, sessions, spec, file, evals, issues, settings, specAgain, sessionsAgain, sockets, screenshot: join(out, 'selection-tab-audit.png') }))
} finally {
  await page.close(); await browser.close(); await ui.close()
}
