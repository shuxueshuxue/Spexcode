// Real-browser evidence for [[files]]. Start a backend and dashboard, then pass SESSION after publishing a
// file through the public CLI. The script captures the empty/live toolbar states and verifies the browser's
// click reaches the authorized download route.
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const SESSION = process.env.SESSION
const HTML_FILE = process.env.HTML_FILE
const OUT = process.env.OUT || '/tmp/session-files-e2e'
if (!SESSION) throw new Error('pass SESSION=<id> after publishing the test artifact with spex session files add')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/snap/bin/chromium', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-files .si-tool').waitFor({ state: 'visible', timeout: 20_000 })
  const button = page.locator('.si-files .si-tool')
  const disabled = await button.isDisabled()
  await page.screenshot({ path: join(OUT, disabled ? 'files-empty.png' : 'files-live.png'), fullPage: true })
  if (disabled) throw new Error('session has no posted files; empty-state screenshot captured, then publish an artifact and rerun')
  await button.click()
  const row = HTML_FILE
    ? page.locator('.si-files-row').filter({ hasText: basename(HTML_FILE) }).first()
    : page.locator('.si-files-row').first()
  const name = row.locator('.si-files-name')
  await name.waitFor({ state: 'visible' })
  const copy = row.locator('.si-files-copy')
  const fullPath = await copy.getAttribute('data-tip')
  if (!fullPath || await name.getAttribute('data-tip') || (await name.textContent())?.includes('/'))
    throw new Error('the compact file row must show only a name; only its copy-path icon may expose the full path')
  for (const tool of ['.si-files-download']) {
    const tip = await row.locator(tool).getAttribute('data-tip')
    if (!tip || tip.includes(fullPath)) throw new Error(`${tool} must name its action without exposing the full path`)
  }
  const [menuBox, nameBox] = await Promise.all([page.locator('.si-files-menu').boundingBox(), name.boundingBox()])
  if (!menuBox || !nameBox || menuBox.width > nameBox.width + 100) throw new Error('the file dropdown must fit its visible file name and fixed icon tools')
  const visibleName = await name.textContent()
  if (!visibleName) throw new Error('the posted file needs a visible short name')
  await page.screenshot({ path: join(OUT, 'files-menu.png'), fullPage: true })
  await page.mouse.click(12, 840)
  await page.locator('.si-files-menu').waitFor({ state: 'hidden' })
  await button.click()
  await row.locator('.si-files-name').click()
  const resourceTab = page.locator('.si-resource-tab').filter({ hasText: visibleName })
  await resourceTab.waitFor({ state: 'visible' })
  if (!await resourceTab.evaluate((element) => element.classList.contains('on')))
    throw new Error('clicking the filename must select the same resource tab opened by the toolbar picker')
  await page.locator('.si-resource-file').waitFor({ state: 'visible' })
  if (HTML_FILE) {
    const frame = page.locator('.si-file-html')
    await frame.waitFor({ state: 'visible' })
    if (await frame.getAttribute('sandbox') !== null) throw new Error('HTML previews must not restrict browser capabilities with a sandbox')
    if (await frame.getAttribute('referrerpolicy') !== null) throw new Error('HTML previews must not restrict the document referrer policy')
    if (await page.locator('.si-file-text').count()) throw new Error('HTML previews must not render source in a preformatted text block')
    const renderedHeading = page.frameLocator('.si-file-html').locator('#proof')
    await renderedHeading.waitFor({ state: 'visible' })
    if (await renderedHeading.textContent() !== 'Rendered HTML') throw new Error('the posted HTML must render its document content')
    if (await page.frameLocator('.si-file-html').locator('body').getAttribute('data-script-ran') !== 'yes')
      throw new Error('HTML previews must execute scripts')
    const parentAccessible = await page.frameLocator('.si-file-html').locator('body').evaluate(() => {
      try { return Boolean(window.parent.document.querySelector('#root')) } catch { return false }
    })
    if (!parentAccessible) throw new Error('HTML previews must retain same-origin access to the dashboard document')
  }
  if (await page.locator('.si-file-preview-backdrop').count())
    throw new Error('a files-menu preview must not create a second pop-out surface')
  const resourceActions = page.locator('.si-actions [data-resource-action]')
  if (await resourceActions.count() !== 3)
    throw new Error('a selected file must expose refresh, download, and copy path in the right-side toolbar')
  await page.locator('.si-actions [data-resource-action="copy"]').click()
  if (await page.evaluate(() => navigator.clipboard.readText()) !== fullPath)
    throw new Error('the selected file toolbar must copy its absolute posted path')
  await page.screenshot({ path: join(OUT, 'files-resource-tab.png'), fullPage: true })
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.si-actions [data-resource-action="download"]').click()])
  const result = { session: SESSION, path: fullPath, suggestedFilename: download.suggestedFilename() }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally {
  await browser.close()
}
