import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// [[message-stream]] `latest-working-note-opens-execution-trace`: the current turn is the LIVE TAIL of the
// conversation — the working note as agent prose, each tool step as a transcript-style sentence with its
// own inline disclosure — and never a card, a door, or a pop-out.
//
//   BASE_URL=http://127.0.0.1:5198 SESSION_ID=<real-session-id> node spec-dashboard/test/execution-trace.e2e.mjs
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199'
const SESSION_ID = process.env.SESSION_ID
const OUT = process.env.OUT || '/tmp/execution-trace-e2e'
const SENSITIVE = 'PRIVATE_INPUT_SHOULD_NOT_RENDER'
if (!SESSION_ID) throw new Error('SESSION_ID=<real-session-id> is required')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })

try {
  // The backend API test owns the real transcript/SSE proof. This fixture is the normalized wire object, so UI
  // coverage cannot accidentally duplicate native parsing or pass raw source fields into the browser.
  await context.addInitScript(() => {
    localStorage.setItem('spexcode.session-surface.v1.root', JSON.stringify({ defaultSurface: 'conversation', sessions: {} }))
    class ExecutionSource {
      constructor(url) {
        this.url = url
        this.listeners = new Map()
        if (url.includes('/execution/stream')) {
          window.executionSource = this
          setTimeout(() => this.emit('execution', {
            revision: 'fixture-1',
            turnId: 'fixture-turn-1',
            workingNote: 'Inspecting the live execution trace',
            steps: [
              { id: 'read', kind: 'read', label: 'read_file', detail: 'path: src/trace.ts · lines: 1-60', state: 'done' },
              { id: 'run', kind: 'command', label: 'exec_command', detail: 'cmd: npm test', state: 'running' },
            ],
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
      close() {}
    }
    window.EventSource = ExecutionSource
  })

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION_ID)}?surface=conversation`, { waitUntil: 'domcontentloaded' })
  const tail = page.locator('.m-execution:visible')
  await tail.waitFor({ state: 'visible', timeout: 30_000 })

  // the newest thing on the page, in the conversation's own grammar — no card, no door
  assert.equal(await tail.locator('.m-execution-note').textContent(), 'Inspecting the live execution trace')
  assert.equal(await page.locator('.m-execution-entry, .execution-trace-modal, [role="dialog"]').count(), 0, 'no entry button and no pop-out')
  assert.equal(await tail.evaluate((element) => {
    const row = element.closest('.m-ev'); return row.parentElement.lastElementChild === row
  }), true, 'the live tail is the last row of the column')
  const noteStyle = await tail.locator('.m-execution-note').evaluate((element) => {
    const style = getComputedStyle(element); return { fontSize: style.fontSize, border: style.borderStyle, background: style.backgroundColor }
  })
  assert.equal(noteStyle.fontSize, '14px', 'the note is prose')
  assert.equal(noteStyle.border, 'none')
  assert.equal(noteStyle.background, 'rgba(0, 0, 0, 0)', 'the note sits on the page, not in a well')

  const rows = tail.locator('.m-execution-step')
  const toggles = tail.locator('.tc-tool-row.is-openable')
  assert.equal(await rows.count(), 2)
  assert.equal(await toggles.count(), 2)
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'false')
  assert.equal(await toggles.nth(1).getAttribute('aria-expanded'), 'false')
  assert.equal(await rows.nth(1).locator('.m-execution-running').count(), 1, 'the running step says so')
  assert.equal(await rows.nth(0).locator('.m-execution-running').count(), 0, 'a done step carries no badge')
  const rowWidth = await toggles.nth(0).evaluate((element) => element.getBoundingClientRect().width)
  const tailWidth = await tail.evaluate((element) => element.getBoundingClientRect().width)
  assert.ok(rowWidth < tailWidth, 'a step is a sentence, not a bar')
  const collapsedHeight = await rows.nth(0).evaluate((element) => element.getBoundingClientRect().height)
  assert.equal(await tail.locator('.m-execution-detail').count(), 0)

  await toggles.nth(0).click()
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'true')
  assert.equal(await tail.locator('.m-execution-detail').textContent(), 'path: src/trace.ts · lines: 1-60')
  const expandedHeight = await rows.nth(0).evaluate((element) => element.getBoundingClientRect().height)
  assert.ok(expandedHeight > collapsedHeight)
  assert.equal(await toggles.nth(1).getAttribute('aria-expanded'), 'false', 'a sibling did not open')

  // a same-turn revision keeps what the reader opened
  await page.evaluate(() => window.executionSource.emit('execution', {
    revision: 'fixture-1b', turnId: 'fixture-turn-1', workingNote: 'Inspecting the live execution trace',
    steps: [
      { id: 'read', kind: 'read', label: 'read_file', detail: 'path: src/trace.ts · lines: 1-60', state: 'done' },
      { id: 'run', kind: 'command', label: 'exec_command', detail: 'cmd: npm test', state: 'done' },
    ],
  }))
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'true')
  assert.equal(await tail.locator('.m-execution-detail').textContent(), 'path: src/trace.ts · lines: 1-60')
  assert.equal(await rows.nth(1).locator('.m-execution-running').count(), 0, 'the finished step lost its running mark')

  // ...even when the revision replaces the note itself: the turn is the same, so the reader's disclosure stays
  await page.evaluate(() => window.executionSource.emit('execution', {
    revision: 'fixture-1c', turnId: 'fixture-turn-1', workingNote: 'Inspecting the live execution trace, then testing',
    steps: [
      { id: 'read', kind: 'read', label: 'read_file', detail: 'path: src/trace.ts · lines: 1-60', state: 'done' },
      { id: 'run', kind: 'command', label: 'exec_command', detail: 'cmd: npm test', state: 'done' },
    ],
  }))
  await page.waitForTimeout(100)
  assert.equal(await tail.locator('.m-execution-note').textContent(), 'Inspecting the live execution trace, then testing')
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'true', 'a same-turn note change keeps the open row')
  assert.equal(await tail.locator('.m-execution-detail').textContent(), 'path: src/trace.ts · lines: 1-60')

  await toggles.nth(1).click()
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'true')
  assert.equal(await toggles.nth(1).getAttribute('aria-expanded'), 'true')
  const payload = await tail.textContent() || ''
  assert.match(payload, /path: src\/trace\.ts · lines: 1-60/)
  assert.match(payload, /cmd: npm test/)
  assert.doesNotMatch(payload, new RegExp(SENSITIVE))
  await page.screenshot({ path: `${OUT}/execution-trace.png` })

  // the turn settles: the tail leaves
  await page.evaluate(() => window.executionSource.emit('execution', {
    revision: 'fixture-2', turnId: 'fixture-turn-2', workingNote: null, steps: [],
  }))
  await tail.waitFor({ state: 'hidden', timeout: 5_000 })
  // a new turn starts closed
  await page.evaluate(() => window.executionSource.emit('execution', {
    revision: 'fixture-3', turnId: 'fixture-turn-2', workingNote: 'Current turn work',
    steps: [{ id: 'new-turn-step', kind: 'read', label: 'read_file', detail: 'path: src/current.ts', state: 'running' }],
  }))
  await tail.waitFor({ state: 'visible', timeout: 5_000 })
  assert.equal(await tail.locator('.m-execution-note').textContent(), 'Current turn work')
  assert.equal(await tail.locator('.tc-tool-row.is-openable').getAttribute('aria-expanded'), 'false')

  // THE TAIL SAYS NOTHING THE RECORD ALREADY SAID: a note equal to the newest message on the record, with
  // nothing still running, draws nothing at all.
  await page.waitForSelector('.tl-chat .m-ev-say .m-ev-note', { timeout: 20_000 }).catch(() => null)
  const lastSaid = await page.evaluate(() => {
    const notes = document.querySelectorAll('.tl-chat .m-ev-say .m-ev-note'); return notes.length ? notes[notes.length - 1].textContent : null
  })
  if (lastSaid) {
    await page.evaluate((note) => window.executionSource.emit('execution', {
      revision: 'fixture-4', turnId: 'fixture-turn-3', workingNote: note.replace(/\s+/g, ' ').trim().slice(0, 239),
      steps: [{ id: 'said-step', kind: 'command', label: 'exec', state: 'done' }],
    }), lastSaid)
    await tail.waitFor({ state: 'hidden', timeout: 5_000 })
    console.log('dedupe: a note already on the record drew nothing')
  } else console.log('dedupe: this session has no agent message on the record; the elision rule was not exercised here')

  assert.deepEqual(pageErrors, [])
  console.log('PASS', OUT)
} finally {
  await browser.close()
}
