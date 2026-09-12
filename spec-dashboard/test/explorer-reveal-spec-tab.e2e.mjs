import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = resolve(root, '..', '..')
const vitePath = join(existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/explorer-reveal-spec-tab-e2e')
const port = Number(process.env.PORT || 5299)
const base = `http://127.0.0.1:${port}`
const node = { id: 'root', title: 'Root spec', status: 'active', parent: null, body: '# Root spec\n\nReadable prose.', code: ['src/app.js'] }
const board = { nodes: [node], sessions: [], issuesStamp: null }

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const { createServer } = await import(pathToFileURL(vitePath).href)
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const vite = await createServer({ root: dashboardRoot, configFile: join(dashboardRoot, 'cvid.vite.config.mjs'), server: { host: '127.0.0.1', port, strictPort: true } })
await vite.listen()
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()) })

try {
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
    if (pathname === '/api/specs/root/content') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: node.body, parts: null }) })
    if (pathname === '/api/files') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ entries: [], truncated: false }) })
    if (pathname === '/api/projects') return route.fulfill({ status: 404, body: 'not found' })
    if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.addInitScript(() => {
    localStorage.removeItem('spexcode.tabs.root')
    localStorage.setItem('spexcode.dock', '1')
    localStorage.setItem('spexcode.dockMode', 'explorer')
  })
  await page.goto(`${base}/#/spec`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-spec .graphview').waitFor({ state: 'visible' })
  await page.locator('.filetree').waitFor({ state: 'visible', timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}\nbody=${await page.locator('body').innerText()}`)
  })

  await page.locator('[data-menu-kind="node"][data-menu-id="root"] .ft-label').click({ button: 'right' })
  await page.getByRole('menu', { name: 'node actions' }).waitFor({ state: 'visible' })
  await page.getByRole('menuitem', { name: 'reveal on graph' }).click()
  await page.waitForFunction(() => location.hash === '#/spec/root')
  await page.locator('[data-tab-key="#/spec/root"]').waitFor({ state: 'visible' })

  const result = await page.evaluate(() => ({
    hash: location.hash,
    tabs: [...document.querySelectorAll('[role="tab"][data-tab-key]')].map((tab) => ({ key: tab.dataset.tabKey, active: tab.getAttribute('aria-selected') === 'true' })),
  }))
  assert.equal(result.hash, '#/spec/root')
  assert.deepEqual(result.tabs, [{ key: '#/spec/root', active: true }])
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  const screenshot = join(out, 'reveal-spec-tab.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  console.log(JSON.stringify({ ok: true, result, screenshot }))
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
