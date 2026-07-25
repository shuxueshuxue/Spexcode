import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// DOM 可以当“我点对了吗”的证人，永远不能当“用户拿到什么”的答案。两层不共享 oracle，就不会形成自证闭环。
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5198'
const sessionId = process.env.SESSION_ID
const secondSessionId = process.env.SECOND_SESSION_ID
const out = resolve(process.env.OUT || '/tmp/timeline-chat-interaction')
if (!sessionId) throw new Error('SESSION_ID=<real-headless-session-id> is required')
if (!secondSessionId) throw new Error('SECOND_SESSION_ID=<second-real-headless-session-id> is required')
mkdirSync(out, { recursive: true })

const FIXTURE_MARKDOWN = 'Stable semantic fixture starts with several words before `inline code`, visits [the gate link](https://example.com), and copies math $E = mc^2$ exactly once.'
const FIXTURE_COPY = 'Stable semantic fixture starts with several words before inline code, visits the gate link, and copies math E = mc^2 exactly once.\n'
const FIXTURE_MARKER = 'Stable semantic fixture starts with several words'
const FIXTURE_FORMULA = 'E = mc^2'

const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 900 } },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
const started = Date.now()
const events = [{ at: 0, step: 'start TimelineChat interaction run' }]
const results = []
const mark = (viewport, step) => {
  const focusVerdict = step.match(/^gesture focus .+ \((pass|fail)\)$/)?.[1]
  events.push({
    at: Date.now() - started,
    step: `${viewport}: ${focusVerdict ? `gesture focus samples (${focusVerdict})` : step}`,
  })
}

const timelinePath = (id) => `/api/sessions/${id}/timeline`

const isTimelineResponse = (response, id) => {
  const path = new URL(response.url()).pathname
  return response.request().method() === 'GET' && path === timelinePath(id)
}

async function waitForParkedFixtures() {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const graph = await fetch(`${base}/api/graph`).then((response) => response.json())
    const primary = graph.sessions?.find((candidate) => candidate.id === sessionId)
    const secondary = graph.sessions?.find((candidate) => candidate.id === secondSessionId)
    if (primary?.capabilities?.headless && primary.status === 'parked'
      && secondary?.capabilities?.headless && secondary.status === 'parked') {
      const timeline = await fetch(`${base}${timelinePath(sessionId)}`).then((response) => response.json())
      if (timeline.events?.some((event) => event.kind === 'status' && event.note === FIXTURE_MARKDOWN)) return
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }
  throw new Error('fixtures must be parked headless sessions, and SESSION_ID must contain the exact rich note fixture')
}

async function openTimeline(id) {
  const timelineLoaded = page.waitForResponse((response) => isTimelineResponse(response, id), { timeout: 30_000 })
  await page.goto(`${base}/#/sessions/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' })
  const response = await timelineLoaded
  assert.equal(response.ok(), true, `initial timeline load failed: ${response.status()}`)
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  const rows = page.locator('.m-timeline:visible .m-ev')
  await rows.first().waitFor({ state: 'visible', timeout: 30_000 })
  assert.ok(await rows.count() > 0, 'timeline baseline was taken before real events hydrated')
}

async function installReadout(viewport) {
  await page.evaluate(({ viewportName }) => {
    const readout = document.createElement('pre')
    readout.id = 'timeline-interaction-readout'
    Object.assign(readout.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '2147483647', margin: '0',
      maxWidth: 'calc(100vw - 16px)', whiteSpace: 'pre-wrap', pointerEvents: 'none',
      padding: '8px 10px', border: '2px solid #b58900', borderRadius: '4px',
      background: 'rgba(0, 43, 54, .94)', color: '#fdf6e3', font: '12px/1.35 monospace',
    })
    readout.textContent = `${viewportName}\nwaiting for browser interaction…`
    document.body.append(readout)
  }, { viewportName: viewport })
}

async function showReadout(viewport, step, snapshot) {
  await page.evaluate(({ viewportName, currentStep, current }) => {
    const readout = document.querySelector('#timeline-interaction-readout')
    if (!readout) return
    const pass = current.pass == null ? 'RUN' : current.pass ? 'PASS' : 'FAIL'
    readout.style.borderColor = pass === 'FAIL' ? '#dc322f' : pass === 'PASS' ? '#859900' : '#b58900'
    readout.textContent = [
      `${viewportName} · ${currentStep} · ${pass}`,
      `focus=${current.focus ?? '-'} connected=${current.connected ?? '-'}`,
      `draft=${JSON.stringify(current.draft ?? '')}`,
      `selection=${JSON.stringify(current.selection ?? '')}`,
      `caret=${current.caret ?? '-'} typed=${current.typed ?? '-'} sinks=${current.sinks ?? '-'}`,
    ].join('\n')
  }, { viewportName: viewport, currentStep: step, current: snapshot })
}

async function readInteraction(inputHandle, draft) {
  return page.evaluate(({ input, expectedDraft }) => {
    const highlight = CSS.highlights?.get('timeline-sel')
    const range = highlight ? Array.from(highlight)[0] : null
    return {
      connected: input.isConnected,
      focus: document.activeElement === input,
      draft: input.value,
      draftKept: input.value === expectedDraft,
      selection: getSelection()?.toString() || '',
      highlight: !!range && !range.collapsed,
      highlightText: range?.toString() || '',
      highlights: CSS.highlights?.size || 0,
      caret: `${input.selectionStart}:${input.selectionEnd}`,
    }
  }, { input: inputHandle, expectedDraft: draft })
}

async function waitForTimelineRefresh(viewport, sample) {
  let settled = false
  const responsePromise = page.waitForResponse(
    (response) => isTimelineResponse(response, sessionId),
    { timeout: 15_000 },
  ).then((response) => {
    settled = true
    return response
  }, (error) => {
    settled = true
    throw error
  })
  const readings = []
  while (!settled) {
    const reading = await sample()
    readings.push(reading)
    await showReadout(viewport, 'timeline poll refresh', reading)
    await page.waitForTimeout(250)
  }
  const response = await responsePromise
  assert.equal(response.ok(), true, `timeline refresh failed: ${response.status()}`)
  readings.push(await sample())
  return readings
}

async function assertSameTarget(element, point, stage) {
  const identity = await page.evaluate(({ target, x, y }) => {
    const hit = document.elementFromPoint(x, y)
    return {
      connected: target.isConnected,
      same: !!hit && (hit === target || hit.closest('.m-ev-note, .m-ev-text') === target),
      hit: hit?.className || hit?.nodeName || null,
    }
  }, { target: element, x: point.x, y: point.y })
  assert.equal(identity.connected, true, `${stage}: fixture row was replaced`)
  assert.equal(identity.same, true, `${stage}: coordinate hit ${identity.hit}, not the fixture row`)
  return identity
}

async function dragSelectNote(inputHandle, note = page.locator('.m-ev-note:visible').last(), element = null) {
  await note.scrollIntoViewIfNeeded()
  const target = element || await note.elementHandle()
  if (!target) throw new Error('visible note has no element handle')
  const box = await note.boundingBox()
  if (!box) throw new Error('visible note has no bounding box')
  const start = { x: box.x + 10, y: box.y + Math.min(12, box.height / 3) }
  const end = {
    x: box.x + Math.min(box.width - 10, 300),
    y: box.y + Math.min(box.height - 5, 34),
  }
  await assertSameTarget(target, start, 'drag before mousedown')
  const focusSamples = []
  const sampleFocus = async (stage) => focusSamples.push(await page.evaluate(({ input, sampleStage }) => ({
    stage: sampleStage,
    focused: document.activeElement === input,
    activeElement: document.activeElement?.tagName || null,
  }), { input: inputHandle, sampleStage: stage }))
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await sampleFocus('mousedown')
  for (let step = 1; step <= 12; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 12,
      start.y + ((end.y - start.y) * step) / 12,
    )
    await sampleFocus(`mousemove-${step}`)
  }
  await page.mouse.up()
  await sampleFocus('mouseup')
  await assertSameTarget(target, end, 'drag after mouseup')
  return {
    start,
    end,
    selection: await page.evaluate(() => getSelection()?.toString() || ''),
    highlight: await page.evaluate(() => {
      const paint = CSS.highlights?.get('timeline-sel')
      const range = paint ? Array.from(paint)[0] : null
      return { exists: !!range && !range.collapsed, text: range?.toString() || '', size: CSS.highlights?.size || 0 }
    }),
    focusSamples,
    focusPass: focusSamples.every((sample) => sample.focused),
  }
}

async function readTimelineSelection(inputHandle) {
  return page.evaluate((input) => {
    const paint = CSS.highlights?.get('timeline-sel')
    const range = paint ? Array.from(paint)[0] : null
    const text = range?.toString() || ''
    const words = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)]
        .filter((segment) => segment.isWordLike).length
      : (text.match(/[\p{L}\p{M}\p{N}_]+/gu) || []).length
    return {
      text,
      words,
      highlight: !!range && !range.collapsed,
      native: getSelection()?.toString() || '',
      focus: document.activeElement === input,
    }
  }, inputHandle)
}

async function noteSelectionFixture(note, element) {
  await note.scrollIntoViewIfNeeded()
  return page.evaluate((target) => {
    const element = target
    // Reuse 2df6933a: rich prose is addressed by its first non-empty descendant Text, never firstChild.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node && !node.data.trim()) node = walker.nextNode()
    if (!node) throw new Error('note has no selectable text node')
    const segments = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(node.data)]
        .filter((segment) => segment.isWordLike)
      : [...node.data.matchAll(/[\p{L}\p{M}\p{N}_]+/gu)]
        .map((match) => ({ segment: match[0], index: match.index }))
    if (segments.length < 4) throw new Error(`note needs four words for WORD drag proof: ${node.data}`)

    const startWord = segments[0]
    const endWord = segments[Math.min(3, segments.length - 1)]
    const singleWord = segments[Math.min(1, segments.length - 1)]
    const pointIn = (segment, ratio = 0.5) => {
      const charIndex = segment.index + Math.min(
        segment.segment.length - 1,
        Math.max(0, Math.floor(segment.segment.length * ratio)),
      )
      const range = document.createRange()
      range.setStart(node, charIndex)
      range.setEnd(node, charIndex + 1)
      const rect = [...range.getClientRects()].find((candidate) => candidate.width && candidate.height)
      if (!rect) throw new Error(`word has no client rect: ${segment.segment}`)
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    const charStart = pointIn(startWord, 0.25)
    const charEnd = pointIn(endWord, 0.6)
    const startCaret = document.caretRangeFromPoint(charStart.x, charStart.y)
    const endCaret = document.caretRangeFromPoint(charEnd.x, charEnd.y)
    if (!startCaret || !endCaret) throw new Error('browser did not resolve character fixture points')
    const charRange = document.createRange()
    const forward = startCaret.compareBoundaryPoints(Range.START_TO_START, endCaret) <= 0
    const charRangeStart = forward ? startCaret : endCaret
    const charRangeEnd = forward ? endCaret : startCaret
    charRange.setStart(charRangeStart.startContainer, charRangeStart.startOffset)
    charRange.setEnd(charRangeEnd.startContainer, charRangeEnd.startOffset)
    const lineRange = document.createRange()
    lineRange.selectNodeContents(element)
    const nested = [...element.querySelectorAll('code, a, [data-math-source]')]
    return {
      charStart,
      charEnd,
      charExpected: charRange.toString(),
      wordStart: pointIn(startWord),
      wordEnd: pointIn(endWord),
      wordExpected: node.data.slice(startWord.index, endWord.index + endWord.segment.length),
      wordEndText: endWord.segment,
      singlePoint: pointIn(singleWord),
      singleExpected: singleWord.segment,
      linePoint: pointIn(segments[Math.min(2, segments.length - 1)]),
      lineExpected: lineRange.toString(),
      nestedCount: nested.length,
    }
  }, element)
}

async function moveDrag(start, end, clickCount = 1) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ clickCount })
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 10,
      start.y + ((end.y - start.y) * step) / 10,
    )
  }
  await page.mouse.up({ clickCount })
}

async function clickWithDetail(point, detail) {
  await page.mouse.click(point.x, point.y, { clickCount: detail })
}

async function verifySelectionModes(viewport, inputHandle, note, noteHandle) {
  const fixture = await noteSelectionFixture(note, noteHandle)
  assert.ok(fixture.nestedCount >= 3, `rich fixture lost inline code/link/math nesting: ${fixture.nestedCount}`)

  await assertSameTarget(noteHandle, fixture.charStart, 'NORMAL before drag')
  await moveDrag(fixture.charStart, fixture.charEnd)
  await assertSameTarget(noteHandle, fixture.charEnd, 'NORMAL after drag')
  const normal = await readTimelineSelection(inputHandle)
  normal.pass = normal.focus && normal.native === '' && normal.text === fixture.charExpected
    && normal.text.length > 1
  await showReadout(viewport, 'NORMAL character range', {
    focus: normal.focus, selection: normal.text, typed: `${normal.text.length} chars`, pass: normal.pass,
  })
  mark(viewport, `NORMAL exact character range (${normal.pass ? 'pass' : 'fail'}, ${normal.text.length} chars)`)
  await page.waitForTimeout(900)

  await assertSameTarget(noteHandle, fixture.singlePoint, 'WORD before stationary double-click')
  await clickWithDetail(fixture.singlePoint, 1)
  await clickWithDetail(fixture.singlePoint, 2)
  await assertSameTarget(noteHandle, fixture.singlePoint, 'WORD after stationary double-click')
  const word = await readTimelineSelection(inputHandle)
  word.pass = word.focus && word.native === '' && word.text === fixture.singleExpected && word.words === 1
  await showReadout(viewport, 'WORD stationary double-click', {
    focus: word.focus, selection: word.text, typed: `${word.words} word`, pass: word.pass,
  })
  mark(viewport, `WORD exact stationary word (${word.pass ? 'pass' : 'fail'}, ${word.words} word)`)
  await page.waitForTimeout(900)

  await assertSameTarget(noteHandle, fixture.wordStart, 'WORD before continuous drag')
  await clickWithDetail(fixture.wordStart, 1)
  await moveDrag(fixture.wordStart, fixture.wordEnd, 2)
  await assertSameTarget(noteHandle, fixture.wordEnd, 'WORD after continuous drag')
  const wordDrag = await readTimelineSelection(inputHandle)
  wordDrag.pass = wordDrag.focus && wordDrag.native === '' && wordDrag.text === fixture.wordExpected
    && wordDrag.words >= 4 && wordDrag.text !== fixture.wordEndText
  wordDrag.collapsedToLandingWord = wordDrag.text === fixture.wordEndText && wordDrag.words === 1
  await showReadout(viewport, 'WORD double-click then drag', {
    focus: wordDrag.focus, selection: wordDrag.text,
    typed: `${wordDrag.words} words`, pass: wordDrag.pass,
  })
  mark(viewport, `WORD continuous multi-word range (${wordDrag.pass ? 'pass' : 'fail'}, ${wordDrag.words} words)`)
  await page.waitForTimeout(1_200)

  await assertSameTarget(noteHandle, fixture.linePoint, 'LINE before triple-click')
  await clickWithDetail(fixture.linePoint, 1)
  await clickWithDetail(fixture.linePoint, 2)
  await clickWithDetail(fixture.linePoint, 3)
  await assertSameTarget(noteHandle, fixture.linePoint, 'LINE after triple-click')
  const line = await readTimelineSelection(inputHandle)
  line.nested = await page.evaluate((element) => {
    const paint = CSS.highlights?.get('timeline-sel')
    const range = paint ? Array.from(paint)[0] : null
    const descendants = [...element.querySelectorAll('code, a, [data-math-source]')]
    return { count: descendants.length, allIntersected: !!range && descendants.every((node) => range.intersectsNode(node)) }
  }, noteHandle)
  await page.keyboard.press('Control+c')
  line.copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  line.formulaOccurrences = line.copied.split(FIXTURE_FORMULA).length - 1
  line.copyPass = line.copied === FIXTURE_COPY && line.formulaOccurrences === 1
  line.pass = line.focus && line.native === '' && line.text === fixture.lineExpected
    && line.nested.count >= 3 && line.nested.allIntersected && line.copyPass
  await showReadout(viewport, 'LINE triple-click whole note', {
    focus: line.focus, selection: line.text,
    typed: `${line.text.length} chars · formula=${line.formulaOccurrences}`, pass: line.pass,
  })
  mark(viewport, `LINE exact whole note (${line.pass ? 'pass' : 'fail'}, ${line.text.length} chars)`)
  await page.waitForTimeout(1_000)

  await page.keyboard.press('Escape')
  const afterEscape = await readTimelineSelection(inputHandle)
  afterEscape.pass = afterEscape.focus && afterEscape.native === '' && !afterEscape.highlight && afterEscape.text === ''
  await showReadout(viewport, 'Escape clears custom highlight', {
    focus: afterEscape.focus, selection: afterEscape.text, typed: 'n/a', pass: afterEscape.pass,
  })
  mark(viewport, `Escape clears highlight only (${afterEscape.pass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(800)

  return {
    pass: normal.pass && word.pass && wordDrag.pass && line.pass && afterEscape.pass,
    fixture,
    normal,
    word,
    wordDrag,
    line,
    afterEscape,
  }
}

async function activeSinkCount() {
  return page.locator('.m-input[data-focus-sink]').count()
}

async function setComposerState(inputHandle, value, start = value.length, end = start) {
  await page.evaluate(({ input, nextValue, selectionStart, selectionEnd }) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(input, nextValue)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.focus()
    input.setSelectionRange(selectionStart, selectionEnd)
  }, { input: inputHandle, nextValue: value, selectionStart: start, selectionEnd: end })
}

const keyCases = [
  { name: 'Backspace', press: 'Backspace', value: 'abcef', caret: 3 },
  { name: 'Delete', press: 'Delete', value: 'abcdf', caret: 4 },
  { name: 'ArrowLeft', press: 'ArrowLeft', value: 'abcdef', caret: 3 },
  { name: 'ArrowRight', press: 'ArrowRight', value: 'abcdef', caret: 5 },
  { name: 'paste', press: 'Control+v', value: 'abcdPASTEDef', caret: 10, paste: true },
  { name: 'replace selection', press: 'X', start: 2, end: 4, value: 'abXef', caret: 3 },
  { name: 'printable', press: 'X', value: 'abcdXef', caret: 5 },
]

async function verifyEditingHandoff(viewport, inputHandle, note, noteHandle) {
  const cases = []
  for (const keyCase of keyCases) {
    const start = keyCase.start ?? 4
    const end = keyCase.end ?? start
    await setComposerState(inputHandle, 'abcdef', start, end)
    const drag = await dragSelectNote(inputHandle, note, noteHandle)
    const selected = drag.highlight.text || drag.selection
    const before = await page.evaluate((input) => ({
      focus: document.activeElement === input,
      caret: input.selectionStart,
      end: input.selectionEnd,
      selection: getSelection()?.toString() || '',
    }), inputHandle)
    if (keyCase.paste) await page.evaluate(() => navigator.clipboard.writeText('PASTED'))
    await page.keyboard.press(keyCase.press)
    const after = await page.evaluate((input) => ({
      focus: document.activeElement === input,
      value: input.value,
      caret: input.selectionStart,
      end: input.selectionEnd,
      selection: getSelection()?.toString() || '',
    }), inputHandle)
    const pass = drag.focusPass && selected.length > 0 && before.focus
      && after.focus && after.value === keyCase.value && after.caret === keyCase.caret
      && after.end === keyCase.caret && after.selection.length === 0
    cases.push({ key: keyCase.name, pass, composerSelection: { start, end }, dragFocusSamples: drag.focusSamples, before, after })
    await showReadout(viewport, `${keyCase.name} selection-to-composer handoff`, {
      focus: after.focus,
      draft: after.value,
      selection: selected,
      caret: `${before.caret}->${after.caret}`,
      typed: pass,
      pass,
    })
    mark(viewport, `${keyCase.name} native edit under custom highlight (${pass ? 'pass' : 'fail'})`)
    await page.waitForTimeout(650)
  }
  return { pass: cases.every((entry) => entry.pass), cases }
}

async function verifySecondConversationSink(viewport) {
  await openTimeline(secondSessionId)
  const input = page.locator('.m-input:visible')
  const notes = page.locator('.m-ev-note:visible')
  const note = await notes.count() ? notes.last() : page.locator('.m-ev-word:visible').last()
  await note.waitFor({ state: 'visible', timeout: 30_000 })
  const mounted = await page.locator('.si-term-layer .m-input').count()
  assert.ok(mounted >= 2, `expected two warm headless composers, got ${mounted}`)
  const inputHandle = await input.elementHandle()
  assert.ok(inputHandle)
  const draft = 'desktop second layer keeps the sole sink'
  await input.click()
  await input.pressSequentially(draft, { delay: 20 })
  const drag = await dragSelectNote(inputHandle, note)
  const selected = drag.highlight.text || drag.selection
  const beforeType = await readInteraction(inputHandle, draft)
  const sinks = await activeSinkCount()
  await page.keyboard.type('Z')
  const afterType = await input.inputValue()
  const afterFocus = await page.evaluate((inputElement) => document.activeElement === inputElement, inputHandle)
  const pass = sinks === 1 && drag.focusPass && beforeType.focus && selected.length > 0
    && afterFocus && afterType === `${draft}Z`
  await showReadout(viewport, 'second warm layer owns sink + typing', {
    ...beforeType, selection: selected, typed: afterType === `${draft}Z`, sinks, pass,
  })
  mark(viewport, `second warm layer exact sink (${pass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(1_400)
  return { pass, mounted, sinks, selected, dragFocusSamples: drag.focusSamples, afterType }
}

async function verifyDetailsToggle(viewport, inputHandle) {
  const summary = page.locator('.m-ev-prompt:visible > summary').first()
  if (!await summary.count()) return { pass: false, reason: 'prompt summary is missing' }
  const details = summary.locator('..')
  const before = await details.evaluate((element) => element.open)
  await summary.click()
  const after = await details.evaluate((element) => element.open)
  const focus = await page.evaluate((input) => document.activeElement === input, inputHandle)
  const pass = before !== after && focus
  await showReadout(viewport, 'details summary native toggle', {
    focus, draft: await page.locator('.m-input:visible').inputValue(), selection: '', typed: 'n/a', pass,
  })
  mark(viewport, `details summary toggle (${pass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(800)
  return { pass, before, after, focus }
}

async function verifyComposerPress(viewport, inputHandle) {
  const highlightBefore = await page.evaluate(() => {
    const paint = CSS.highlights?.get('timeline-sel')
    const range = paint ? Array.from(paint)[0] : null
    return range?.toString() || ''
  })
  const input = page.locator('.m-input:visible')
  const valueBefore = await input.inputValue()
  const box = await input.boundingBox()
  if (!box) return { pass: false, reason: 'composer has no bounding box' }
  await input.click({ position: { x: Math.max(8, box.width - 14), y: box.height / 2 } })
  const afterPress = await page.evaluate((inputElement) => ({
    focus: document.activeElement === inputElement,
    selection: getSelection()?.toString() || '',
    highlight: (() => {
      const paint = CSS.highlights?.get('timeline-sel')
      const range = paint ? Array.from(paint)[0] : null
      return range?.toString() || ''
    })(),
    caret: inputElement.selectionStart,
  }), inputHandle)
  await page.keyboard.type('R')
  const valueAfter = await input.inputValue()
  const expected = `${valueBefore.slice(0, afterPress.caret)}R${valueBefore.slice(afterPress.caret)}`
  const pass = highlightBefore.length > 0 && afterPress.focus && afterPress.selection.length === 0
    && afterPress.highlight.length === 0
    && valueAfter === expected
  await showReadout(viewport, 'composer press retires external selection', {
    focus: afterPress.focus, draft: valueAfter, selection: afterPress.selection,
    caret: afterPress.caret, typed: valueAfter === expected, pass,
  })
  mark(viewport, `composer press + native caret (${pass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(800)
  return { pass, highlightBefore, afterPress, valueBefore, valueAfter, expected }
}

async function runViewport(name, viewport) {
  await page.setViewportSize(viewport)
  await openTimeline(sessionId)
  const note = page.locator('.m-ev-note:visible').filter({ hasText: FIXTURE_MARKER }).last()
  await note.waitFor({ state: 'visible', timeout: 30_000 })
  const noteHandle = await note.elementHandle()
  assert.ok(noteHandle, 'rich fixture note has no stable element handle')
  await installReadout(name)
  mark(name, 'open hydrated parked TimelineChat fixture')

  const input = page.locator('.m-input:visible')
  const draft = `${name} draft survives the timeline poll`
  await input.click()
  await input.pressSequentially(draft, { delay: 28 })
  const inputHandle = await input.elementHandle()
  assert.ok(inputHandle)
  await showReadout(name, 'draft ready', await readInteraction(inputHandle, draft))
  mark(name, 'type unsent draft')

  const firstDrag = await dragSelectNote(inputHandle, note, noteHandle)
  const selectedBefore = firstDrag.highlight.text || firstDrag.selection
  const afterDrag = await readInteraction(inputHandle, draft)
  const gestureFocusPass = firstDrag.focusPass
  const dragPass = gestureFocusPass && selectedBefore.length > 0 && afterDrag.focus && afterDrag.draftKept
  await showReadout(name, 'pointer drag keeps the exact composer focused', {
    ...afterDrag, selection: selectedBefore, typed: 'not yet', pass: dragPass,
  })
  mark(name, `gesture focus ${firstDrag.focusSamples.map((sample) => `${sample.stage}:${sample.activeElement}`).join(' · ')} (${gestureFocusPass ? 'pass' : 'fail'})`)
  mark(name, `drag selection + exact composer focus (${dragPass ? 'pass' : 'fail'})`)

  const selectionReadings = await waitForTimelineRefresh(name, async () => ({
    ...await readInteraction(inputHandle, draft),
    selection: await page.evaluate(() => getSelection()?.toString() || ''),
    highlight: await page.evaluate(() => {
      const paint = CSS.highlights?.get('timeline-sel')
      const range = paint ? Array.from(paint)[0] : null
      return range?.toString() || ''
    }),
  }))
  await assertSameTarget(noteHandle, firstDrag.end, 'fixture row after timeline refresh')
  const selectedAfter = await page.evaluate(() => {
    const paint = CSS.highlights?.get('timeline-sel')
    const range = paint ? Array.from(paint)[0] : null
    return range?.toString() || ''
  })
  const selectionPass = selectedBefore.length > 0
    && selectionReadings.every((reading) => reading.selection === '')
    && selectionReadings.every((reading) => reading.highlight === selectedBefore)
    && selectedAfter === selectedBefore
    && selectionReadings.every((reading) => reading.focus && reading.draftKept)
    && selectionReadings.every((reading) => reading.connected)
  await showReadout(name, 'selection after refresh', {
    ...await readInteraction(inputHandle, draft), selection: selectedAfter, pass: selectionPass,
  })
  mark(name, `custom highlight + composer focus after real refresh (${selectionPass ? 'pass' : 'fail'}, ${selectedAfter.length} chars)`)
  await page.waitForTimeout(1_200)

  const keyMatrix = await verifyEditingHandoff(name, inputHandle, note, noteHandle)
  const typedDraft = keyCases.at(-1).value

  const selectionModes = await verifySelectionModes(name, inputHandle, note, noteHandle)

  await assertSameTarget(noteHandle, selectionModes.fixture.singlePoint, 'plain click before action')
  await clickWithDetail(selectionModes.fixture.singlePoint, 1)
  await assertSameTarget(noteHandle, selectionModes.fixture.singlePoint, 'plain click after action')
  const afterClick = await readInteraction(inputHandle, typedDraft)
  const clickSelection = await page.evaluate(() => getSelection()?.toString() || '')
  await page.keyboard.type('Q')
  const clickDraft = 'abcdXQef'
  const clickTypingPass = await input.inputValue() === clickDraft
  const clickPass = afterClick.focus && clickSelection.length === 0
    && !afterClick.highlight && afterClick.highlightText === '' && clickTypingPass
  await showReadout(name, 'plain click returns composer', {
    ...afterClick, selection: clickSelection, typed: clickTypingPass, pass: clickPass,
  })
  mark(name, `plain click + next key enters draft (${clickPass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(1_000)

  await assertSameTarget(noteHandle, selectionModes.fixture.singlePoint, 'composer press setup before WORD')
  await clickWithDetail(selectionModes.fixture.singlePoint, 1)
  await clickWithDetail(selectionModes.fixture.singlePoint, 2)
  await assertSameTarget(noteHandle, selectionModes.fixture.singlePoint, 'composer press setup after WORD')
  const wordBeforeComposer = await readTimelineSelection(inputHandle)
  assert.equal(wordBeforeComposer.text, selectionModes.fixture.singleExpected,
    `${name}: composer-press setup missed its stable WORD target`)

  const composerPress = await verifyComposerPress(name, inputHandle)
  const detailsToggle = await verifyDetailsToggle(name, inputHandle)
  const secondSink = name === 'desktop' ? await verifySecondConversationSink(name) : null
  const result = {
    viewport: name, gestureFocusPass, gestureFocusSamples: firstDrag.focusSamples,
    dragPass, selectionPass, keyMatrix, selectionModes, clickPass, composerPress, detailsToggle,
    secondSink, selectedBefore, selectedAfter, nativeSelectionBefore: firstDrag.selection,
    highlightBefore: firstDrag.highlight,
  }
  results.push(result)
  return result
}

try {
  await waitForParkedFixtures()
  await runViewport('desktop', { width: 1280, height: 800 })
  await runViewport('mobile', { width: 390, height: 844 })
  console.log(JSON.stringify({ results }, null, 2))
  for (const result of results) {
    assert.equal(result.gestureFocusPass, true, `${result.viewport} composer lost focus during pointer gesture`)
    assert.equal(result.dragPass, true, `${result.viewport} drag did not keep the exact composer focused`)
    assert.equal(result.selectionPass, true, `${result.viewport} selection refresh failed`)
    assert.equal(result.nativeSelectionBefore, '', `${result.viewport} created a native document Selection`)
    assert.equal(result.highlightBefore.exists, true, `${result.viewport} did not create a CSS highlight`)
    assert.equal(result.keyMatrix.pass, true, `${result.viewport} selection-to-composer key matrix failed`)
    assert.equal(result.selectionModes.pass, true, `${result.viewport} xterm selection mode matrix failed`)
    assert.equal(result.selectionModes.wordDrag.collapsedToLandingWord, false,
      `${result.viewport} late dblclick collapsed the continuing WORD drag to its landing word`)
    assert.equal(result.selectionModes.line.copied, FIXTURE_COPY,
      `${result.viewport} clipboard differed from the authored fixture literal`)
    assert.equal(result.selectionModes.line.formulaOccurrences, 1,
      `${result.viewport} copied formula did not occur exactly once`)
    assert.equal(result.clickPass, true, `${result.viewport} plain click did not return composer typing`)
    assert.equal(result.composerPress.pass, true, `${result.viewport} composer press did not retire the external selection`)
    assert.equal(result.detailsToggle.pass, true, `${result.viewport} details summary did not toggle natively`)
    if (result.secondSink) assert.equal(result.secondSink.pass, true, 'second warm headless layer did not own the exact sink')
  }
  const summaryPath = join(out, 'timeline-chat-interaction.json')
  const timelineOutputPath = join(out, 'timeline-chat-interaction.timeline.json')
  writeFileSync(summaryPath, `${JSON.stringify({ results }, null, 2)}\n`)
  writeFileSync(timelineOutputPath, `${JSON.stringify({ v: 2, axis: 'time', events }, null, 2)}\n`)
  const video = page.video()
  await context.close()
  console.log(JSON.stringify({ ok: true, results, video: await video.path(), timeline: timelineOutputPath, summary: summaryPath }, null, 2))
} finally {
  if (context.pages().length) await context.close().catch(() => {})
  await browser.close()
}
