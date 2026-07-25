import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5198'
const OUT = resolve(process.env.OUT || '/tmp/session-multi-select-e2e')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const sessions = graph.sessions || []
const childCount = new Map()
for (const session of sessions) {
  if (session.parent) childCount.set(session.parent, (childCount.get(session.parent) || 0) + 1)
}
const parent = sessions.find((session) => childCount.has(session.id) && session.liveness !== 'offline')
assert.ok(parent, 'the live board needs one present parent session')

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 900, height: 720 } })
await context.addInitScript(() => {
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(graph),
}))

try {
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  const treeRow = page.locator(`.si-tree-row:has(> .si-item[data-sid="${parent.id}"])`)
  const row = treeRow.locator('> .si-item')
  const count = treeRow.locator('> .sess-fold-control')
  const headline = row.locator('.sess-id')
  await row.waitFor({ state: 'visible' })
  await count.waitFor({ state: 'visible' })
  assert.equal(await row.evaluate((node) => node.classList.contains('on')), false,
    'the geometry probe needs a resting parent row')

  const before = {
    count: await count.boundingBox(),
    headline: await headline.boundingBox(),
  }
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /select/i }).click()
  await row.locator('.si-check').waitFor({ state: 'visible' })
  const after = {
    checkbox: await row.locator('.si-check').boundingBox(),
    count: await count.boundingBox(),
    headline: await headline.boundingBox(),
  }
  await page.screenshot({ path: `${OUT}/nested-count-select-mode.png` })

  assert.ok(before.count && before.headline && after.checkbox && after.count && after.headline)
  const countShift = after.count.x - before.count.x
  const headlineShift = after.headline.x - before.headline.x
  assert.ok(headlineShift > 0, 'the checkbox must shift the row face to the right')
  assert.ok(Math.abs(countShift - headlineShift) < 0.5,
    `nested count and headline must move together (count ${countShift}px, headline ${headlineShift}px)`)
  assert.ok(after.checkbox.x + after.checkbox.width <= after.count.x,
    'the checkbox and nested-session count must not overlap')
} finally {
  await context.close()
  await browser.close()
}

console.log(`session multi-select proof: ${OUT}`)
