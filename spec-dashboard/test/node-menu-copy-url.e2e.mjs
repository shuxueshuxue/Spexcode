import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const OUT = resolve(process.env.OUT || '/tmp/node-menu-copy-url-e2e')

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const board = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const target = board.nodes.find((node) => node.parent && /^[a-z][a-z0-9-]*$/.test(node.id))
assert.ok(target, 'the graph needs one URL-safe non-root node')

const hash = `#/graph/${encodeURIComponent(target.id)}`
const expectedUrl = `${BASE}/${hash}`
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  const page = await context.newPage()
  await page.goto(expectedUrl, { waitUntil: 'domcontentloaded' })

  const selected = page.locator('.react-flow__node.selected')
  await selected.waitFor({ state: 'visible' })
  await selected.click({ button: 'right' })

  const menu = page.getByRole('menu', { name: 'node actions' })
  await menu.waitFor({ state: 'visible' })
  const copy = page.getByRole('menuitem', { name: 'copy node URL' })
  await copy.click()
  await page.getByRole('menuitem', { name: 'copied' }).waitFor({ state: 'visible' })
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expectedUrl)
  await page.screenshot({ path: `${OUT}/copied.png` })
  await menu.waitFor({ state: 'detached' })
  await context.close()
} finally {
  await browser.close()
}

console.log(`node menu copy URL proof: ${OUT}`)
