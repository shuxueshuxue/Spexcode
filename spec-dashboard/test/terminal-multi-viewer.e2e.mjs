import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = resolve(process.env.OUT || '/tmp/terminal-multi-viewer-e2e')
const TMUX_SOCKET = process.env.SPEXCODE_TMUX || 'spexcode'
const scratch = `spex-viewers-${process.pid}-${Date.now()}`
mkdirSync(OUT, { recursive: true })

const tmux = (...args) => spawnSync('tmux', ['-L', TMUX_SOCKET, ...args], { encoding: 'utf8' })
const clients = () => {
  const result = tmux('list-clients', '-t', scratch, '-F', '#{client_pid}|#{client_width}x#{client_height}')
  return result.status === 0 ? result.stdout.trim().split('\n').filter(Boolean) : []
}
const windowSize = () => tmux('display-message', '-p', '-t', scratch, '#{window_width}x#{window_height}').stdout.trim()
const waitFor = async (read, accept, label, timeout = 6000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value)}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
}

const created = tmux('new-session', '-d', '-s', scratch, "printf 'MULTI_VIEW_READY\\n'; exec cat")
if (created.status !== 0) throw new Error(created.stderr || `could not create tmux session ${scratch}`)

let browser
let smallContext
let largeContext
try {
  const { chromium } = await import(pathToFileURL(PW).href)
  const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
  const seed = graph.sessions.find((session) => session.liveness === 'online') || graph.sessions[0]
  assert.ok(seed, 'a session-shaped graph row is required for the browser fixture')
  const fixture = structuredClone(graph)
  fixture.sessions = [{
    ...seed,
    id: scratch,
    session: scratch,
    status: 'working',
    lifecycle: 'active',
    liveness: 'online',
    parent: null,
    node: null,
    name: 'Native multi-viewer proof',
    headline: 'Native multi-viewer proof',
    created: Date.now(),
  }, ...fixture.sessions.filter((session) => session.id !== scratch)]

  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  const events = []
  const started = Date.now()
  const step = (name) => events.push({ at: Date.now() - started, step: name })
  const openViewer = async (label, viewport) => {
    const context = await browser.newContext({ viewport, recordVideo: { dir: OUT, size: viewport } })
    await context.addInitScript(() => {
      window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
      localStorage.removeItem('spex.siListWidth')
    })
    const page = await context.newPage()
    await page.route('**/api/graph*', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    }))
    await page.goto(`${BASE}/#/sessions/${scratch}`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
    await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('MULTI_VIEW_READY'))
    step(`${label} browser owns a visible terminal`)
    return { context, page, video: page.video() }
  }

  const small = await openViewer('small', { width: 900, height: 600 })
  smallContext = small.context
  const smallOnly = await waitFor(clients, (value) => value.length === 1, 'small native client')
  const smallSize = smallOnly[0].split('|')[1]

  const large = await openViewer('large', { width: 1440, height: 900 })
  largeContext = large.context
  const paired = await waitFor(clients, (value) => value.length === 2, 'two native browser clients')
  const sizes = paired.map((row) => row.split('|')[1])
  const parseSize = (value) => value.split('x').map(Number)
  const [smallCols, smallRows] = parseSize(smallSize)
  const largeSize = sizes.find((value) => {
    const [cols, rows] = parseSize(value)
    return cols > smallCols && rows > smallRows
  })
  assert.ok(largeSize, JSON.stringify({ smallSize, paired }))
  assert.equal(windowSize(), largeSize)
  await small.page.screenshot({ path: `${OUT}/small-viewer.png`, fullPage: true })
  await large.page.screenshot({ path: `${OUT}/large-viewer.png`, fullPage: true })
  step(`tmux largest policy selects ${largeSize} over ${smallSize}`)

  await large.context.close()
  largeContext = null
  await large.video.saveAs(`${OUT}/large-viewer.webm`)
  const afterLargeClose = await waitFor(clients, (value) => value.length === 1, 'large browser detach')
  assert.equal(afterLargeClose[0].split('|')[1], smallSize)
  assert.equal(windowSize(), smallSize)
  step('closing the large browser removes only its client and recomputes the window')

  await small.context.close()
  smallContext = null
  await small.video.saveAs(`${OUT}/small-viewer.webm`)
  await waitFor(clients, (value) => value.length === 0, 'small browser detach')
  step('closing the final browser leaves zero tmux clients')

  writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
  writeFileSync(`${OUT}/result.json`, JSON.stringify({ scratch, smallSize, largeSize, paired, afterLargeClose }, null, 2))
  console.log(JSON.stringify({ ok: true, smallSize, largeSize, out: OUT }))
} finally {
  await largeContext?.close().catch(() => {})
  await smallContext?.close().catch(() => {})
  await browser?.close().catch(() => {})
  tmux('kill-session', '-t', scratch)
}
