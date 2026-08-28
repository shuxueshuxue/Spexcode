// Real-browser proof that a short tab on a wrapped final row keeps its content width.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import net from 'node:net'

const root = resolve(new URL('../..', import.meta.url).pathname)
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : resolve(root, '..', '..')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/tab-wrap-intrinsic-width-e2e')
const port = await new Promise((done, fail) => {
  const server = net.createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => done(value)) })
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const { createServer } = await import(pathToFileURL(viteEntry).href)
const ui = await createServer({ root: dashboardRoot, configFile: join(dashboardRoot, 'vite.config.js'), server: { host: '127.0.0.1', port, strictPort: true } })
await ui.listen()
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text()) })

const tabs = Array.from({ length: 8 }, (_, index) => ({ page: 'file', param: `f${index}.md`, query: null, pinned: true }))
tabs.push({ page: 'settings', param: null, query: null, pinned: true })

try {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], sessions: [], issuesStamp: null }) })
    if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.addInitScript((seed) => {
    localStorage.clear()
    localStorage.setItem('spexcode.tabs', JSON.stringify(seed))
    localStorage.setItem('spexcode.dock', '0')
    localStorage.setItem('spexcode.lang', 'en')
    localStorage.setItem('spexcode.theme', 'minimal')
  }, tabs)
  await page.goto(`http://127.0.0.1:${port}/#/settings`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-settings').waitFor({ state: 'visible' })
  const geometry = await page.evaluate(() => {
    const settings = document.querySelector('.tab[data-tab-key="#/settings"]')
    const host = document.querySelector('.tabstrip-tabs')
    const rect = (element) => element?.getBoundingClientRect().toJSON() || null
    return {
      host: rect(host),
      settings: rect(settings),
      rows: new Set([...document.querySelectorAll('.tab')].map((tab) => Math.round(tab.getBoundingClientRect().top))).size,
    }
  })
  assert.ok(geometry.host && geometry.settings, 'wrapped tab strip is rendered')
  assert.ok(geometry.rows >= 2, `expected wrapped rows, got ${geometry.rows}`)
  assert.ok(geometry.settings.width <= 240, `short Settings tab stretched to ${geometry.settings.width}px`)
  assert.ok(geometry.settings.width < geometry.host.width / 2, 'Settings must not consume the final row')
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  await page.screenshot({ path: join(out, 'tab-wrap-intrinsic-width.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, geometry, screenshot: join(out, 'tab-wrap-intrinsic-width.png') }))
} finally {
  await page.close()
  await browser.close()
  await ui.close()
}
