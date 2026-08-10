// Real-browser proof for [[lock-hint]]. The dashboard, click path, and banner are real; the graph
// response starts from the live backend and adds one deterministic overlay session so the test never
// silently passes because today's board happens to have no dirty session.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5191'
const OUT = resolve(process.env.OUT || '/tmp/lock-hint-e2e')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const response = await fetch(`${BASE}/api/graph`)
assert.equal(response.ok, true, `dashboard graph response must be available (HTTP ${response.status})`)
const liveGraph = await response.json()
const targets = (liveGraph.nodes || []).filter((node) => node.parent).slice(0, 2)
assert.equal(targets.length, 2, 'the live graph needs two non-root nodes for the lock-banner population')

const sessionId = `lock-hint-e2e-${process.pid}`
const source = `lock-hint-e2e-source-${process.pid}`
const headline = 'lock hint browser proof'
const graphFor = (count) => {
  const graph = structuredClone(liveGraph)
  graph.sessions = [{
    id: sessionId,
    source,
    label: headline,
    headline,
    status: 'working',
    liveness: 'online',
    archived: false,
    created: Date.now(),
    sortKey: Date.now(),
    parent: null,
    capabilities: { headless: true },
    ops: targets.slice(0, count).map((node) => ({ nodeId: node.id, op: 'edited', committed: false, dirty: true })),
  }, ...(graph.sessions || [])]
  const targetIds = new Set(targets.slice(0, count).map((node) => node.id))
  graph.nodes = graph.nodes.map((node) => targetIds.has(node.id)
    ? { ...node, overlays: [...(node.overlays || []), { source, seed: sessionId, label: headline, op: 'edited', committed: false }] }
    : node)
  return graph
}

let fixture = graphFor(2)
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => {
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('lock-hint fixture disables graph stream') } }
})
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(fixture),
}))

const observations = []
const observe = (step, value) => observations.push({ step, value })
const sessionRow = () => page.locator('.sesswin .sess-row').filter({ hasText: headline })

try {
  await page.goto(`${BASE}/#/graph`, { waitUntil: 'domcontentloaded' })
  await sessionRow().waitFor({ state: 'visible' })
  await sessionRow().click()

  const banner = page.locator('.lock-hint')
  await banner.waitFor({ state: 'visible' })
  assert.match((await banner.locator('.lock-hint-lead').textContent()) || '', /lock hint browser proof/)
  assert.deepEqual(await banner.locator('kbd').allTextContents(), ['o', 'O'])
  assert.match((await banner.locator('.lock-hint-body').textContent()) || '', /2 changed nodes/)
  assert.equal(await sessionRow().evaluate((row) => row.classList.contains('locked')), true)
  observe('two-node lock banner', { keys: await banner.locator('kbd').allTextContents(), text: await banner.textContent() })
  await page.screenshot({ path: `${OUT}/two-node-lock.png`, fullPage: true })

  await banner.getByRole('button', { name: 'release' }).click()
  await banner.waitFor({ state: 'hidden' })
  assert.equal(await sessionRow().evaluate((row) => row.classList.contains('locked')), false)
  observe('release lock', 'banner hidden and session row unlocked')

  fixture = graphFor(1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await sessionRow().waitFor({ state: 'visible' })
  await sessionRow().click()
  await banner.waitFor({ state: 'visible' })
  assert.match((await banner.locator('.lock-hint-body').textContent()) || '', /this session changed 1 node/)
  assert.equal(await banner.locator('kbd').count(), 0)
  observe('one-node lock banner', { keys: await banner.locator('kbd').count(), text: await banner.textContent() })
  await page.screenshot({ path: `${OUT}/one-node-lock.png`, fullPage: true })
} finally {
  writeFileSync(`${OUT}/observations.json`, `${JSON.stringify(observations, null, 2)}\n`)
  await context.close()
  await browser.close()
}

console.log(`lock hint browser proof: ${OUT}`)
