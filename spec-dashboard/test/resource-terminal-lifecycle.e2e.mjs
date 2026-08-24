// YATU resource lifecycle proof: a pane-backed terminal is warm while its pane is live, and is disposed
// when the authoritative board changes that pane to offline/archived. The conversation layer remains readable.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const OUT = resolve(process.env.OUT || '/tmp/resource-terminal-lifecycle')
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })

const response = await fetch(`${BASE}/api/graph`)
assert.equal(response.status, 200, `dashboard graph returned ${response.status}`)
const liveGraph = await response.json()
const id = `resource-terminal-lifecycle-${process.pid}`
const secondId = `${id}-second`
const baseSession = {
  id, node: null, branch: null, path: process.cwd(), label: 'resource lifecycle fixture',
  headline: 'resource lifecycle fixture', title: 'resource lifecycle fixture', raw: { name: 'resource lifecycle fixture', title: null },
  harness: 'claude', capabilities: { headless: false }, launcher: null, status: 'working', lifecycle: 'active',
  proposal: null, merges: 0, liveness: 'online', parent: null, note: null, archived: false,
  archiveHazard: null, prompt: null, promptPreview: null, created: Date.now(), activity: null, sortKey: Date.now(), files: [], web: [],
}
const secondSession = { ...baseSession, id: secondId, label: 'resource lifecycle second fixture', headline: 'resource lifecycle second fixture', title: 'resource lifecycle second fixture' }
const fixtureFor = (patch = {}) => ({ ...structuredClone(liveGraph), sessions: [{ ...baseSession, ...patch }, secondSession] })
let fixture = fixtureFor()

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => {
  const streams = new Set()
  window.__fixtureSocketState = { created: 0, closed: 0, active: 0 }
  class FixtureEventSource {
    constructor() { this.listeners = new Map(); streams.add(this) }
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) }
    emit(name, data) { for (const fn of this.listeners.get(name) || []) fn({ data: JSON.stringify(data) }) }
    close() { streams.delete(this) }
  }
  window.EventSource = FixtureEventSource
  window.__emitFixtureGraph = (graph, tag) => { for (const source of streams) source.emit('graph-full', { to: tag, graph }) }
  class FixtureWebSocket {
    constructor() {
      window.__fixtureSocketState.created += 1
      window.__fixtureSocketState.active += 1
      this.readyState = 0; this.listeners = new Map()
      setTimeout(() => { this.readyState = 1; this.dispatch('open', {}) }, 0)
    }
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) }
    removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn)) }
    dispatch(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); this[`on${name}`]?.(event) }
    send() {}
    close() {
      if (this.readyState >= 2) return
      window.__fixtureSocketState.closed += 1
      window.__fixtureSocketState.active -= 1
      this.readyState = 3; this.dispatch('close', {})
    }
  }
  window.WebSocket = FixtureWebSocket
})
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }))
await page.route('**/api/sessions/archive-index*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
try {
  await page.goto(`${BASE}/#/sessions/${id}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-term-layer[style*="visibility: visible"] .xterm').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('.si-term-layer .xterm').count(), 2, 'both live panes mount one resident terminal each')
  await page.locator('.si-term-layer[style*="visibility: visible"] .xterm').evaluate((node) => { node.dataset.lifecycleIdentity = 'first' })
  const initialActiveSockets = await page.evaluate(() => window.__fixtureSocketState.active)
  assert.ok(initialActiveSockets >= 2, 'two live sessions own active terminal sockets')

  // Changing the session address is an inactive-pane transition, not a document teardown. The first xterm
  // must remain mounted and hidden while the second session warms exactly one independent terminal/socket.
  await page.goto(`${BASE}/#/sessions/${secondId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-term-layer[style*="visibility: visible"] .xterm').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('.si-term-layer .xterm').count(), 2, 'switch keeps the first terminal mounted')
  assert.equal(await page.locator('.si-term-layer .xterm[data-lifecycle-identity="first"]').count(), 1, 'first terminal identity survives inactive switch')
  assert.equal(await page.locator('.si-term-layer .xterm[data-lifecycle-identity="first"]').evaluate((node) => getComputedStyle(node.parentElement).visibility), 'hidden', 'first terminal is hidden, not detached')
  assert.equal(await page.evaluate(() => window.__fixtureSocketState.active), initialActiveSockets, 'switch keeps the active socket set stable')

  // Returning to the first session restores the same DOM/xterm and socket instead of cold-loading it again.
  await page.goto(`${BASE}/#/sessions/${id}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-term-layer[style*="visibility: visible"] .xterm').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('.si-term-layer .xterm[data-lifecycle-identity="first"]').count(), 1, 'first terminal identity survives return')
  assert.equal(await page.locator('.si-term-layer .xterm[data-lifecycle-identity="first"]').evaluate((node) => getComputedStyle(node.parentElement).visibility), 'visible', 'first terminal becomes visible again')
  assert.equal(await page.evaluate(() => window.__fixtureSocketState.active), initialActiveSockets, 'return keeps the active socket set stable')
  await page.screenshot({ path: `${OUT}/online-terminal.png`, fullPage: true })

  fixture = fixtureFor({ status: 'offline', lifecycle: 'error', liveness: 'offline', archived: true })
  await page.evaluate((baseline) => sessionStorage.setItem('resource-terminal-baseline', String(baseline)), initialActiveSockets)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('.si-term-layer .xterm').count(), 1, 'offline session has no terminal and other live pane remains resident')
  const offlineBaseline = Number(await page.evaluate(() => sessionStorage.getItem('resource-terminal-baseline')))
  assert.equal(await page.evaluate(() => window.__fixtureSocketState.active), offlineBaseline - 1, 'offline reload leaves exactly one fewer active socket')
  assert.equal(await page.locator('.tl-chat:visible textarea').count(), 1, 'conversation remains available after pane disposal')
  await page.screenshot({ path: `${OUT}/offline-conversation.png`, fullPage: true })
  console.log(JSON.stringify({ status: 'pass', terminalOnline: 2, terminalOffline: 1, warmSwitch: true, initialActiveSockets, finalActiveSockets: initialActiveSockets - 1, conversation: true, out: OUT }))
} finally {
  await context.close(); await browser.close()
}
