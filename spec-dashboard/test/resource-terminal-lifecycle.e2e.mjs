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
const baseSession = {
  id, node: null, branch: null, path: process.cwd(), label: 'resource lifecycle fixture',
  headline: 'resource lifecycle fixture', title: 'resource lifecycle fixture', raw: { name: 'resource lifecycle fixture', title: null },
  harness: 'claude', capabilities: { headless: false }, launcher: null, status: 'working', lifecycle: 'active',
  proposal: null, merges: 0, liveness: 'online', parent: null, note: null, archived: false,
  archiveHazard: null, prompt: null, promptPreview: null, created: Date.now(), activity: null, sortKey: Date.now(), files: [], web: [],
}
const fixtureFor = (patch = {}) => ({ ...structuredClone(liveGraph), sessions: [{ ...baseSession, ...patch }] })
let fixture = fixtureFor()

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => {
  const streams = new Set()
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
      this.readyState = 0; this.listeners = new Map()
      setTimeout(() => { this.readyState = 1; this.dispatch('open', {}) }, 0)
    }
    addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) }
    removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn)) }
    dispatch(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); this[`on${name}`]?.(event) }
    send() {}
    close() { if (this.readyState >= 2) return; this.readyState = 3; this.dispatch('close', {}) }
  }
  window.WebSocket = FixtureWebSocket
})
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }))
try {
  await page.goto(`${BASE}/#/sessions/${id}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-term-layer .xterm').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('.si-term-layer .xterm').count(), 1, 'live pane mounts one terminal')
  await page.screenshot({ path: `${OUT}/online-terminal.png`, fullPage: true })

  fixture = fixtureFor({ status: 'offline', lifecycle: 'error', liveness: 'offline', archived: true })
  await page.evaluate((graph) => window.__emitFixtureGraph(graph, `offline-${Date.now()}`), fixture)
  await page.locator('.si-term-layer .xterm').waitFor({ state: 'detached', timeout: 30_000 })
  assert.equal(await page.locator('.si-term-layer .xterm').count(), 0, 'offline/archived pane disposes terminal')
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  assert.equal(await page.locator('.tl-chat:visible textarea').count(), 1, 'conversation remains available after pane disposal')
  await page.screenshot({ path: `${OUT}/offline-conversation.png`, fullPage: true })
  console.log(JSON.stringify({ status: 'pass', terminalOnline: 1, terminalOffline: 0, conversation: true, out: OUT }))
} finally {
  await context.close(); await browser.close()
}
