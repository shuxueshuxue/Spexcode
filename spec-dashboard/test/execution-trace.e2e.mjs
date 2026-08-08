import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199'
const SESSION_ID = process.env.SESSION_ID
const OUT = process.env.OUT || '/tmp/execution-trace-e2e'
if (!SESSION_ID) throw new Error('SESSION_ID=<real-session-id> is required')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })

try {
  // The backend API test owns the real rollout/SSE proof. This browser fixture represents the already-normalized
  // wire object so the UI assertion cannot accidentally duplicate native transcript parsing.
  await context.addInitScript(() => {
    localStorage.setItem('spexcode.session-surface.v1.root', JSON.stringify({ defaultSurface: 'conversation', sessions: {} }))
    class ExecutionSource {
      constructor(url) {
        this.url = url
        this.listeners = new Map()
        if (url.includes('/execution/stream')) setTimeout(() => this.emit('execution', {
          revision: 'fixture-1',
          workingNote: 'Inspecting the live execution trace',
          steps: [
            { id: 'read', kind: 'read', label: 'read_file', detail: 'path: src/trace.ts · lines: 1-60', state: 'done' },
            { id: 'run', kind: 'command', label: 'exec_command', detail: 'cmd: npm test', state: 'running' },
          ],
        }), 50)
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
  const steps = await modal.evaluate((element) => ({
    note: element.querySelector('.execution-note')?.textContent?.trim(),
    rows: [...element.querySelectorAll('.execution-step')].map((row) => ({
      label: row.querySelector('.execution-step-label')?.textContent?.trim(),
      detail: row.querySelector('.execution-step-detail')?.textContent?.trim(),
      state: row.querySelector('.execution-step-state')?.textContent?.trim(),
      icon: !!row.querySelector('svg'),
    })),
  }))
  assert.equal(steps.note, 'Inspecting the live execution trace')
  assert.deepEqual(steps.rows, [
    { label: 'read_file', detail: 'path: src/trace.ts · lines: 1-60', state: 'done', icon: true },
    { label: 'exec_command', detail: 'cmd: npm test', state: 'running', icon: true },
  ])
  await page.screenshot({ path: `${OUT}/execution-trace.png`, fullPage: true })
} finally {
  await browser.close()
}
