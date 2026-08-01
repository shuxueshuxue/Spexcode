import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5179'
const OUT = resolve(process.env.OUT || '/tmp/attachment-complete-e2e')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const file = { name: 'attachment-complete-proof.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment completion proof') }

try {
  await page.goto(`${BASE}/#/sessions/new`, { waitUntil: 'domcontentloaded' })
  const input = page.locator('.si-input')
  await input.waitFor({ state: 'visible', timeout: 30_000 })
  await input.fill('keep this draft')
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.si-attach').click(),
  ])
  await chooser.setFiles(file)
  const complete = page.locator('.si-attach-row.complete')
  await complete.waitFor({ state: 'visible', timeout: 30_000 })
  assert.match(await complete.locator('.si-attach-status').textContent() || '', /attached|已附加/)
  assert.match(await input.inputValue(), /spexcode-uploads/)
  await page.screenshot({ path: join(OUT, 'completed-row.png'), fullPage: true })
  await complete.waitFor({ state: 'detached', timeout: 2_200 })
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ok: true, removed: true }))
  console.log(JSON.stringify({ ok: true, screenshot: join(OUT, 'completed-row.png') }))
} finally {
  await browser.close()
}
