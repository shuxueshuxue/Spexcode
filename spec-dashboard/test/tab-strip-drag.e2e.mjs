import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = resolve(root, '..', '..')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/tab-strip-drag-e2e')
const port = Number(process.env.PORT || 5291)
const base = `http://127.0.0.1:${port}`
const tabs = [
  { page: 'file', param: 'alpha.md', query: null, pinned: true },
  { page: 'file', param: 'bravo.md', query: null, pinned: true },
  { page: 'file', param: 'charlie.md', query: null, pinned: true },
]

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const { createServer } = await import(pathToFileURL(viteEntry).href)
const ui = await createServer({ root: dashboardRoot, configFile: join(dashboardRoot, 'vite.config.js'), server: { host: '127.0.0.1', port, strictPort: true } })
await ui.listen()
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text()) })
await page.route('**/api/**', async (route) => {
  const pathname = new URL(route.request().url()).pathname
  if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
  if (pathname.endsWith('/graph')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], sessions: [], files: [], issuesStamp: null }) })
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})

const order = () => page.locator('[role="tab"][data-tab-key]:visible').evaluateAll((items) => items.map((item) => item.dataset.tabKey))
const dragTo = async (key, point) => {
  const box = await page.locator(`[data-tab-key="${key}"]`).boundingBox()
  assert.ok(box, `${key} has no rendered bounds`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y)
}

try {
  await page.addInitScript((seed) => { if (!localStorage.getItem('spexcode.tabs')) localStorage.setItem('spexcode.tabs', JSON.stringify(seed)) }, tabs)
  await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator('[role="tab"][data-tab-key="#/file/alpha.md"]').waitFor({ state: 'visible' })
  assert.deepEqual(await order(), ['#/file/alpha.md', '#/file/bravo.md', '#/file/charlie.md'])

  const bravo = await page.locator('[data-tab-key="#/file/bravo.md"]').boundingBox()
  assert.ok(bravo, 'bravo tab has no bounds')
  await dragTo('#/file/alpha.md', { x: bravo.x + bravo.width - 4, y: bravo.y + bravo.height / 2 })
  const movedBeforeRelease = await order()
  assert.deepEqual(movedBeforeRelease, ['#/file/bravo.md', '#/file/alpha.md', '#/file/charlie.md'], 'motion must reorder before release')
  await page.mouse.up()
  assert.deepEqual(await order(), movedBeforeRelease)

  const host = await page.locator('.tabstrip-tabs').boundingBox()
  assert.ok(host, 'tab-list host has no bounds')
  await dragTo('#/file/bravo.md', { x: host.x + host.width - 4, y: host.y + host.height / 2 })
  const tailBeforeRelease = await order()
  assert.deepEqual(tailBeforeRelease, ['#/file/alpha.md', '#/file/charlie.md', '#/file/bravo.md'], 'host tail must append during motion')
  await page.mouse.up()
  assert.equal(await page.evaluate(() => location.hash), '#/sessions', 'reordering must not navigate')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[role="tab"][data-tab-key="#/file/bravo.md"]').waitFor({ state: 'visible' })
  assert.deepEqual(await order(), tailBeforeRelease, 'stored order must survive reload')

  await page.locator('[data-tab-key="#/file/charlie.md"] .tab-x').click()
  await page.waitForFunction(() => !document.querySelector('[data-tab-key="#/file/charlie.md"]'))
  assert.equal(await page.evaluate(() => location.hash), '#/sessions', 'closing a non-active tab must preserve route')
  assert.deepEqual(await order(), ['#/file/alpha.md', '#/file/bravo.md'])
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  await page.screenshot({ path: join(out, 'tab-strip-drag-final.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, movedBeforeRelease, tailBeforeRelease, final: await order(), screenshot: join(out, 'tab-strip-drag-final.png'), video: await page.video()?.path() }))
} finally {
  await page.close(); await browser.close(); await ui.close()
}
