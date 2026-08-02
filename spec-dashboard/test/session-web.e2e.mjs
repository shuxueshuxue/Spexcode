// Real-browser resource-tab evidence for [[web]]. It drives the public CLI only after the dashboard has read
// its initial graph, so a new published URL must arrive through the live graph update and auto-open one tab.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const SESSION = process.env.SESSION
const WEB_URL = process.env.WEB_URL
const CLI = process.env.SPEXCODE_CLI || resolve(here, '..', '..', 'spec-cli', 'bin', 'spex.mjs')
const OUT = resolve(process.env.OUT || '/tmp/session-web-e2e')
if (!SESSION || !WEB_URL) throw new Error('SESSION=<live-session-id> WEB_URL=http://127.0.0.1:<port>/ are required')
mkdirSync(OUT, { recursive: true })
const FILE = resolve(process.env.FILE || join(OUT, 'posted-preview.md'))
if (!process.env.FILE) writeFileSync(FILE, [
  '# Preview starts here',
  '',
  'This is selectable Markdown from the current live path.',
  '',
  '<div data-untrusted="true">Raw markup must remain visible source.</div>',
  '',
  '## Second heading',
].join('\n'))

const command = (...args) => execFileSync(process.execPath, [CLI, 'session', ...args], {
  cwd: process.cwd(), env: { ...process.env, SPEXCODE_SESSION_ID: SESSION }, encoding: 'utf8',
}).trim()
const webLabel = (() => {
  const url = new URL(WEB_URL)
  return `${url.hostname.replace(/^\[|\]$/g, '')}:${url.port}${url.pathname === '/' ? '' : url.pathname}`
})()

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
let postedFile = false
let postedWeb = false
try {
  const canonicalWeb = new URL(WEB_URL).href
  if (command('web', 'ls').split('\n').includes(canonicalWeb)) command('web', 'retract', WEB_URL)
  if (!command('files', 'ls').split('\n').includes(FILE)) {
    assert.equal(command('files', 'add', FILE), `posted ${FILE}`)
    postedFile = true
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-tab-add').waitFor({ state: 'visible', timeout: 20_000 })

  const files = page.locator('.si-files')
  await files.locator('.si-tool').click()
  const row = files.locator('.si-files-row').filter({ hasText: basename(FILE) })
  await row.waitFor({ state: 'visible' })
  assert.equal(await row.locator('.si-files-name').getAttribute('data-tip'), null)
  assert.equal(await row.locator('.si-files-copy').getAttribute('data-tip'), FILE)
  assert.equal(await row.locator('.si-files-preview').getAttribute('data-tip'), 'preview file')
  assert.equal(await row.locator('.si-files-download').getAttribute('data-tip'), 'download file')
  await row.locator('.si-files-preview').click()
  const fileTab = page.locator('.si-resource-tab').filter({ hasText: basename(FILE) })
  await fileTab.waitFor({ state: 'visible' })
  assert.equal(await fileTab.evaluate((element) => element.classList.contains('on')), true, 'the eye must select the file resource tab')
  assert.equal(await page.locator('.si-file-preview-backdrop').count(), 0, 'the eye must not create a second pop-out preview')
  const resourceMarkdown = page.locator('.si-resource-file .si-file-markdown')
  await resourceMarkdown.getByRole('heading', { name: 'Preview starts here' }).waitFor({ state: 'visible' })
  assert.equal(await page.locator('.si-resource-file .si-file-text').count(), 0, 'Markdown must not fall back to a raw preformatted dump')
  const resource = await page.locator('.si-resource-file').evaluate((element) => {
    const first = element.querySelector('.si-file-markdown > :first-child')
    const box = element.getBoundingClientRect()
    const firstBox = first?.getBoundingClientRect()
    const selection = getSelection()
    const range = document.createRange()
    range.selectNodeContents(element.querySelector('.si-file-markdown'))
    selection?.removeAllRanges()
    selection?.addRange(range)
    const selected = selection?.toString() || ''
    selection?.removeAllRanges()
    return { scrollTop: element.scrollTop, firstTop: firstBox?.top, boxTop: box.top, selected }
  })
  assert.equal(resource.scrollTop, 0, 'a resource preview must open at its first line')
  assert.ok(resource.firstTop >= resource.boxTop, 'the first Markdown block must not be clipped above the resource viewport')
  assert.match(resource.selected, /selectable Markdown/, 'resource Markdown must be browser-selectable')
  assert.match(await resourceMarkdown.textContent(), /<div data-untrusted="true">/, 'untrusted markup must stay text, not become a dashboard element')
  const copyTarget = resourceMarkdown.locator('p').first()
  const copyBox = await copyTarget.boundingBox()
  assert.ok(copyBox, 'Markdown copy target must be visible')
  await page.mouse.move(copyBox.x + 3, copyBox.y + copyBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(copyBox.x + copyBox.width - 3, copyBox.y + copyBox.height / 2, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.press('Control+C')
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /selectable Markdown/, 'a human drag and Ctrl+C must copy resource tab text')
  await page.screenshot({ path: join(OUT, 'file-resource-tab.png'), fullPage: true })

  assert.equal(command('web', 'add', WEB_URL), `posted ${canonicalWeb}`)
  postedWeb = true
  const webTab = page.locator('.si-resource-tab').filter({ hasText: webLabel })
  await webTab.waitFor({ state: 'visible', timeout: 20_000 })
  const frame = page.frameLocator('.si-resource-web')
  const version = frame.locator('#spex-web-proof')
  await version.waitFor({ state: 'visible', timeout: 20_000 })
  const first = await version.textContent()
  await webTab.locator('.si-resource-tab-action').first().click()
  await page.waitForFunction((before) => {
    const frameEl = document.querySelector('.si-resource-web')
    return frameEl?.contentDocument?.querySelector('#spex-web-proof')?.textContent !== before
  }, first)
  const second = await page.frameLocator('.si-resource-web').locator('#spex-web-proof').textContent()
  assert.notEqual(second, first, 'refresh must request the live service again')

  await page.locator('.si-tab-add').click()
  const picker = page.locator('.si-resource-menu')
  await picker.waitFor({ state: 'visible' })
  assert.equal(await picker.getByRole('menuitem', { name: webLabel }).count(), 0, 'an open web is not offered twice')
  assert.equal(await picker.getByRole('menuitem', { name: basename(FILE) }).count(), 0, 'the eye-opened file is not offered twice')
  await page.locator('.si-tab-add').click()
  await fileTab.locator('.si-resource-tab-action').nth(1).click()
  await fileTab.waitFor({ state: 'detached' })
  await page.locator('.si-tab-add').click()
  await page.locator('.si-resource-menu').getByRole('menuitem', { name: basename(FILE) }).click()
  await page.locator('.si-resource-tab').filter({ hasText: basename(FILE) }).waitFor({ state: 'visible' })
  await page.locator('.si-tab-add').click()
  assert.equal(await page.locator('.si-resource-menu').getByRole('menuitem', { name: webLabel }).count(), 0, 'the re-opened web remains singleton')
  assert.equal(await page.locator('.si-resource-menu').getByRole('menuitem', { name: basename(FILE) }).count(), 0, 'the re-opened file remains singleton')
  await page.screenshot({ path: join(OUT, 'resource-tabs-live.png'), fullPage: true })

  await webTab.locator('.si-resource-tab-action').nth(1).click()
  await webTab.waitFor({ state: 'detached' })
  await page.locator('.si-tab-add').click()
  await page.locator('.si-resource-menu').getByRole('menuitem', { name: webLabel }).click()
  await page.locator('.si-resource-tab').filter({ hasText: webLabel }).waitFor({ state: 'visible' })

  assert.equal(command('web', 'retract', WEB_URL), `retracted ${canonicalWeb}`)
  postedWeb = false
  await page.locator('.si-resource-tab').filter({ hasText: webLabel }).waitFor({ state: 'detached', timeout: 20_000 })
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ session: SESSION, file: FILE, web: WEB_URL, first, second }, null, 2) + '\n')
  console.log(JSON.stringify({ session: SESSION, file: FILE, web: WEB_URL, first, second }))
} finally {
  if (postedWeb) { try { command('web', 'retract', WEB_URL) } catch {} }
  if (postedFile) { try { command('files', 'retract', FILE) } catch {} }
  await browser.close()
}
