// Native-selection YATU proof for [[selection-controller]] / [[conversation]]. The conversation reader uses
// the browser's Selection and clipboard path; no Custom Highlight or app-owned copy shortcut is an oracle.
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5199'
const sessionId = process.env.SESSION_ID
if (!sessionId) throw new Error('SESSION_ID=<real-headless-session-id> is required')

const NOTE = 'Native selection fixture: choose these words and paste them elsewhere.'
const timeline = { events: [{ ts: '2026-07-24T00:00:00.000Z', kind: 'status', status: 'asking', proposal: null, note: NOTE, display: 'asking' }] }
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
try {
  await page.route('**/api/sessions/*/timeline*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ...timeline, offset: 0, total: 1, stamp: 1 }),
  }))
  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  const note = page.locator('.m-ev-note:visible').first()
  const input = page.locator('.m-input:visible')
  await note.waitFor({ state: 'visible', timeout: 30_000 })
  await input.fill('draft remains separate from reader selection')
  await input.focus()

  await note.dblclick({ position: { x: 42, y: 14 } })
  const selected = await page.evaluate(() => ({
    text: window.getSelection()?.toString() || '',
    custom: !!window.CSS?.highlights?.has('timeline-sel'),
    focused: document.activeElement?.classList.contains('m-input'),
  }))
  assert.ok(selected.text.length > 0, 'native double-click did not create a text selection')
  assert.equal(selected.custom, false, 'the timeline still owns a Custom Highlight')
  assert.equal(selected.focused, false, 'native reading selection owns document focus')

  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(copied, selected.text, 'browser copy did not return the selected words')

  await page.evaluate(() => {
    const textarea = document.createElement('textarea')
    textarea.id = 'native-paste-audit'
    document.body.appendChild(textarea)
    textarea.focus()
  })
  await page.keyboard.press('Control+v')
  const pasted = await page.locator('#native-paste-audit').inputValue()
  assert.equal(pasted, selected.text, 'browser paste did not deliver selected text to an ordinary textarea')
  await page.locator('#native-paste-audit').evaluate((element) => element.remove())

  await page.keyboard.press('Escape')
  const cleared = await page.evaluate(() => ({ native: window.getSelection()?.toString() || '', draft: document.querySelector('.m-input')?.value || '' }))
  assert.equal(cleared.native, '', 'Escape did not clear the explicit native selection')
  assert.equal(cleared.draft, 'draft remains separate from reader selection', 'selection cleanup changed the composer draft')

  const report = { selected: selected.text, copied, pasted, cleared, customHighlight: selected.custom }
  console.log(JSON.stringify(report, null, 2))
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
