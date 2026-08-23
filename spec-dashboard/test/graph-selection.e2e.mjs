import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLAYWRIGHT = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const OUT = resolve(process.env.OUT || '/tmp/graph-selection-e2e')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
try {
  await page.goto(`${BASE}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible', timeout: 45_000 })
  await page.waitForTimeout(250)
  const pane = await page.locator('.react-flow__pane').boundingBox()
  const boxes = await page.locator('.react-flow__node').evaluateAll((nodes) => nodes.slice(0, 2).map((node) => ({
    id: node.dataset.id,
    box: node.getBoundingClientRect().toJSON(),
  })))
  assert.ok(pane && boxes.length >= 2, 'graph needs a pane and two visible tiles')
  const left = Math.max(pane.x + 4, Math.min(...boxes.map(({ box }) => box.left)) - 14)
  const top = Math.max(pane.y + 4, Math.min(...boxes.map(({ box }) => box.top)) - 14)
  const right = Math.min(pane.x + pane.width - 4, Math.max(...boxes.map(({ box }) => box.right)) + 14)
  const bottom = Math.min(pane.y + pane.height - 4, Math.max(...boxes.map(({ box }) => box.bottom)) + 14)
  await page.mouse.move(left, top)
  await page.mouse.down()
  await page.mouse.move(right, bottom, { steps: 8 })
  await page.mouse.up()
  await page.locator('.graph-selection-actions').waitFor({ state: 'visible', timeout: 10_000 })
  const selectedIds = await page.locator('.react-flow__node.selected').evaluateAll((nodes) => nodes.map((node) => node.dataset.id))
  assert.ok(selectedIds.length >= 2, `marquee should select at least two tiles: ${selectedIds}`)
  await page.screenshot({ path: resolve(OUT, 'marquee-selected.png'), fullPage: true })
  await page.locator('.graph-selection-send').click()
  await page.waitForFunction(() => location.hash === '#/sessions/new', null, { timeout: 10_000 })
  assert.equal(await page.evaluate(() => location.hash), '#/sessions/new')
  const draft = await page.locator('.si-input').inputValue()
  for (const id of selectedIds) assert.ok(draft.includes(`[[${id}]]`), `composer seed includes [[${id}]]`)
  await page.screenshot({ path: resolve(OUT, 'marquee-new-session-seed.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, hash: '#/sessions/new', selectedIds, out: OUT }))
} finally {
  await browser.close()
}
