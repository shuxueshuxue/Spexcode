// The theorem this run measures: a session the record says is WORKING always ends its Conversation with one
// open, disclosable seam — no matter what event came last. Every scenario is a timeline shape the status
// machine really writes (a human message into an already-active session leaves no status event behind;
// an `active` event may carry a note), and each expected row list is the conversation the reader is owed.
// The same script runs before (PHASE=A) and after (PHASE=B) the fix: scenarios that were already right
// must stay right, and the broken ones must turn right.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5210'
const API = process.env.API_URL || 'http://127.0.0.1:8787'
const PHASE = (process.env.PHASE || 'B').toUpperCase()
const OUT = resolve(process.env.OUT || `/tmp/conversation-working-tail-${PHASE.toLowerCase()}`)
mkdirSync(OUT, { recursive: true })

import { LIFECYCLE, SCENARIOS } from './fixtures/conversation-tail.scenarios.mjs'

// ---- one fixture session on the real board shape -----------------------------------------------------------
const graph = await fetch(`${API}/api/graph`).then((response) => response.json())
const shape = graph.sessions?.[0]
assert.ok(shape, 'the fixture needs one public session shape')
const fixtureSession = (id, kind) => ({
  ...shape, id, label: id, headline: id, title: id, prompt: null, promptPreview: null, note: null, files: [], web: [],
  archived: false, archiveHazard: null, closedAt: null, parent: null,
  capabilities: { headless: true },   // a headless row opens straight onto the Conversation, no terminal face first
  ...(kind === 'offline'
    ? { status: 'working', lifecycle: 'active', proposal: null, liveness: 'offline' }
    : { status: kind, lifecycle: LIFECYCLE[kind], proposal: null, liveness: 'online' }),
})

const readRows = (page) => page.evaluate(() => [...document.querySelectorAll('.m-ev')]
  .filter((row) => !row.matches('.m-ev-prompt, .m-ev-trace'))
  .map((row) => {
    if (row.matches('.m-ev-seam')) {
      const button = row.querySelector('.m-seam-row')
      return { kind: 'seam', live: button.classList.contains('is-live'), lead: button.querySelector('.m-seam-lead').textContent, expanded: button.getAttribute('aria-expanded') }
    }
    if (row.matches('.m-ev-sent')) return { kind: 'sent', text: row.querySelector('.tx-quote-text')?.textContent?.slice(0, 40) }
    if (row.matches('.m-ev-say')) return { kind: 'say', word: row.querySelector('.m-ev-word')?.textContent }
    if (row.matches('.m-ev-line')) return { kind: 'line', word: row.querySelector('.m-ev-word')?.textContent }
    return { kind: row.className }
  }))

// the en locale (Playwright's default navigator.language); the words are the spec's, not the fixture's
const WORDS = { working: 'working', worked: 'worked' }
// what the table's rows look like once rendered: a quote is a sent row, an event is a line, an open seam is
// the ticking live tail on a live session and the bare word on a dead record
function judge(scenario, actual) {
  const live = scenario.session !== 'offline'
  const expected = scenario.expect.map((row) => row.kind === 'quote' ? 'sent' : row.kind === 'event' ? 'line' : row.kind)
  if (expected.length !== actual.length) return `expected ${expected.length} rows, saw ${actual.length}`
  for (const [i, want] of scenario.expect.entries()) {
    const got = actual[i]
    if (expected[i] !== got.kind) return `row ${i}: expected ${expected[i]}, saw ${got.kind}`
    if (want.kind === 'seam') {
      if ((want.open && live) !== got.live) return `row ${i}: seam live=${got.live}, expected ${want.open && live}`
      const lead = want.open && live ? got.lead.startsWith(`${WORDS.working} ·`) : want.open ? got.lead === WORDS.working : got.lead.startsWith(WORDS.worked)
      if (!lead) return `row ${i}: seam reads "${got.lead}"`
    } else if (want.status && want.status !== got.word) return `row ${i}: ${want.kind} reads "${got.word}", expected "${want.status}"`
  }
  return null
}

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const facts = { phase: PHASE, base: BASE, scenarios: [] }
try {
  for (const scenario of SCENARIOS) {
    // a fresh context per scenario: the board is read once per page and SSE is off, so a hash change alone
    // would leave the previous scenario's sessions (and DOM) in place
    const id = `working-tail-${scenario.name}`
    const board = { ...graph, sessions: [fixtureSession(id, scenario.session)] }
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addInitScript(() => {
      window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
    })
    const page = await context.newPage()
    try {
      // Playwright tries routes newest-first, so the catch-all goes in before the specific answers.
      const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
      await page.route(`**/api/sessions/${id}/**`, json({}, 404))
      await page.route(`**/api/sessions/${id}`, json({ id, prompt: null }))
      await page.route(`**/api/sessions/${id}/transcript*`, json({ turns: [] }))
      await page.route(`**/api/sessions/${id}/timeline*`, json({ events: scenario.events }))
      await page.route('**/api/graph*', json(board))

      await page.goto(`${BASE}/#/sessions/${id}`, { waitUntil: 'domcontentloaded' })
      await page.locator('.m-timeline .m-ev:not(.m-ev-trace)').first().waitFor({ state: 'visible', timeout: 20_000 })
      await page.waitForTimeout(300)   // the timeline read and one paint
      const rows = await readRows(page)
      const verdict = judge(scenario, rows)
      // the live tail must be DISCLOSABLE: one click opens its inset
      let disclosure = null
      if (!verdict && scenario.expect.at(-1).open && scenario.session !== 'offline') {
        const tail = page.locator('.m-ev-seam .m-seam-row').last()
        await tail.click()
        await page.locator('.m-ev-seam').last().locator('.m-seam-inset').waitFor({ state: 'visible', timeout: 5000 })
        disclosure = { expanded: await tail.getAttribute('aria-expanded') }
      }
      await page.screenshot({ path: resolve(OUT, `${scenario.name}.png`), fullPage: true })
      facts.scenarios.push({ name: scenario.name, session: scenario.session, wasRight: scenario.wasRight, rows, disclosure, verdict: verdict ?? 'pass' })
      console.log(`${verdict ? 'FAIL' : 'pass'}  ${scenario.name}${verdict ? ` — ${verdict}` : ''}`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
writeFileSync(resolve(OUT, 'facts.json'), JSON.stringify(facts, null, 2))
const failed = facts.scenarios.filter((s) => s.verdict !== 'pass')
console.log(`\nphase ${PHASE}: ${facts.scenarios.length - failed.length}/${facts.scenarios.length} scenarios hold the theorem → ${OUT}`)
if (PHASE === 'B') assert.equal(failed.length, 0, `after the fix every scenario must hold: ${failed.map((s) => s.name).join(', ')}`)
else assert.deepEqual(facts.scenarios.filter((s) => s.wasRight).map((s) => s.verdict), facts.scenarios.filter((s) => s.wasRight).map(() => 'pass'), 'before the fix the already-right scenarios must already pass')
