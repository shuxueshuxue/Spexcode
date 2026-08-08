import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

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
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

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
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION_ID)}`, { waitUntil: 'domcontentloaded' })
  const switcher = page.locator('[data-surface-switch="conversation"]:visible')
  if (await switcher.count()) await switcher.click()
  const entry = page.locator('.m-execution-entry:visible')
  await entry.waitFor({ state: 'visible', timeout: 30_000 })
  assert.match(await entry.textContent() || '', /Inspecting the live execution trace/)
  assert.equal(await entry.evaluate((element) => element.parentElement?.lastElementChild === element), true)
  await entry.click()

  const modal = page.locator('.execution-trace-modal:visible')
  await modal.waitFor({ state: 'visible', timeout: 5_000 })
  assert.equal(await modal.locator('.execution-note').textContent(), 'Inspecting the live execution trace')
  const rows = modal.locator('.execution-step')
  const toggles = modal.locator('.execution-step-toggle')
  assert.equal(await rows.count(), 2)
  assert.equal(await toggles.count(), 2)
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'false')
  assert.equal(await toggles.nth(1).getAttribute('aria-expanded'), 'false')
  const collapsedHeight = await rows.nth(0).evaluate((element) => element.getBoundingClientRect().height)
  assert.equal(await modal.locator('.execution-step-detail').count(), 0)

  await toggles.nth(0).click()
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'true')
  assert.equal(await modal.locator('.execution-step-detail').textContent(), 'path: src/trace.ts · lines: 1-60')
  const expandedHeight = await rows.nth(0).evaluate((element) => element.getBoundingClientRect().height)
  assert.ok(expandedHeight > collapsedHeight)

  await toggles.nth(1).click()
  assert.equal(await toggles.nth(0).getAttribute('aria-expanded'), 'true')
  assert.equal(await toggles.nth(1).getAttribute('aria-expanded'), 'true')
  const payload = await modal.textContent() || ''
  assert.match(payload, /path: src\/trace\.ts · lines: 1-60/)
  assert.match(payload, /cmd: npm test/)
  assert.doesNotMatch(payload, new RegExp(SENSITIVE))
  await page.screenshot({ path: `${OUT}/execution-trace.png`, fullPage: true })

  await page.evaluate(() => window.executionSource.emit('execution', {
    revision: 'fixture-2', turnId: 'fixture-turn-2', workingNote: null, steps: [],
  }))
  await entry.waitFor({ state: 'hidden', timeout: 5_000 })
  await modal.waitFor({ state: 'hidden', timeout: 5_000 })
  await page.evaluate(() => window.executionSource.emit('execution', {
    revision: 'fixture-3', turnId: 'fixture-turn-2', workingNote: 'Current turn work', steps: [],
  }))
  await entry.waitFor({ state: 'visible', timeout: 5_000 })
  assert.match(await entry.textContent() || '', /Current turn work/)
} finally {
  await browser.close()
}
