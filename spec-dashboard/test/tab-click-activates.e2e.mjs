import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = resolve(process.env.SPEXCODE_DASHBOARD_ROOT || join(root, 'spec-dashboard'))
const dependencyRoot = resolve(root, '..', '..')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/tab-click-activates-e2e')
const apiPort = Number(process.env.API_PORT || 5296)
const uiPort = Number(process.env.PORT || 5297)
const base = `http://127.0.0.1:${uiPort}`
const seeded = [
  { page: 'file', param: 'alpha.md', query: null },
  { page: 'file', param: 'bravo.md', query: null },
]

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const backend = createHttpServer((request, response) => {
  const pathname = new URL(request.url, `http://127.0.0.1:${apiPort}`).pathname
  if (pathname.endsWith('/stream')) {
    response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.end('event: board\\ndata: {}\\n\\n'); return
  }
  const body = pathname.endsWith('/graph') ? { nodes: [], sessions: [], files: [], issuesStamp: null } : []
  response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body))
})
await new Promise((resolveListen) => backend.listen(apiPort, '127.0.0.1', resolveListen))
process.env.API_URL = `http://127.0.0.1:${apiPort}`
const { createServer } = await import(pathToFileURL(viteEntry).href)
const ui = await createServer({ root: dashboardRoot, configFile: join(dashboardRoot, 'vite.config.js'), server: { host: '127.0.0.1', port: uiPort, strictPort: true } })
await ui.listen()
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()) })

const state = () => page.locator('[role="tab"][data-tab-key]:visible').evaluateAll((items) => items.map((item) => ({
  key: item.dataset.tabKey, active: item.getAttribute('aria-selected') === 'true',
})))

try {
  await page.addInitScript((tabs) => localStorage.setItem('spexcode.tabs', JSON.stringify(tabs)), seeded)
  await page.goto(`${base}/#/file/alpha.md`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-tab-key="#/file/alpha.md"] .tab-face').waitFor({ state: 'visible' })
  const before = await state()
  assert.deepEqual(before, [
    { key: '#/file/alpha.md', active: true },
    { key: '#/file/bravo.md', active: false },
  ])
  await page.locator('[data-tab-key="#/file/bravo.md"] .tab-face').click()
  await page.waitForFunction(() => location.hash === '#/file/bravo.md')
  await page.waitForFunction(() => document.querySelector('[data-tab-key="#/file/bravo.md"]')?.getAttribute('aria-selected') === 'true')
  const after = await state()
  assert.deepEqual(after, [
    { key: '#/file/alpha.md', active: false },
    { key: '#/file/bravo.md', active: true },
  ])
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  const screenshot = join(out, 'click-activates-tab.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: true, before, after, hash: await page.evaluate(() => location.hash), screenshot }, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, before, after, screenshot }))
} catch (error) {
  const screenshot = join(out, 'click-activates-tab-fail.png')
  await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {})
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: false, error: String(error), screenshot }, null, 2) + '\n')
  throw error
} finally {
  await page.close(); await browser.close(); await ui.close()
  await new Promise((resolveClose) => backend.close(resolveClose))
}
