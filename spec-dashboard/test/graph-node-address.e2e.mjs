import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const OUT = resolve(process.env.OUT || '/tmp/graph-node-address-e2e')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const board = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const target = board.nodes.find((node) => node.parent && /^[a-z][a-z0-9-]*$/.test(node.id))
assert.ok(target, 'the graph needs one URL-safe non-root node')

const hash = `#/graph/${encodeURIComponent(target.id)}`
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })

try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await desktop.newPage()
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  const selected = page.locator('.react-flow__node.selected')
  await selected.waitFor({ state: 'visible' })
  assert.equal(await page.evaluate(() => location.hash), hash)
  assert.equal(await selected.getAttribute('data-id'), target.id)
  await page.screenshot({ path: `${OUT}/desktop-direct.png` })

  const parent = page.locator(`.react-flow__node[data-id="${target.parent}"]`)
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(150)
  assert.equal(await page.locator('.react-flow__node.selected').getAttribute('data-id'), target.parent)
  assert.equal(await page.evaluate(() => location.hash), hash)
  await page.screenshot({ path: `${OUT}/desktop-keyboard-navigated.png` })
  await desktop.close()

  const mouseDesktop = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const mousePage = await mouseDesktop.newPage()
  await mousePage.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  const mouseSelected = mousePage.locator('.react-flow__node.selected')
  await mouseSelected.waitFor({ state: 'visible' })
  await mousePage.locator(`.react-flow__node[data-id="${target.parent}"]`).click()
  await mousePage.waitForTimeout(150)
  assert.equal(await mousePage.locator('.react-flow__node.selected').getAttribute('data-id'), target.parent)
  assert.equal(await mousePage.evaluate(() => location.hash), hash)
  await mousePage.screenshot({ path: `${OUT}/desktop-mouse-navigated.png` })

  await mousePage.reload({ waitUntil: 'domcontentloaded' })
  await mouseSelected.waitFor({ state: 'visible' })
  assert.equal(await mousePage.evaluate(() => location.hash), hash)
  assert.equal(await mouseSelected.getAttribute('data-id'), target.id)
  await mousePage.screenshot({ path: `${OUT}/desktop-reload.png` })
  await mouseDesktop.close()

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const pageMobile = await mobile.newPage()
  await pageMobile.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded' })
  const currentCrumb = pageMobile.locator('.m-crumb-btn.cur')
  await currentCrumb.waitFor({ state: 'visible' })
  assert.equal(await pageMobile.evaluate(() => location.hash), hash)
  assert.equal((await currentCrumb.textContent())?.trim(), target.title)
  assert.equal((await pageMobile.locator('.m-node-title').textContent())?.trim(), target.title)
  await pageMobile.screenshot({ path: `${OUT}/mobile-direct.png` })

  await pageMobile.goto(`${BASE}/#/graph/no-longer-present`, { waitUntil: 'domcontentloaded' })
  await pageMobile.locator('.m-specs').waitFor({ state: 'visible' })
  assert.equal((await pageMobile.locator('.m-crumb-btn.cur').textContent())?.trim(), board.nodes.find((node) => !node.parent)?.title)
  await mobile.close()
} finally {
  await browser.close()
}

console.log(`graph node address proof: ${OUT}`)
