// Real-browser proof that a deep working set keeps the strip on ONE row, clips the tail, marks the list
// button, and that the list reaches a clipped tab and brings it back into view ([[tab-strip]], [[tab-layout]]).
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))   // fileURLToPath, not .pathname: a worktree path with non-ASCII segments arrives percent-encoded otherwise
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : resolve(root, '..', '..')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/tab-overflow-list-e2e')
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
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text()) })

// twelve documents at the 120px floor is 1440px of tabs: wider than the row can be at this viewport.
const tabs = Array.from({ length: 12 }, (_, index) => ({ page: 'file', param: `folder/document-${index}.md`, query: null }))
tabs.push({ page: 'settings', param: null, query: null })

try {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ nodes: [], sessions: [], issuesStamp: null }) })
    if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.addInitScript((seed) => {
    localStorage.clear()
    localStorage.setItem('spexcode.tabs.root', JSON.stringify(seed))
    localStorage.setItem('spexcode.dock', '0')
    localStorage.setItem('spexcode.lang', 'en')
    localStorage.setItem('spexcode.theme', 'minimal')
  }, tabs)
  await page.goto(`http://127.0.0.1:${port}/#/settings`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-settings').waitFor({ state: 'visible' })
  await page.locator('.tab-list-button.clipped').waitFor({ state: 'visible' })

  const geometry = () => page.evaluate(() => {
    const host = document.querySelector('.tabstrip-tabs')
    const strip = document.querySelector('.tabstrip')
    const hostBox = host.getBoundingClientRect()
    const tabs = [...document.querySelectorAll('.tab')]
    const visible = (tab) => { const b = tab.getBoundingClientRect(); return b.left >= hostBox.left - 1 && b.right <= hostBox.right + 1 }
    return {
      stripHeight: strip.getBoundingClientRect().height,
      rows: new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().top))).size,
      count: tabs.length,
      hidden: tabs.filter((tab) => !visible(tab)).map((tab) => ({ key: tab.dataset.tabKey, label: tab.querySelector('.tab-label').textContent })),
      active: document.querySelector('.tab.on')?.dataset.tabKey || null,
      activeVisible: !!document.querySelector('.tab.on') && visible(document.querySelector('.tab.on')),
      clipped: !!document.querySelector('.tab-list-button.clipped'),
    }
  })

  const before = await geometry()
  assert.equal(before.count, tabs.length, 'every seeded tab is in the strip')
  assert.equal(before.rows, 1, `the strip must stay on one row, got ${before.rows}`)
  assert.equal(before.stripHeight, 36, `the band is --line-top tall, got ${before.stripHeight}`)
  assert.ok(before.hidden.length > 0, 'a deep working set clips some tabs')
  assert.ok(before.clipped, 'the list button marks that tabs are clipped')
  assert.equal(before.active, '#/settings')
  assert.ok(before.activeVisible, 'the active tab is scrolled into the visible stretch')
  await page.screenshot({ path: join(out, 'one-row-clipped.png'), clip: { x: 0, y: 0, width: 1000, height: 120 } })

  // the list names every held tab, including the clipped ones, and reaches one of them
  await page.locator('.tab-list-button').click()
  const menu = page.locator('.sess-menu [role=menuitem]')
  assert.equal(await menu.count(), tabs.length, 'the list has one row per held tab')
  assert.equal(await page.locator('.sess-menu .tab-list-current').count(), 1, 'the active tab is marked in the list')
  await page.screenshot({ path: join(out, 'tab-list-open.png'), clip: { x: 0, y: 0, width: 1000, height: 420 } })
  const target = before.hidden[0]
  await menu.filter({ hasText: target.label }).first().click()
  await page.locator(`.tab.on[data-tab-key="${target.key}"]`).waitFor({ state: 'visible' })
  const after = await geometry()
  assert.equal(after.active, target.key, 'the list opened the clipped tab')
  assert.ok(after.activeVisible, 'the newly active tab is brought into the visible stretch')
  assert.equal(after.rows, 1, 'still one row after focusing a clipped tab')
  assert.equal(await page.locator('.sess-menu').count(), 0, 'the list closes on choice')
  await page.screenshot({ path: join(out, 'clipped-tab-focused.png'), clip: { x: 0, y: 0, width: 1000, height: 120 } })

  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  console.log(JSON.stringify({ ok: true, before, after, screenshots: out }))
} finally {
  await page.close()
  await browser.close()
  await ui.close()
}
