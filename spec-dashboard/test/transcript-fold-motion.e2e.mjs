// Measures the FOLD's motion in the real conversation. A live seam is expanded and its work is drawn as tool
// sentences; then the next user turn ends that stretch and the work folds behind one row. The question this
// run answers is not "is there a fold row" (there always was) but "does the page travel to it": the seam's
// own height is sampled every animation frame across the fold, so an instantaneous fold shows one step and an
// animated one shows a descent. Before the change the trace has a single step; after it, a ramp.
//   BASE_URL=http://127.0.0.1:5301 OUT=/some/dir TAG=before node spec-dashboard/test/transcript-fold-motion.e2e.mjs
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5301'
const OUT = process.env.OUT || '/tmp/transcript-fold-motion'
const TAG = process.env.TAG || 'after'
const REDUCED = process.env.REDUCED === '1'
const SID = 'transcript-fold-motion-fixture'
mkdirSync(OUT, { recursive: true })

const NOW = Date.now(), iso = (o) => new Date(NOW + o).toISOString()
const session = {
  id: SID, label: SID, headline: SID, title: SID, raw: { name: SID, title: null }, node: null, branch: `node/${SID}`,
  path: '/tmp/fixture', parent: null, harness: 'claude', capabilities: { headless: true }, launcher: 'reclaude',
  lifecycle: 'active', proposal: null, merges: 0, note: null, status: 'working', liveness: 'online', archived: false,
  closedAt: null, archiveHazard: null, prompt: '给 conversation ui 加个折叠动效', promptPreview: null,
  created: iso(-300_000), activity: null, sortKey: '', files: [], web: [],
}
const board = { sessions: [session], nodes: [], edges: [] }
// the record's last word is `working`, so the conversation ends in one OPEN seam — the live tail's own seam
const timeline = { events: [
  { kind: 'status', ts: iso(-240_000), status: 'active', display: 'working', note: null },
] }
const seamFrom = Date.parse(iso(-240_000))
const call = (id, name, input, lines) => ({ id, name, input: JSON.stringify(input), output: null, outputLines: lines, outputBytes: lines * 40 })
const frame = (turns) => ({
  kind: 'full', revision: `r${turns.length}`, from: seamFrom, to: seamFrom + 200_000,
  truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0, turns,
})
const working = [
  { id: 'u1', at: seamFrom + 100, role: 'user', text: '给 conversation ui 加个折叠动效' },
  { id: 'a1', at: seamFrom + 2_000, role: 'assistant', tools: [
    call('t1', 'Read', { file_path: 'packages/transcript-ui/src/TranscriptView.tsx' }, 88),
    call('t2', 'Read', { file_path: 'packages/transcript-ui/styles.css' }, 126),
    call('t3', 'Grep', { pattern: 'tx-work-body' }, 6),
    call('t4', 'Bash', { command: 'npm test --workspace packages/transcript-ui' }, 24),
    call('t5', 'Read', { file_path: 'spec-dashboard/src/TimelineChat.jsx' }, 41),
  ] },
]
// the person's next message ends that stretch: the work before it is now the process behind a boundary, and
// the agent's first turn after it is the new work in progress
const after = [...working,
  { id: 'u2', at: seamFrom + 120_000, role: 'user', text: '顺手把 reduced-motion 也照顾一下' },
  { id: 'a2', at: seamFrom + 121_000, role: 'assistant', tools: [call('t6', 'Read', { file_path: 'packages/transcript-ui/styles.css' }, 126)] },
]

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
// the behaviour under measurement is a MOVEMENT, so the run records itself: the whole-session video is the
// evidence a still cannot carry, and the height trace below is its numeric half
const context = await browser.newContext({
  viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2,
  reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  recordVideo: { dir: `${OUT}/video-${TAG}`, size: { width: 1100, height: 900 } },
})
const facts = { tag: TAG, reduced: REDUCED }
let video = null
try {
  await context.addInitScript(() => {
    localStorage.setItem('spexcode.session-surface.v1.root', JSON.stringify({ defaultSurface: 'conversation', sessions: {} }))
    // the transcript stream is SSE; this fixture is the transport, so the test decides when a frame lands
    class FixtureEventSource {
      constructor(url) { this.url = url; this.rows = {}; window.__es = this }
      addEventListener(type, fn) { (this.rows[type] ||= []).push(fn) }
      removeEventListener() {}
      close() { if (window.__es === this) window.__es = null }
    }
    window.EventSource = FixtureEventSource
    window.__push = (data) => { for (const fn of (window.__es?.rows?.transcript || [])) fn({ data: JSON.stringify(data) }) }
    // one height sample per animation frame: what the reader's page actually does across the fold
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
  await page.route(`**/api/sessions/${SID}/timeline*`, json(timeline))
  await page.route(`**/api/sessions/${SID}/transcript?*`, json(frame(working)))
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SID)}?surface=conversation`, { waitUntil: 'domcontentloaded' })

  const seam = page.locator('.m-ev-seam').last()
  await seam.locator('.m-seam-row').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => !!window.__es, null, { timeout: 15_000 })
  await page.evaluate((f) => window.__push(f), frame(working))
  await seam.locator('.m-seam-row').click()                       // read the stretch in full, as a person does
  await page.locator('.m-seam-inset .tx-tool').first().waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(400)
  facts.sentencesBefore = await page.locator('.m-seam-inset .tx-tool-row').count()
  facts.foldRowsBefore = await page.locator('.m-seam-inset .tx-work-row').count()
  facts.insetHeightBefore = await page.locator('.m-seam-inset').evaluate((el) => Math.round(el.getBoundingClientRect().height))
  await page.screenshot({ path: `${OUT}/fold-1-working-${TAG}.png`, animations: 'allow' })

  // THE MOMENT: the next user turn lands, the stretch above it folds
  const trace = page.evaluate(() => window.__trace('.m-seam-inset', 700))
  await page.evaluate((f) => window.__push(f), frame(after))
  await page.screenshot({ path: `${OUT}/fold-2-folding-${TAG}.png`, animations: 'allow' })
  facts.midShotAt = 'immediately after the frame landed'
  facts.trace = await trace
  await page.waitForTimeout(500)
  facts.sentencesAfter = await page.locator('.m-seam-inset .tx-tool-row:not(.is-run)').count()
  facts.foldRowsAfter = await page.locator('.m-seam-inset .tx-work-row').count()
  facts.foldRowText = (await page.locator('.m-seam-inset .tx-work-row').allTextContents()).join(' | ')
  facts.insetHeightAfter = await page.locator('.m-seam-inset').evaluate((el) => Math.round(el.getBoundingClientRect().height))
  facts.leftovers = await page.locator('.m-seam-inset .tx-fold').count()
  await page.screenshot({ path: `${OUT}/fold-3-folded-${TAG}.png`, animations: 'allow' })

  // the fold's OWN control: a person clicks the row open, then shut
  await page.locator('.m-seam-inset .tx-work-row').first().click()
  await page.waitForTimeout(60)
  await page.screenshot({ path: `${OUT}/fold-4-opening-${TAG}.png`, animations: 'allow' })
  await page.waitForTimeout(400)
  facts.bodyOpenHeight = await page.locator('.m-seam-inset .tx-work-body').evaluate((el) => Math.round(el.getBoundingClientRect().height))
  await page.screenshot({ path: `${OUT}/fold-5-open-${TAG}.png`, animations: 'allow' })
  const closeTrace = page.evaluate(() => window.__trace('.m-seam-inset', 500))
  await page.locator('.m-seam-inset .tx-work-row').first().click()
  facts.closeTrace = await closeTrace
  await page.waitForTimeout(400)
  facts.leftoversAfterClose = await page.locator('.m-seam-inset .tx-fold').count()
  facts.bodiesAfterClose = await page.locator('.m-seam-inset .tx-work-body').count()

  facts.pageErrors = pageErrors
  // the descent: how many distinct heights the seam passed through while the work folded
  const steps = (rows) => new Set(rows.map((r) => r[1])).size
  facts.foldSteps = steps(facts.trace)
  facts.closeSteps = steps(facts.closeTrace)
  writeFileSync(`${OUT}/facts-${TAG}${REDUCED ? '-reduced' : ''}.json`, JSON.stringify(facts, null, 2))
  console.log(`[${TAG}] sentences before fold: ${facts.sentencesBefore}, fold rows: ${facts.foldRowsBefore}`)
  console.log(`[${TAG}] after: sentences ${facts.sentencesAfter}, fold rows ${facts.foldRowsAfter} (${facts.foldRowText})`)
  console.log(`[${TAG}] seam height ${facts.insetHeightBefore} → ${facts.insetHeightAfter}; distinct heights across the fold: ${facts.foldSteps}`)
  console.log(`[${TAG}] close of the opened body: distinct heights ${facts.closeSteps}; wrappers left behind ${facts.leftoversAfterClose}, bodies ${facts.bodiesAfterClose}`)
  console.log(`[${TAG}] page errors: ${JSON.stringify(pageErrors)}`)

  // what must hold in every phase, before and after: the fold draws exactly one row and hides the sentences
  assert.equal(facts.foldRowsBefore, 0, 'the work in progress is not folded')
  assert.equal(facts.sentencesBefore, 5, 'five calls, five sentences')
  assert.equal(facts.foldRowsAfter, 1, 'the folded stretch draws exactly one fold row')
  assert.equal(facts.sentencesAfter, 1, 'only the new work in progress is left as a sentence')
  assert.equal(facts.leftovers, 0, 'nothing the animation mounted outlives it')
  assert.equal(facts.bodiesAfterClose, 0, 'a shut fold leaves no body behind')
  assert.deepEqual(pageErrors, [], 'no page errors')
  if (TAG === 'after' && !REDUCED) {
    assert.ok(facts.foldSteps >= 5, `the fold travels: expected many heights, saw ${facts.foldSteps}`)
    assert.ok(facts.closeSteps >= 5, `the shut travels: expected many heights, saw ${facts.closeSteps}`)
  }
  if (REDUCED) assert.equal(facts.foldSteps, 2, `reduced motion keeps the fold instantaneous, saw ${facts.foldSteps} heights`)
  console.log(`PASS ${TAG}${REDUCED ? ' (reduced motion)' : ''}`)
  video = await page.video()?.path()
} finally {
  await context.close()      // the recording is written out when its context closes, not when the browser does
  await browser.close()
  if (video) console.log(`[${TAG}] video: ${video}`)
}
