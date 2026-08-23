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
const leaf = sessions.find((session) => session.liveness !== 'offline'
  && ['working', 'parked'].includes(session.status) && !childrenOf.get(session.id)?.length)
const childSubtree = new Set()
const pendingDescendants = child ? [child] : []
while (pendingDescendants.length) {
  const session = pendingDescendants.pop()
  if (!session || childSubtree.has(session.id)) continue
  childSubtree.add(session.id)
  pendingDescendants.push(...(childrenOf.get(session.id) || []))
}
const reparentTarget = sessions.find((session) => session.liveness !== 'offline'
  && session.id !== parent?.id && !childSubtree.has(session.id))
const retainedOffline = sessions.filter((session) => session.liveness === 'offline').slice(0, 2)
const offline = retainedOffline.length ? retainedOffline : sessions.filter((session) =>
  session.id !== parent?.id && session.id !== child?.id && session.id !== leaf?.id
  && !session.parent && !childrenOf.get(session.id)?.length).slice(0, 1)
const fixtureNeedsOffline = retainedOffline.length === 0
assert.ok(parent && child, 'the live board needs one present parent/child session pair')
assert.ok(leaf, 'the live board needs one live leaf session')
assert.ok(reparentTarget, 'the live board needs one second live session for a reparent target')
assert.ok(offline.length, 'the board needs one unrelated session record for the offline fixture')

// Keep the live board's real session records and nesting. Promote retained offline records to roots; when a
// clean board has none, mark one unrelated root offline only in this intercepted snapshot. The running
// backend and every session.json stay untouched while the real dashboard still renders the full state shape.
const fixture = structuredClone(graph)
const offlineIds = new Set(offline.map((session) => session.id))
const longDragHeadline = 'selected drag projection must keep this complete title layout aligned with the live focused session row'
fixture.sessions = fixture.sessions.map((session) => {
  const patched = offlineIds.has(session.id)
    ? { ...session, parent: null, ...(fixtureNeedsOffline ? { status: 'offline', liveness: 'offline' } : {}) }
    : session
  return session.id === child.id ? { ...patched, title: longDragHeadline, headline: longDragHeadline } : patched
})

const transcript = []
const timeline = []
const reparentRequests = []
const record = (surface, fact, value) => transcript.push({ surface, fact, value })
let videoStartedAt = 0
const mark = (step) => timeline.push({ at: Date.now() - videoStartedAt, step })
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
videoStartedAt = Date.now()
const page = await context.newPage()
await page.route('**/api/graph*', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(fixture),
}))
await page.route('**/api/sessions/reparent', async (route) => {
  reparentRequests.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ok: true }),
  })
})

try {
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-panel').waitFor({ state: 'visible' })
  mark('open sessions')

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

  const visibleSessionIds = await page.locator('.si-item[data-sid]').evaluateAll((rows) => rows.map((row) => row.dataset.sid))
  const parentIndex = visibleSessionIds.indexOf(parent.id)
  const tabDirection = parentIndex < visibleSessionIds.length - 1 ? 'ArrowDown' : 'ArrowUp'
  const tabReturn = tabDirection === 'ArrowDown' ? 'ArrowUp' : 'ArrowDown'
  const expectedMovedSession = visibleSessionIds[parentIndex + (tabDirection === 'ArrowDown' ? 1 : -1)]
  await page.keyboard.press(`Alt+${tabDirection}`)
  const movedSession = await page.locator('.si-item.on').getAttribute('data-sid')
  assert.equal(movedSession, expectedMovedSession, 'plain Alt arrows must keep moving the selected session tab')
  await page.keyboard.press(`Alt+${tabReturn}`)
  assert.equal(await page.locator('.si-item.on').getAttribute('data-sid'), parent.id, 'plain Alt+ArrowUp must return to the selected parent')
  record('SessionInterface', 'plain Alt arrows move tabs', true)

  await page.evaluate(() => { document.activeElement.dataset.sessionTreeFocusProbe = 'before-fold' })
  await interfacePod.click()
  assert.equal(await expanded(interfacePod), 'true')
  assert.equal(await page.locator(`.si-item[data-sid="${child.id}"]`).count(), 1)
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.sessionTreeFocusProbe), 'before-fold')
  record('SessionInterface', 'header click opens fold without taking focus', await expanded(interfacePod))
  record('SessionInterface', 'header click keeps focus owner', true)
  await interfacePod.click()

  await interfaceBody.click()
  mark('expand current parent with Alt+Shift+ArrowDown')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  assert.equal(await expanded(interfacePod), 'true', 'Alt+Shift+ArrowDown must expand the selected parent')
  assert.equal(await page.locator(`.si-item[data-sid="${child.id}"]`).count(), 1)
  await page.keyboard.press('Alt+Shift+ArrowUp')
  assert.equal(await expanded(interfacePod), 'false', 'Alt+Shift+ArrowUp must collapse the selected parent')
  assert.equal(await page.locator(`.si-item[data-sid="${child.id}"]`).count(), 0)
  record('SessionInterface', 'Alt+Shift arrows disclose current parent', 'false→true→false')

  await page.evaluate((id) => { window.location.hash = `#/sessions/${id}` }, leaf.id)
  const leafRow = page.locator(`.si-item[data-sid="${leaf.id}"]`)
  await leafRow.waitFor({ state: 'visible' })
  await leafRow.click()
  await page.waitForFunction((id) => document.querySelector(`.si-item[data-sid="${id}"]`)?.classList.contains('on'), leaf.id)
  await page.keyboard.press('Alt+i')
  const leafCommand = page.locator('.si-command-input')
  await leafCommand.waitFor({ state: 'visible' })
  await leafCommand.fill('alpha beta')
  await leafCommand.evaluate((input) => input.setSelectionRange(0, 0))
  await page.keyboard.press('ArrowRight')
  assert.ok(await leafCommand.evaluate((input) => input.selectionStart) > 0, 'ArrowRight must keep native input navigation')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  assert.equal(await page.locator('.si-item.on').getAttribute('data-sid'), leaf.id, 'leaf shortcut must not move the selected tab')
  assert.equal(await leafCommand.inputValue(), 'alpha beta', 'leaf shortcut must leave the composer draft intact')
  record('SessionInterface', 'leaf Alt+Shift shortcut is a no-op', true)
  await page.keyboard.press('Escape')

  const interfaceOffline = page.locator('.si-zone-offline')
  assert.equal(await expanded(interfaceOffline), 'false')
  await interfaceOffline.locator('.si-zone-label').click()
  assert.equal(await expanded(interfaceOffline), 'true', 'OFFLINE label must toggle the header')
  const offlineBox = await interfaceOffline.boundingBox()
  assert.ok(offlineBox, 'OFFLINE header must have a layout box')
  await page.mouse.click(offlineBox.x + offlineBox.width - 4, offlineBox.y + offlineBox.height / 2)
  assert.equal(await expanded(interfaceOffline), 'false', 'trailing rule area must toggle the header')
  await interfaceOffline.focus()
  assert.equal(await interfaceOffline.evaluate((node) => document.activeElement === node), true, 'OFFLINE header was not keyboard focusable')
  await interfaceOffline.press('Enter')
  assert.equal(await expanded(interfaceOffline), 'true', 'Enter must toggle the whole header')
  await interfaceOffline.press('Space')
  assert.equal(await expanded(interfaceOffline), 'false', 'Space must toggle the whole header')
  assert.equal(await interfaceOffline.locator('.si-zone-count').getAttribute('aria-expanded'), null)
  assert.equal(await interfaceOffline.locator('button').count(), 0, 'zone header must not nest a second button')
  const unchangedSelection = await page.locator('.si-item.on').getAttribute('data-sid')
  for (const zone of ['need', 'run']) {
    const header = page.locator(`.si-zone-${zone}`)
    if (await header.count()) {
      await header.click()
      assert.equal(await page.locator('.si-item.on').getAttribute('data-sid'), unchangedSelection, `${zone} header click changed selection`)
    }
  }
  assert.ok(await visibleRows(page, '.si-item') > 1)

  await page.evaluate((id) => { window.location.hash = `#/sessions/${id}` }, offline[0].id)
  await page.locator(`.si-item[data-sid="${offline[0].id}"]`).waitFor({ state: 'visible' })
  assert.equal(await expanded(interfaceOffline), 'false')
  record('SessionInterface', 'offline deep link remains visible while folded', true)

  await page.evaluate((id) => { window.location.hash = `#/sessions/${id}` }, child.id)
  await page.locator(`.si-item[data-sid="${child.id}"]`).waitFor({ state: 'visible' })
  assert.equal(await expanded(interfacePod), 'true', 'a nested deep link must reveal its present ancestors')
  assert.equal(await page.locator('.si-list button button').count(), 0)

  // Reparent uses the actual session row as the drag subject: its fixed ghost carries the row's visible
  // headline/status, the valid receiver is highlighted, and the request remains an intercepted fixture write.
  await page.evaluate((id) => { window.location.hash = `#/sessions/${id}` }, child.id)
  const dragChild = page.locator(`.si-item[data-sid="${child.id}"]`)
  const dragTarget = page.locator(`.si-tree-row:has(> .si-item[data-sid="${reparentTarget.id}"])`)
  await dragChild.waitFor({ state: 'visible' })
  await dragTarget.waitFor({ state: 'visible' })
  await page.waitForFunction((id) => document.querySelector(`.si-item[data-sid="${id}"]`)?.classList.contains('on'), child.id)
  const childBox = await dragChild.boundingBox()
  assert.ok(childBox, 'drag source must have screen bounds')
  await page.mouse.move(childBox.x + 16, childBox.y + childBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(childBox.x + 28, childBox.y + childBox.height / 2)
  const dragGhost = page.locator('.si-session-drag-ghost')
  await dragGhost.waitFor({ state: 'visible' })
  assert.equal(await page.locator(`.si-tree-row:has(> .si-item[data-sid="${child.id}"])`).evaluate((row) => row.classList.contains('dragging')), true)
  assert.equal(await dragGhost.locator('.sess-id').textContent(), await dragChild.locator('.sess-id').textContent(), 'the ghost retains the source row headline')
  const dragLayout = await dragChild.evaluate((source) => {
    const ghost = document.querySelector('.si-session-drag-ghost .si-item')
    const transform = new DOMMatrix(getComputedStyle(ghost.parentElement).transform)
    const describe = (row) => {
      const headline = row.querySelector('.sess-id')
      const marker = row.querySelector('.sess-meta')
      const bounds = headline.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(headline)
      const lines = [...range.getClientRects()]
        .filter((rect) => rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1)
        .map((rect) => Math.round(rect.width))
      return {
        tag: row.tagName,
        className: row.className,
        markerFloat: getComputedStyle(marker).float,
        lines,
      }
    }
    return { source: describe(source), ghost: describe(ghost), visualScale: Math.hypot(transform.a, transform.b) }
  })
  assert.equal(dragLayout.source.tag, dragLayout.ghost.tag, 'the ghost and source retain the same row element')
  assert.equal(dragLayout.source.className, dragLayout.ghost.className, 'the ghost and source retain the same focused row state')
  assert.equal(dragLayout.source.markerFloat, 'right', 'a focused source reserves the status mark on its first line')
  assert.equal(dragLayout.ghost.markerFloat, 'right', 'the ghost keeps the focused source marker rule')
  assert.ok(Math.abs(dragLayout.visualScale - 0.75) < 0.001, 'the drag ghost is 75% of the source row size')
  assert.equal(dragLayout.source.lines.length, 3, 'the focused source exposes three visible headline lines')
  assert.equal(dragLayout.ghost.lines.length, dragLayout.source.lines.length, 'the ghost exposes the same visible headline line count')
  assert.ok(Math.max(...dragLayout.source.lines.slice(1)) > dragLayout.source.lines[0], 'the source lets later lines grow past the marker-reserved first line')
  assert.ok(Math.max(...dragLayout.ghost.lines.slice(1)) > dragLayout.ghost.lines[0], 'the ghost preserves the source first-line marker reservation')
  record('SessionInterface', 'focused drag layout matches source', dragLayout)
  const movedTargetBox = await dragTarget.boundingBox()
  assert.ok(movedTargetBox, 'target row must keep screen bounds after the root zone opens')
  await page.mouse.move(movedTargetBox.x + movedTargetBox.width / 2, movedTargetBox.y + movedTargetBox.height / 2)
  assert.equal(await dragTarget.evaluate((row) => row.classList.contains('drop-target')), true)
  await page.screenshot({ path: `${OUT}/session-row-drag.png` })
  const targetDrop = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/sessions/reparent'))
  await page.mouse.up()
  await targetDrop
  assert.deepEqual(reparentRequests.at(-1), { children: [child.id], parent: reparentTarget.id })
  mark('whole-row drag reparent')
  record('SessionInterface', 'whole-row drag reparent', reparentTarget.id)

  const rootSource = page.locator(`.si-item[data-sid="${child.id}"]`)
  const rootSourceBox = await rootSource.boundingBox()
  assert.ok(rootSourceBox, 'nested row must still be draggable to the root zone')
  await page.mouse.move(rootSourceBox.x + 16, rootSourceBox.y + rootSourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(rootSourceBox.x + 28, rootSourceBox.y + rootSourceBox.height / 2)
  const rootDrop = page.locator('[data-session-root-drop]')
  await rootDrop.waitFor({ state: 'visible' })
  const rootBox = await rootDrop.boundingBox()
  assert.ok(rootBox, 'nested drag must reveal the root drop zone')
  await page.mouse.move(rootBox.x + rootBox.width / 2, rootBox.y + rootBox.height / 2)
  assert.equal(await rootDrop.evaluate((zone) => zone.classList.contains('on')), true)
  const rootRequest = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/sessions/reparent'))
  await page.mouse.up()
  await rootRequest
  assert.deepEqual(reparentRequests.at(-1), { children: [child.id], parent: null })
  mark('root-zone detaches parent')
  record('SessionInterface', 'root-zone detaches parent', true)

  await rootSource.click({ button: 'right' })
  const detach = page.locator('.sess-menu-item', { hasText: 'remove from parent' })
  await detach.waitFor({ state: 'visible' })
  const menuRequest = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith('/api/sessions/reparent'))
  await detach.click()
  await menuRequest
  assert.deepEqual(reparentRequests.at(-1), { children: [child.id], parent: null })
  mark('context menu detaches parent')
  record('SessionInterface', 'context menu detaches parent', true)

  // Compare the two real product surfaces. Fully disclose the dashboard forest, read its DOM order, then
  // open the empty Sessions palette and verify that its session plane inherits that exact order.
  const offlineHeader = page.locator('.si-zone-offline')
  if (await offlineHeader.count() && await expanded(offlineHeader) === 'false') await offlineHeader.click()
  while (await page.locator('.si-list .sess-fold-control[aria-expanded="false"]').count()) {
    await page.locator('.si-list .sess-fold-control[aria-expanded="false"]').first().click()
  }
  const dashboardSessionOrder = await page.locator('.si-item[data-sid]').evaluateAll((rows) => rows.map((row) => row.dataset.sid))
  mark('open empty session search')
  await page.keyboard.press('Control+/')
  assert.equal(await page.locator('.search-panel').count(), 0, 'Control+/ must remain native and not open app search')
  await page.keyboard.press('Alt+/')
  await page.locator('.search-panel').waitFor({ state: 'visible' })
  const paletteSessionOrder = await page.locator('.search-item[data-kind="session"]').evaluateAll((rows) => rows.map((row) => row.dataset.target))
  assert.deepEqual(paletteSessionOrder, dashboardSessionOrder.slice(0, paletteSessionOrder.length))
  mark('session orders match')
  record('Session search', 'empty order follows disclosed dashboard forest', paletteSessionOrder)
  await page.screenshot({ path: `${OUT}/session-search-empty.png` })
  await page.keyboard.press('Escape')
  await page.screenshot({ path: `${OUT}/session-interface.png` })

  await page.goto(`${BASE}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.locator('.side-rail').waitFor({ state: 'visible' })
  await page.keyboard.press('/')
  await page.locator('.search-panel').waitFor({ state: 'visible' })
  const graphPlainLead = await page.locator('.search-item').first().getAttribute('data-kind')
  assert.equal(graphPlainLead, 'spec', 'plain / on the graph must open the spec-node-first palette')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Alt+/')
  await page.locator('.search-panel').waitFor({ state: 'visible' })
  const graphOptionLead = await page.locator('.search-item').first().getAttribute('data-kind')
  assert.equal(graphOptionLead, 'session', 'Alt+/ on the graph must open the session-first palette')
  record('Graph search', 'plain vs Option slash lead', `${graphPlainLead}→${graphOptionLead}`)
  await page.screenshot({ path: `${OUT}/graph-session-search.png` })
  await page.keyboard.press('Escape')

  // The graph keeps only a bounded cross-reference; the dock remains the full forest owner. Verify the
  // badge and its shared picker before moving to the dock's row/header disclosure ownership.
  const sessionBadge = page.locator('.sess-badge-trigger')
  await sessionBadge.waitFor({ state: 'visible' })
  await sessionBadge.click()
  await page.locator('.sess-badge-panel').waitFor({ state: 'visible' })
  assert.ok(await page.locator('.sess-badge-panel .session-picker-row').count() > 0)
  await page.keyboard.press('Escape')
  await page.evaluate(() => { localStorage.setItem('spexcode.dock', '1'); localStorage.setItem('spexcode.dockMode', 'sessions') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.dock-session-list').waitFor({ state: 'visible' })
  const dockParent = page.locator('.dock-session-list .sess-tree-row:has(> .sess-fold-control)').first()
  const dockBody = dockParent.locator('> .si-item')
  const dockPod = dockParent.locator('> .sess-fold-control')
  const dockRowsBefore = await visibleRows(page, '.dock-session-list .si-item')
  assert.equal(await expanded(dockPod), 'false')
  assert.equal(await dockBody.getAttribute('aria-expanded'), null)
  await dockPod.click()
  assert.equal(await expanded(dockPod), 'true')
  assert.ok(await visibleRows(page, '.dock-session-list .si-item') > dockRowsBefore)
  const dockOffline = page.locator('.dock-session-zone-offline')
  await dockOffline.click()
  assert.equal(await expanded(dockOffline), 'true')
  await dockOffline.click()
  assert.equal(await expanded(dockOffline), 'false')
  assert.equal(await page.locator('.dock-session-list button button').count(), 0)
  record('Session dock', 'row/header ownership', 'row=false,header=true')
  await page.screenshot({ path: `${OUT}/session-dock-disclosure.png` })

  await page.setViewportSize({ width: 390, height: 760 })
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator('.m-tabbar-btn').nth(1).click()
  // A viewport flip may carry the dock's current session into the phone's deep-linked detail. Its
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
  await mobileOffline.locator('.si-zone-label').click()
  assert.equal(await expanded(mobileOffline), 'true')
  await mobileOffline.click()
  assert.equal(await expanded(mobileOffline), 'false')
  assert.equal(await page.locator('.m-sesslist button button').count(), 0)
  record('Mobile Sessions', 'row/header ownership', 'row=false,header=true')
  await page.screenshot({ path: `${OUT}/mobile-sessions.png` })
} finally {
  await context.close()
  await browser.close()
}

writeFileSync(`${OUT}/result.json`, `${JSON.stringify({ parent: parent.id, child: child.id, offline: [...offlineIds], transcript }, null, 2)}\n`)
writeFileSync(`${OUT}/timeline.json`, `${JSON.stringify({ v: 2, axis: 'time', events: timeline }, null, 2)}\n`)
console.log(`session tree disclosure proof: ${OUT}`)
