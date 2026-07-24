import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5198'
const OUT = resolve(process.env.OUT || '/tmp/session-tree-disclosure-e2e')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const sessions = graph.sessions || []
const childrenOf = new Map()
for (const session of sessions) {
  if (!session.parent) continue
  const children = childrenOf.get(session.parent) || []
  children.push(session)
  childrenOf.set(session.parent, children)
}
const parent = sessions.find((session) => session.liveness !== 'offline'
  && childrenOf.get(session.id)?.some((child) => child.liveness !== 'offline'))
const child = parent && childrenOf.get(parent.id).find((candidate) => candidate.liveness !== 'offline')
const offline = sessions.filter((session) => session.liveness === 'offline').slice(0, 2)
assert.ok(parent && child, 'the live board needs one present parent/child session pair')
assert.ok(offline.length, 'the live board needs at least one retained offline session')

// Keep the live board's real session records and nesting. Promote only retained offline records to roots so
// the deterministic fixture exposes the history zone without mutating the backend or any session.json.
const fixture = structuredClone(graph)
const offlineIds = new Set(offline.map((session) => session.id))
fixture.sessions = fixture.sessions.map((session) => offlineIds.has(session.id) ? { ...session, parent: null } : session)

const transcript = []
const record = (surface, fact, value) => transcript.push({ surface, fact, value })
const expanded = (locator) => locator.getAttribute('aria-expanded')
const visibleRows = (page, selector) => page.locator(selector).count()

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({
  viewport: { width: 900, height: 720 },
  recordVideo: { dir: OUT, size: { width: 900, height: 720 } },
})
await context.addInitScript(() => {
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(fixture),
}))

try {
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-list').waitFor({ state: 'visible' })

  const interfaceParent = page.locator(`.si-tree-row:has(> .si-item[data-sid="${parent.id}"])`)
  const interfaceBody = interfaceParent.locator('> .si-item')
  const interfacePod = interfaceParent.locator('> .sess-fold-control')
  assert.equal(await interfaceBody.getAttribute('aria-expanded'), null)
  assert.equal(await expanded(interfacePod), 'false')
  assert.equal(await page.locator(`.si-item[data-sid="${child.id}"]`).count(), 0)

  await interfaceBody.click()
  assert.equal(await interfaceBody.evaluate((node) => node.classList.contains('on')), true)
  assert.equal(await expanded(interfacePod), 'false', 'selecting a SessionInterface parent must not unfold it')
  assert.equal(await page.locator(`.si-item[data-sid="${child.id}"]`).count(), 0)
  record('SessionInterface', 'row click leaves fold', await expanded(interfacePod))

  await page.evaluate(() => { document.activeElement.dataset.sessionTreeFocusProbe = 'before-fold' })
  await interfacePod.click()
  assert.equal(await expanded(interfacePod), 'true')
  assert.equal(await page.locator(`.si-item[data-sid="${child.id}"]`).count(), 1)
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.sessionTreeFocusProbe), 'before-fold')
  record('SessionInterface', 'count click opens fold', await expanded(interfacePod))
  record('SessionInterface', 'count click keeps focus owner', true)
  await interfacePod.click()

  const interfaceOffline = page.locator('.si-zone-offline')
  const interfaceOfflineCount = interfaceOffline.locator('> .si-zone-count')
  assert.equal(await expanded(interfaceOfflineCount), 'false')
  await interfaceOffline.locator('> .si-zone-label').click()
  assert.equal(await expanded(interfaceOfflineCount), 'false', 'OFFLINE label must be inert')
  await interfaceOfflineCount.click()
  assert.equal(await expanded(interfaceOfflineCount), 'true')
  assert.ok(await visibleRows(page, '.si-item') > 1)
  await interfaceOfflineCount.click()

  await page.evaluate((id) => { window.location.hash = `#/sessions/${id}` }, offline[0].id)
  await page.locator(`.si-item[data-sid="${offline[0].id}"]`).waitFor({ state: 'visible' })
  assert.equal(await expanded(interfaceOfflineCount), 'false')
  record('SessionInterface', 'offline deep link remains visible while folded', true)

  await page.evaluate((id) => { window.location.hash = `#/sessions/${id}` }, child.id)
  await page.locator(`.si-item[data-sid="${child.id}"]`).waitFor({ state: 'visible' })
  assert.equal(await expanded(interfacePod), 'true', 'a nested deep link must reveal its present ancestors')
  assert.equal(await page.locator('.si-list button button').count(), 0)
  await page.screenshot({ path: `${OUT}/session-interface.png` })

  await page.goto(`${BASE}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.sesswin').waitFor({ state: 'visible' })
  const windowParent = page.locator('.sesswin-tree-row:has(> .sess-fold-control)').first()
  const windowBody = windowParent.locator('> .sess-row')
  const windowPod = windowParent.locator('> .sess-fold-control')
  const windowRowsBefore = await visibleRows(page, '.sesswin .sess-row')
  assert.equal(await expanded(windowPod), 'false')
  assert.equal(await windowBody.getAttribute('aria-expanded'), null)
  await windowBody.click()
  assert.equal(await expanded(windowPod), 'false', 'locking a SessionWindow parent must not unfold it')
  await windowPod.click()
  assert.equal(await expanded(windowPod), 'true')
  assert.ok(await visibleRows(page, '.sesswin .sess-row') > windowRowsBefore)
  const windowOffline = page.locator('.sesswin-zone-offline')
  const windowOfflineCount = windowOffline.locator('> .si-zone-count')
  await windowOffline.locator('> .si-zone-label').click()
  assert.equal(await expanded(windowOfflineCount), 'false')
  await windowOfflineCount.click()
  assert.equal(await expanded(windowOfflineCount), 'true')
  assert.equal(await page.locator('.sesswin button button').count(), 0)
  record('SessionWindow', 'row/count ownership', 'row=false,count=true')
  await page.screenshot({ path: `${OUT}/session-window.png` })

  await page.setViewportSize({ width: 390, height: 760 })
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator('.m-tabbar-btn').nth(1).click()
  // A viewport flip may carry the SessionWindow's current session into the phone's deep-linked detail. Its
  // Back is intentionally phone-local, so take that real route back to the list before testing list gestures.
  if (await page.locator('.m-sessdetail').count()) await page.locator('.m-sess-back').click()
  await page.locator('.m-sesslist').waitFor({ state: 'visible' })
  let mobileParent = page.locator('.m-sess-tree-row:has(> .sess-fold-control)').first()
  let mobilePod = mobileParent.locator('> .sess-fold-control')
  assert.equal(await expanded(mobilePod), 'false')
  await mobileParent.locator('> .m-sess-row').click()
  await page.locator('.m-sessdetail').waitFor({ state: 'visible' })
  await page.locator('.m-sess-back').click()
  await page.locator('.m-sesslist').waitFor({ state: 'visible' })
  mobileParent = page.locator('.m-sess-tree-row:has(> .sess-fold-control)').first()
  mobilePod = mobileParent.locator('> .sess-fold-control')
  assert.equal(await expanded(mobilePod), 'false', 'opening a mobile parent must not unfold it')
  const mobileRowsBefore = await visibleRows(page, '.m-sess-row')
  await mobilePod.click()
  assert.equal(await expanded(mobilePod), 'true')
  assert.ok(await visibleRows(page, '.m-sess-row') > mobileRowsBefore)

  const mobileOffline = page.locator('.m-zone-offline')
  const mobileOfflineCount = mobileOffline.locator('> .si-zone-count')
  await mobileOffline.locator('> .si-zone-label').click()
  assert.equal(await expanded(mobileOfflineCount), 'false')
  await mobileOfflineCount.click()
  assert.equal(await expanded(mobileOfflineCount), 'true')
  assert.equal(await page.locator('.m-sesslist button button').count(), 0)
  record('Mobile Sessions', 'row/count ownership', 'row=false,count=true')
  await page.screenshot({ path: `${OUT}/mobile-sessions.png` })
} finally {
  await context.close()
  await browser.close()
}

writeFileSync(`${OUT}/result.json`, `${JSON.stringify({ parent: parent.id, child: child.id, offline: [...offlineIds], transcript }, null, 2)}\n`)
console.log(`session tree disclosure proof: ${OUT}`)
