import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5200'
const OUT = resolve(process.env.OUT || '/tmp/session-multi-select-e2e')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
let graph
for (let attempt = 0; attempt < 4 && !graph; attempt += 1) {
  const response = await fetch(`${BASE}/api/graph`)
  if (response.ok) {
    const candidate = await response.json()
    if (candidate.sessions?.length) graph = candidate
  }
  if (!graph) await new Promise((resolve) => setTimeout(resolve, 100))
}
assert.ok(graph, 'graph fixture is available')
const sessions = graph.sessions || []
const childrenOf = new Map()
for (const session of sessions) if (session.parent) childrenOf.set(session.parent, [...(childrenOf.get(session.parent) || []), session])
const parent = sessions.find((session) => childrenOf.get(session.id)?.length)
const child = parent && childrenOf.get(parent.id)[0]
const target = sessions.find((session) => session.id !== parent?.id && session.id !== child?.id && !session.parent && session.liveness !== 'offline')
assert.ok(parent && child && target, 'fixture needs a parent, child, and unrelated target')
const fixture = structuredClone(graph)
fixture.sessions = fixture.sessions.map((session) => session.id === child.id
  ? { ...session, title: 'focused drag projection keeps the complete selected row title visible across several lines' }
  : session)

const requests = []
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1100, height: 760 }, recordVideo: { dir: OUT, size: { width: 1100, height: 760 } } })
await context.addInitScript(() => { window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } } })
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }))
await page.route('**/api/sessions/reparent', async (route) => {
  requests.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
})
await page.route('**/api/sessions/*/close', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))

try {
  await page.goto(`${BASE}/#/sessions/${child.id}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-list').waitFor({ state: 'visible' })
  while (await page.locator('.si-list .sess-fold-control[aria-expanded="false"]').count()) await page.locator('.si-list .sess-fold-control[aria-expanded="false"]').first().click()
  const childRow = page.locator(`.si-item[data-sid="${child.id}"]`)
  const targetRow = page.locator(`.si-item[data-sid="${target.id}"]`)
  await childRow.waitFor({ state: 'visible' })
  await targetRow.waitFor({ state: 'visible' })

  await childRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'select…' }).click()
  assert.equal(await page.locator('.si-selbar').count(), 1, 'row selection bar is visible')
  assert.equal(await childRow.locator('.sess-pick.on').count(), 1, 'context-menu row starts selected')
  await targetRow.click()
  assert.equal(await page.locator('.sess-pick.on').count(), 2, 'second row toggles into the same selection')
  assert.match(page.url(), new RegExp(`/sessions/${child.id}$`), 'multi-select does not navigate')
  const selectionBar = page.locator('.si-selbar')
  const selectionBox = await selectionBar.boundingBox()
  assert.ok(selectionBox, 'selection bar has layout geometry')
  assert.equal(await selectionBar.evaluate((bar) => getComputedStyle(bar).flexWrap), 'nowrap', 'selection actions wrapped')
  assert.equal(await page.locator('.si-selcount').evaluate((count) => getComputedStyle(count).whiteSpace), 'nowrap', 'selection count wrapped')
  for (const button of await selectionBar.locator('button').all()) {
    const box = await button.boundingBox()
    assert.ok(box && box.x >= selectionBox.x && box.x + box.width <= selectionBox.x + selectionBox.width,
      'selection icon action overflowed the narrow forest')
  }
  await page.getByRole('button', { name: 'cancel' }).click()

  const sourceBox = await childRow.boundingBox()
  const targetBox = await targetRow.boundingBox()
  assert.ok(sourceBox && targetBox, 'drag rows have layout boxes')
  await page.mouse.move(sourceBox.x + 18, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + 32, sourceBox.y + sourceBox.height / 2)
  await page.locator('.si-session-drag-ghost').waitFor({ state: 'visible' })
  assert.equal(await childRow.evaluate((row) => row.closest('.si-tree-row').classList.contains('dragging')), true)
  const liveTargetBox = await targetRow.boundingBox()
  assert.ok(liveTargetBox, 'target remains laid out while the ghost is live')
  await page.mouse.move(liveTargetBox.x + liveTargetBox.width / 2, liveTargetBox.y + liveTargetBox.height / 2, { steps: 8 })
  await page.waitForTimeout(200)
  await page.waitForFunction((id) => document.querySelector(`.si-item[data-sid="${id}"]`)?.closest('.si-tree-row')?.classList.contains('drop-target'), target.id)
  await page.screenshot({ path: `${OUT}/session-row-drag-feedback.png`, fullPage: true })
  await page.mouse.up()
  await page.waitForFunction(() => document.body.classList.contains('is-dragging') === false)
  assert.deepEqual(requests.at(-1), { children: [child.id], parent: target.id }, 'valid parent drop reparents through the backend')

  const rootSource = page.locator(`.si-item[data-sid="${child.id}"]`)
  const rootBox = await rootSource.boundingBox()
  assert.ok(rootBox, 'nested row remains draggable after a parent drop')
  await page.mouse.move(rootBox.x + 18, rootBox.y + rootBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rootBox.x + 32, rootBox.y + rootBox.height / 2)
  const rootDrop = page.locator('[data-session-root-drop]')
  await rootDrop.waitFor({ state: 'visible' })
  // the zone scrolls with the rows, so a long board can leave it above the viewport; scroll it in as a
  // reader holding the row would before aiming at it
  await rootDrop.scrollIntoViewIfNeeded()
  const rootDropBox = await rootDrop.boundingBox()
  assert.ok(rootDropBox, 'nested drag reveals the top-level drop zone')
  await page.mouse.move(rootDropBox.x + rootDropBox.width / 2, rootDropBox.y + rootDropBox.height / 2)
  assert.equal(await rootDrop.evaluate((zone) => zone.classList.contains('on')), true)
  await page.mouse.up()
  await page.waitForFunction(() => document.body.classList.contains('is-dragging') === false)
  assert.deepEqual(requests.at(-1), { children: [child.id], parent: null }, 'root drop detaches the row')

  const beforeInvalid = requests.length
  const targetInvalidBox = await targetRow.boundingBox()
  assert.ok(targetInvalidBox)
  await page.mouse.move(targetInvalidBox.x + 12, targetInvalidBox.y + targetInvalidBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetInvalidBox.x + 20, targetInvalidBox.y + targetInvalidBox.height / 2)
  await page.mouse.up()
  assert.equal(requests.length, beforeInvalid, 'a same-row/no-op landing does not write')
  await page.screenshot({ path: `${OUT}/session-tree-settled.png`, fullPage: true })
  console.log(JSON.stringify({ pass: true, selected: 2, reparentRequests: requests, evidence: OUT }))
} finally {
  await browser.close()
}
