import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5191'
const sessionId = process.env.SESSION_ID || 'message-stream-fixture'
const negativeSessionId = process.env.NEGATIVE_SESSION_ID || ''
const messagesFile = process.env.MESSAGES_FILE
const out = resolve(process.env.OUT || '/tmp/message-stream-e2e')
if (!messagesFile) throw new Error('MESSAGES_FILE must point to the fixture session messages.ndjson')

mkdirSync(out, { recursive: true })
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
const started = Date.now()
const timeline = []
const step = (name) => timeline.push({ at: Date.now() - started, step: name })
try {
  // Keep the real graph/session payload and alter only this fixture row's adapter projection; disable graph
  // push so its unmodified full frame cannot replace the fixture during this short proof. The UI must consume
  // capabilities only — the harness id remains untouched.
  await page.route('**/api/graph*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/api/graph/stream')) { await route.abort(); return }
    if (!url.pathname.endsWith('/api/graph')) { await route.continue(); return }
    const response = await route.fetch()
    const graph = await response.json()
    graph.sessions = (graph.sessions || []).map((session) => session.id === sessionId
      ? { ...session, capabilities: { headless: true, messageStream: true } }
      : session.id === negativeSessionId
        ? { ...session, capabilities: { headless: true, messageStream: false } }
        : session)
    await route.fulfill({ response, json: graph })
  })

  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.tl-chat', { state: 'visible', timeout: 20_000 })
  await page.waitForSelector('.tl-process-door', { state: 'visible' })
  assert.equal(await page.locator('.ms-console').count(), 0, 'native stream is a drill-down, not the headless main console')
  assert.equal(await page.locator('.si-term-layer[style*="visibility: visible"] .xterm, .si-term-layer[style*="visibility: visible"] .st-host').count(), 0, 'headless console must not mount xterm')
  assert.equal((await page.locator('.si-tab.on').innerText()).trim().toLowerCase(), 'conversation')
  step('open headless timeline conversation')

  await page.locator('.tl-process-door').click()
  await page.waitForSelector('.ms-console', { state: 'visible', timeout: 20_000 })
  await page.waitForSelector('.ms-tool', { state: 'visible' })
  step('open complete-process message stream')

  assert.ok(await page.locator('.ms-turn.user').count() >= 1, 'user bubble missing')
  assert.ok(await page.locator('.ms-turn.assistant').count() >= 2, 'assistant bubbles missing')
  assert.ok(await page.locator('.ms-tool').filter({ hasText: 'messages.ndjson' }).count() >= 1, 'message-stream tool summary missing')

  const appendedText = `Browser-observed SSE append ${Date.now()}`
  appendFileSync(messagesFile, `${JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: appendedText } })}\n`)
  await page.getByText(appendedText, { exact: true }).waitFor({ state: 'visible', timeout: 10_000 })
  step('receive appended assistant event')

  const geometry = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.ms-turn, .ms-tool')]
    const boxes = rows.map((row) => {
      const box = row.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width }
    })
    const overlap = boxes.some((box, index) => index > 0 && box.top < boxes[index - 1].bottom - 1)
    const clippedBubbles = [...document.querySelectorAll('.ms-bubble')]
      .some((bubble) => bubble.scrollWidth > bubble.clientWidth + 1)
    return { rows: boxes.length, overlap, clippedBubbles, toolbarHeight: document.querySelector('.si-tabbar')?.getBoundingClientRect().height }
  })
  assert.equal(geometry.overlap, false, 'message rows overlap')
  assert.equal(geometry.clippedBubbles, false, 'bubble text is horizontally clipped')
  assert.equal(geometry.toolbarHeight, 32, 'shared toolbar geometry moved')

  const image = join(out, 'headless-message-console.png')
  await page.screenshot({ path: image, fullPage: false })
  step('capture settled message console')

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const mobilePage = await mobileContext.newPage()
  await mobilePage.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await mobilePage.waitForSelector('.tl-chat', { state: 'visible', timeout: 20_000 })
  await mobilePage.waitForSelector('.tl-process-door', { state: 'visible', timeout: 20_000 })
  assert.equal(await mobilePage.locator('.xterm, .st-host').count(), 0, 'mobile headless conversation must not mount xterm')
  await mobilePage.locator('.tl-process-door').click()
  await mobilePage.waitForSelector('.ms-console', { state: 'visible', timeout: 20_000 })
  assert.ok(await mobilePage.locator('.ms-turn.assistant').count() >= 1, 'mobile complete-process stream missing')
  await mobileContext.close()
  step('verify mobile conversation and complete-process door')

  if (negativeSessionId) {
    const negativeContext = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const negativePage = await negativeContext.newPage()
    await negativePage.goto(`${base}/#/sessions/${encodeURIComponent(negativeSessionId)}`, { waitUntil: 'domcontentloaded' })
    await negativePage.waitForSelector('.si-term-layer[style*="visibility: visible"]', { state: 'visible', timeout: 20_000 })
    assert.equal(await negativePage.locator('.si-term-layer[style*="visibility: visible"] .tl-process-door').count(), 0, 'door must stay absent without messageStream capability')
    assert.equal(await negativePage.locator('.si-term-layer[style*="visibility: visible"] .ms-console').count(), 0, 'native stream must stay unreachable without the capability')
    await negativeContext.close()
    step('verify messageStream-negative headless conversation')
  } else {
    step('skip messageStream-negative fixture (NEGATIVE_SESSION_ID not supplied)')
  }

  const video = await page.video().path()
  await context.close()
  const timelinePath = join(out, 'headless-message-console.timeline.json')
  writeFileSync(timelinePath, `${JSON.stringify({ v: 2, axis: 'time', events: timeline }, null, 2)}\n`)
  console.log(JSON.stringify({ ok: true, image, video, timeline: timelinePath, geometry }, null, 2))
} finally {
  if (context.pages().length) await context.close().catch(() => {})
  await browser.close()
}
