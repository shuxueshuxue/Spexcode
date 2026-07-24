import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE_URL || 'http://127.0.0.1:5198'
const sessionId = process.env.SESSION_ID
const phase = (process.env.PHASE || 'A').toUpperCase()
const out = resolve(process.env.OUT || `/tmp/timeline-chat-${phase.toLowerCase()}`)
if (!sessionId) throw new Error('SESSION_ID=<real-headless-session-id> is required')
if (!['A', 'B'].includes(phase)) throw new Error('PHASE must be A or B')
mkdirSync(out, { recursive: true })

const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 900 } },
  permissions: ['clipboard-read', 'clipboard-write'],
})
const page = await context.newPage()
const started = Date.now()
const events = [{
  atMs: 0,
  kind: 'narrate',
  label: '▶ timeline-interaction-refresh-stability · TimelineChat keeps focus, drafts, and text selection through refreshes',
}]
const results = []
const mark = (viewport, step) => events.push({
  atMs: Date.now() - started,
  kind: 'frame',
  label: `📷 ${viewport}: ${step}`,
})

async function sendBackground(text) {
  const response = await fetch(`${base}/api/sessions/${sessionId}/input`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'text', text, replyVia: 'note' }),
  })
  if (!response.ok) throw new Error(`background send failed: ${response.status} ${await response.text()}`)
}

async function waitForActionable() {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const graph = await fetch(`${base}/api/graph`).then((response) => response.json())
    const session = graph.sessions?.find((candidate) => candidate.id === sessionId)
    if (session && ['asking', 'review', 'done', 'parked', 'error'].includes(session.status)) return session.status
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000))
  }
  throw new Error('headless fixture did not return to an actionable state')
}

async function installReadout(viewport) {
  await page.evaluate(({ phaseName, viewportName }) => {
    const readout = document.createElement('pre')
    readout.id = 'timeline-interaction-readout'
    Object.assign(readout.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '2147483647', margin: '0',
      maxWidth: 'calc(100vw - 16px)', whiteSpace: 'pre-wrap', pointerEvents: 'none',
      padding: '8px 10px', border: '2px solid #b58900', borderRadius: '4px',
      background: 'rgba(0, 43, 54, .94)', color: '#fdf6e3', font: '12px/1.35 monospace',
    })
    readout.textContent = `${phaseName} · ${viewportName}\nwaiting for browser interaction…`
    document.body.append(readout)
  }, { phaseName: phase, viewportName: viewport })
}

async function showReadout(viewport, step, snapshot) {
  await page.evaluate(({ phaseName, viewportName, currentStep, current }) => {
    const readout = document.querySelector('#timeline-interaction-readout')
    if (!readout) return
    const pass = current.pass == null ? 'RUN' : current.pass ? 'PASS' : 'FAIL'
    readout.style.borderColor = pass === 'FAIL' ? '#dc322f' : pass === 'PASS' ? '#859900' : '#b58900'
    readout.textContent = [
      `${phaseName} · ${viewportName} · ${currentStep} · ${pass}`,
      `focus=${current.focus ?? '-'} connected=${current.connected ?? '-'}`,
      `draft=${JSON.stringify(current.draft ?? '')}`,
      `selection=${JSON.stringify(current.selection ?? '')}`,
    ].join('\n')
  }, { phaseName: phase, viewportName: viewport, currentStep: step, current: snapshot })
}

async function readInteraction(inputHandle, draft) {
  return page.evaluate(({ input, expectedDraft }) => ({
    connected: input.isConnected,
    focus: document.activeElement === input,
    draft: input.value,
    draftKept: input.value === expectedDraft,
    selection: getSelection()?.toString() || '',
  }), { input: inputHandle, expectedDraft: draft })
}

async function waitForTimelineToken(viewport, token, sample) {
  const deadline = Date.now() + 20_000
  const readings = []
  while (Date.now() < deadline) {
    const reading = await sample()
    readings.push(reading)
    await showReadout(viewport, 'background refresh', reading)
    if ((await page.locator('.m-timeline').innerText()).includes(token)) return readings
    await page.waitForTimeout(400)
  }
  throw new Error(`timeline did not render background token ${token}`)
}

async function dragSelectNote() {
  const note = page.locator('.m-ev-note').last()
  await note.scrollIntoViewIfNeeded()
  const box = await note.boundingBox()
  if (!box) throw new Error('visible note has no bounding box')
  const start = { x: box.x + 10, y: box.y + Math.min(12, box.height / 3) }
  const end = {
    x: box.x + Math.min(box.width - 10, 300),
    y: box.y + Math.min(box.height - 5, 34),
  }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 18 })
  await page.mouse.up()
  return page.evaluate(() => getSelection()?.toString() || '')
}

async function runViewport(name, viewport) {
  await waitForActionable()
  await page.setViewportSize(viewport)
  await page.goto(`${base}/#/sessions/${encodeURIComponent(sessionId)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.m-ev-note').last().waitFor({ state: 'visible', timeout: 30_000 })
  await installReadout(name)
  mark(name, 'open real headless TimelineChat')

  const input = page.locator('.m-input:visible')
  const draft = `${phase}-${name} draft survives every background refresh`
  await input.click()
  await input.pressSequentially(draft, { delay: 28 })
  const inputHandle = await input.elementHandle()
  assert.ok(inputHandle)
  await showReadout(name, 'draft ready', await readInteraction(inputHandle, draft))
  mark(name, 'type unsent draft')

  const focusToken = `FOCUS-${phase}-${name}-${Date.now()}`
  await sendBackground(`${focusToken}: reply immediately with a short complete note and remain available.`)
  const focusReadings = await waitForTimelineToken(name, focusToken, () => readInteraction(inputHandle, draft))
  const finalFocus = await readInteraction(inputHandle, draft)
  const focusPass = [...focusReadings, finalFocus]
    .every((reading) => reading.connected && reading.focus && reading.draftKept)
  await showReadout(name, 'focus + draft after refresh', { ...finalFocus, pass: focusPass })
  mark(name, `focus and draft after real refresh (${focusPass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(1_200)

  await waitForActionable()
  await page.waitForFunction(() => document.querySelectorAll('.m-ev-note').length > 0)
  const selectedBefore = await dragSelectNote()
  await showReadout(name, 'pointer drag selection', { ...await readInteraction(inputHandle, draft), selection: selectedBefore, pass: selectedBefore.length > 0 })
  mark(name, `drag select rendered note (${selectedBefore.length} chars)`)

  const selectionToken = `SELECT-${phase}-${name}-${Date.now()}`
  await sendBackground(`${selectionToken}: reply immediately with another short complete note and remain available.`)
  const selectionReadings = await waitForTimelineToken(name, selectionToken, async () => ({
    ...await readInteraction(inputHandle, draft),
    selection: await page.evaluate(() => getSelection()?.toString() || ''),
  }))
  const selectedAfter = await page.evaluate(() => getSelection()?.toString() || '')
  const selectionPass = selectedBefore.length > 0
    && selectionReadings.every((reading) => reading.selection === selectedBefore)
    && selectedAfter === selectedBefore
  await showReadout(name, 'selection after refresh', {
    ...await readInteraction(inputHandle, draft), selection: selectedAfter, pass: selectionPass,
  })
  mark(name, `selection after real refresh (${selectionPass ? 'pass' : 'fail'}, ${selectedAfter.length} chars)`)
  await page.waitForTimeout(1_200)

  const note = page.locator('.m-ev-note').last()
  await note.dblclick({ position: { x: 40, y: 12 } })
  const doubleClickSelection = await page.evaluate(() => getSelection()?.toString() || '')
  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  const copyPass = doubleClickSelection.length > 0 && copied === doubleClickSelection
  await showReadout(name, 'double-click + copy', {
    ...await readInteraction(inputHandle, draft), selection: doubleClickSelection, pass: copyPass,
  })
  mark(name, `double-click and copy selected text (${copyPass ? 'pass' : 'fail'})`)
  await page.waitForTimeout(1_600)

  const result = { viewport: name, focusPass, selectionPass, copyPass, selectedBefore, selectedAfter, copied }
  results.push(result)
  return result
}

try {
  await runViewport('desktop', { width: 1280, height: 800 })
  await runViewport('mobile', { width: 390, height: 844 })
  if (phase === 'A') {
    assert.ok(results.some((result) => !result.focusPass || !result.selectionPass || !result.copyPass),
      `phase A unexpectedly passed: ${JSON.stringify(results)}`)
  } else {
    for (const result of results) {
      assert.equal(result.focusPass, true, `${result.viewport} focus/draft failed`)
      assert.equal(result.selectionPass, true, `${result.viewport} selection refresh failed`)
      assert.equal(result.copyPass, true, `${result.viewport} copy failed`)
    }
  }
  const summaryPath = join(out, `timeline-chat-${phase.toLowerCase()}.json`)
  const timelinePath = join(out, `timeline-chat-${phase.toLowerCase()}.timeline.json`)
  writeFileSync(summaryPath, `${JSON.stringify({ phase, results }, null, 2)}\n`)
  writeFileSync(timelinePath, `${JSON.stringify({ events }, null, 2)}\n`)
  const video = page.video()
  await context.close()
  console.log(JSON.stringify({ ok: true, phase, results, video: await video.path(), timeline: timelinePath, summary: summaryPath }, null, 2))
} finally {
  if (context.pages().length) await context.close().catch(() => {})
  await browser.close()
}
