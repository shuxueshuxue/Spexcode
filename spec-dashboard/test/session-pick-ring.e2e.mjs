import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// [[session-multi-select]] `one-ring-in-the-fold-column`: while selecting, the fold column is the pick column.
// Every visible row leads with exactly one ring in the slot the fold pod occupies; nothing else is drawn there.
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5200'
const OUT = resolve(process.env.OUT || '/tmp/session-pick-ring-e2e')
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
const parents = sessions.filter((session) => !session.parent && childrenOf.get(session.id)?.length && session.liveness !== 'offline')
assert.ok(parents.length, 'fixture needs a live top-level parent')
const fixture = structuredClone(graph)

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1100, height: 760 } })
await context.addInitScript(() => { window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } } })
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) }))

// a missing element is a null box, not a 30s auto-wait
const box = async (locator) => {
  if (!(await locator.count())) return null
  const b = await locator.first().boundingBox()
  return b && { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }
}
const overlaps = (a, b) => !!a && !!b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const facts = {}
try {
  // any live root parent whose row is on screen; the first that the forest renders wins.
  let parent
  for (const candidate of parents) {
    await page.goto(`${BASE}/#/sessions/${candidate.id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.si-list').waitFor({ state: 'visible' })
    if (await page.locator(`.si-item[data-sid="${candidate.id}"]`).count()) { parent = candidate; break }
  }
  assert.ok(parent, 'a live parent row is rendered')
  const parentRow = page.locator(`.si-tree-row:has(> .si-item[data-sid="${parent.id}"])`)
  const restingPod = parentRow.locator('> .sess-fold-control')
  await restingPod.waitFor({ state: 'visible' })
  facts.restingPod = { text: (await restingPod.textContent()).trim(), box: await box(restingPod) }

  await parentRow.locator('> .si-item').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'select…' }).click()
  await page.locator('.si-selbar').waitFor({ state: 'visible' })
  const list = await box(page.locator('.si-list'))
  await page.screenshot({ path: `${OUT}/selecting.png`, clip: { x: list.x, y: list.y, width: list.w, height: Math.min(list.h, 420) } })

  // what every visible row draws in its lead while selecting
  const rows = page.locator('.si-list .si-tree-row')
  const rowCount = await rows.count()
  const perRow = []
  for (let i = 0; i < rowCount; i += 1) {
    const row = rows.nth(i)
    const check = row.locator('.si-check')
    const control = row.locator('> .sess-fold-control')
    const ring = row.locator('.sess-pick')
    perRow.push({
      sid: await row.locator('> .si-item').getAttribute('data-sid'),
      checks: await check.count(),
      foldControls: await control.count(),
      rings: await ring.count(),
      ringText: (await ring.count()) ? (await ring.first().textContent()).trim() : null,
      overlap: overlaps(await box(check), await box(control)),
    })
  }
  facts.rows = perRow
  const parentRing = parentRow.locator('.sess-pick')
  facts.parentRing = (await parentRing.count()) ? { text: (await parentRing.textContent()).trim(), on: await parentRing.evaluate((el) => el.classList.contains('on')), box: await box(parentRing) } : null

  const other = perRow.find((row) => row.sid !== parent.id)
  const otherRow = other && page.locator(`.si-item[data-sid="${other.sid}"]`)
  if (otherRow) {
    await otherRow.click()
    facts.otherPickedOn = await page.locator(`.si-tree-row:has(> .si-item[data-sid="${other.sid}"]) .sess-pick.on`).count()
    await page.screenshot({ path: `${OUT}/two-picked.png`, clip: { x: list.x, y: list.y, width: list.w, height: Math.min(list.h, 420) } })
    await otherRow.click()
    facts.otherUnpickedOn = await page.locator(`.si-tree-row:has(> .si-item[data-sid="${other.sid}"]) .sess-pick.on`).count()
  }
  await page.getByRole('button', { name: 'cancel' }).click()
  await page.locator('.si-selbar').waitFor({ state: 'hidden' })
  facts.afterCancel = { rings: await page.locator('.si-list .sess-pick').count(), foldControls: await page.locator('.si-list .sess-fold-control').count(), parentPod: await box(parentRow.locator('> .sess-fold-control')) }
  writeFileSync(`${OUT}/facts.json`, JSON.stringify(facts, null, 2))
  console.log(JSON.stringify(facts))

  // the contract, asserted after the evidence is captured so a fail reading still carries the picture
  assert.equal(perRow.filter((row) => row.checks === 0 && row.foldControls === 0 && row.rings === 1).length, rowCount,
    `${rowCount} of ${rowCount} visible rows draw exactly one ring and nothing else in the lead`)
  assert.equal(perRow.filter((row) => row.overlap).length, 0, 'no checkbox overlaps a fold control')
  assert.ok(facts.parentRing, 'the parent row keeps its ring while selecting')
  assert.equal(facts.parentRing.text, facts.restingPod.text, 'the parent ring still shows the subtree count')
  assert.equal(facts.parentRing.on, true, 'the context-menu row starts picked')
  assert.ok(Math.abs(facts.parentRing.box.x - facts.restingPod.box.x) <= 0.5 && Math.abs(facts.parentRing.box.y - facts.restingPod.box.y) <= 0.5,
    `the ring sits where the pod sat (${JSON.stringify(facts.parentRing.box)} vs ${JSON.stringify(facts.restingPod.box)})`)
  assert.equal(perRow.filter((row) => !childrenOf.get(row.sid)?.length && row.ringText === '').length,
    perRow.filter((row) => !childrenOf.get(row.sid)?.length).length, 'every leaf ring is empty')
  if (otherRow) {
    assert.equal(facts.otherPickedOn, 1, 'picking another row fills its ring')
    assert.equal(facts.otherUnpickedOn, 0, 'unpicking hollows it again')
  }
  assert.equal(facts.afterCancel.rings, 0, 'cancel removes the rings')
  assert.ok(facts.afterCancel.foldControls > 0 && facts.afterCancel.parentPod, 'cancel restores the resting pods')
  console.log(JSON.stringify({ pass: true, rows: rowCount, evidence: OUT }))
} finally {
  await browser.close()
}
