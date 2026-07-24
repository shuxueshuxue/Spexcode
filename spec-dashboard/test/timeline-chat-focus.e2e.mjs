import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5199'
const sessionId = process.env.SESSION_ID
const secondSessionId = process.env.SECOND_SESSION_ID
const out = resolve(process.env.OUT || '/tmp/timeline-chat-focus')
if (!sessionId) throw new Error('SESSION_ID=<real-headless-session-id> is required')
if (!secondSessionId) throw new Error('SECOND_SESSION_ID=<second-real-headless-session-id> is required')
mkdirSync(out, { recursive: true })

const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
})
const page = await context.newPage()
const video = page.video()
const started = Date.now()
const events = []
const mark = (kind, label) => events.push({ atMs: Date.now() - started, kind, label })
mark('narrate', '▶ timeline-focus-on-active · desktop focus and phone restraint')

const readFocus = async () => page.evaluate(() => {
  const input = [...document.querySelectorAll('.m-input')].find((element) => (
    element.offsetParent !== null && getComputedStyle(element).visibility !== 'hidden'
  ))
  return {
    active: document.activeElement === input,
    activeTag: document.activeElement?.tagName || null,
    activeClass: document.activeElement?.className || '',
    draft: input?.value || '',
    sinks: document.querySelectorAll('[data-focus-sink]').length,
  }
})

const showReadout = async (title, lines, pass) => page.evaluate(({ heading, entries, ok }) => {
  document.querySelector('#timeline-focus-readout')?.remove()
  const readout = document.createElement('pre')
  readout.id = 'timeline-focus-readout'
  Object.assign(readout.style, {
    position: 'fixed', top: '10px', left: '10px', zIndex: '2147483647', margin: '0',
    maxWidth: 'calc(100vw - 20px)', padding: '10px 12px', whiteSpace: 'pre-wrap',
    border: `3px solid ${ok ? '#859900' : '#dc322f'}`, borderRadius: '4px',
    background: 'rgba(0,43,54,.96)', color: '#fdf6e3', font: '13px/1.45 monospace',
    pointerEvents: 'none',
  })
  readout.textContent = [heading, ...entries].join('\n')
  document.body.append(readout)
}, { heading: title, entries: lines, ok: pass })

let result
try {
  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  const firstInput = page.locator('.m-input:visible')
  await firstInput.fill('B-first-draft-kept')
  mark('frame', '📷 keep draft in first desktop session')

  await page.goto(`${base}/#/sessions/${encodeURIComponent(secondSessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const desktopSecondBefore = await readFocus()
  await page.keyboard.type('B-second-direct')
  const desktopSecondAfter = await readFocus()
  mark('frame', '📷 switch to second session and type without click')

  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.m-input:visible').waitFor({ state: 'visible', timeout: 30_000 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const desktopReturnBefore = await readFocus()
  await page.keyboard.type('-DIRECT')
  const desktopReturnAfter = await readFocus()
  const desktop = {
    pass: desktopSecondBefore.active && desktopSecondBefore.sinks === 1
      && desktopSecondAfter.draft === 'B-second-direct'
      && desktopReturnBefore.active && desktopReturnBefore.sinks === 1
      && desktopReturnBefore.draft === 'B-first-draft-kept'
      && desktopReturnAfter.draft === 'B-first-draft-kept-DIRECT',
    secondBefore: desktopSecondBefore,
    secondAfter: desktopSecondAfter,
    returnBefore: desktopReturnBefore,
    returnAfter: desktopReturnAfter,
    mountedComposers: await page.locator('.si-term-layer .m-input').count(),
  }
  mark('frame', '📷 return to focused composer with preserved draft')
  await showReadout('B · DESKTOP FOCUS ON ACTIVE', [
    `second activeElement === .m-input: ${desktopSecondBefore.active}`,
    `second direct draft: ${desktopSecondAfter.draft}`,
    `return activeElement === .m-input: ${desktopReturnBefore.active}`,
    `preserved + direct draft: ${desktopReturnAfter.draft}`,
    `sole sink: ${desktopReturnBefore.sinks === 1}`,
  ], desktop.pass)
  await page.waitForTimeout(1200)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => matchMedia('(max-width: 640px)').matches)
  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.m-sessdetail:visible .m-input').waitFor({ state: 'visible', timeout: 30_000 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const mobileFirstBefore = await readFocus()
  await page.keyboard.type('IGNORED')
  const mobileFirstAfter = await readFocus()
  await page.locator('.m-sess-back:visible').click()
  await page.locator('.m-sesslist:visible').waitFor({ state: 'visible', timeout: 30_000 })
  await page.goto(`${base}/#/sessions/${encodeURIComponent(secondSessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.m-sessdetail:visible .m-input').waitFor({ state: 'visible', timeout: 30_000 })
  await page.evaluate(() => new Promise(requestAnimationFrame))
  const mobileSecondBefore = await readFocus()
  await page.keyboard.type('IGNORED')
  const mobileSecondAfter = await readFocus()
  const mobile = {
    pass: !mobileFirstBefore.active && mobileFirstBefore.sinks === 1
      && mobileFirstAfter.draft === mobileFirstBefore.draft
      && !mobileSecondBefore.active && mobileSecondBefore.sinks === 1
      && mobileSecondAfter.draft === mobileSecondBefore.draft,
    firstBefore: mobileFirstBefore,
    firstAfter: mobileFirstAfter,
    secondBefore: mobileSecondBefore,
    secondAfter: mobileSecondAfter,
  }
  mark('frame', '📷 phone session entry leaves composer unfocused')
  await showReadout('B · PHONE DOES NOT AUTO-FOCUS', [
    `first activeElement === .m-input: ${mobileFirstBefore.active}`,
    `first direct typing changed draft: ${mobileFirstAfter.draft !== mobileFirstBefore.draft}`,
    `second activeElement === .m-input: ${mobileSecondBefore.active}`,
    `second direct typing changed draft: ${mobileSecondAfter.draft !== mobileSecondBefore.draft}`,
    `sole sink: ${mobileSecondBefore.sinks === 1}`,
  ], mobile.pass)
  await page.waitForTimeout(1200)
  result = { desktop, mobile }
} finally {
  await context.close()
  await video.saveAs(join(out, 'timeline-chat-focus-b.webm'))
  await browser.close()
}

writeFileSync(join(out, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
writeFileSync(join(out, 'timeline-chat-focus-b.timeline.json'), `${JSON.stringify({ events }, null, 2)}\n`)
writeFileSync(join(out, 'timeline-chat-focus-b.steps.json'), `${JSON.stringify({
  v: 2,
  axis: 'time',
  events: events.map(({ atMs, label }) => ({ at: atMs, step: label.replace(/^[▶📷]\s*/u, '') })),
}, null, 2)}\n`)
assert.equal(result?.desktop.pass, true, `desktop focus-on-active failed: ${JSON.stringify(result?.desktop)}`)
assert.equal(result?.mobile.pass, true, `phone composer was auto-focused: ${JSON.stringify(result?.mobile)}`)
console.log(JSON.stringify({ ok: true, result, video: join(out, 'timeline-chat-focus-b.webm') }, null, 2))
