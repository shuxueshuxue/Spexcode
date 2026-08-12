import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLAYWRIGHT = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href)
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const OUT = resolve(process.env.OUT || '/tmp/plugin-node-e2e')
mkdirSync(OUT, { recursive: true })

const board = await fetch(`${BASE}/api/graph`).then(async (response) => {
  assert.equal(response.ok, true, `fixture graph must be available (HTTP ${response.status})`)
  return response.json()
})
const plugins = board.nodes.find((node) => node.path?.endsWith('/.plugins/spec.md'))
assert.ok(plugins, 'fixture must carry a .plugins node')
const children = board.nodes.filter((node) => node.parent === plugins.id)
assert.ok(children.length > 0, '.plugins fixture node must have direct children')
const grandchildren = board.nodes.filter((node) => children.some((child) => child.id === node.parent))
assert.ok(grandchildren.length > 0, '.plugins fixture node must have nested descendants')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const pageErrors = []
const failedResponses = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('response', (response) => {
  if (response.status() < 400) return
  const path = new URL(response.url()).pathname
  // A direct project's API intentionally has no multi-project catalog. The shell probes it once to decide
  // whether the current address is a gateway hub; that expected 404 is not a rendering failure.
  if (path !== '/projects' && path !== '/api/projects') failedResponses.push(`${response.status()} ${path}`)
})
await page.goto(`${BASE}/#/graph`, { waitUntil: 'domcontentloaded' })
const tile = page.locator(`.react-flow__node[data-id="${plugins.id}"] .spec-node`)
await tile.waitFor({ state: 'visible', timeout: 45_000 })
await page.waitForTimeout(300)

assert.equal(await tile.getAttribute('data-governance-root'), null)
assert.equal(await tile.getAttribute('data-governance-count'), null)
assert.equal(await tile.evaluate((node) => node.classList.contains('governance-group')), false)
assert.equal(await tile.locator('.node-title').textContent(), plugins.title)
assert.equal(await tile.locator('.node-ver').textContent(), `v${plugins.version}`)
assert.equal(await tile.locator('.node-expand').textContent(), `▸${children.length}`)
const stats = page.locator('.graph-stats')
assert.equal(await stats.locator('.bstat-total').textContent(), String(board.nodes.length))
assert.equal(await stats.locator('.bstat-project, .bstat-governance').count(), 0)
const statusOrder = ['merged', 'active', 'drift', 'pending']
const statusCounts = statusOrder.map((status) => board.nodes.filter((node) => node.status === status).length)
assert.equal(statusCounts.reduce((total, count) => total + count, 0), board.nodes.length)
assert.deepEqual(await stats.locator('.bstat:has(.bstat-dot)').allTextContents(), statusCounts.map(String))
await page.screenshot({ path: resolve(OUT, 'plugins-ordinary.png'), fullPage: true })

await tile.click()
for (const child of children) {
  await page.locator(`.react-flow__node[data-id="${child.id}"]`).waitFor({ state: 'visible', timeout: 5_000 })
}
for (const grandchild of grandchildren) {
  assert.equal(await page.locator(`.react-flow__node[data-id="${grandchild.id}"]`).count(), 0)
}
await page.screenshot({ path: resolve(OUT, 'plugins-expanded.png'), fullPage: true })
await browser.close()

assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('\n')}`)
assert.deepEqual(failedResponses, [], `unexpected browser response failures: ${failedResponses.join('\n')}`)
console.log(JSON.stringify({
  base: BASE,
  plugins: { id: plugins.id, title: plugins.title, version: plugins.version, directChildren: children.length },
  screenshots: ['plugins-ordinary.png', 'plugins-expanded.png'],
}, null, 2))
