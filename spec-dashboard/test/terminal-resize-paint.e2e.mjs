// [[live-view]] YATU: a real xterm canvas must paint the native resize transaction.
// The WebSocket timeline proves transport ordering; screenshot pixels are the paint oracle.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:5179'
const TMUX_SOCKET = process.env.SPEXCODE_TMUX || 'spexcode'
const OUT = resolve(process.env.OUT || '/tmp/terminal-resize-paint-e2e')
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const scratch = `resize-paint-${process.pid}-${Date.now()}`
const scratchDir = mkdtempSync(join(tmpdir(), 'resize-paint-'))
const program = join(scratchDir, 'busy-resize.mjs')
mkdirSync(OUT, { recursive: true })

const tmux = (...args) => spawnSync('tmux', ['-L', TMUX_SOCKET, ...args], { encoding: 'utf8' })
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))
const waitUntil = async (read, accept, label, timeout = 10_000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    assert.ok(Date.now() < deadline, `timed out waiting for ${label}`)
    await wait(25)
  }
}

const PROGRAM = String.raw`
const W = process.stdout
let tick = 0
const swatch = (rgb) => '\x1b[48;2;' + rgb.join(';') + 'm\x1b[38;2;0;0;0m'
const row = (label, color, cols) => swatch(color) + (label + ' '.repeat(cols)).slice(0, cols - 1) + '\x1b[0m'
const draw = (label, color) => {
  const cols = W.columns || 96, rows = W.rows || 30
  W.write('\x1b[?2026h\x1b[2J\x1b[H' + Array.from({ length: Math.max(1, rows - 1) }, () => row(label, color, cols)).join('\r\n') + '\x1b[?2026l')
}
draw('READY-OLD-GRID', [244, 0, 220])
setInterval(() => W.write('\x1b[?2026h\x1b[HSPINNER-TICK-' + (++tick) + '\x1b[?2026l'), 45)
process.on('SIGWINCH', () => {
  W.write('\x1b[?2026h\x1b[HRESIZE-PAIRED-PRELUDE\x1b[?2026l')
  W.write('\x1b[2J\x1b[HRESIZE-UNPAIRED-CLEAR')
  setTimeout(() => draw('FINAL-SYNCHRONIZED-GRID', [0, 220, 32]), 120)
  setTimeout(() => W.write('\x1b[H' + row('POST-BOUNDARY-LIVE-TAIL', [0, 180, 255], W.columns || 96)), 650)
})
setInterval(() => {}, 1 << 30)
`

const swatches = async (page, screenshot) => page.evaluate(async (base64) => {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0)
  const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
  const counts = { old: 0, final: 0, tail: 0 }
  for (let i = 0; i < pixels.length; i += 4) {
    const [red, green, blue, alpha] = pixels.subarray(i, i + 4)
    if (alpha < 250) continue
    if (red > 200 && green < 70 && blue > 160) counts.old++
    if (red < 70 && green > 150 && blue < 100) counts.final++
    if (red < 70 && green > 110 && blue > 170) counts.tail++
  }
  return counts
}, screenshot.toString('base64'))

let browser
let context
let runError = null
const started = Date.now()
const at = () => Date.now() - started
const events = []
const step = (name) => events.push({ at: at(), step: name })
const received = []
const sent = []

function wireSocket(socket) {
  const capture = (direction, event) => {
    const payload = event.payload
    const text = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8')
    const row = { at: at(), direction, bytes: Buffer.byteLength(text), text: text.slice(0, 300) }
    ;(direction === 'received' ? received : sent).push(row)
  }
  socket.on('framesent', (event) => capture('sent', event))
  socket.on('framereceived', (event) => capture('received', event))
}

try {
  writeFileSync(program, PROGRAM)
  const created = tmux('new-session', '-d', '-s', scratch, '-x', '168', '-y', '60')
  assert.equal(created.status, 0, created.stderr || 'scratch tmux session could not start')
  step('scratch shell opened before browser attaches')

  const graphResponse = await fetch(`${BASE}/api/graph`)
  assert.equal(graphResponse.status, 200, `dashboard graph returned ${graphResponse.status}`)
  const graph = await graphResponse.json()
  const fixture = structuredClone(graph)
  fixture.sessions = [{
    id: scratch,
    node: null,
    branch: null,
    path: scratchDir,
    label: 'native resize paint proof',
    title: 'native resize paint proof',
    raw: { name: 'native resize paint proof', title: null },
    harness: 'claude',
    capabilities: { headless: false },
    launcher: null,
    status: 'working',
    lifecycle: 'active',
    proposal: null,
    merges: 0,
    liveness: 'online',
    parent: null,
    note: null,
    archived: false,
    archiveHazard: null,
    prompt: null,
    promptPreview: null,
    created: Date.now(),
    activity: null,
    sortKey: null,
    files: [],
    web: [],
  }]

  const { chromium } = await import(pathToFileURL(PW).href)
  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  context = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    recordVideo: { dir: OUT, size: { width: 1600, height: 950 } },
  })
  await context.addInitScript(() => {
    window.EventSource = class DisabledEventSource { constructor() { throw new Error('terminal measurement owns a fixed graph fixture') } }
  })
  const page = await context.newPage()
  page.on('websocket', wireSocket)
  await page.route('**/api/graph*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixture),
  }))
  await page.goto(`${BASE}/#/sessions/${scratch}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-tool.command').waitFor({ state: 'visible', timeout: 30_000 })
  await waitUntil(
    () => tmux('list-clients', '-t', scratch, '-F', '#{client_pid}').stdout.trim(),
    Boolean,
    'browser native tmux client',
  )
  await page.waitForTimeout(400)
  tmux('send-keys', '-t', scratch, '-l', `node ${program}`)
  tmux('send-keys', '-t', scratch, 'Enter')
  step('browser native attach settled, then scratch busy SIGWINCH program started')

  const paintEvidence = []
  const inspect = async () => {
    const screenshot = await page.screenshot({ fullPage: true })
    return { at: at(), screenshot, colors: await swatches(page, screenshot) }
  }
  const capture = (name, frame) => {
    const file = `${name}.png`
    writeFileSync(join(OUT, file), frame.screenshot)
    const record = { at: frame.at, name, file, colors: frame.colors }
    paintEvidence.push(record)
    step(`browser screenshot pixels captured: ${name}`)
    return record
  }
  const waitForPaint = async (label, accept) => waitUntil(inspect, accept, label, 30_000)

  await waitUntil(
    () => received.some((frame) => frame.text.includes('READY-OLD-GRID')),
    Boolean,
    'old native grid bytes',
    30_000,
  )
  const oldPaint = await waitForPaint('old grid pixels', (frame) => frame.colors.old > 10_000)
  capture('old-native-grid', oldPaint)

  step('begin browser shrink')
  const resizeStart = at()
  await page.setViewportSize({ width: 1100, height: 700 })
  const postResizePaint = await inspect()
  capture('after-browser-resize', postResizePaint)
  const resizeCommit = await waitUntil(
    () => received.find((frame) => frame.at >= resizeStart && /"t":"resize-commit"/.test(frame.text)),
    Boolean,
    'backend resize commit',
  )
  assert.ok(oldPaint.at < resizeStart, 'old browser pixels were not captured before the browser resize')
  assert.ok(resizeStart < resizeCommit.at, 'backend committed a grid before the browser requested it')
  assert.ok(
    postResizePaint.colors.old + postResizePaint.colors.final > 10_000,
    'browser painted a blank or unrecognizable terminal after the viewport resize',
  )

  const firstCommitPaint = await inspect()
  capture('first-committed-native-grid', firstCommitPaint)
  assert.ok(
    firstCommitPaint.colors.old + firstCommitPaint.colors.final > 10_000,
    'browser painted a blank or unrecognizable terminal immediately after the resize commit',
  )

  const finalBytes = await waitUntil(
    () => received.find((frame) => frame.at >= resizeStart && frame.text.includes('FINAL-SYNCHRONIZED-GRID')),
    Boolean,
    'final native redraw bytes',
  )
  const finalPaint = await waitForPaint('final grid pixels', (frame) => frame.colors.final > 10_000)
  capture('final-synchronized-grid', finalPaint)

  const tailBytes = await waitUntil(
    () => received.find((frame) => frame.at >= resizeStart && frame.text.includes('POST-BOUNDARY-LIVE-TAIL')),
    Boolean,
    'post-boundary ordinary output',
  )
  const tailPaint = await waitForPaint('post-boundary tail pixels', (frame) => frame.colors.tail > 1_000)
  capture('post-boundary-live-tail', tailPaint)

  const resizeRequests = sent.filter((frame) => frame.at >= resizeStart && /"t":"resize"/.test(frame.text))
  assert.ok(resizeRequests.length, 'the real browser never emitted a resize request')
  assert.ok(resizeCommit.at < finalBytes.at, 'final native redraw preceded its browser resize commit')
  assert.ok(finalBytes.at < tailBytes.at, 'ordinary tail preceded the final native redraw')
  assert.ok(finalPaint.at >= finalBytes.at, 'final grid pixels were captured before their real terminal bytes arrived')
  assert.ok(tailPaint.at >= tailBytes.at, 'tail pixels were captured before ordinary tail bytes arrived')
  assert.ok(tailPaint.at - resizeStart < 2_500, `post-boundary ordinary output painted too late (${tailPaint.at - resizeStart}ms)`)

  const pane = tmux('display-message', '-p', '-t', scratch, '#{pane_width}x#{pane_height}')
  assert.equal(pane.status, 0, pane.stderr || 'could not inspect real tmux pane size')
  const video = page.video()
  await context.close()
  context = null
  await video.saveAs(join(OUT, 'terminal-resize-paint.webm'))
  const result = {
    ok: true,
    base: BASE,
    tmuxSocket: TMUX_SOCKET,
    tmuxPane: pane.stdout.trim(),
    resizeStart,
    resizeCommitAt: resizeCommit.at,
    finalBytesAt: finalBytes.at,
    tailBytesAt: tailBytes.at,
    resizeRequests,
    paintEvidence,
    events,
  }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, out: OUT, result }, null, 2))
} catch (error) {
  runError = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ok: false, base: BASE, tmuxSocket: TMUX_SOCKET, scratch, error: runError, events, sent, received }, null, 2) + '\n')
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2) + '\n')
  console.error(runError.stack || runError.message)
  process.exitCode = 1
} finally {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  tmux('kill-session', '-t', scratch)
  rmSync(scratchDir, { recursive: true, force: true })
}
