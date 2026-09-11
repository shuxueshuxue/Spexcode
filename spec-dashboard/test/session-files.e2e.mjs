// Real-browser evidence for [[resource-picker]] and [[files]]: what an agent posts, a posted web service, and a
// file the human sends through the Conversation composer all reach the human through the one floating picker.
// Start a backend and a dashboard, then pass SESSION (a live pane-backed session on that backend). The script
// posts its own fixture files through the public CLI and retracts them afterwards.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const API = process.env.API || process.env.SPEXCODE_API_URL || 'http://127.0.0.1:8787'
const PROJECT = process.env.PROJECT || process.cwd()
const SESSION = process.env.SESSION
const CLI = process.env.SPEXCODE_CLI || resolve(here, '..', '..', 'spec-cli', 'bin', 'spex.mjs')
const OUT = resolve(process.env.OUT || '/tmp/session-files-e2e')
if (!SESSION) throw new Error('pass SESSION=<id> of a live session on the backend behind BASE')
mkdirSync(OUT, { recursive: true })

const crc32 = (bytes) => {
  let crc = ~0
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) }
  return ~crc >>> 0
}
const png = (width, height, [r, g, b]) => {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length)
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(body))
    return Buffer.concat([size, body, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())])))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}

const fixture = join(OUT, 'posted')
const files = {
  report: join(fixture, 'report.html'),
  notes: join(fixture, 'notes.md'),
  metrics: join(fixture, 'metrics.json'),
  shot: join(fixture, 'shot.png'),
  odd: join(fixture, 'bundle.qzx9'),
  alpha: join(fixture, 'alpha', 'summary.txt'),
  beta: join(fixture, 'beta', 'summary.txt'),
}
const upload = join(OUT, 'mockup.png')
mkdirSync(join(fixture, 'alpha'), { recursive: true })
mkdirSync(join(fixture, 'beta'), { recursive: true })
writeFileSync(files.report, '<!doctype html><h1 id="proof">Rendered HTML</h1>\n')
writeFileSync(files.notes, '# Notes\n')
writeFileSync(files.metrics, '{"p95": 118}\n')
writeFileSync(files.shot, png(48, 32, [200, 90, 80]))
writeFileSync(files.odd, 'odd suffix\n')
writeFileSync(files.alpha, 'alpha summary\n')
writeFileSync(files.beta, 'beta summary\n')
writeFileSync(upload, png(48, 32, [80, 160, 120]))

const cli = (...args) => execFileSync(process.execPath, [CLI, 'session', ...args], {
  cwd: PROJECT, env: { ...process.env, SPEXCODE_SESSION_ID: SESSION, SPEXCODE_API_URL: API }, encoding: 'utf8',
}).trim()
const board = async () => {
  const response = await fetch(`${BASE}/api/graph`)
  return response.ok ? (await response.json()).sessions?.find((session) => session.id === SESSION) : null
}
const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((done) => setTimeout(done, 200))
  }
}
const service = await new Promise((done, fail) => {
  const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<title>preview</title>ok') })
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => done({ server, url: `http://127.0.0.1:${server.address().port}/` }))
})

// every animation frame for a short while: how much of the drawer shows below its slot line, and where that line
// is. `presses` are button presses made from inside the page at exact times, so an interruption lands mid-motion.
const sampleDrawer = (page, ms = 600, presses = []) => page.evaluate(([duration, times]) => new Promise((done) => {
  const frames = []
  const start = performance.now()
  for (const at of times) setTimeout(() => document.querySelector('.si-rp-fab').click(), at)
  const tick = () => {
    const drawer = document.querySelector('.si-rp-drawer')
    const t = performance.now() - start
    if (drawer) {
      const rect = drawer.getBoundingClientRect()
      const inset = parseFloat(getComputedStyle(drawer).clipPath.match(/inset\(([-\d.]+)/)?.[1] || '0') / 100 * rect.height
      frames.push({ t: Math.round(t), shown: Math.round(rect.bottom - rect.top - inset), slot: Math.round(rect.top + inset), closing: drawer.classList.contains('closing') })
    } else frames.push({ t: Math.round(t), gone: true })
    if (t < duration) requestAnimationFrame(tick); else done(frames)
  }
  requestAnimationFrame(tick)
}), [ms, presses])

const checks = []
const check = (name, ok, detail = null) => {
  checks.push({ name, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail == null ? '' : ` - ${JSON.stringify(detail)}`}`)
}
const posted = []
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
try {
  for (const path of Object.values(files)) { cli('files', 'add', path); posted.push(path) }
  cli('web', 'add', service.url)
  await waitFor(async () => {
    const row = await board()
    return row && Object.values(files).every((path) => row.files?.includes(path)) && row.web?.some((web) => web.url === service.url)
  }, 'posted files and web service on the board')

  await page.goto(`${BASE}/#/sessions/${SESSION}?surface=conversation`, { waitUntil: 'domcontentloaded' })
  const fab = page.locator('.si-rp-fab')
  await fab.waitFor({ state: 'visible', timeout: 20_000 })
  const placement = await page.evaluate(() => {
    const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON()
    return { fab: rect('.si-rp-fab'), strip: rect('.tabstrip'), doc: rect('.si-session-wrap'), inStrip: document.querySelectorAll('.tabstrip [data-action="resource-picker"]').length }
  })
  check('the picker is a floating button over the document, not a tab-row action',
    placement.inStrip === 0 && placement.fab.top >= placement.strip.bottom && placement.doc.right - placement.fab.right <= 24 && placement.fab.top - placement.doc.top <= 24, placement)

  // the human's own file goes in through the Conversation composer's paperclip, exactly as a person sends one
  const composer = page.locator('.si-term-layer:visible .m-composer')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), composer.getByRole('button', { name: /^attach a file/ }).click()])
  // bytes rather than a path: a sandboxed (snap) Chromium cannot read files outside the user's home
  await chooser.setFiles({ name: 'mockup.png', mimeType: 'image/png', buffer: readFileSync(upload) })
  const draft = composer.locator('textarea')
  await waitFor(async () => (await draft.inputValue()).includes('spexcode-uploads/'), 'the upload path spliced into the draft')
  await draft.press('End')
  await draft.type(' match this mockup')
  await draft.press('Enter')
  const sent = await waitFor(async () => (await board())?.uploadedFiles?.find((file) => file.name === 'mockup.png'), 'the sent upload posted to the session')
  check('a sent upload is posted to the session and projected as the human\'s', sent.path.endsWith('-mockup.png') && (await board()).files.includes(sent.path), sent)

  const total = await waitFor(async () => {
    const row = await board()
    const count = (row.files?.length || 0) + (row.web?.length || 0)
    return (await fab.textContent())?.trim() === String(count) ? count : null
  }, 'the button count to match the published resources')
  check('the button carries the published count', true, total)
  await page.screenshot({ path: join(OUT, 'picker-closed.png') })

  // slow the drawer's opening right down, then pin it at fixed points to show it sliding out of its slot
  const slow = await page.addStyleTag({ content: '.si-rp-drawer { transition-duration: 60s !important; }' })
  await fab.click()
  const drawer = page.locator('.si-rp-drawer')
  await drawer.waitFor({ state: 'attached' })
  const frames = []
  for (const progress of [0.25, 0.5, 0.75]) {
    const visible = await drawer.evaluate((element, p) => {
      for (const animation of element.getAnimations()) { animation.pause(); animation.currentTime = p * 60_000 }
      const rect = element.getBoundingClientRect()
      const inset = parseFloat(getComputedStyle(element).clipPath.match(/inset\(([-\d.]+)/)?.[1] || '0') / 100 * rect.height
      return { top: Math.round(rect.top), visibleTop: Math.round(rect.top + inset), bottom: Math.round(rect.bottom) }
    }, progress)
    frames.push({ progress, ...visible })
    await page.screenshot({ path: join(OUT, `picker-drawer-${Math.round(progress * 100)}.png`), clip: { x: 960, y: 36, width: 480, height: 620 } })
  }
  check('the drawer slides down out of a fixed slot while it opens',
    frames[0].bottom < frames[1].bottom && frames[1].bottom < frames[2].bottom && new Set(frames.map((frame) => frame.visibleTop)).size === 1, frames)
  await drawer.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
  await slow.evaluate((style) => style.remove())
  check('opening puts focus in the search field', await page.evaluate(() => document.activeElement?.closest('.si-rp-search') != null))

  const chips = await page.locator('.si-rp-chip').evaluateAll((elements) => elements.map((element) => element.dataset.filter))
  check('chips are All, the allowlisted types present in their fixed order, then Uploaded',
    JSON.stringify(chips) === JSON.stringify(['all', 'html', 'markdown', 'image', 'text', 'json', 'web', 'uploaded']), chips)
  const oddRow = page.locator('.si-rp-row').filter({ hasText: 'bundle.qzx9' })
  check('an unlisted suffix mints no chip but is listed under All', await oddRow.count() === 1 && /File|文件/.test(await oddRow.locator('.si-rp-meta').textContent()))
  const folders = await page.locator('.si-rp-row').filter({ hasText: 'summary.txt' }).locator('.si-rp-folder').allTextContents()
  check('two files sharing a name are told apart by folder, and only those', JSON.stringify(folders.sort()) === '["alpha","beta"]' && await page.locator('.si-rp-folder').count() === 2, folders)
  const uploadedRow = page.locator('.si-rp-row').filter({ hasText: 'mockup.png' })
  check('the upload is listed by its own name with the uploaded tag', await uploadedRow.count() === 1 && await uploadedRow.locator('.si-rp-tag').count() === 1)
  await page.screenshot({ path: join(OUT, 'picker-open.png') })

  await page.locator('.si-rp-chip[data-filter="image"]').click()
  const images = await page.locator('.si-rp-name').allTextContents()
  check('a type chip keeps only that type', JSON.stringify(images.sort()) === '["mockup.png","shot.png"]', images)
  await page.locator('.si-rp-chip[data-filter="uploaded"]').click()
  const uploads = await page.locator('.si-rp-name').allTextContents()
  check('the Uploaded chip keeps only the human\'s uploads', JSON.stringify(uploads) === '["mockup.png"]', uploads)
  await page.screenshot({ path: join(OUT, 'picker-uploaded.png') })
  await page.locator('.si-rp-chip[data-filter="all"]').click()

  const search = page.locator('.si-rp-search input')
  await search.fill('summ')
  const matches = await page.locator('.si-rp-name').allTextContents()
  check('search narrows by name', JSON.stringify(matches) === '["summary.txt","summary.txt"]', matches)
  await page.screenshot({ path: join(OUT, 'picker-search.png') })
  const second = await page.locator('.si-rp-row').nth(1).locator('.si-rp-folder').textContent()
  const tabsBefore = await page.locator('.tab[role="tab"]').count()
  await search.press('ArrowDown')
  await search.press('Enter')
  await drawer.waitFor({ state: 'detached' })
  const activeTab = page.locator('.tab.on .tab-label')
  check('the keyboard opens the highlighted file as a resource tab', (await activeTab.textContent()) === 'summary.txt' && await page.locator('.tab[role="tab"]').count() === tabsBefore + 1)
  await page.locator('.si-resource-file.text').waitFor({ state: 'visible' })
  const preview = await page.evaluate(() => [...document.querySelectorAll('.si-file-text')].find((element) => element.checkVisibility({ visibilityProperty: true }))?.textContent)
  check('the opened tab previews that file', preview?.includes(`${second} summary`), preview)

  await page.locator(`.tab[role="tab"][data-tab-key^="#/sessions/${SESSION}"]:not([data-tab-key*="surface="]) .tab-face`).click()
  await fab.click()
  await drawer.waitFor({ state: 'visible' })
  const openRow = page.locator('.si-rp-row').filter({ has: page.locator('.si-rp-state') })
  check('an entry whose tab is open says so', await openRow.count() === 1 && (await openRow.locator('.si-rp-folder').textContent()) === second)
  await openRow.locator('.si-rp-open').click()
  check('picking an open entry focuses its tab instead of duplicating it',
    (await activeTab.textContent()) === 'summary.txt' && await page.locator('.tab[role="tab"]').count() === tabsBefore + 1)

  await fab.click()
  await drawer.waitFor({ state: 'visible' })
  const reportRow = page.locator('.si-rp-row').filter({ hasText: 'report.html' })
  await reportRow.hover()
  const copy = reportRow.locator('.si-rp-tool').last()
  check('only the copy tool names the full path', (await copy.getAttribute('aria-label')) === files.report && !(await reportRow.locator('.si-rp-open').textContent()).includes('/'))
  await copy.click()
  check('the copy tool writes the absolute posted path', await page.evaluate(() => navigator.clipboard.readText()) === files.report)
  const [download] = await Promise.all([page.waitForEvent('download'), reportRow.locator('.si-rp-tool').first().click()])
  check('the download tool fetches the posted file', download.suggestedFilename() === basename(files.report), download.suggestedFilename())
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'detached' })
  check('Escape closes the picker and gives focus back', await page.evaluate(() => !document.activeElement?.closest('.si-rp')))

  await fab.click()
  await drawer.waitFor({ state: 'visible' })
  await page.mouse.click(700, 500)
  await drawer.waitFor({ state: 'detached' })
  check('a press elsewhere closes the picker', true)

  await fab.click()
  await uploadedRow.locator('.si-rp-open').click()
  await page.locator('.si-resource-file.image').waitFor({ state: 'visible' })
  check('an upload\'s tab wears the name the human gave it', (await activeTab.textContent()) === 'mockup.png')
  await page.screenshot({ path: join(OUT, 'picker-upload-tab.png') })

  const drawn = (frames) => frames.filter((frame) => !frame.gone)
  await drawer.waitFor({ state: 'detached' })
  await fab.click()
  await drawer.waitFor({ state: 'visible' })
  await page.waitForTimeout(400)
  const closeRun = sampleDrawer(page)
  await page.keyboard.press('Escape')
  const closeFrames = drawn(await closeRun)
  const lastShown = closeFrames.at(-1)
  check('the drawer is back in its slot before it leaves the page',
    lastShown.closing && lastShown.shown <= 2 && new Set(closeFrames.map((frame) => frame.slot)).size === 1, closeFrames.slice(-4))
  await drawer.waitFor({ state: 'detached' })
  const interruptFrames = drawn(await sampleDrawer(page, 700, [0, 90]))
  const opened = interruptFrames.filter((frame) => !frame.closing)
  const reversal = interruptFrames.findIndex((frame) => frame.closing)
  check('a close during the opening reverses from where the drawer is',
    reversal > 0 && interruptFrames[reversal].shown <= Math.max(...opened.map((frame) => frame.shown)) + 40 && interruptFrames.at(-1).shown <= 2,
    { peak: Math.max(...opened.map((frame) => frame.shown)), firstClosing: interruptFrames[reversal]?.shown, last: interruptFrames.at(-1)?.shown })
  await drawer.waitFor({ state: 'detached' })

  await page.goto(`${BASE}/#/sessions/${SESSION}?surface=diff`, { waitUntil: 'domcontentloaded' })
  await page.locator('.diff-toolbar').waitFor({ state: 'visible', timeout: 20_000 })
  const covered = await page.evaluate(() => {
    const fab = document.querySelector('.si-rp-fab').getBoundingClientRect()
    return [...document.querySelectorAll('.diff-toolbar button, .diff-toolbar input')].filter((element) => {
      const box = element.getBoundingClientRect()
      return box.width > 0 && !(box.right <= fab.left || box.left >= fab.right || box.bottom <= fab.top || box.top >= fab.bottom)
    }).map((element) => element.getAttribute('aria-label') || element.textContent)
  })
  check('the diff toolbar leaves the floating corner free', covered.length === 0, covered)
  await page.screenshot({ path: join(OUT, 'picker-diff.png') })

  await page.goto(`${BASE}/#/sessions/${SESSION}?surface=terminal`, { waitUntil: 'domcontentloaded' })
  await fab.waitFor({ state: 'visible', timeout: 20_000 })
  await page.waitForTimeout(800)
  await fab.click()
  await drawer.waitFor({ state: 'visible' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'picker-terminal.png') })
  check('the same floating picker rides the terminal face', await page.locator('.si-rp-row').count() === total)

  check('no page errors', errors.length === 0, errors)
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ session: SESSION, checks, frames }, null, 2) + '\n')
  assert.ok(checks.every((item) => item.ok), `failed: ${checks.filter((item) => !item.ok).map((item) => item.name).join('; ')}`)
} finally {
  await page.screenshot({ path: join(OUT, 'last.png') }).catch(() => {})
  for (const path of posted) { try { cli('files', 'retract', path) } catch {} }
  try { cli('web', 'retract', service.url) } catch {}
  await browser.close()
  await new Promise((done) => service.server.close(done))
}
