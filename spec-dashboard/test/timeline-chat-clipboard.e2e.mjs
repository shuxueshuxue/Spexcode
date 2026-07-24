import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5199'
const sessionId = process.env.SESSION_ID
const secondSessionId = process.env.SECOND_SESSION_ID
if (!sessionId) throw new Error('SESSION_ID=<real-headless-session-id> is required')
if (!secondSessionId) throw new Error('SECOND_SESSION_ID=<second-real-headless-session-id> is required')

const NOTE = 'Clipboard seam exact fixture text'
const DRAFT = 'draft stays intact'
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })

const timeline = {
  events: [{
    ts: '2026-07-24T00:00:00.000Z', kind: 'status', status: 'asking', proposal: null,
    note: NOTE, display: 'asking',
  }],
}

async function makePage({ api = 'absent', fallback = 'success', customHighlight = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(({ apiMode, fallbackMode, keepHighlight }) => {
    window.__copyProbe = { apiCalls: 0, execCalls: 0, apiText: null, fallbackText: null }
    if (!keepHighlight) Object.defineProperty(window, 'Highlight', { configurable: true, value: undefined })
    const clipboard = apiMode === 'absent' ? undefined : {
      writeText(text) {
        window.__copyProbe.apiCalls += 1
        window.__copyProbe.apiText = text
        if (apiMode === 'success') return Promise.resolve()
        if (apiMode === 'reject') return Promise.reject(new Error('clipboard denied'))
        throw new Error('clipboard threw')
      },
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard })
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value(command) {
        if (command !== 'copy') return false
        window.__copyProbe.execCalls += 1
        if (fallbackMode === 'throw') throw new Error('copy command threw')
        if (fallbackMode === 'unconfirmed') return true
        const data = new DataTransfer()
        const event = new Event('copy', { bubbles: true, cancelable: true })
        Object.defineProperty(event, 'clipboardData', { value: data })
        document.dispatchEvent(event)
        window.__copyProbe.fallbackText = data.getData('text/plain')
        return fallbackMode !== 'false'
      },
    })
  }, { apiMode: api, fallbackMode: fallback, keepHighlight: customHighlight })
  await page.route('**/api/sessions/*/timeline', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(timeline),
  }))
  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.m-ev-note:visible').waitFor({ state: 'visible', timeout: 30_000 })
  return page
}

async function setComposer(page, start = 5, end = start) {
  const input = page.locator('.m-input:visible')
  await input.evaluate((element, { value, selectionStart, selectionEnd }) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.focus()
    element.setSelectionRange(selectionStart, selectionEnd)
  }, { value: DRAFT, selectionStart: start, selectionEnd: end })
  return input
}

async function selectTimelineWord(page) {
  await page.locator('.m-ev-note:visible').dblclick({ position: { x: 42, y: 14 } })
  const selected = await page.evaluate(() => {
    const highlight = CSS.highlights?.get('timeline-sel')
    return highlight ? [...highlight][0]?.toString() || '' : ''
  })
  assert.ok(selected.length > 0, 'fixture did not create a custom timeline Range')
  return selected
}

async function state(page) {
  return page.evaluate(() => {
    const input = document.activeElement?.classList.contains('m-input') ? document.activeElement : null
    const highlight = CSS.highlights?.get('timeline-sel')
    const range = highlight ? [...highlight][0] : null
    return {
      probe: { ...window.__copyProbe },
      status: document.querySelector('.m-copy-status')?.textContent || '',
      failed: document.querySelector('.m-copy-status')?.classList.contains('failed') || false,
      active: !!input,
      draft: input?.value || '',
      caret: input ? [input.selectionStart, input.selectionEnd] : null,
      highlight: range?.toString() || '',
      nativeSelection: getSelection()?.toString() || '',
      sinks: document.querySelectorAll('.m-input[data-focus-sink]').length,
    }
  })
}

async function runShortcutCase(name, config, expected) {
  const page = await makePage(config)
  try {
    await setComposer(page)
    const selected = await selectTimelineWord(page)
    await page.keyboard.press('Control+c')
    await page.locator('.m-copy-status').waitFor({ state: 'visible' })
    const result = await state(page)
    assert.equal(result.probe.apiCalls, expected.apiCalls, `${name}: Clipboard API calls`)
    assert.equal(result.probe.execCalls, expected.execCalls, `${name}: fallback calls`)
    assert.equal(result.probe.apiText, expected.apiCalls ? selected : null, `${name}: API payload`)
    assert.equal(result.probe.fallbackText, expected.fallbackText ? selected : null, `${name}: fallback payload`)
    assert.equal(result.failed, expected.failed, `${name}: failure state`)
    assert.equal(result.active, true, `${name}: composer focus changed`)
    assert.equal(result.draft, DRAFT, `${name}: draft changed`)
    assert.deepEqual(result.caret, [5, 5], `${name}: caret changed`)
    assert.equal(result.highlight, selected, `${name}: custom Range changed`)
    assert.equal(result.nativeSelection, '', `${name}: document Selection was created`)
    return { name, selected, ...result }
  } finally {
    await page.close()
  }
}

const results = []
try {
  results.push(await runShortcutCase('api success', { api: 'success' }, {
    apiCalls: 1, execCalls: 0, fallbackText: false, failed: false,
  }))
  results.push(await runShortcutCase('api reject to fallback', { api: 'reject', fallback: 'success' }, {
    apiCalls: 1, execCalls: 1, fallbackText: true, failed: false,
  }))
  results.push(await runShortcutCase('clipboard absent to fallback', { api: 'absent', fallback: 'success' }, {
    apiCalls: 0, execCalls: 1, fallbackText: true, failed: false,
  }))
  results.push(await runShortcutCase('fallback false', { api: 'absent', fallback: 'false' }, {
    apiCalls: 0, execCalls: 1, fallbackText: true, failed: true,
  }))
  results.push(await runShortcutCase('fallback throw', { api: 'absent', fallback: 'throw' }, {
    apiCalls: 0, execCalls: 1, fallbackText: false, failed: true,
  }))
  results.push(await runShortcutCase('copy event unconfirmed', { api: 'absent', fallback: 'unconfirmed' }, {
    apiCalls: 0, execCalls: 1, fallbackText: false, failed: true,
  }))

  const ownSelectionPage = await makePage({ api: 'success' })
  try {
    await setComposer(ownSelectionPage)
    const selected = await selectTimelineWord(ownSelectionPage)
    await setComposer(ownSelectionPage, 0, 5)
    await ownSelectionPage.keyboard.press('Control+c')
    const ownSelection = await state(ownSelectionPage)
    assert.equal(ownSelection.probe.apiCalls, 0, 'composer native selection did not win')
    assert.equal(ownSelection.probe.execCalls, 0, 'composer native selection reached fallback')
    assert.deepEqual(ownSelection.caret, [0, 5], 'composer native selection changed')
    assert.equal(ownSelection.highlight, selected, 'native composer copy cleared timeline highlight')
    results.push({ name: 'composer native selection wins', ...ownSelection })
  } finally {
    await ownSelectionPage.close()
  }

  const buttonPage = await makePage({ api: 'reject', fallback: 'success', customHighlight: false })
  try {
    await setComposer(buttonPage)
    await buttonPage.locator('.m-copy-note:visible').click()
    await buttonPage.locator('.m-copy-status').waitFor({ state: 'visible' })
    const button = await state(buttonPage)
    assert.equal(button.probe.apiCalls, 1, 'copy button skipped the Clipboard API seam')
    assert.equal(button.probe.execCalls, 1, 'copy button skipped the fallback seam')
    assert.equal(button.probe.apiText, NOTE, 'copy button API payload')
    assert.equal(button.probe.fallbackText, NOTE, 'copy button fallback payload')
    assert.equal(button.failed, false, 'copy button reported failure after confirmed fallback')
    assert.equal(button.active, true, 'copy button moved composer focus')
    assert.equal(button.nativeSelection, '', 'copy button created a document Selection')
    results.push({ name: 'button uses shared seam', ...button })
  } finally {
    await buttonPage.close()
  }

  const cleanupPage = await makePage({ api: 'success' })
  try {
    const cleanupInput = await setComposer(cleanupPage)
    await selectTimelineWord(cleanupPage)
    await cleanupPage.keyboard.press('Escape')
    const escaped = await state(cleanupPage)
    assert.equal(escaped.highlight, '', 'Escape did not clear timeline highlight')
    assert.equal(escaped.active, true, 'Escape moved composer focus')
    assert.equal(escaped.draft, DRAFT, 'Escape changed the draft')

    await selectTimelineWord(cleanupPage)
    await cleanupPage.keyboard.type('X')
    const edited = await state(cleanupPage)
    assert.equal(edited.highlight, '', 'typing did not clear timeline highlight')
    assert.equal(edited.draft, `${DRAFT.slice(0, 5)}X${DRAFT.slice(5)}`, 'typing missed the saved caret')
    assert.equal(edited.active, true, 'typing moved composer focus')

    await selectTimelineWord(cleanupPage)
    await cleanupPage.goto(`${base}/#/sessions/${encodeURIComponent(secondSessionId)}`)
    await cleanupPage.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
    await cleanupPage.locator('.m-input:visible').click()
    const hidden = await state(cleanupPage)
    assert.equal(hidden.highlight, '', 'hidden TimelineChat retained the global highlight')
    assert.equal(hidden.sinks, 1, 'hidden TimelineChat retained a focus sink')
    assert.ok(await cleanupPage.locator('.si-term-layer .m-input').count() >= 2, 'second TimelineChat did not stay warm')
    await cleanupPage.keyboard.press('Control+c')
    assert.equal((await state(cleanupPage)).probe.apiCalls, 0, 'hidden TimelineChat handled the copy chord')
    results.push({ name: 'Escape, edit, and hidden cleanup', escaped, edited, hidden })
    assert.ok(await cleanupInput.count(), 'original composer was unexpectedly destroyed')
  } finally {
    await cleanupPage.close()
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2))
} finally {
  await browser.close()
}
