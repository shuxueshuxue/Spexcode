import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PLAYWRIGHT = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const { chromium } = await import(pathToFileURL(PLAYWRIGHT).href)
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const OUT = resolve(process.env.OUT || '/tmp/governance-group-e2e')
mkdirSync(OUT, { recursive: true })

const board = await fetch(`${BASE}/api/graph`).then(async (response) => {
  assert.equal(response.ok, true, `fixture graph must be available (HTTP ${response.status})`)
  return response.json()
})
const byId = new Map(board.nodes.map((node) => [node.id, node]))
const governanceRoot = board.nodes.find((node) => node.path?.endsWith('/.plugins/spec.md'))
assert.ok(governanceRoot, 'fixture must carry the reserved .plugins governance root')

function isGovernance(node) {
  for (let cur = node; cur; cur = cur.parent ? byId.get(cur.parent) : null) {
    if (cur.id === governanceRoot.id) return true
  }
  return false
}

const governance = board.nodes.filter(isGovernance)
const project = board.nodes.filter((node) => !isGovernance(node))
assert.equal(project.length, 4, 'fixture baseline has four project nodes')
assert.equal(governance.length, 22, 'fixture baseline has twenty-two governance nodes')

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
await page.locator('.react-flow__node').first().waitFor({ state: 'visible', timeout: 45_000 })
await page.waitForTimeout(300)

const idsOnScreen = async () => page.locator('.react-flow__node').evaluateAll((nodes) => nodes.map((node) => node.dataset.id))
const initialIds = await idsOnScreen()
const initialProjectTiles = initialIds.filter((id) => !isGovernance(byId.get(id)))
const initialGovernanceTiles = initialIds.filter((id) => isGovernance(byId.get(id)))
assert.equal(initialProjectTiles.length, 4, 'initial graph shows all four project nodes')
assert.equal(initialGovernanceTiles.length, 1, 'initial graph reduces governance to one group entry')
assert.ok(initialProjectTiles.length > initialGovernanceTiles.length, 'project nodes visually dominate the first graph frame')

const group = page.locator(`.react-flow__node[data-id="${governanceRoot.id}"] .governance-group`)
await group.waitFor({ state: 'visible' })
assert.equal(await group.getAttribute('data-governance-count'), String(governance.length))
assert.match((await group.textContent()) || '', /SpexCode governance/)
assert.match((await group.textContent()) || '', /22 specs/)
const stats = page.locator('.graph-stats')
assert.match((await stats.textContent()) || '', /4 project/)
assert.match((await stats.textContent()) || '', /22 SpexCode/)
await page.screenshot({ path: resolve(OUT, 'initial-project-first.png'), fullPage: true })

// Follow the same focus/drill interaction a reader uses. Every governance id must become a real tile;
// a CSS-only hide or payload filter fails because it can never enter the `seen` set.
const seen = new Set(initialGovernanceTiles)
for (const node of governance) {
  const path = []
  for (let cur = node; cur; cur = cur.parent ? byId.get(cur.parent) : null) {
    path.unshift(cur.id)
    if (cur.id === governanceRoot.id) break
  }
  for (const id of path) {
    const tile = page.locator(`.react-flow__node[data-id="${id}"]`)
    await tile.waitFor({ state: 'visible', timeout: 5_000 })
    await tile.click()
  }
  for (const id of await idsOnScreen()) if (isGovernance(byId.get(id))) seen.add(id)
}

assert.deepEqual([...seen].sort(), governance.map((node) => node.id).sort(), 'all governance nodes stay reachable through the group')
await page.screenshot({ path: resolve(OUT, 'governance-drilled.png'), fullPage: true })
await browser.close()

assert.deepEqual(pageErrors, [], `browser page errors: ${pageErrors.join('\n')}`)
assert.deepEqual(failedResponses, [], `unexpected browser response failures: ${failedResponses.join('\n')}`)
console.log(JSON.stringify({
  base: BASE,
  fixture: { project: project.length, governance: governance.length },
  initial: { projectTiles: initialProjectTiles.length, governanceTiles: initialGovernanceTiles.length },
  reachableGovernanceTiles: seen.size,
  screenshots: ['initial-project-first.png', 'governance-drilled.png'],
}, null, 2))
