// Native-selection YATU matrix for [[selection-controller]] / [[conversation]]. The old test simulated xterm
// word/line selection inside a conversation and asserted a CSS Custom Highlight; that was the architecture bug.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5198'
const SESSION = process.env.SESSION_ID
const OUT = resolve(process.env.OUT || '/tmp/timeline-native-selection')
if (!SESSION) throw new Error('SESSION_ID=<real-headless-session-id> is required')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage()
try {
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  const note = page.locator('.m-ev-note:visible').last()
  const input = page.locator('.m-input:visible')
  await note.waitFor({ state: 'visible', timeout: 30_000 })
  await input.fill('native selection leaves the draft alone')
  await input.focus()
  const box = await note.boundingBox()
  assert.ok(box, 'conversation note has a visible selection target')

  await page.mouse.move(box.x + 8, box.y + Math.min(12, box.height / 3))
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(box.width - 8, 260), box.y + Math.min(box.height - 5, 30), { steps: 8 })
  await page.mouse.up()
  const selected = await page.evaluate(() => ({
    text: window.getSelection()?.toString() || '',
    native: window.getSelection()?.rangeCount || 0,
    custom: !!window.CSS?.highlights?.has('timeline-sel'),
    focused: document.activeElement?.classList.contains('m-input'),
  }))
  assert.ok(selected.text.length > 0, 'drag did not create a native conversation selection')
  assert.equal(selected.native > 0, true, 'selection did not remain a DOM Range')
  assert.equal(selected.custom, false, 'conversation still owns a Custom Highlight')
  assert.equal(selected.focused, true, 'reading text stole composer focus')

  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(copied, selected.text, 'native Ctrl+C did not copy the selected conversation text')

  await page.keyboard.press('Escape')
  const afterEscape = await page.evaluate(() => ({
    text: window.getSelection()?.toString() || '',
    draft: document.querySelector('.m-input:visible')?.value || '',
    custom: !!window.CSS?.highlights?.has('timeline-sel'),
  }))
  assert.equal(afterEscape.text, '', 'Escape did not clear the explicit native selection')
  assert.equal(afterEscape.custom, false, 'Escape left a custom selection artifact')
  assert.equal(afterEscape.draft, 'native selection leaves the draft alone', 'selection cleanup changed the draft')

  const report = { session: SESSION, selected, copied, afterEscape }
  writeFileSync(resolve(OUT, 'report.json'), JSON.stringify(report, null, 2))
  await page.screenshot({ path: resolve(OUT, 'native-selection.png'), fullPage: true })
  console.log(JSON.stringify(report, null, 2))
} finally {
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
}
