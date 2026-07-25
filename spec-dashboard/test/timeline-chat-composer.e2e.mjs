import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH
  || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5200'
const sessionId = process.env.SESSION_ID
const phase = (process.env.PHASE || 'B').toUpperCase()
const out = resolve(process.env.OUT || `/tmp/timeline-chat-composer-${phase.toLowerCase()}`)

if (!sessionId) throw new Error('SESSION_ID=<real-headless-session-id> is required')
if (!['A', 'B'].includes(phase)) throw new Error('PHASE must be A or B')
mkdirSync(out, { recursive: true })

const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const results = []

const metrics = (input) => input.evaluate((element) => {
  const styles = getComputedStyle(element)
  return {
    value: element.value,
    offsetHeight: element.offsetHeight,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: styles.overflowY,
    minHeight: styles.minHeight,
    maxHeight: styles.maxHeight,
  }
})

const sentCount = (page) => page.locator('.m-ev-sent:visible').count()

async function waitForSent(page, token) {
  await page.waitForFunction((expected) => [...document.querySelectorAll('.m-ev-text')]
    .some((element) => element.textContent?.includes(expected)), token, { timeout: 20_000 })
}

async function verifyComposerPress(page, input) {
  const highlighted = await page.evaluate(() => {
    const note = document.querySelector('.m-ev-note') || document.querySelector('.m-ev-text')
    const text = note?.firstChild
    if (!text || typeof Highlight === 'undefined' || !CSS.highlights) return false
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(4, text.data.length))
    CSS.highlights.set('timeline-sel', new Highlight(range))
    return CSS.highlights.has('timeline-sel')
  })
  await input.click()
  const after = await page.evaluate(() => ({
    highlighted: CSS.highlights?.has('timeline-sel') || false,
    focused: document.activeElement?.matches('.m-input') || false,
  }))
  return { available: highlighted, ...after }
}

async function verifyMobileLaunchComposer(page) {
  await page.locator('.m-sess-back:visible').click()
  await page.locator('.m-new-btn:visible').click()
  const input = page.locator('.m-new-input:visible')
  await input.waitFor({ state: 'visible' })
  const requests = []
  const collectRequest = (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sessions') requests.push(request.url())
  }
  page.on('request', collectRequest)
  const lines = []
  for (const count of [8, 10, 12]) {
    await input.fill(Array.from({ length: count }, (_, index) => `launch line ${index + 1}`).join('\n'))
    await page.waitForTimeout(50)
    lines.push(await metrics(input))
  }
  await input.fill('long launch prompt')
  await input.press('Enter')
  await page.waitForTimeout(500)
  const result = {
    sharedClass: await input.evaluate((element) => element.classList.contains('composer-textarea')),
    lines,
    enterValue: await input.inputValue(),
    launchRequests: requests.length,
  }
  page.off('request', collectRequest)
  await page.screenshot({ path: `${out}/mobile-launch-composer.png`, fullPage: true })

  assert.equal(result.sharedClass, true, 'mobile launch prompt bypassed ComposerTextarea')
  assert.ok(lines[0].offsetHeight < lines[1].offsetHeight && lines[1].offsetHeight < lines[2].offsetHeight,
    `mobile launch prompt did not grow above its floor: ${JSON.stringify(lines)}`)
  assert.ok(lines.every((entry) => entry.overflowY === 'hidden'), 'mobile launch prompt scrolled before its cap')
  assert.ok(lines.every((entry) => entry.scrollHeight <= entry.clientHeight), 'mobile launch prompt overflowed its client box')
  assert.equal(result.enterValue, 'long launch prompt\n', 'mobile launch Enter did not remain native editing')
  assert.equal(result.launchRequests, 0, 'mobile launch Enter created a session')
  return result
}

async function runViewport(name, viewport) {
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: out, size: viewport },
  })
  const page = await context.newPage()
  const video = page.video()
  const started = Date.now()
  const events = []
  const mark = (step) => events.push({ at: Date.now() - started, step })
  const result = { name, viewport }
  try {
    mark('open real headless conversation')
    await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
    const input = page.locator('.m-input:visible')
    await input.waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(500)

    result.initialFocus = await input.evaluate((element) => document.activeElement === element)
    result.sinks = await page.locator('.m-input[data-focus-sink]').count()
    result.lines = []
    for (const value of ['alpha', 'alpha\nbeta', 'alpha\nbeta\ngamma']) {
      await input.fill(value)
      await page.waitForTimeout(50)
      result.lines.push(await metrics(input))
    }
    mark('measure one two and three lines')

    await page.screenshot({ path: `${out}/${name}-three-lines.png`, fullPage: true })

    await input.fill(Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n'))
    await page.waitForTimeout(50)
    result.capped = await metrics(input)
    mark('measure overflow beyond cap')

    const shiftBefore = await sentCount(page)
    await input.fill('shift line')
    await input.press('Shift+Enter')
    await page.waitForTimeout(500)
    result.shiftEnter = {
      value: await input.inputValue(),
      sentBefore: shiftBefore,
      sentAfter: await sentCount(page),
    }
    mark('exercise Shift+Enter')

    const imeToken = `IME-${phase}-${name}-${Date.now()}`
    await input.fill(imeToken)
    const imeBefore = await sentCount(page)
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true })
    await page.waitForTimeout(500)
    result.imeEnter = {
      value: await input.inputValue(),
      sentBefore: imeBefore,
      sentAfter: await sentCount(page),
    }
    mark('exercise composing Enter')

    result.composerPress = await verifyComposerPress(page, input)
    mark('press composer after timeline selection')

    const sendToken = `COMPOSER-${phase}-${name}-${Date.now()}`
    await input.fill(sendToken)
    const enterBefore = await sentCount(page)
    await input.press('Enter')
    if (phase === 'B') await waitForSent(page, sendToken)
    else await page.waitForTimeout(700)
    result.enter = {
      token: sendToken,
      value: await input.inputValue(),
      sentBefore: enterBefore,
      sentAfter: await sentCount(page),
      delivered: await page.locator('.m-ev-text:visible').filter({ hasText: sendToken }).count() > 0,
    }
    mark('send unique token with plain Enter')
    if (phase === 'B' && name === 'mobile') {
      result.launchComposer = await verifyMobileLaunchComposer(page)
      mark('verify phone Create growth and native Enter')
    }

    const heights = result.lines.map((entry) => entry.offsetHeight)
    if (phase === 'A') {
      assert.deepEqual(heights, [heights[0], heights[0], heights[0]], `${name}: old textarea unexpectedly grew`)
      assert.ok(result.lines.slice(1).some((entry) => entry.scrollHeight > entry.clientHeight), `${name}: old textarea did not overflow`)
      assert.equal(result.enter.delivered, false, `${name}: old textarea unexpectedly sent on Enter`)
      assert.match(result.enter.value, /\n$/, `${name}: old Enter did not insert a line`)
    } else {
      assert.ok(heights[0] < heights[1] && heights[1] < heights[2], `${name}: textarea did not grow line by line`)
      assert.ok(result.lines.every((entry) => entry.overflowY === 'hidden'), `${name}: uncapped textarea exposed a scrollbar`)
      assert.ok(result.lines.every((entry) => entry.scrollHeight <= entry.clientHeight), `${name}: uncapped textarea overflowed its client box`)
      assert.ok(result.capped.scrollHeight > result.capped.clientHeight, `${name}: long textarea never reached its cap`)
      assert.equal(result.capped.overflowY, 'auto', `${name}: capped textarea did not enable scrolling`)
      assert.equal(result.shiftEnter.value, 'shift line\n', `${name}: Shift+Enter did not insert a line`)
      assert.equal(result.shiftEnter.sentAfter, result.shiftEnter.sentBefore, `${name}: Shift+Enter sent a message`)
      assert.equal(result.imeEnter.value, imeToken, `${name}: composition Enter changed the draft`)
      assert.equal(result.imeEnter.sentAfter, result.imeEnter.sentBefore, `${name}: composition Enter sent a message`)
      assert.equal(result.enter.delivered, true, `${name}: Enter did not deliver to the real session timeline`)
      assert.equal(result.enter.value, '', `${name}: successful send did not clear the draft`)
    }
    assert.equal(result.sinks, 1, `${name}: active TimelineChat did not own exactly one focus sink`)
    assert.equal(result.initialFocus, name === 'desktop', `${name}: viewport focus policy regressed`)
    if (result.composerPress.available) {
      assert.equal(result.composerPress.highlighted, false, `${name}: composer press kept the timeline selection`)
      assert.equal(result.composerPress.focused, true, `${name}: composer press lost textarea focus`)
    }
    return result
  } finally {
    await context.close()
    await video.saveAs(`${out}/${name}.webm`)
    writeFileSync(`${out}/${name}.timeline.json`, `${JSON.stringify({ v: 2, axis: 'time', events }, null, 2)}\n`)
  }
}

try {
  results.push(await runViewport('desktop', { width: 1280, height: 800 }))
  results.push(await runViewport('mobile', { width: 390, height: 844 }))
  writeFileSync(`${out}/results.json`, `${JSON.stringify(results, null, 2)}\n`)
  console.log(JSON.stringify(results, null, 2))
} catch (error) {
  writeFileSync(`${out}/results.json`, `${JSON.stringify({ results, error: error.stack }, null, 2)}\n`)
  throw error
} finally {
  await browser.close()
}
