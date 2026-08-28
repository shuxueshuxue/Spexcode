import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// [[message-stream]] `the-open-seam-is-the-live-tail`: the current turn is the collapsed face of the open
// seam — the agent's newest prose as the page, each call as a transcript-style sentence, a running call
// wearing its spinner — fed by the seam's transcript STREAM, and the same payload the expanded seam shows
// in full. Never a card, a door, a pop-out, or a second row after the seam.
//
// The board and timeline are fixtures in the shapes the backend really writes (a working headless session whose
// record's last word is `working`, with an earlier answer on the record), so the run is deterministic and needs
// only the dashboard; the stream frames are the normalized wire payload of [[session-transcript]].
//
//   BASE_URL=http://127.0.0.1:5198 node spec-dashboard/test/live-tail.e2e.mjs
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199'
const OUT = process.env.OUT || '/tmp/live-tail-e2e'
const SESSION_ID = 'live-tail-fixture'
mkdirSync(OUT, { recursive: true })

const NOW = Date.now()
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString()
const board = { sessions: [{
  id: SESSION_ID, label: SESSION_ID, headline: SESSION_ID, title: SESSION_ID, raw: { name: SESSION_ID, title: null }, node: null, branch: `node/${SESSION_ID}`,
  path: '/tmp/fixture', parent: null, harness: 'claude-headless', capabilities: { headless: true }, launcher: 'claude-headless',
  lifecycle: 'active', proposal: null, merges: 0, note: null, status: 'working', liveness: 'online', archived: false, closedAt: null,
  archiveHazard: null, prompt: null, promptPreview: null, created: iso(-300_000), activity: null, sortKey: '', files: [], web: [],
}], nodes: [], edges: [] }
// what the status machine really writes: an earlier answer, the human's next message, and the agent back at work
const timeline = { events: [
  { kind: 'status', ts: iso(-120_000), status: 'asking', display: 'asking', note: 'Earlier answer already on the record' },
  { kind: 'sent', ts: iso(-90_000), from: null, mid: 'm1', text: 'begin the next turn' },
  { kind: 'status', ts: iso(-60_000), status: 'active', display: 'working', note: null },
] }

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })

try {
  // The backend API test owns the real native-thread proof. This fixture is the normalized wire payload
  // ([[session-transcript]]), so UI coverage never duplicates native parsing or hands raw source fields to the
  // browser: the browser sees turns, and only turns.
  await context.addInitScript(() => {
    localStorage.setItem('spexcode.session-surface.v1.root', JSON.stringify({ defaultSurface: 'conversation', sessions: {} }))
    class TranscriptSource {
      constructor(url) {
        this.url = url
        this.listeners = new Map()
        if (url.includes('/transcript/stream')) {
          window.transcriptSource = this
          window.transcriptFrom = Number(new URL(url, location.href).searchParams.get('from'))
          // the wire of [[session-transcript]]: the first frame is the whole interval; a recorded result is
          // `output: null` (its body is fetched when opened), a running call has no output field
          setTimeout(() => this.emit('transcript', {
            kind: 'full', revision: 'fixture-1', from: window.transcriptFrom, to: window.transcriptFrom + 5000,
            turns: [
              { id: 'u1', at: window.transcriptFrom + 100, role: 'user', text: 'begin the next turn' },
              { id: 'a1', at: window.transcriptFrom + 200, role: 'assistant', text: 'Inspecting the live tail', tools: [
                { id: 'read', name: 'Read', input: '{"file_path":"/repo/src/trace.ts"}', output: null, outputLines: 1, outputBytes: 18 },
                { id: 'run', name: 'Bash', input: '{"command":"npm test"}', outputLines: 0, outputBytes: 0 },
              ] },
            ],
            truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0,
          }), 50)
        }
      }
      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || []
        listeners.push(listener)
        this.listeners.set(type, listeners)
      }
      removeEventListener(type, listener) {
        this.listeners.set(type, (this.listeners.get(type) || []).filter((item) => item !== listener))
      }
      emit(type, data) {
        for (const listener of this.listeners.get(type) || []) listener(new MessageEvent(type, { data: JSON.stringify(data) }))
      }
      close() { window.transcriptClosed = (window.transcriptClosed || 0) + 1 }
    }
    window.EventSource = TranscriptSource
  })

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const requests = []
  page.on('request', (request) => { if (request.url().includes('/transcript')) requests.push(request.url()) })
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/**', json({}, 404))
  await page.route('**/api/graph*', json(board))
  await page.route('**/api/settings*', json({ launchers: [], default: null }))
  await page.route(`**/api/sessions/${SESSION_ID}`, json({ ...board.sessions[0], prompt: 'the originating prompt' }))
  await page.route(`**/api/sessions/${SESSION_ID}/timeline*`, json(timeline))
  // a withheld body, fetched for exactly one call when a person opens it
  await page.route(`**/api/sessions/${SESSION_ID}/transcript/tool/read?*`, json({ id: 'read', output: 'export const x = 1', outputLines: 1, outputBytes: 18 }))
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION_ID)}?surface=conversation`, { waitUntil: 'domcontentloaded' })
  const seam = page.locator('.m-ev-seam').last()
  const tail = seam.locator('.m-live')
  await tail.waitFor({ state: 'visible', timeout: 30_000 })

  // the tail lives INSIDE the open seam's row — no row after it, no trace row, no card, no door
  assert.equal(await seam.locator('.m-seam-row.is-live').count(), 1, 'the seam above the tail is the live one')
  assert.equal(await page.locator('.m-ev-trace, .m-execution, .execution-trace-modal, [role="dialog"]').count(), 0, 'no separate trace row and no pop-out')
  assert.equal(await seam.evaluate((element) => element.parentElement.lastElementChild === element), true, 'the seam is the last row of the column')
  assert.equal(await seam.locator('.m-seam-row').getAttribute('aria-expanded'), 'false', 'the seam is collapsed while the tail shows')
  assert.equal(await seam.locator('.m-seam-detail').textContent(), '2 turns · 2 tool uses', 'the seam counts from the streamed payload')

  // the newest prose is the page: prose size, no border, no well
  const note = tail.locator('.tc-say-text')
  assert.equal(await note.textContent(), 'Inspecting the live tail')
  const noteStyle = await note.evaluate((element) => {
    const style = getComputedStyle(element); return { fontSize: style.fontSize, border: style.borderStyle, background: style.backgroundColor }
  })
  assert.equal(noteStyle.border, 'none')
  assert.equal(noteStyle.background, 'rgba(0, 0, 0, 0)', 'the note sits on the page, not in a well')
  assert.equal(await tail.locator('.tc-ask').count(), 0, 'the human message that opened the turn is on the record above, not repeated in the tail')

  // each call is a transcript sentence; the one without a result is running
  const rows = tail.locator('.tc-tool')
  assert.equal(await rows.count(), 2)
  assert.equal(await rows.nth(0).locator('.tc-tool-running').count(), 0, 'a call with its result carries no running mark')
  assert.equal(await rows.nth(1).locator('.tc-tool-running').count(), 1, 'the call without a result says running')
  const rowWidth = await rows.nth(0).locator('.tc-tool-row').evaluate((element) => element.getBoundingClientRect().width)
  const tailWidth = await tail.evaluate((element) => element.getBoundingClientRect().width)
  assert.ok(rowWidth < tailWidth, 'a call is a sentence, not a bar')
  // output stays folded until asked; the completed call opens inline and independently — its body arrives by
  // one fetch for that call, because the live frame carried only its size
  assert.equal(await tail.locator('.tc-tool-out').count(), 0)
  await rows.nth(0).locator('.tc-tool-row').click()
  assert.equal(await rows.nth(0).locator('.tc-tool-row').getAttribute('aria-expanded'), 'true')
  await tail.locator('pre.tc-tool-out').waitFor({ state: 'visible', timeout: 5_000 })
  assert.equal(await tail.locator('pre.tc-tool-out').textContent(), 'export const x = 1')
  assert.equal(requests.filter((url) => url.includes('/transcript/tool/')).length, 1, 'one body fetch, for the one call opened')

  // a refresh of the same interval keeps what the reader opened, and the running call settles: a DELTA
  // carrying only the turn that changed
  await page.evaluate(() => window.transcriptSource.emit('transcript', {
    kind: 'delta', revision: 'fixture-2', from: window.transcriptFrom, to: window.transcriptFrom + 9000,
    turns: [
      { id: 'a1', at: window.transcriptFrom + 200, role: 'assistant', text: 'Inspecting the live tail', tools: [
        { id: 'read', name: 'Read', input: '{"file_path":"/repo/src/trace.ts"}', output: null, outputLines: 1, outputBytes: 18 },
        { id: 'run', name: 'Bash', input: '{"command":"npm test"}', output: null, outputLines: 1, outputBytes: 2 },
      ] },
    ],
    removed: [],
    truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0,
  }))
  await page.waitForTimeout(100)
  assert.equal(await rows.nth(0).locator('.tc-tool-row').getAttribute('aria-expanded'), 'true', 'a same-interval refresh keeps the open row')
  assert.equal(await tail.locator('pre.tc-tool-out').textContent(), 'export const x = 1', 'and the body it fetched')
  assert.equal(requests.filter((url) => url.includes('/transcript/tool/')).length, 1, 'a refresh does not refetch an opened body')
  assert.equal(await rows.nth(1).locator('.tc-tool-running').count(), 0, 'the finished call lost its running mark')
  assert.equal(await tail.locator('.tc-ask').count(), 0, 'the delta left the human message where the record has it')

  // a later note replaces the compact view: the newest prose and the calls after it — three new turns in one
  // delta; the unchanged first turn does not travel again
  await page.evaluate(() => window.transcriptSource.emit('transcript', {
    kind: 'delta', revision: 'fixture-3', from: window.transcriptFrom, to: window.transcriptFrom + 12000,
    turns: [
      // prose in a turn of its own, then calls AFTER it in tool-only turns — the live tail's usual shape
      { id: 'a2', at: window.transcriptFrom + 9000, role: 'assistant', text: 'Now testing' },
      { id: 'a3', at: window.transcriptFrom + 9200, role: 'assistant', tools: [
        { id: 'run2', name: 'Bash', input: '{"command":"npm run e2e"}', output: null, outputLines: 1, outputBytes: 2 },
      ] },
      { id: 'a4', at: window.transcriptFrom + 9500, role: 'assistant', tools: [
        { id: 'run3', name: 'Bash', input: '{"command":"npm run lint"}', outputLines: 0, outputBytes: 0 },
      ] },
    ],
    removed: [],
    truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0,
  }))
  await page.waitForTimeout(100)
  assert.equal(await tail.locator('.tc-say-text').last().textContent(), 'Now testing')
  // THE CARET MARKS WORDS STILL BEING SAID: a call follows this prose, so the words are finished and no caret
  // blinks under them — the running call is the live mark
  const caret = () => page.evaluate(() => {
    const live = document.querySelector('.m-live')
    const text = [...live.querySelectorAll('.tc-say-text')].pop()   // the newest prose
    const block = text?.querySelector('.rich-text > :last-child')
    const content = (element) => (element ? getComputedStyle(element, '::after').content : null)
    return { speaking: live.classList.contains('is-speaking'), onContainer: content(text), onBlock: content(block), blockHeight: block?.getBoundingClientRect().height, lineHeight: block ? parseFloat(getComputedStyle(block).lineHeight) : null }
  })
  await page.screenshot({ path: `${OUT}/live-tail.png` })
  assert.deepEqual(await caret().then((c) => [c.speaking, c.onContainer, c.onBlock]), [false, 'none', 'none'], 'no caret under prose that a call already follows')
  assert.equal(await tail.locator('.tc-tool').count(), 2, 'the earlier prose and its calls folded away; the calls after the newest prose stay, including a tool-only turn')
  assert.equal(await tail.locator('.tc-tool-running').count(), 1, 'the newest call is the running one')
  assert.equal(await seam.locator('.m-seam-detail').textContent(), '5 turns · 4 tool uses')

  // EXPANDING THE SEAM SHOWS THE WHOLE INTERVAL FROM THE SAME PAYLOAD — and the compact tail steps aside,
  // so nothing is drawn twice
  await seam.locator('.m-seam-row').click()
  await seam.locator('.m-seam-inset').waitFor({ state: 'visible', timeout: 5_000 })
  assert.equal(await tail.count(), 0, 'the collapsed face leaves when the seam opens')
  // the full view is the conversation's own fold: the process behind the newest answer collapses to one row
  assert.match(await seam.locator('.m-seam-inset .tc-work-row').textContent(), /^2 tool uses/, 'the process before the answer folds; the fold counts only what it hides')
  assert.equal(await seam.locator('.m-seam-inset .tc-say-text').count(), 1, 'the answer stays')
  assert.equal(await seam.locator('.m-seam-inset .tc-tool:visible').count(), 2, 'the calls after the answer stay in the open')
  await seam.locator('.m-seam-inset .tc-work-row').click()
  assert.equal(await seam.locator('.m-seam-inset .tc-say-text').count(), 2, 'opening the fold shows every prose turn')
  assert.equal(await seam.locator('.m-seam-inset .tc-ask').count(), 0, 'the message that opened the seam is quoted on the record one row above, not again inside the interval')
  assert.equal(await seam.locator('.m-seam-inset .tc-tool-running').count(), 1, 'the running call is still running in the full view')
  assert.equal(await page.locator('.m-transcript-state').count(), 0, 'no loading line: the payload was already here')
  assert.equal(requests.filter((url) => !url.includes('/transcript/stream') && !url.includes('/transcript/tool/')).length, 0, 'the open seam issues no interval GET of its own')
  await page.screenshot({ path: `${OUT}/live-tail-expanded.png` })
  await seam.locator('.m-seam-row').click()
  await tail.waitFor({ state: 'visible', timeout: 5_000 })

  // a turn that opens with tools and no prose is not blank: the calls are the news
  await page.evaluate(() => window.transcriptSource.emit('transcript', {
    kind: 'full', revision: 'fixture-4', from: window.transcriptFrom, to: window.transcriptFrom + 15000,
    turns: [
      { id: 'u1', at: window.transcriptFrom + 100, role: 'user', text: 'begin the next turn' },
      { id: 'a3', at: window.transcriptFrom + 14000, role: 'assistant', tools: [
        { id: 'grep', name: 'Grep', input: '{"pattern":"seam"}', outputLines: 0, outputBytes: 0 },
      ] },
    ],
    truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0,
  }))
  await page.waitForTimeout(100)
  assert.equal(await tail.locator('.tc-say-text').count(), 0)
  assert.equal(await tail.locator('.tc-tool-running').count(), 1, 'tools before any prose still show')

  // WORK IN PROGRESS NEVER FOLDS. In history a run of three or more calls folds to `N tool uses` — but the
  // calls after the newest prose of a LIVE payload are what is happening, and a fold that says seven and
  // shows none, under a seam line that already says seven, is the duplication a reader hits first. Every
  // call in progress is a sentence in BOTH faces, and the run folds the moment the agent speaks.
  const inProgress = [
    { id: 'u1', at: 100, role: 'user', text: 'begin the next turn' },
    // a human turn the record does not carry — typed into the harness itself — is still quoted in the interval
    { id: 'u2', at: 13900, role: 'user', text: 'typed into the harness itself' },
    { id: 'b1', at: 14000, role: 'assistant', tools: [{ id: 'w1', name: 'Grep', input: '{"pattern":"seam"}', output: null, outputLines: 1, outputBytes: 1 }] },
    { id: 'b2', at: 14100, role: 'assistant', tools: [{ id: 'w2', name: 'Read', input: '{"file_path":"/repo/src/a.ts"}', output: null, outputLines: 1, outputBytes: 1 }] },
    { id: 'b3', at: 14200, role: 'assistant', tools: [{ id: 'w3', name: 'Bash', input: '{"command":"npm test"}', output: null, outputLines: 1, outputBytes: 2 }] },
    { id: 'b4', at: 14300, role: 'assistant', tools: [{ id: 'w4', name: 'Bash', input: '{"command":"npm run lint"}', output: null, outputLines: 1, outputBytes: 2 }] },
    // one turn that fired three calls at once — the per-turn run fold's own trigger
    { id: 'b5', at: 14400, role: 'assistant', tools: [
      { id: 'w5', name: 'Read', input: '{"file_path":"/repo/src/b.ts"}', output: null, outputLines: 1, outputBytes: 1 },
      { id: 'w6', name: 'Read', input: '{"file_path":"/repo/src/c.ts"}', output: null, outputLines: 1, outputBytes: 1 },
      { id: 'w7', name: 'Read', input: '{"file_path":"/repo/src/d.ts"}', outputLines: 0, outputBytes: 0 },
    ] },
  ]
  const emitTurns = (revision, turns, kind = 'full') => page.evaluate(({ revision, turns, kind }) => window.transcriptSource.emit('transcript', {
    kind, revision, from: window.transcriptFrom, to: window.transcriptFrom + 15500,
    turns: turns.map((turn) => ({ ...turn, at: window.transcriptFrom + turn.at })),
    ...(kind === 'delta' ? { removed: [] } : {}),
    truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0,
  }), { revision, turns, kind })
  await emitTurns('fixture-4b', inProgress)
  await page.waitForTimeout(100)
  await page.screenshot({ path: `${OUT}/live-tail-in-progress.png` })
  assert.equal(await seam.locator('.m-seam-detail').textContent(), '7 turns · 7 tool uses')
  assert.equal(await tail.locator('.tc-work-row, .tc-tool-row.is-run').count(), 0, 'the work in progress is not folded behind a count')
  assert.equal(await tail.locator('.tc-tool').count(), 7, 'every call in progress is a sentence')
  assert.equal(await tail.locator('.tc-tool-running').count(), 1)
  await seam.locator('.m-seam-row').click()
  await seam.locator('.m-seam-inset').waitFor({ state: 'visible', timeout: 5_000 })
  await page.screenshot({ path: `${OUT}/live-tail-in-progress-expanded.png` })
  assert.equal(await seam.locator('.m-seam-inset .tc-work-row, .m-seam-inset .tc-tool-row.is-run').count(), 0, 'the expanded live seam does not fold the work in progress either')
  assert.equal(await seam.locator('.m-seam-inset .tc-tool:visible').count(), 7)
  assert.deepEqual(await seam.locator('.m-seam-inset .tc-ask .m-ev-text').allTextContents(), ['typed into the harness itself'], 'only the human turn the record does not carry is quoted inside the interval')
  // seven calls across five turns sit at one list spacing: no turn gap between consecutive tool-only turns
  const rowTops = await seam.locator('.m-seam-inset .tc-tool-row').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().top))
  const steps = rowTops.slice(1).map((top, index) => Math.round(top - rowTops[index]))
  assert.ok(Math.max(...steps) - Math.min(...steps) <= 2, `consecutive calls are evenly spaced, got steps ${steps.join(',')}`)
  await seam.locator('.m-seam-row').click()
  await tail.waitFor({ state: 'visible', timeout: 5_000 })
  // ...and the moment the agent answers, that work is process behind an answer: gone from the tail, folded in history
  await emitTurns('fixture-4c', [{ id: 'b6', at: 15000, role: 'assistant', text: 'Found the seam' }], 'delta')
  await page.waitForTimeout(100)
  assert.equal(await tail.locator('.tc-say-text').textContent(), 'Found the seam')
  assert.equal(await tail.locator('.tc-tool').count(), 0, 'the calls that produced the answer left the tail')
  // ...and now the prose IS the newest thing: the caret blinks inline at the end of its last line — on the last
  // block, adding no line of its own, never on the container under the paragraph
  {
    const c = await caret()
    assert.equal(c.speaking, true, 'the tail is speaking when prose is its newest event')
    assert.equal(c.onBlock, '"▍"', 'the caret sits on the last block of the prose')
    assert.equal(c.onContainer, 'none', 'no caret on the block container')
    assert.ok(Math.abs(c.blockHeight - c.lineHeight) <= 2, `the caret is inline — the paragraph stays one line (${c.blockHeight}px vs ${c.lineHeight}px)`)
    await page.screenshot({ path: `${OUT}/live-tail-caret-inline.png` })
  }
  await seam.locator('.m-seam-row').click()
  await seam.locator('.m-seam-inset').waitFor({ state: 'visible', timeout: 5_000 })
  assert.match(await seam.locator('.m-seam-inset .tc-work-row').textContent(), /^7 tool uses/, 'in history the same seven calls fold behind the answer')
  await page.screenshot({ path: `${OUT}/live-tail-folded-after-answer.png` })
  await seam.locator('.m-seam-row').click()
  await tail.waitFor({ state: 'visible', timeout: 5_000 })

  // THE TAIL SAYS NOTHING THE RECORD ALREADY SAID: prose equal to the newest message on the record, with
  // nothing still running, draws nothing at all.
  const lastSaid = await page.evaluate(() => {
    const notes = document.querySelectorAll('.tl-chat .m-ev-say .m-ev-note'); return notes.length ? notes[notes.length - 1].textContent : null
  })
  assert.equal(lastSaid, 'Earlier answer already on the record')
  {
    await page.evaluate((note) => window.transcriptSource.emit('transcript', {
      kind: 'full', revision: 'fixture-5', from: window.transcriptFrom, to: window.transcriptFrom + 16000,
      turns: [{ id: 'a4', at: window.transcriptFrom + 15500, role: 'assistant', text: note.replace(/\s+/g, ' ').trim().slice(0, 239), tools: [
        { id: 'done', name: 'Bash', input: '{"command":"true"}', output: null, outputLines: 0, outputBytes: 0 },
      ] }],
      truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0,
    }), lastSaid)
    await tail.waitFor({ state: 'hidden', timeout: 5_000 })
    console.log('dedupe: prose already on the record drew nothing')
  }

  assert.deepEqual(pageErrors, [])
  console.log('PASS', OUT)
} finally {
  await browser.close()
}
