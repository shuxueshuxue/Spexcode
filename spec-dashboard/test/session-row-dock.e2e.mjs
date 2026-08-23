import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const base = process.env.BASE || 'http://127.0.0.1:5327'
const out = process.env.OUT || '/tmp/session-row-dock-e2e'
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const { chromium } = await import(pathToFileURL(playwrightPath).href)

const graph = await fetch(`${base}/api/graph`).then((response) => response.json())
const sessions = graph.sessions || []
const child = sessions.find((session) => session.parent && session.liveness !== 'offline')
const target = sessions.find((session) => session.id !== child?.id && session.id !== child?.parent
  && session.liveness !== 'offline' && !session.parent)
assert.ok(child && target, 'the live board needs a nested child and a separate root target')

const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
const context = await browser.newContext({ viewport: { width: 900, height: 720 } })
await context.addInitScript(() => {
  localStorage.setItem('spexcode.dock', '1')
  localStorage.setItem('spexcode.dockMode', 'sessions')
})
const page = await context.newPage()
await page.route('**/api/sessions/reparent', (route) => route.fulfill({
  status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }),
}))
await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
const source = page.locator(`.dock-session-list .si-tree-row:has(> .si-item[data-sid="${child.id}"])`)
const destination = page.locator(`.dock-session-list .si-tree-row:has(> .si-item[data-sid="${target.id}"])`)
await source.waitFor({ state: 'visible' })
await destination.waitFor({ state: 'visible' })
const sourceBox = await source.locator('> .si-item').boundingBox()
const destinationBox = await destination.boundingBox()
assert.ok(sourceBox && destinationBox, 'source and target rows have screen bounds')
await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
await page.mouse.down()
await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 70, sourceBox.y + sourceBox.height / 2 + 8, { steps: 12 })
await page.waitForTimeout(300)
assert.match((await page.locator('body').getAttribute('class')) || '', /is-session-dragging/)
assert.equal(await source.evaluate((row) => row.classList.contains('dragging')), true)
await page.mouse.move(destinationBox.x + destinationBox.width / 2, destinationBox.y + destinationBox.height / 2)
await page.waitForFunction((id) => document.querySelector(`[data-session-drop-id="${id}"]`)?.classList.contains('drop-target'), target.id)
assert.equal(await destination.evaluate((row) => row.classList.contains('drop-target')), true)
assert.equal(await page.locator('.si-session-drag-ghost').count(), 0)
await page.screenshot({ path: `${out}/dock-row-drag.png`, fullPage: true })
await page.mouse.up()
console.log(JSON.stringify({ ok: true, child: child.id, target: target.id, ghost: 0 }))
await browser.close()
