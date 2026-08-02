// Real-browser evidence for [[files]]. Start a backend and dashboard, then pass SESSION after publishing a
// file through the public CLI. The script captures the empty/live toolbar states and verifies the browser's
// click reaches the authorized download route.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const SESSION = process.env.SESSION
const OUT = process.env.OUT || '/tmp/session-files-e2e'
if (!SESSION) throw new Error('pass SESSION=<id> after publishing the test artifact with spex session files add')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/snap/bin/chromium', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-files .si-tool').waitFor({ state: 'visible', timeout: 20_000 })
  const button = page.locator('.si-files .si-tool')
  const disabled = await button.isDisabled()
  await page.screenshot({ path: join(OUT, disabled ? 'files-empty.png' : 'files-live.png'), fullPage: true })
  if (disabled) throw new Error('session has no posted files; empty-state screenshot captured, then publish an artifact and rerun')
  await button.click()
  const row = page.locator('.si-files-item').first()
  await row.waitFor({ state: 'visible' })
  await row.click()
  await page.locator('.si-file-preview').waitFor({ state: 'visible' })
  await page.screenshot({ path: join(OUT, 'files-preview.png'), fullPage: true })
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.si-file-preview-head button').first().click()])
  const result = { session: SESSION, path: await row.getAttribute('aria-label'), suggestedFilename: download.suggestedFilename() }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
