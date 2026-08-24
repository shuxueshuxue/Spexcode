// YATU proof: switching between resident session documents hides a terminal without rebuilding its
// browser identity. The isolated fixture records the real browser WebSocket protocol and keeps the
// xterm DOM mounted through the native bridge's bounded linger budget. The isolated browser fixture proves
// DOM/WS identity; pty-bridge owns native helper expiry and its 5s linger contract is covered separately.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import net from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const dashboardRoot = resolve(new URL('..', import.meta.url).pathname)
const viteEntry = resolve(dashboardRoot, '..', 'node_modules/vite/dist/node/index.js')
const OUT = resolve(process.env.OUT || '/tmp/session-term-warm-switch')
const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})
const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((done) => setTimeout(done, 80))
  }
  throw new Error(`timed out waiting for ${label}`)
}

if (!existsSync(PW)) throw new Error(`Playwright is missing: ${PW}`)
if (!existsSync(CHROMIUM)) throw new Error(`Chromium is missing: ${CHROMIUM}`)
if (!existsSync(resolve(dashboardRoot, 'dist', 'index.html'))) throw new Error('prebuilt spec-dashboard/dist is required; run npm run build first')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const idA = `warm-switch-a-${process.pid}`
const idB = `warm-switch-b-${process.pid}`
const session = (id, label) => ({
  id, node: null, branch: null, path: process.cwd(), label, headline: label, title: label,
  raw: { name: label, title: null }, harness: 'claude', capabilities: { headless: false }, launcher: null,
  status: 'working', lifecycle: 'active', proposal: null, merges: 0, liveness: 'online', parent: null,
  note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null,
  created: Date.now(), activity: null, sortKey: Date.now(), files: [], web: [],
})
const graph = { sessions: [session(idA, 'resident A'), session(idB, 'resident B')], specs: [], files: [], issues: [] }
const tabs = JSON.stringify([
  { page: 'sessions', param: idA, query: null, pinned: true },
  { page: 'sessions', param: idB, query: null, pinned: true },
])
const port = await freePort()
const base = `http://127.0.0.1:${port}`
const { preview } = await import(pathToFileURL(viteEntry).href)
const ui = await preview({ root: dashboardRoot, configFile: false, preview: { host: '127.0.0.1', port, strictPort: true } })
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
await context.addInitScript(({ tabs: initialTabs }) => {
  localStorage.setItem('spexcode.tabs', initialTabs)
  const sockets = []
  class FixtureWebSocket {
    constructor(url) {
      this.url = url; this.readyState = 0; this.listeners = new Map(); this.sent = []
      sockets.push(this)
      setTimeout(() => {
        this.readyState = 1; this.dispatch('open', {})
        this.dispatch('message', { data: new TextEncoder().encode('fixture-screen\r\n').buffer })
      }, 0)
    }
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) }
    removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn)) }
    dispatch(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); this[`on${name}`]?.(event) }
    send(data) { this.sent.push(String(data)) }
    close() { if (this.readyState >= 2) return; this.readyState = 3; this.dispatch('close', {}) }
  }
  window.WebSocket = FixtureWebSocket
  window.__warmSockets = sockets
}, { tabs })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(String(error)))
await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) }))
await page.route('**/api/sessions/*/timeline', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) }))
await page.route('**/api/sessions/*/transcript', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }))
await page.route('**/api/sessions/archive-index', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
await page.route('**/api/slash-commands*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }))
try {
  await page.goto(`${base}/#/sessions/${idA}?surface=terminal`, { waitUntil: 'domcontentloaded' })
  const terminals = () => page.locator('.si-term-layer .xterm')
  const terminal = (index) => terminals().nth(index)
  await terminal(0).waitFor({ state: 'visible', timeout: 30_000 })
  const identityA = await terminal(0).evaluate((node) => { node.dataset.auditId ||= crypto.randomUUID(); return node.dataset.auditId })
  await page.goto(`${base}/#/sessions/${idB}?surface=terminal`, { waitUntil: 'domcontentloaded' })
  await terminal(1).waitFor({ state: 'visible', timeout: 30_000 })
  const identityB = await terminal(1).evaluate((node) => { node.dataset.auditId ||= crypto.randomUUID(); return node.dataset.auditId })
  const hiddenWaitMs = 5_500
  await new Promise((done) => setTimeout(done, hiddenWaitMs))
  assert.equal(await terminals().count(), 2, 'hidden session keeps xterm mounted beyond linger')
  await page.goto(`${base}/#/sessions/${idA}?surface=terminal`, { waitUntil: 'domcontentloaded' })
  await terminal(0).waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await terminal(0).evaluate((node) => node.dataset.auditId), identityA, 'reactivation keeps xterm DOM identity')
  assert.equal(await terminal(1).evaluate((node) => node.dataset.auditId), identityB, 'inactive sibling keeps xterm DOM identity')
  const protocol = await page.evaluate(() => window.__warmSockets.map((socket) => ({ url: socket.url, sent: socket.sent })))
  const byId = (id) => protocol.filter((socket) => socket.url.includes(`/api/sessions/${id}/socket`))
  assert.equal(byId(idA).length, 1, 'session A has one browser WebSocket')
  assert.equal(byId(idB).length, 1, 'session B has one browser WebSocket')
  assert.ok(byId(idA)[0].sent.some((message) => message.includes('"visible":false')), 'session A sends hidden visibility claim')
  assert.ok(byId(idA)[0].sent.some((message) => message.includes('"t":"resize"')), 'session A sends resize when reactivated')
  assert.deepEqual(pageErrors, [], 'browser has no page errors')
  await page.screenshot({ path: `${OUT}/warm-switch.png`, fullPage: true })
  console.log(JSON.stringify({ status: 'pass', hiddenWaitMs, identities: { [idA]: identityA, [idB]: identityB }, sockets: protocol.length, out: OUT }))
} finally {
  await context.close(); await browser.close(); await ui.close()
}
