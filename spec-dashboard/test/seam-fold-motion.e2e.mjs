// Measures the SEAM's motion in the real conversation — the fold the reader actually causes. A live seam is
// working and its tail is on screen; the person types a message into the composer and presses Enter, the
// record comes back with that `sent` event, and the stretch above it closes into one `worked …` row. The
// question this run answers is not "does the seam close" (it always did) but "does the page travel to it":
// the outgoing seam's own height is sampled every animation frame across the close, so an instantaneous
// close shows one step and an animated one shows a descent.
//   BASE_URL=http://127.0.0.1:5310 OUT=/some/dir TAG=before node spec-dashboard/test/seam-fold-motion.e2e.mjs
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5310'
const OUT = process.env.OUT || '/tmp/seam-fold-motion'
const TAG = process.env.TAG || 'after'
const REDUCED = process.env.REDUCED === '1'
const SHOT = `${process.env.TAG || 'after'}${process.env.REDUCED === '1' ? '-reduced' : ''}`
const SID = 'seam-fold-motion-fixture'
mkdirSync(OUT, { recursive: true })

const NOW = Date.now(), iso = (o) => new Date(NOW + o).toISOString()
const session = {
  id: SID, label: SID, headline: SID, title: SID, raw: { name: SID, title: null }, branch: `node/${SID}`,
  path: '/tmp/fixture', parent: null, harness: 'claude', capabilities: { headless: true }, launcher: 'reclaude',
  lifecycle: 'active', proposal: null, merges: 0, note: null, status: 'working', liveness: 'online', archived: false,
  closedAt: null, archiveHazard: null, prompt: '给 conversation ui 加个折叠动效', promptPreview: null,
  created: iso(-300_000), activity: null, sortKey: '', files: [], web: [],
}
const board = { sessions: [session], nodes: [], edges: [] }
// the record's last word is `working`, so the conversation ends in ONE open seam — the live tail's own
const workingAt = iso(-240_000), seamFrom = Date.parse(workingAt)
const before = { events: [{ kind: 'status', ts: workingAt, status: 'active', display: 'working', note: null }] }
// what the record says once the person's message has landed: the working stretch is closed by the `sent`
// event, the message is quoted, and the agent — still working — opens a new stretch on the other side of it
const sentAt = iso(-1_000)
const after = { events: [
  ...before.events,
  { kind: 'sent', ts: sentAt, from: null, text: '顺手把 reduced-motion 也照顾一下' },
] }

const call = (id, name, input, lines) => ({ id, name, input: JSON.stringify(input), output: null, outputLines: lines, outputBytes: lines * 40 })
const frame = (turns) => ({
  kind: 'full', revision: `r${turns.length}`, from: seamFrom, to: seamFrom + 200_000,
  truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0, turns,
})
// the tail as the reader sees it while the agent works: the newest prose, then the calls it is making
const tail = [
  { id: 'a1', at: seamFrom + 2_000, role: 'assistant', text: '在读 transcript 的 fold，看它能不能直接给 seam 用。' },
  { id: 'a2', at: seamFrom + 4_000, role: 'assistant', tools: [
    call('t1', 'Read', { file_path: 'packages/transcript-ui/styles.css' }, 126),
    call('t2', 'Read', { file_path: 'spec-dashboard/src/TimelineChat.jsx' }, 753),
    call('t3', 'Grep', { pattern: 'tx-fold' }, 9),
    call('t4', 'Read', { file_path: 'spec-dashboard/src/useFold.js' }, 38),
  ] },
]

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
// the behaviour under measurement is a MOVEMENT, so the run records itself: the whole-session video is the
// evidence a still cannot carry, and the height trace below is its numeric half
const context = await browser.newContext({
  viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2,
  reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  recordVideo: { dir: `${OUT}/video-${TAG}${REDUCED ? '-reduced' : ''}`, size: { width: 1100, height: 900 } },
})
const facts = { tag: TAG, reduced: REDUCED }
let video = null
let sent = false
try {
  await context.addInitScript(() => {
    // the run visits `about:blank` between passes, where storage is denied; the seed is for the app document
    try { localStorage.setItem('spexcode.session-surface.v1.root', JSON.stringify({ defaultSurface: 'conversation', sessions: {} })) } catch { /* not the app origin */ }
    // the transcript stream is SSE; this fixture is the transport, so the test decides when a frame lands
    class FixtureEventSource {
      constructor(url) { this.url = url; this.rows = {}; window.__es = this }
      addEventListener(type, fn) { (this.rows[type] ||= []).push(fn) }
      removeEventListener() {}
      close() { if (window.__es === this) window.__es = null }
    }
    window.EventSource = FixtureEventSource
    window.__push = (data) => { for (const fn of (window.__es?.rows?.transcript || [])) fn({ data: JSON.stringify(data) }) }
    // one height sample per animation frame: what the reader's page actually does across the close
    window.__trace = (selector, ms) => new Promise((done) => {
      const rows = []; const t0 = performance.now()
      const sample = () => {
        const el = document.querySelector(selector)
        rows.push([Math.round(performance.now() - t0), el ? Math.round(el.getBoundingClientRect().height) : -1])
      }
      const tick = () => { sample(); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(rows) }
      sample()          // the height as it stands, before the frame that changes it
      requestAnimationFrame(tick)
    })
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e.message)))
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/**', json({}, 404))
  await page.route('**/api/graph*', json(board))
  await page.route('**/api/settings*', json({ launchers: [], default: null }))
  await page.route(`**/api/sessions/${SID}`, json(session))
  await page.route('**/api/sessions/archive-index', json([]))   // else the shell raises a toast over the evidence
  // the record answers with what it knows NOW: before the send it ends in the open stretch, after it the
  // stretch is closed by the message. The composer's own reload is what fetches the second answer.
  await page.route(`**/api/sessions/${SID}/timeline*`, (route) => json(sent ? after : before)(route))
  await page.route(`**/api/sessions/${SID}/transcript?*`, json(frame(tail)))
  // the composer's real endpoint ([[conversation]] → `sendSessionCommand`): accepting it is what makes the
  // page reload the record, which is the moment under measurement
  await page.route(`**/api/sessions/${SID}/input`, (route) => { sent = true; return json({ ok: true })(route) })

  const seam = page.locator('.m-ev-seam').first()
  // the working stretch as the reader has it: the row counting up, the tail underneath it. `about:blank`
  // first, so the second pass gets a fresh document rather than a same-hash no-op.
  const settle = async () => {
    sent = false
    await page.goto('about:blank')
    await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SID)}?surface=conversation`, { waitUntil: 'domcontentloaded' })
    await seam.locator('.m-seam-row').waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForFunction(() => !!window.__es, null, { timeout: 15_000 })
    await page.evaluate((f) => window.__push(f), frame(tail))
    await seam.locator('.tx-live .tx-tool').first().waitFor({ state: 'visible', timeout: 10_000 })
    await page.waitForTimeout(400)
  }
  // THE MOMENT: the person's own message, typed into the composer and sent the way a person sends it
  const sendIt = async () => {
    await page.locator('.m-input').fill('顺手把 reduced-motion 也照顾一下')
    await page.locator('.m-input').press('Enter')
  }

  // PASS ONE — the stills. A capture stalls the renderer, so it never shares a run with the trace.
  await settle()
  facts.leadBefore = (await seam.locator('.m-seam-lead').textContent()).trim()
  facts.tailsBefore = await seam.locator('.tx-live').count()
  facts.sentencesBefore = await seam.locator('.tx-live .tx-tool-row').count()
  facts.seamHeightBefore = await seam.evaluate((el) => Math.round(el.getBoundingClientRect().height))
  await page.screenshot({ path: `${OUT}/seam-1-working-${SHOT}.png`, animations: 'allow' })
  await sendIt()
  try {
    await page.waitForSelector('.m-ev-seam .tx-fold.is-closing', { timeout: 1_000 })
    facts.midHeight = await seam.evaluate((el) => Math.round(el.getBoundingClientRect().height))
    await page.screenshot({ path: `${OUT}/seam-2-folding-${SHOT}.png`, animations: 'allow' })
  } catch { facts.midHeight = null }   // before the change there is no closing wrapper to catch
  await page.waitForTimeout(600)

  facts.leadAfter = (await seam.locator('.m-seam-lead').textContent()).trim()
  facts.quotes = await page.locator('.tl-chat .m-ev-quote, .tl-chat .tx-quote').count()
  facts.seams = await page.locator('.m-ev-seam').count()
  facts.tailsAfter = await seam.locator('.tx-live').count()
  facts.leftovers = await seam.locator('.tx-fold').count()
  facts.seamHeightAfter = await seam.evaluate((el) => Math.round(el.getBoundingClientRect().height))
  facts.rowHeight = await seam.locator('.m-seam-row').evaluate((el) => Math.round(el.getBoundingClientRect().height))
  await page.screenshot({ path: `${OUT}/seam-3-folded-${SHOT}.png`, animations: 'allow' })

  // PASS TWO — the trace. Same session, same send, nothing capturing: one height sample per animation frame.
  await settle()
  const trace = page.evaluate(() => window.__trace('.m-ev-seam', 900))
  await sendIt()
  facts.trace = await trace
  await page.waitForTimeout(400)
  facts.leftoversLater = await seam.locator('.tx-fold').count()
  facts.pageErrors = pageErrors

  // the descent: how many distinct heights the outgoing seam passed through while its work folded away
  facts.foldSteps = new Set(facts.trace.map((r) => r[1])).size
  const moving = facts.trace.filter((r) => r[1] !== facts.seamHeightBefore && r[1] !== facts.seamHeightAfter)
  facts.foldSpanMs = moving.length ? moving[moving.length - 1][0] - moving[0][0] : 0
  writeFileSync(`${OUT}/facts-${TAG}${REDUCED ? '-reduced' : ''}.json`, JSON.stringify(facts, null, 2))
  console.log(`[${TAG}] before: "${facts.leadBefore}", ${facts.sentencesBefore} sentences in the tail, seam ${facts.seamHeightBefore}px`)
  console.log(`[${TAG}] after: "${facts.leadAfter}", tails ${facts.tailsAfter}, seams ${facts.seams}, seam ${facts.seamHeightAfter}px (row alone ${facts.rowHeight}px)`)
  console.log(`[${TAG}] distinct heights across the close: ${facts.foldSteps}, moving for ~${facts.foldSpanMs}ms, mid-fold height ${facts.midHeight}`)
  console.log(`[${TAG}] wrappers left behind ${facts.leftovers}; page errors ${JSON.stringify(pageErrors)}`)

  // what must hold in every phase, before and after: the send closes the stretch and draws exactly one row
  assert.equal(facts.tailsBefore, 1, 'the working seam wears its live tail')
  assert.equal(facts.sentencesBefore, 4, 'four calls, four sentences')
  assert.match(facts.leadBefore, /^working/, 'the open stretch says it is working')
  assert.equal(facts.seams, 2, 'the message split the stretch: the one it closed, and the one it opened')
  assert.match(facts.leadAfter, /^worked/, 'the closed stretch says how long it worked')
  assert.equal(facts.tailsAfter, 0, 'the closed stretch keeps no live tail')
  assert.equal(facts.leftovers, 0, 'nothing the animation mounted outlives it')
  assert.equal(facts.leftoversLater, 0, 'nor on the traced run')
  assert.ok(facts.seamHeightAfter <= facts.rowHeight + 8, 'the closed stretch settles at its row')
  assert.deepEqual(pageErrors, [], 'no page errors')
  if (TAG === 'after' && !REDUCED) {
    assert.ok(facts.foldSteps >= 5, `the close travels: expected many heights, saw ${facts.foldSteps}`)
    assert.ok(facts.foldSpanMs >= 60 && facts.foldSpanMs <= 400, `one fold duration, not more: saw ${facts.foldSpanMs}ms`)
  }
  if (REDUCED) assert.equal(facts.foldSteps, 2, `reduced motion keeps the close instantaneous, saw ${facts.foldSteps} heights`)
  console.log(`PASS ${TAG}${REDUCED ? ' (reduced motion)' : ''}`)
  video = await page.video()?.path()
} finally {
  await context.close()      // the recording is written out when its context closes, not when the browser does
  await browser.close()
  if (video) console.log(`[${TAG}] video: ${video}`)
}
