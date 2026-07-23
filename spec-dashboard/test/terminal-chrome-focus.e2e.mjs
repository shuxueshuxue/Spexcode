// chrome-clicks-keep-tui-focus — the console's inert-chrome focus discipline, measured YATU.
// A live session's typing focus (the TUI helper, or whichever composer owns the surface) must survive
// pointer work on console chrome — the sidebar list, zone headers, the resizer, the toolbar — and every
// transient pop above the console (search palette, context menu, rename modal, Command Box) must hand
// focus back to that surface when it exits. Collects every violation instead of stopping at the first,
// so one run paints the whole picture.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = resolve(process.env.OUT || '/tmp/terminal-chrome-focus-e2e')
const TMUX_SOCKET = process.env.SPEXCODE_TMUX || 'spexcode'
const scratch = `spex-chromefocus-${process.pid}-${Date.now()}`
const scratchDir = mkdtempSync(join(tmpdir(), 'spex-chromefocus-'))
const capturePath = join(scratchDir, 'input.txt')
mkdirSync(OUT, { recursive: true })

const tmux = (...args) => spawnSync('tmux', ['-L', TMUX_SOCKET, ...args], { encoding: 'utf8' })
const created = tmux('new-session', '-d', '-s', scratch, `printf 'CHROME_READY\\n'; exec tee ${capturePath}`)
if (created.status !== 0) throw new Error(created.stderr || `could not create tmux session ${scratch}`)

let browser
let context
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
    name: 'chrome focus proof',
    headline: 'chrome focus proof',
    created: Date.now(),
  }, ...fixture.sessions.filter((session) => session.id !== scratch)]

  const events = []
  const failures = []
  const started = Date.now()
  const check = (name, ok) => {
    events.push({ at: Date.now() - started, step: name, ok })
    if (!ok) failures.push(name)
  }

  browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
  context = await browser.newContext({
    viewport: { width: 1280, height: 760 },
    recordVideo: { dir: OUT, size: { width: 1280, height: 760 } },
  })
  await context.addInitScript(() => {
    window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
  })
  const page = await context.newPage()
  await page.route('**/api/graph*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixture),
  }))

  await page.goto(`${BASE}/#/sessions/${scratch}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-tool.command').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('CHROME_READY'))
  check('terminal opens focused', true)

  const helperFocused = () => page.evaluate(() => {
    const helper = document.querySelector('.si-term-layer[style*="visibility: visible"] .xterm-helper-textarea')
    return !!helper && document.activeElement === helper
  })
  const activeIs = (selector) => page.evaluate((sel) => document.activeElement?.matches?.(sel) === true, selector)
  const settle = () => page.waitForTimeout(120)
  // pops must RETURN focus (deferred a frame), so the return checks poll briefly instead of reading once.
  const eventually = async (probe, timeout = 1_500) => {
    const until = Date.now() + timeout
    while (Date.now() < until) {
      if (await probe()) return true
      await page.waitForTimeout(50)
    }
    return probe()
  }

  // --- inert chrome around a focused TUI ---------------------------------------------------------
  await page.locator('.si-zone').first().click()
  await settle()
  check('zone-header click keeps TUI focus', await helperFocused())

  const toprow = await page.locator('.si-toprow').boundingBox()
  await page.mouse.click(toprow.x + toprow.width - 8, toprow.y + toprow.height / 2)
  await settle()
  check('sidebar empty-space click keeps TUI focus', await helperFocused())

  const resizer = await page.locator('.si-resizer').boundingBox()
  await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + 200)
  await page.mouse.down()
  await page.mouse.move(resizer.x + resizer.width / 2 + 36, resizer.y + 200, { steps: 4 })
  await page.mouse.up()
  await settle()
  check('list-resizer drag keeps TUI focus', await helperFocused())
  await page.locator('.si-resizer').dblclick()
  await settle()
  check('list-resizer reset keeps TUI focus', await helperFocused())

  await page.locator('#si-terminal-tab').click()
  await settle()
  check('Terminal-tab click keeps TUI focus', await helperFocused())

  await page.locator(`[data-sid="${scratch}"]`).click()
  await settle()
  check('active-row click keeps TUI focus', await helperFocused())

  // the retained focus is a REAL input path: type through it and read the tmux-side capture.
  await page.keyboard.type('FOCUSPROOF')
  await page.keyboard.press('Enter')
  let typed = false
  for (let attempt = 0; attempt < 40 && !typed; attempt++) {
    typed = existsSync(capturePath) && readFileSync(capturePath, 'utf8').includes('FOCUSPROOF')
    if (!typed) await page.waitForTimeout(50)
  }
  check('typing lands in the real tmux pane after chrome clicks', typed)

  // --- pops above the TUI return focus on exit ---------------------------------------------------
  await page.locator('.si-pill.search').click()
  await page.locator('.search-backdrop input').waitFor({ state: 'visible', timeout: 5_000 })
  await page.keyboard.press('Escape')
  await page.locator('.search-backdrop').waitFor({ state: 'detached', timeout: 5_000 })
  check('search palette exit returns focus to TUI', await eventually(helperFocused))

  await page.locator('.si-tool.command').click()
  await page.waitForFunction(() => document.activeElement?.classList?.contains('si-command-input'))
  await page.locator('.si-zone').first().click()
  await settle()
  check('zone-header click keeps Command Box focus', await activeIs('.si-command-input'))
  await page.keyboard.press('Escape')
  check('Command Box exit returns focus to TUI', await eventually(helperFocused))

  await page.locator(`[data-sid="${scratch}"]`).click({ button: 'right' })
  await page.locator('.sess-menu').waitFor({ state: 'visible', timeout: 5_000 })
  await page.locator('.sess-menu-item', { hasText: 'rename' }).click()
  await page.locator('.sess-rename-input').waitFor({ state: 'visible', timeout: 5_000 })
  check('rename modal owns focus while open', await eventually(() => activeIs('.sess-rename-input')))
  await page.locator('.sess-rename-btn', { hasText: 'cancel' }).click()
  await page.locator('.sess-rename-modal').waitFor({ state: 'detached', timeout: 5_000 })
  check('rename modal exit returns focus to TUI', await eventually(helperFocused))

  // --- the same blanket protects the New composer ------------------------------------------------
  await page.locator('.si-pill.new').click()
  await page.waitForFunction(() => document.activeElement?.classList?.contains('si-input'))
  await page.locator('.si-zone').first().click()
  await settle()
  check('zone-header click keeps New-composer focus', await activeIs('.si-input'))
  await page.locator('.si-pill.search').click()
  await page.locator('.search-backdrop input').waitFor({ state: 'visible', timeout: 5_000 })
  await page.keyboard.press('Escape')
  await page.locator('.search-backdrop').waitFor({ state: 'detached', timeout: 5_000 })
  check('search palette exit returns focus to New composer', await eventually(() => activeIs('.si-input')))

  await page.locator(`[data-sid="${scratch}"]`).click()
  check('row click from New returns TUI focus', await eventually(helperFocused))

  await page.screenshot({ path: join(OUT, 'terminal-chrome-focus.png'), fullPage: true })
  const video = page.video()
  await context.close()
  context = null
  await video.saveAs(join(OUT, 'terminal-chrome-focus.webm'))
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ scratch, events, failures }, null, 2))
  console.log(JSON.stringify({ ok: failures.length === 0, failures, video: join(OUT, 'terminal-chrome-focus.webm'), result: join(OUT, 'result.json') }))
  if (failures.length) process.exitCode = 1
} finally {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  tmux('kill-session', '-t', scratch)
}
