import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5178'
const API = process.env.API || 'http://127.0.0.1:8788'
const OUT = resolve(process.env.OUT || '/tmp/lifecycle-outcome-e2e')
const SESSION = 'lifecycle-outcome-fixture'
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const graph = await fetch(`${API}/api/graph`).then((response) => response.json())
const baseSession = graph.sessions?.[0]
assert.ok(baseSession, 'the fixture needs one public session shape')
graph.sessions = [{
  ...baseSession,
  id: SESSION,
  label: 'lifecycle outcome fixture',
  headline: 'lifecycle outcome fixture',
  status: 'offline',
  lifecycle: 'idle',
  liveness: 'offline',
  archived: false,
  archiveHazard: null,
}]

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.addInitScript(() => {
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})
const page = await context.newPage()
try {
  await page.route('**/api/graph*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
  })
  await page.route(`**/api/sessions/${SESSION}/resume`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300))
    await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({
      ok: false,
      error: 'fixture keeps the relaunch pending long enough to inspect',
    }) })
  })

  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  const relaunch = page.locator('.m-coldline-action').filter({ hasText: /relaunch|重新启动/i })
  await relaunch.waitFor({ state: 'visible' })
  await relaunch.click()
  await page.screenshot({ path: resolve(OUT, 'relaunch-pending.png'), fullPage: true })
  await page.waitForFunction(() => document.querySelector('.m-coldline-action')?.getAttribute('aria-busy') === 'true')
  assert.equal(await relaunch.locator('.si-coldline-busy').count(), 1)
  assert.match((await relaunch.textContent())?.trim() || '', /working|正在处理/i)
  assert.equal(await page.locator('.m-coldline .si-action-outcome.pending').count(), 0)
  await page.locator('.m-coldline .si-action-outcome.failed').waitFor({ state: 'visible' })
} finally {
  await context.close()
  await browser.close()
}
