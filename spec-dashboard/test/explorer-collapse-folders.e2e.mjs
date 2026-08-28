// [[file-tree]] `the-tree-opens-the-branch-the-address-names-and-remembers-it` and
// `collapse-folders-is-one-door-on-the-explorer-head`, [[disk-tree]] `a-folder-stays-open-across-the-files-fold`,
// and [[conversation]] `the-composer-is-paper-with-one-send-mark` + `the-conversation-reads-as-paper` +
// `stop-is-one-square-while-working` + `the-live-seam-counts-and-glows` + `an-expanded-live-seam-keeps-counting`, measured
// through the running dashboard in a real browser.
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
  const caret = (row) => { const c = row?.querySelector('.ft-caret .caret'); return c ? (c.classList.contains('is-open') ? 'open' : 'closed') : 'none' }
  return { rows: rows.length, focused: on?.querySelector('.ft-label').textContent.trim() || null, painted, ownCaret: caret(on), parentCaret: caret(parent) }
})
const reveal = await readReveal()
record('explorer.reveal', reveal)
assert.equal(reveal.focused, 'disk-tree')
assert.equal(reveal.painted, true)
assert.equal(reveal.parentCaret, 'open', 'the ancestor opened')
assert.equal(reveal.ownCaret, 'closed', 'the node itself stays closed')
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
const openNodeCarets = () => page.locator('.dock .ft-node .ft-caret .caret.is-open').count()
const openDirs = () => page.locator('.dock .ft-dir[aria-expanded="true"]').count()
const heads = page.locator('.dock .ft-section-head')
const door = page.locator('.dock .dock-head-act[aria-label]').filter({ has: page.locator('svg') }).first()
// open three more closed roots on top of whatever the route revealed
for (let i = 0, opened = 0; i < await nodeRows.count() && opened < 3; i++) {
  if (await nodeRows.nth(i).locator('.ft-caret .caret:not(.is-open)').count()) { await nodeRows.nth(i).click(); opened++; await page.waitForTimeout(120) }
}
await page.waitForSelector('.dock .ft-dir', { timeout: 20000 })
await page.locator('.dock .ft-dir').first().click()
await page.waitForTimeout(400)
const routeBefore = await page.evaluate(() => location.hash)
record('explorer.before', { openNodes: await openNodeCarets(), openDirs: await openDirs(), route: routeBefore })
assert.ok(facts['explorer.before'].openNodes >= 3 && facts['explorer.before'].openDirs >= 1, 'fixture: branches open in both sections')

// the disclosure mark is a chevron and nesting is a line
const marks = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.dock .ft-row')]
  const triangles = rows.filter((row) => /[▸▾]/.test(row.textContent)).length
  const rotation = (el) => { const m = getComputedStyle(el).transform; if (m === 'none') return 0; const [a, b] = m.match(/-?[\d.]+/g).map(Number); return Math.round(Math.atan2(b, a) * 180 / Math.PI) }
  const open = document.querySelector('.dock .ft-node .ft-caret .caret.is-open')
  const closed = document.querySelector('.dock .ft-node .ft-caret .caret:not(.is-open)')
  const heads = [...document.querySelectorAll('.dock .ft-section-head[aria-expanded]')].length
  const zones = [...document.querySelectorAll('.dock .ft-section-head.si-zone')].map((head) => ({
    label: head.querySelector('.si-zone-label')?.textContent?.trim(), count: head.querySelector('.si-zone-count')?.textContent?.trim(),
  }))
  const deep = rows.map((row) => ({ row, depth: Number(getComputedStyle(row).getPropertyValue('--depth')) })).find((r) => r.depth >= 3)
  let guides = null
  if (deep) {
    const before = getComputedStyle(deep.row, '::before')
    guides = { depth: deep.depth, left: before.left, width: before.width, image: before.backgroundImage.includes('repeating-linear-gradient') }
  }
  return { triangles, openTag: open?.tagName, openRotation: open ? rotation(open) : null, closedRotation: closed ? rotation(closed) : null, heads, zones, guides }
})
record('explorer.marks', marks)
assert.equal(marks.triangles, 0, 'no triangle glyph survives')
assert.equal(marks.openTag, 'svg'); assert.equal(marks.openRotation, 90); assert.equal(marks.closedRotation, 0)
assert.equal(marks.heads, 0, 'section zone heads have no disclosure control')
assert.deepEqual(marks.zones.map((zone) => zone.label), ['Specs', 'Files'])
assert.ok(marks.guides && marks.guides.image && marks.guides.left === '12px' && marks.guides.width === `${marks.guides.depth * 11}px`, 'N guides for depth N, dropped from the caret slot')

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
assert.equal(facts['explorer.afterCollapse'].specsHead, null)
assert.equal(facts['explorer.afterCollapse'].filesHead, null)
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

// a directory opened inside Files stays mounted while the explorer remains visible
await page.locator('.dock .ft-dir').first().click()
await page.waitForTimeout(300)
const dirPath = await page.locator('.dock .ft-dir').first().getAttribute('data-menu-path')
record('explorer.filesReopened', { dir: dirPath, stillOpen: await page.locator(`.dock .ft-dir[data-menu-path="${dirPath}"]`).getAttribute('aria-expanded') })
assert.equal(facts['explorer.filesReopened'].stillOpen, 'true', 'directory disclosure remains visible in the static Files projection')

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
assert.ok(desktop.width <= 720 && desktop.width <= desktop.columnWidth + 1, 'no wider than the reading column')
assert.ok(desktop.centreOffset <= 1, 'centred on the pane')
assert.equal(desktop.border, '1px')
await page.screenshot({ path: `${OUT}/conversation-desktop.png` })

// ---- the page as paper: one measure, quiet minutes, a seam with no rule
const measurePaper = async () => page.evaluate(() => {
  const col = document.querySelector('.tl-chat .m-col'); const chat = document.querySelector('.tl-chat .m-timeline')
  const c = col.getBoundingClientRect(); const h = chat.getBoundingClientRect()
  const widest = (sel) => Math.max(0, ...[...document.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().width)))
  const rows = [...document.querySelectorAll('.tl-chat .m-ev')].filter((row) => row.getBoundingClientRect().height > 0)
  const gaps = rows.slice(1).map((row, i) => Math.round(row.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom))
  const seam = document.querySelector('.tl-chat .m-seam-row')
  const time = document.querySelector('.tl-chat .m-ev .m-gut time')
  // the CELL is the measure minus the 52px ruler and its 16px gap: what a note may fill and a quote is capped against
  const cell = Math.round(document.querySelector('.tl-chat .m-ev-say > .m-say')?.parentElement.getBoundingClientRect().width - 68)
  return {
    column: Math.round(c.width), cell, centreOffset: Math.round(Math.abs((c.left + c.width / 2) - (h.left + h.width / 2))),
    sidePadding: parseFloat(getComputedStyle(chat).paddingLeft),
    widestNote: widest('.tl-chat .m-say'), widestQuote: widest('.tl-chat .m-ev > .m-quote'),
    rowPadding: parseFloat(getComputedStyle(rows[0]).paddingTop) * 2, minGap: Math.min(...gaps),
    timeOpacity: time ? parseFloat(getComputedStyle(time).opacity) : null,
    seam: seam ? (() => { const caret = seam.querySelector('.caret'); const lead = seam.querySelector('.m-seam-lead')
      return { fontSize: getComputedStyle(seam).fontSize, rule: !!seam.querySelector('.m-seam-line'), width: Math.round(seam.getBoundingClientRect().width),
        caretLast: seam.lastElementChild === caret, caretTrails: !!caret && !!lead && caret.getBoundingClientRect().left >= lead.getBoundingClientRect().right } })() : null,
    trailing: [...document.querySelectorAll('.tl-chat [aria-expanded]')].filter((row) => row.querySelector('.caret')).map((row) => row.lastElementChild.classList.contains('caret')),
    ground: getComputedStyle(document.querySelector('.tl-chat')).backgroundColor,
  }
})
const paper = await measurePaper()
record('paper.desktop', paper)
assert.equal(paper.column, 720); assert.ok(paper.centreOffset <= 1)
assert.equal(paper.cell, 652, 'the ruler takes 52px + 16px of the 720px measure')
assert.ok(paper.widestNote >= paper.cell - 1, 'the agent runs the whole cell')
assert.ok(paper.widestQuote <= Math.round(paper.cell * 0.8) + 1, 'the quote caps at 80% of the cell')
assert.ok(paper.timeOpacity < 1, 'the minute rests quiet')
assert.ok(paper.seam && !paper.seam.rule && paper.seam.fontSize === '11px' && paper.seam.width < paper.column, 'one caption line, no rule to the edge')
assert.ok(paper.seam.caretLast && paper.seam.caretTrails, 'the seam chevron trails the words')
assert.ok(paper.trailing.length > 0 && paper.trailing.every(Boolean), 'every disclosure in the conversation ends with its chevron')
assert.ok(paper.rowPadding >= 24 && paper.minGap >= 0, 'air between rows')
assert.ok(paper.sidePadding > 16, 'the margin grew with the pane')
await page.locator('.tl-chat .m-ev.m-ev-say').first().hover()
await page.waitForTimeout(250)
record('paper.hover', { timeOpacity: await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.tl-chat .m-ev.m-ev-say .m-gut time')).opacity)) })
assert.equal(facts['paper.hover'].timeOpacity, 1)
await page.mouse.move(5, 5)

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

// ---- stop: one square beside send, only while the agent works; the one interrupt verb, intercepted
const interrupts = []
await page.route('**/api/sessions/**/interrupt', async (route) => {
  interrupts.push(route.request().url())
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
})
const working = (graph.sessions || []).find((s) => s.liveness !== 'offline' && s.status === 'working' && !s.capabilities?.headless)
if (working) {
  await page.goto(`${BASE}/#/sessions/${working.id}?surface=conversation`)
  await settled('.m-composer:visible')
  // two TimelineChats stay mounted once two sessions were visited; read only the one on screen
  const stopFacts = await page.evaluate(() => {
    const shown = (sel) => [...document.querySelectorAll(sel)].find((el) => el.getClientRects().length > 0)
    const stop = shown('.tl-chat .m-stop'); const send = shown('.tl-chat .m-send')
    if (!stop) return { present: false }
    const a = stop.getBoundingClientRect(); const b = send.getBoundingClientRect()
    return { present: true, tag: stop.tagName, label: stop.getAttribute('aria-label'), tip: stop.getAttribute('data-tip'), w: Math.round(a.width), h: Math.round(a.height), leftOfSend: a.right <= b.left, hasSvg: !!stop.querySelector('svg') }
  })
  record('stop.working', { session: working.id, ...stopFacts })
  assert.deepEqual(stopFacts, { present: true, tag: 'BUTTON', label: 'stop', tip: 'stop', w: 26, h: 26, leftOfSend: true, hasSvg: true })
  await page.locator('.m-composer:visible').screenshot({ path: `${OUT}/composer-stop.png` })
  await page.locator('.m-stop:visible').click()
  await page.waitForTimeout(400)
  record('stop.pressed', { interrupts })
  assert.equal(interrupts.length, 1)
  assert.ok(interrupts[0].includes(`/api/sessions/${working.id}/interrupt`))
  // the live seam counts every second and glows — on whichever working session has an open tail seam now
  let liveLead = page.locator('.tl-chat:visible .m-seam-row.is-live .m-seam-lead')
  for (const candidate of (graph.sessions || []).filter((s) => s.liveness !== 'offline' && s.status === 'working' && s.id !== working.id)) {
    if (await liveLead.count()) break
    await page.goto(`${BASE}/#/sessions/${candidate.id}?surface=conversation`)
    await settled('.m-composer:visible')
    liveLead = page.locator('.tl-chat:visible .m-seam-row.is-live .m-seam-lead')
  }
  if (await liveLead.count()) {
    const seconds = (text) => { const m = /(\d+)s\b/.exec(text); return m ? Number(m[1]) : null }
    const first = await liveLead.textContent(); await page.waitForTimeout(2100); const second = await liveLead.textContent()
    const anim = await liveLead.evaluate((el) => getComputedStyle(el).animationName)
    record('seam.live', { first, second, anim })
    assert.ok(first.startsWith('working') && seconds(first) !== null && seconds(second) !== null, 'the live seam reads working · Ns')
    assert.ok(Math.abs((seconds(second) - seconds(first) + 60) % 60 - 2) <= 1, 'the count advanced ~2s without a poll')
    assert.equal(anim, 'm-seam-shimmer')
    // an EXPANDED live seam keeps counting: each poll re-reads its interval with an advancing `to`, and the
    // inset never blinks back to its loading line once it has content
    const reads = []
    await page.route('**/transcript?*', async (route) => { reads.push(Number(new URL(route.request().url()).searchParams.get('to'))); await route.continue() })
    const liveRow = page.locator('.tl-chat:visible .m-seam-row.is-live')
    await liveRow.click()
    await page.waitForSelector('.tl-chat:visible .m-seam-inset .tc-flow, .tl-chat:visible .m-seam-inset .m-transcript-empty', { timeout: 20000 })
    const detailBefore = await page.locator('.tl-chat:visible .m-seam-row.is-live .m-seam-detail').textContent().catch(() => null)
    let loadingFlashes = 0
    const deadline = Date.now() + 19000
    while (Date.now() < deadline) {
      if (await page.locator('.tl-chat:visible .m-seam-inset .m-transcript-state').count()) loadingFlashes++
      await page.waitForTimeout(300)
    }
    const detailAfter = await page.locator('.tl-chat:visible .m-seam-row.is-live .m-seam-detail').textContent().catch(() => null)
    await page.unroute('**/transcript?*')
    record('seam.expanded', { reads, loadingFlashes, detailBefore, detailAfter, stillOpen: await liveRow.getAttribute('aria-expanded') })
    assert.ok(reads.length >= 2, 'the expanded live seam re-read across polls')
    assert.ok(reads.every((to, i) => i === 0 || to > reads[i - 1]), 'each re-read ends later than the last')
    assert.equal(loadingFlashes, 0, 'the inset never fell back to its loading line')
    assert.equal(facts['seam.expanded'].stillOpen, 'true')
  } else record('seam.live', { skipped: 'no working session has an open tail seam right now' })
} else record('stop.working', { skipped: 'no working pane-backed session on the board' })
await page.goto(`${BASE}/#/sessions/${live.id}?surface=conversation`)
await settled('.m-composer:visible')
record('stop.asking', { session: live.id, status: live.status, stops: await page.locator('.m-stop:visible').count(), liveSeams: await page.locator('.tl-chat:visible .m-seam-row.is-live').count() })
assert.equal(facts['stop.asking'].stops, 0, 'no stop control while nothing is working')
assert.equal(facts['stop.asking'].liveSeams, 0, 'an asking session marks no seam live')

// the work fold is a sentence and the tool output is a well on the theme's ladder, dark and light alike
const foldFacts = {}
for (const theme of ['minimal', 'things']) {
  await page.evaluate((t) => { localStorage.setItem('spexcode.theme', t); document.documentElement.dataset.theme = t }, theme)
  await page.waitForTimeout(150)
  const seams = page.locator('.tl-chat:visible .m-seam-row')
  for (let i = await seams.count() - 1; i >= 0 && !(await page.locator('.tl-chat:visible .tc-tool-row.is-openable').count()); i--) {
    if ((await seams.nth(i).getAttribute('aria-expanded')) !== 'true') { await seams.nth(i).click(); await page.waitForTimeout(700) }
  }
  const fold = page.locator('.tl-chat:visible .tc-work-row').first()
  if (await fold.count() && (await fold.getAttribute('aria-expanded')) !== 'true') { await fold.click(); await page.waitForTimeout(200) }
  const tool = page.locator('.tl-chat:visible .tc-tool-row.is-openable').first()
  if (await tool.count() && (await tool.getAttribute('aria-expanded')) !== 'true') { await tool.click(); await page.waitForTimeout(200) }
  foldFacts[theme] = await page.evaluate(() => {
    const probe = document.createElement('div'); probe.style.background = 'var(--panel2)'; document.body.append(probe)
    const panel2 = getComputedStyle(probe).backgroundColor; probe.remove()
    const fold = document.querySelector('.tl-chat .tc-work-row'); const out = document.querySelector('.tl-chat .tc-tool-out')
    // a flex container blockifies an inline-flex child (computed `flex`), so the row is judged by what the UA
    // default button would have painted instead: a grey fill, no radius, 1px 6px padding
    const fs = fold ? getComputedStyle(fold) : null
    return { fold: fs ? { background: fs.backgroundColor, radius: fs.borderRadius, padding: fs.padding, bounded: fold.getBoundingClientRect().width < fold.parentElement.getBoundingClientRect().width } : null,
      outBackground: out ? getComputedStyle(out).backgroundColor : null, panel2 }
  })
}
record('fold.themes', foldFacts)
for (const [theme, f] of Object.entries(foldFacts)) {
  if (f.fold) assert.ok(f.fold.background === 'rgba(0, 0, 0, 0)' && f.fold.radius === '6px' && f.fold.bounded, `${theme}: the work fold is a styled, bounded sentence, not a default button`)
  if (f.outBackground !== null) assert.equal(f.outBackground, f.panel2, `${theme}: the tool output sits on the theme's --panel2`)
}
await page.evaluate(() => { localStorage.removeItem('spexcode.theme'); document.documentElement.dataset.theme = 'minimal' })
await page.goto(`${BASE}/#/sessions/${live.id}?surface=conversation`)
await settled('.m-composer:visible')

await page.setViewportSize({ width: 760, height: 900 })
await settled('.tl-chat .m-ev .m-ev-note, .tl-chat .m-ev .m-ev-text')
const narrow = await measureComposer()
record('composer.narrow', narrow)
assert.equal(narrow.gutters, 0, 'no ruler under the container threshold')
assert.ok(narrow.inlineTimes > 0, 'rows keep their own time')
assert.ok(narrow.width <= narrow.paneWidth && narrow.centreOffset <= 1)
const paperNarrow = await measurePaper()
record('paper.narrow', paperNarrow)
assert.equal(paperNarrow.sidePadding, 14)
assert.ok(paperNarrow.widestQuote <= Math.round(paperNarrow.column * 0.88) + 1, 'under the threshold the ruler is gone and the quote caps at 88% of the column')
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
