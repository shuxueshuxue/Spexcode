import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5198'
const OUT = resolve(process.env.OUT || '/tmp/session-sidebar-scroll-e2e')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const now = Date.now()
const fixture = structuredClone(graph)
fixture.sessions = Array.from({ length: 28 }, (_, index) => ({
  id: `sidebar-scroll-${String(index + 1).padStart(2, '0')}`,
  label: `scroll probe ${index + 1}`,
  headline: `scroll probe session ${index + 1}`,
  status: index % 4 === 0 ? 'asking' : 'working',
  liveness: 'online',
  created: now - index,
  sortKey: now - index,
  parent: null,
  archived: false,
  ops: [],
  capabilities: { headless: true },
}))

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 900, height: 420 } })
await context.addInitScript(() => {
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(fixture),
}))

try {
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  const sidebar = page.locator('.si-list')
  await sidebar.waitFor({ state: 'visible' })
  await page.locator('.si-item').last().waitFor({ state: 'attached' })

  const geometry = await sidebar.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      height: bounds.height,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      overflowY: getComputedStyle(element).overflowY,
      viewportHeight: window.innerHeight,
    }
  })
  writeFileSync(`${OUT}/geometry.json`, `${JSON.stringify(geometry, null, 2)}\n`)
  await page.screenshot({ path: `${OUT}/session-sidebar.png` })

  assert.ok(geometry.bottom <= geometry.viewportHeight + 1,
    `sidebar escaped viewport: bottom=${geometry.bottom}, viewport=${geometry.viewportHeight}`)
  assert.ok(geometry.scrollHeight > geometry.clientHeight,
    `sidebar did not become a scrollport: scrollHeight=${geometry.scrollHeight}, clientHeight=${geometry.clientHeight}`)
  assert.equal(geometry.overflowY, 'auto')
} finally {
  await context.close()
  await browser.close()
}

console.log(`session sidebar scroll e2e passed; evidence: ${OUT}`)
