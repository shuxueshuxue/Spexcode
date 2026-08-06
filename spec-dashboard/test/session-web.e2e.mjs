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
  '',
  ...Array.from({ length: 80 }, (_, index) => `Warm preview scroll line ${index + 1}.`),
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
const extraFiles = []
try {
  const canonicalWeb = new URL(WEB_URL).href
  if (command('web', 'ls').split('\n').includes(canonicalWeb)) command('web', 'retract', WEB_URL)
  if (!command('files', 'ls').split('\n').includes(FILE)) {
    assert.equal(command('files', 'add', FILE), `posted ${FILE}`)
    postedFile = true
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let previewRequests = 0
  page.on('request', (request) => {
    if (request.url().includes('/files/download?') && request.url().includes('preview=1')) previewRequests += 1
  })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-tab-add').waitFor({ state: 'visible', timeout: 20_000 })

  const files = page.locator('.si-files')
  await files.locator('.si-tool').click()
  const row = files.locator('.si-files-row').filter({ hasText: basename(FILE) })
  await row.waitFor({ state: 'visible' })
  assert.equal(await row.locator('.si-files-name').getAttribute('data-tip'), null)
  assert.equal(await row.locator('.si-files-name').getAttribute('aria-label'), 'preview file')
  assert.equal(await row.locator('.si-files-copy').getAttribute('data-tip'), FILE)
  assert.equal(await row.locator('.si-files-download').getAttribute('data-tip'), 'download file')
  await row.locator('.si-files-name').click()
  const fileTab = page.locator('.si-resource-tab').filter({ hasText: basename(FILE) })
  await fileTab.waitFor({ state: 'visible' })
  assert.equal(await fileTab.evaluate((element) => element.classList.contains('on')), true, 'the filename must select the file resource tab')
  assert.equal(await page.locator('.si-file-preview-backdrop').count(), 0, 'the filename must not create a second pop-out preview')
  assert.equal(await page.locator('.si-actions [data-resource-action]').count(), 3, 'a selected file gets refresh, download, and copy-path actions in the right toolbar')
  assert.equal(await page.locator('.si-actions [data-resource-action="download"]').count(), 1, 'a selected file gets one right-side download action')
  assert.equal(await page.locator('.si-actions [data-resource-action="copy"]').getAttribute('data-tip'), FILE, 'only the copy-path toolbar action exposes the absolute path')
  assert.equal(await page.locator('.si-actions [data-command="merge"]').count(), 0, 'merge belongs to the terminal surface, not a file')
  assert.equal(await fileTab.locator('.si-resource-tab-action').count(), 1, 'the file tab keeps close but not refresh')
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
  writeFileSync(FILE, [
    '# Preview starts here',
    '',
    'This is selectable Markdown from the current live path.',
    '',
    '## Refreshed file content',
    '',
    'The right-side file action rereads this current path.',
    '',
    ...Array.from({ length: 80 }, (_, index) => `Refreshed warm preview scroll line ${index + 1}.`),
  ].join('\n'))
  await page.locator('.si-actions [data-resource-action="refresh"]').click()
  await resourceMarkdown.getByRole('heading', { name: 'Refreshed file content' }).waitFor({ state: 'visible' })
  assert.match(await resourceMarkdown.textContent(), /rereads this current path/, 'file refresh must reread the live path')
  const previewRequestsBeforeRoundTrip = previewRequests
  const initialFileScroll = await page.locator('.si-resource-file').evaluate((element) => {
    element.scrollTop = Math.min(240, Math.max(0, element.scrollHeight - element.clientHeight))
    return element.scrollTop
  })
  await page.screenshot({ path: join(OUT, 'file-resource-tab.png'), fullPage: true })

  assert.equal(command('web', 'add', WEB_URL), `posted ${canonicalWeb}`)
  postedWeb = true
  const webTab = page.locator('.si-resource-tab').filter({ hasText: webLabel })
  await webTab.waitFor({ state: 'visible', timeout: 20_000 })
  assert.equal(await page.locator('.si-actions [data-resource-action="refresh"]').count(), 0, 'web resources do not get the file refresh action')
  assert.equal(await page.locator('.si-actions [data-command="merge"]').count(), 0, 'merge remains hidden while web is selected')
  const frame = page.frameLocator('.si-resource-web')
  const version = frame.locator('#spex-web-proof')
  await version.waitFor({ state: 'visible', timeout: 20_000 })
  const first = await version.textContent()
  const initialWeb = await page.locator('.si-resource-web').evaluate((element) => {
    window.__spexResourceFrame = element.contentWindow
    element.contentWindow?.scrollTo(0, 240)
    return { scrollY: element.contentWindow?.scrollY || 0 }
  })

  await fileTab.locator('.si-resource-tab-main').click()
  await resourceMarkdown.getByRole('heading', { name: 'Preview starts here' }).waitFor({ state: 'visible' })
  const returnedFile = await page.locator('.si-resource-file').evaluate((element) => ({ scrollTop: element.scrollTop }))
  await page.locator('.si-tab[role="tab"]').click()
  await webTab.locator('.si-resource-tab-main').click()
  await version.waitFor({ state: 'visible', timeout: 20_000 })
  const returnedWeb = await page.locator('.si-resource-web').evaluate((element) => ({
    sameContentWindow: element.contentWindow === window.__spexResourceFrame,
    scrollY: element.contentWindow?.scrollY || 0,
  }))
  const warmResources = {
    previewRequests,
    previewRequestsBeforeRoundTrip,
    initialFileScroll,
    returnedFileScroll: returnedFile.scrollTop,
    initialWebScroll: initialWeb.scrollY,
    returnedWebScroll: returnedWeb.scrollY,
    sameContentWindow: returnedWeb.sameContentWindow,
  }
  writeFileSync(join(OUT, 'warm-resource-round-trip.json'), JSON.stringify(warmResources, null, 2) + '\n')
  assert.equal(warmResources.previewRequests, warmResources.previewRequestsBeforeRoundTrip, 'reselecting the file resource must not request its preview again')
  assert.equal(warmResources.returnedFileScroll, warmResources.initialFileScroll, 'reselecting the file resource must preserve its scroll')
  assert.equal(warmResources.sameContentWindow, true, 'reselecting the web resource must keep the same iframe contentWindow')
  assert.equal(warmResources.returnedWebScroll, warmResources.initialWebScroll, 'reselecting the web resource must preserve its in-frame scroll')

  const capacityFiles = Array.from({ length: 7 }, (_, index) => join(OUT, `resource-capacity-${index + 1}.txt`))
  for (const path of capacityFiles) {
    writeFileSync(path, `resource capacity fixture ${basename(path)}\n`)
    assert.equal(command('files', 'add', path), `posted ${path}`)
    extraFiles.push(path)
  }
  await page.locator('.si-tab-add').click()
  const capacityPicker = page.locator('.si-resource-menu')
  await capacityPicker.getByRole('menuitem', { name: basename(capacityFiles[0]) }).waitFor({ state: 'visible', timeout: 20_000 })
  for (const path of capacityFiles.slice(0, 6)) {
    await capacityPicker.getByRole('menuitem', { name: basename(path) }).click()
    await page.locator('.si-resource-tab').filter({ hasText: basename(path) }).waitFor({ state: 'visible' })
    await page.locator('.si-tab-add').click()
  }
  const ninth = capacityPicker.getByRole('menuitem', { name: basename(capacityFiles[6]) })
  assert.equal(await page.locator('.si-resource-layer').count(), 8, 'the console keeps at most eight mounted warm resource layers')
  assert.equal(await ninth.isDisabled(), true, 'the ninth resource must be disabled instead of evicting a warm tab')
  await page.locator('.si-tab-add').click()

  await page.locator('.si-tab-add').click()
  const picker = page.locator('.si-resource-menu')
  await picker.waitFor({ state: 'visible' })
  assert.equal(await picker.getByRole('menuitem', { name: webLabel }).count(), 0, 'an open web is not offered twice')
  assert.equal(await picker.getByRole('menuitem', { name: basename(FILE) }).count(), 0, 'the filename-opened file is not offered twice')
  await page.locator('.si-tab-add').click()
  await fileTab.locator('.si-resource-tab-action').click()
  await fileTab.waitFor({ state: 'detached' })
  await page.locator('.si-tab-add').click()
  await page.locator('.si-resource-menu').getByRole('menuitem', { name: basename(FILE) }).click()
  await page.locator('.si-resource-tab').filter({ hasText: basename(FILE) }).waitFor({ state: 'visible' })
  await page.locator('.si-tab-add').click()
  assert.equal(await page.locator('.si-resource-menu').getByRole('menuitem', { name: webLabel }).count(), 0, 'the re-opened web remains singleton')
  assert.equal(await page.locator('.si-resource-menu').getByRole('menuitem', { name: basename(FILE) }).count(), 0, 'the re-opened file remains singleton')
  await page.screenshot({ path: join(OUT, 'resource-tabs-live.png'), fullPage: true })

  await webTab.locator('.si-resource-tab-action').click()
  await webTab.waitFor({ state: 'detached' })
  await page.locator('.si-tab-add').click()
  await page.locator('.si-resource-menu').getByRole('menuitem', { name: webLabel }).click()
  await page.locator('.si-resource-tab').filter({ hasText: webLabel }).waitFor({ state: 'visible' })

  assert.equal(command('web', 'retract', WEB_URL), `retracted ${canonicalWeb}`)
  postedWeb = false
  await page.locator('.si-resource-tab').filter({ hasText: webLabel }).waitFor({ state: 'detached', timeout: 20_000 })
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ session: SESSION, file: FILE, web: WEB_URL, first, warmResources }, null, 2) + '\n')
  console.log(JSON.stringify({ session: SESSION, file: FILE, web: WEB_URL, first, warmResources }))
} finally {
  if (postedWeb) { try { command('web', 'retract', WEB_URL) } catch {} }
  for (const path of extraFiles) { try { command('files', 'retract', path) } catch {} }
  if (postedFile) { try { command('files', 'retract', FILE) } catch {} }
  await browser.close()
}
