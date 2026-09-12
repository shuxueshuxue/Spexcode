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
// the list is the FRAME's navigator now ([[dock-modes]]), not a projection inside the finding dock
const source = page.locator(`.app > .si-list .si-tree-row:has(> .si-item[data-sid="${child.id}"])`)
const destination = page.locator(`.app > .si-list .si-tree-row:has(> .si-item[data-sid="${target.id}"])`)
// parents are collapsed by default ([[session-forest]]), so the nested row has to be disclosed before it
// can be dragged — the same click a reader makes.
await destination.waitFor({ state: 'visible' })
if (!(await source.count())) {
  await page.locator(`.app > .si-list .si-item[data-sid="${child.parent}"]`)
    .locator('xpath=preceding-sibling::*[contains(@class,"sess-fold-control")][1]').first().click()
    .catch(async () => {
      await page.locator(`.app > .si-list .si-tree-row:has(> .si-item[data-sid="${child.parent}"]) .sess-fold-control`).first().click()
    })
}
await source.waitFor({ state: 'visible' })
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
// ONE ghost follows the pointer, and it takes no pointer events — which is exactly why the hit test above
// can still name the row underneath it ([[drag-gesture]]).
assert.equal(await page.locator('.si-session-drag-ghost').count(), 1)
assert.equal(await page.locator('.si-session-drag-ghost').evaluate((el) => getComputedStyle(el).pointerEvents), 'none')
// and the affordance that appears mid-drag must not move the rows: the root-drop strip stands AFTER the
// last row, so the row the reader was aiming at is still where they aimed.
assert.equal(await page.evaluate(() => {
  const scroll = document.querySelector('.app > .si-list [data-session-scroll]')
  const strip = scroll?.querySelector('.si-root-drop')
  const rows = [...(scroll?.querySelectorAll('[data-session-drop-id]') || [])]
  return !!strip && rows.every((row) => row.getBoundingClientRect().top < strip.getBoundingClientRect().top)
}), true)
await page.screenshot({ path: `${out}/dock-row-drag.png`, fullPage: true })
await page.mouse.up()
console.log(JSON.stringify({ ok: true, child: child.id, target: target.id, ghosts: 1, rootDropBelowRows: true }))
await browser.close()
