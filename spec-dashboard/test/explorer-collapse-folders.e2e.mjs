// [[file-tree]] `the-tree-opens-the-branch-the-address-names-and-remembers-it` and
// `collapse-folders-is-one-door-on-the-explorer-head`, [[disk-tree]] `a-folder-stays-open-across-the-files-fold`,
// and [[conversation]] `the-composer-is-paper-with-one-send-mark`, measured through the running dashboard in
// a real browser.
//
//   BASE=http://127.0.0.1:5198 OUT=/path/to/evidence node spec-dashboard/test/explorer-collapse-folders.e2e.mjs
//
// The send is intercepted at the network edge: the browser posts through the product's own path
// (composer → Enter → sendSessionText → fetch) and the request body is read there, so a real session is
// never written to by a measurement.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5198'
const OUT = resolve(process.env.OUT || '/tmp/explorer-collapse-folders-e2e')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
const facts = {}
const record = (key, value) => { facts[key] = value; console.log(key, JSON.stringify(value)) }
// A screenshot is evidence only of a SETTLED page: no spinner, no "loading…" placeholder anywhere visible,
// and whatever the shot is about already in the DOM. Every capture below goes through this gate.
const settled = async (selector = null) => {
  if (selector) await page.waitForSelector(selector, { timeout: 20000 })
  await page.waitForFunction(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const spinners = [...document.querySelectorAll('.spinner, .pane-loading')].filter(visible)
    const placeholders = [...document.querySelectorAll('.m-empty, .ft-note, .m-transcript-state')]
      .filter((el) => visible(el) && /loading|加载/i.test(el.textContent))
    return spinners.length === 0 && placeholders.length === 0
  }, null, { timeout: 20000 })
  await page.waitForTimeout(400)
}

const graph = await (await fetch(`${BASE}/api/graph`)).json()
const live = (graph.sessions || []).find((s) => s.liveness !== 'offline' && s.status === 'asking')
  || (graph.sessions || []).find((s) => s.liveness !== 'offline')
assert.ok(live, 'the live board needs one online session')

// ───────────────────────────── explorer: one door folds both projections ─────────────────────────────
// the tree is a view of the address: routing to a NESTED node opens its ancestors, marks the row, and
// leaves the node itself closed; folding the dock away and back changes nothing.
await page.goto(`${BASE}/#/spec/disk-tree`)
await settled('.dock .ft-node.on')
const readReveal = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('.dock .ft-node')]
  const on = document.querySelector('.dock .ft-node.on')
  const parent = on && rows[rows.indexOf(on) - 1]
  const painted = on && (() => { const r = on.getBoundingClientRect(); return r.width > 0 && r.height > 0 })()
  return { rows: rows.length, focused: on?.querySelector('.ft-label').textContent.trim() || null, painted, ownCaret: on?.querySelector('.ft-caret').textContent.trim(),
    parentCaret: parent?.querySelector('.ft-caret').textContent.trim() }
})
const reveal = await readReveal()
record('explorer.reveal', reveal)
assert.equal(reveal.focused, 'disk-tree')
assert.equal(reveal.painted, true)
assert.equal(reveal.parentCaret, '▾', 'the ancestor opened')
assert.equal(reveal.ownCaret, '▸', 'the node itself stays closed')
await settled()
await page.locator('.dock').screenshot({ path: `${OUT}/explorer-reveal.png` })
const railFold = page.locator('button[aria-pressed][aria-label="Collapse sidebar"]')
await railFold.click(); await page.waitForTimeout(450)
record('explorer.dockFolded', { docks: await page.locator('.dock').count() })
assert.equal(facts['explorer.dockFolded'].docks, 0, 'a closed dock is unmounted')
await page.locator('button[aria-pressed][aria-label="Expand sidebar"]').click(); await page.waitForTimeout(450)
const revealAgain = await readReveal()
record('explorer.revealAfterFold', revealAgain)
assert.deepEqual(revealAgain, reveal, 'folding away and back renders exactly the same rows')
const nodeRows = page.locator('.dock .ft-section').first().locator('.ft-node')
const openNodeCarets = () => page.locator('.dock .ft-node .ft-caret', { hasText: '▾' }).count()
const openDirs = () => page.locator('.dock .ft-dir[aria-expanded="true"]').count()
const heads = page.locator('.dock .ft-section-head')
const door = page.locator('.dock .dock-head-act[aria-label]').filter({ has: page.locator('svg') }).first()
// open three more closed roots on top of whatever the route revealed
for (let i = 0, opened = 0; i < await nodeRows.count() && opened < 3; i++) {
  if ((await nodeRows.nth(i).locator('.ft-caret').innerText()).trim() === '▸') { await nodeRows.nth(i).click(); opened++; await page.waitForTimeout(120) }
}
if ((await heads.nth(1).getAttribute('aria-expanded')) !== 'true') await heads.nth(1).click()
await page.waitForSelector('.dock .ft-dir', { timeout: 20000 })
await page.locator('.dock .ft-dir').first().click()
await page.waitForTimeout(400)
const routeBefore = await page.evaluate(() => location.hash)
record('explorer.before', { openNodes: await openNodeCarets(), openDirs: await openDirs(), route: routeBefore })
assert.ok(facts['explorer.before'].openNodes >= 3 && facts['explorer.before'].openDirs >= 1, 'fixture: branches open in both sections')

// where the door is: on the dock head, beside search, never inside a section head
const doorLabel = await door.getAttribute('aria-label')
const doorTip = await door.getAttribute('data-tip')
const doorBox = await door.boundingBox()
const headBox = await page.locator('.dock .dock-head').boundingBox()
const searchBox = await page.locator('.dock .dock-head-act', { has: page.locator('svg') }).nth(1).boundingBox()
const inSectionHead = await page.locator('.dock .ft-section-head button, .dock .ft-section-head [role="button"]').count()
record('explorer.door', {
  label: doorLabel, tip: doorTip, disabledBefore: await door.isDisabled(),
  onDockHead: doorBox.y >= headBox.y && doorBox.y + doorBox.height <= headBox.y + headBox.height + 1,
  leftOfSearch: doorBox.x < searchBox.x, nestedInSectionHead: inSectionHead,
})
assert.equal(doorLabel, 'Collapse folders')
assert.equal(doorTip, doorLabel)
assert.equal(facts['explorer.door'].disabledBefore, false)
assert.equal(facts['explorer.door'].onDockHead, true)
assert.equal(facts['explorer.door'].leftOfSearch, true)
assert.equal(inSectionHead, 0, 'no control is nested inside a section head')
await settled('.dock .ft-dir[aria-expanded="true"] + *')
await page.locator('.dock').screenshot({ path: `${OUT}/explorer-open.png` })

await door.click()
await page.waitForTimeout(300)
record('explorer.afterCollapse', {
  openNodes: await openNodeCarets(), openDirs: await openDirs(),
  specsHead: await heads.nth(0).getAttribute('aria-expanded'), filesHead: await heads.nth(1).getAttribute('aria-expanded'),
  rootsVisible: await nodeRows.count(), route: await page.evaluate(() => location.hash), doorDisabled: await door.isDisabled(),
})
assert.equal(facts['explorer.afterCollapse'].openNodes, 0)
assert.equal(facts['explorer.afterCollapse'].openDirs, 0)
assert.equal(facts['explorer.afterCollapse'].specsHead, 'true')
assert.equal(facts['explorer.afterCollapse'].filesHead, 'true')
assert.ok(facts['explorer.afterCollapse'].rootsVisible > 0, 'roots stay listed')
assert.equal(facts['explorer.afterCollapse'].route, routeBefore)
assert.equal(facts['explorer.afterCollapse'].doorDisabled, true)
await settled()
await page.locator('.dock').screenshot({ path: `${OUT}/explorer-collapsed.png` })
await door.hover()
await page.waitForTimeout(250)
await page.locator('.dock .dock-head').screenshot({ path: `${OUT}/explorer-head-hover.png` })

// reopen ONE node: only that branch
await nodeRows.first().click()
await page.waitForTimeout(250)
record('explorer.reopenOne', { openNodes: await openNodeCarets(), doorDisabled: await door.isDisabled() })
assert.equal(facts['explorer.reopenOne'].openNodes, 1)
assert.equal(facts['explorer.reopenOne'].doorDisabled, false)

// a directory opened inside Files survives closing and reopening the section
await page.locator('.dock .ft-dir').first().click()
await page.waitForTimeout(300)
const dirPath = await page.locator('.dock .ft-dir').first().getAttribute('data-menu-path')
await heads.nth(1).click()   // close Files
await page.waitForTimeout(200)
record('explorer.filesClosed', { dirRows: await page.locator('.dock .ft-dir').count() })
await heads.nth(1).click()   // reopen Files
await page.waitForSelector('.dock .ft-dir', { timeout: 20000 })
await page.waitForTimeout(400)
record('explorer.filesReopened', { dir: dirPath, stillOpen: await page.locator(`.dock .ft-dir[data-menu-path="${dirPath}"]`).getAttribute('aria-expanded') })
assert.equal(facts['explorer.filesReopened'].stillOpen, 'true', 'directory disclosure is remembered across the section fold')

// ───────────────────────────── conversation: paper card, one send mark ─────────────────────────────
const sent = []
await page.route('**/api/sessions/**/input', async (route) => {
  sent.push(JSON.parse(route.request().postData() || '{}'))
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
})
const measureComposer = async () => page.evaluate(() => {
  const composer = document.querySelector('.tl-chat .m-composer')
  const column = document.querySelector('.tl-chat .m-col')
  const send = composer.querySelector('.m-send')
  const chat = document.querySelector('.tl-chat')
  const c = composer.getBoundingClientRect(); const k = column.getBoundingClientRect(); const s = send.getBoundingClientRect(); const h = chat.getBoundingClientRect()
  const style = getComputedStyle(composer)
  return {
    paneWidth: Math.round(h.width), width: Math.round(c.width), columnWidth: Math.round(k.width),
    centreOffset: Math.round(Math.abs((c.left + c.width / 2) - (h.left + h.width / 2))),
    border: style.borderTopWidth, background: style.backgroundColor,
    send: { tag: send.tagName, label: send.getAttribute('aria-label'), tip: send.getAttribute('data-tip'), hasSvg: !!send.querySelector('svg'), text: send.textContent.trim(), w: Math.round(s.width), h: Math.round(s.height), disabled: send.disabled },
    gutters: [...document.querySelectorAll('.tl-chat .m-ev > .m-gut')].filter((el) => getComputedStyle(el).display !== 'none').length,
    inlineTimes: [...document.querySelectorAll('.tl-chat .m-tin')].filter((el) => getComputedStyle(el).display !== 'none').length,
  }
})
await page.goto(`${BASE}/#/sessions/${live.id}?surface=conversation`)
await settled('.tl-chat .m-ev .m-ev-note, .tl-chat .m-ev .m-ev-text')
const desktop = await measureComposer()
record('composer.desktop', desktop)
assert.equal(desktop.send.tag, 'BUTTON')
assert.equal(desktop.send.label, 'send')
assert.equal(desktop.send.tip, 'send')
assert.equal(desktop.send.hasSvg, true)
assert.equal(desktop.send.text, '', 'icon-only: no word inside the button')
assert.equal(desktop.send.disabled, true, 'nothing to send yet')
assert.ok(desktop.width <= 760 && desktop.width <= desktop.columnWidth + 1, 'no wider than the reading column')
assert.ok(desktop.centreOffset <= 1, 'centred on the pane')
assert.equal(desktop.border, '1px')
await page.screenshot({ path: `${OUT}/conversation-desktop.png` })

const input = page.locator('.tl-chat .m-input')
await input.fill('YATU composer probe — first line\nsecond line')
await page.waitForTimeout(150)
record('composer.typed', { sendDisabled: await page.locator('.tl-chat .m-send').isDisabled() })
assert.equal(facts['composer.typed'].sendDisabled, false)
await page.locator('.tl-chat .m-composer').screenshot({ path: `${OUT}/composer-armed.png` })
await input.press('Enter')
await page.waitForTimeout(600)
record('composer.sent', { requests: sent, draftAfter: await input.inputValue() })
assert.equal(sent.length, 1, 'one send request')
assert.deepEqual(sent[0], { kind: 'text', text: 'YATU composer probe — first line\nsecond line', replyVia: 'note' })
assert.equal(facts['composer.sent'].draftAfter, '')

await page.setViewportSize({ width: 760, height: 900 })
await settled('.tl-chat .m-ev .m-ev-note, .tl-chat .m-ev .m-ev-text')
const narrow = await measureComposer()
record('composer.narrow', narrow)
assert.equal(narrow.gutters, 0, 'no ruler under the container threshold')
assert.ok(narrow.inlineTimes > 0, 'rows keep their own time')
assert.ok(narrow.width <= narrow.paneWidth && narrow.centreOffset <= 1)
await page.screenshot({ path: `${OUT}/conversation-narrow.png` })

await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${BASE}/#/sessions/${live.id}`)
await settled('.m-app .tl-chat .m-ev .m-ev-note, .m-app .tl-chat .m-ev .m-ev-text')
const phone = await page.evaluate(() => {
  const composer = document.querySelector('.m-app .tl-chat .m-composer').getBoundingClientRect()
  const tabbar = document.querySelector('.m-app .m-tabbar')?.getBoundingClientRect()
  const send = document.querySelector('.m-app .tl-chat .m-send')
  return { composerBottom: Math.round(composer.bottom), tabbarTop: tabbar ? Math.round(tabbar.top) : null, width: Math.round(composer.width), sendSvg: !!send?.querySelector('svg'),
    messageRows: document.querySelectorAll('.m-app .tl-chat .m-ev').length, placeholder: document.querySelector('.m-app .tl-chat .m-empty')?.textContent || null }
})
record('composer.phone', phone)
assert.ok(phone.tabbarTop === null || phone.composerBottom <= phone.tabbarTop, 'the composer sits above the tab bar')
assert.equal(phone.sendSvg, true)
assert.ok(phone.messageRows > 0 && phone.placeholder === null, 'the phone shot shows the conversation, not a placeholder')
await page.screenshot({ path: `${OUT}/conversation-phone.png` })

record('pageErrors', pageErrors)
assert.deepEqual(pageErrors, [])
writeFileSync(`${OUT}/facts.json`, JSON.stringify(facts, null, 2))
await browser.close()
console.log('PASS', OUT)
