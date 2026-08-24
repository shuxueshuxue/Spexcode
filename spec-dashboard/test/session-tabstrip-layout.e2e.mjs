// Real-Chromium proof for the Sessions document layout owner. The forest and its document tabstrip must
// share one horizontal frame: the forest pays its width before the strip begins, rather than the strip
// spanning above a list that starts underneath it.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = resolve(root, '..', '..')
const vitePath = resolve(existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : dependencyRoot, 'node_modules/vite/dist/node/index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-tabstrip-layout-e2e')
const freePort = () => new Promise((done, fail) => {
  const server = net.createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => done(port)) })
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const port = await freePort()
const base = `http://127.0.0.1:${port}`
const { createServer } = await import(pathToFileURL(vitePath).href)
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const sessions = [
  { id: 'session-a', title: 'Session A', label: 'Session A', status: 'working', liveness: 'working', parent: null, source: 'src/a', capabilities: { headless: true } },
  { id: 'session-b', title: 'Session B', label: 'Session B', status: 'asking', liveness: 'working', parent: null, source: 'src/b', capabilities: { headless: true } },
]
const board = { nodes: [], sessions, issuesStamp: null }
const vite = await createServer({ root: dashboardRoot, configFile: join(dashboardRoot, 'cvid.vite.config.mjs'), server: { host: '127.0.0.1', port, strictPort: true } })
await vite.listen()
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()) })
await page.route('**/api/**', async (route) => {
  const { pathname } = new URL(route.request().url())
  if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
  if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
})
await page.addInitScript(() => {
  localStorage.clear()
  localStorage.setItem('spexcode.dock', '0')
  localStorage.setItem('spexcode.tabs', JSON.stringify([{ page: 'sessions', param: 'session-a', query: null, pinned: true }]))
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})

await page.goto(`${base}/#/sessions/session-a`, { waitUntil: 'domcontentloaded' })
await page.locator('.si-list').waitFor({ state: 'visible' })
await page.locator('.si-document > .tabstrip').waitFor({ state: 'visible' })
const geometry = await page.evaluate(() => {
  const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null
  const list = rect('.si-list')
  const documentColumn = rect('.si-document')
  const strip = rect('.si-document > .tabstrip')
  const panel = rect('.si-document > .si-panel')
  const content = rect('.si-content')
  return {
    viewport: { width: innerWidth, height: innerHeight },
    list, documentColumn, strip, panel, content,
    shellStrip: Boolean(document.querySelector('.app-main > .tabstrip')),
    clip: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
    errors: [],
  }
})
geometry.errors = errors
assert.equal(geometry.shellStrip, false, 'Sessions must not render a second shell-level tabstrip')
assert.ok(geometry.list && geometry.documentColumn && geometry.strip && geometry.content, 'Sessions layout is rendered')
assert.equal(Math.round(geometry.list.right), Math.round(geometry.documentColumn.left), 'forest width pushes document column right')
assert.equal(Math.round(geometry.strip.left), Math.round(geometry.documentColumn.left), 'tabstrip begins at document column edge')
assert.equal(Math.round(geometry.strip.top), Math.round(geometry.list.top), 'forest and tabstrip share the top edge')
assert.equal(Math.round(geometry.content.top), Math.round(geometry.strip.bottom), 'content begins below its document tabstrip')
assert.equal(geometry.clip.scrollWidth, geometry.clip.clientWidth, 'layout does not create horizontal clipping')
assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`)
assert.equal(await page.locator('.document-action-button[data-action="session-menu"]').count(), 0, 'session lifecycle is not a toolbar action')
await page.locator('.tab[data-tab-key^="#/sessions/"]').first().click({ button: 'right' })
const contextMenu = page.locator('[role="menu"]').last()
await contextMenu.waitFor({ state: 'visible' })
const contextText = await contextMenu.textContent()
assert.match(contextText, /rename/i, 'session tab menu keeps rename')
assert.match(contextText, /close/i, 'session tab menu keeps close')
await page.screenshot({ path: join(out, 'session-tabstrip-layout.png'), fullPage: true })
await context.close()
await browser.close()
await vite.close()
console.log(JSON.stringify(geometry, null, 2))
