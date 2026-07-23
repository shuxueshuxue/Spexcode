// Right-edge typing/IME must never shift the terminal pane. xterm parks its hidden composition
// textarea at the cursor cell and widens it to the composition string; at the rightmost columns that
// box pokes past the pane edge, and Chromium's caret-reveal then scrolls any scrollable ancestor
// (overflow:hidden included) to chase it — the whole pane lurches left like a horizontal scroll.
// The console's terminal chrome must therefore be overflow:clip — not a scroll container at all.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = resolve(process.env.OUT || '/tmp/terminal-hscroll-e2e')
const TMUX_SOCKET = process.env.SPEXCODE_TMUX || 'spexcode'
const scratch = `spex-hscroll-${process.pid}`
const scratchDir = mkdtempSync(join(tmpdir(), 'spex-hscroll-'))
const capturePath = join(scratchDir, 'input.txt')
mkdirSync(OUT, { recursive: true })

const tmux = (...args) => spawnSync('tmux', ['-L', TMUX_SOCKET, ...args], { encoding: 'utf8' })
const created = tmux('new-session', '-d', '-s', scratch, `printf 'HS_READY\\n'; exec tee ${capturePath}`)
if (created.status !== 0) throw new Error(created.stderr || `could not create tmux session ${scratch}`)

let browser
let context
try {
  const { chromium } = await import(pathToFileURL(PW).href)
  const graph = await fetch(`${BASE}/api/graph`).then((r) => r.json())
  const seed = graph.sessions.find((s) => s.liveness === 'online') || graph.sessions[0]
  assert.ok(seed, 'a session-shaped graph row is required for the browser fixture')
  const fixture = structuredClone(graph)
  fixture.sessions = [{
    ...seed, id: scratch, session: scratch, status: 'working', lifecycle: 'active',
    liveness: 'online', parent: null, node: null, name: 'right-edge pane-still proof',
    headline: 'right-edge pane-still proof', created: Date.now(),
  }]

  const events = []
  const started = Date.now()
  const step = (name) => events.push({ at: Date.now() - started, step: name })

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
    status: 200, contentType: 'application/json', body: JSON.stringify(fixture),
  }))
  await page.goto(`${BASE}/#/sessions/${scratch}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-tool.command').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('HS_READY'))
  await page.waitForTimeout(400)
  step('terminal focused, real tmux pane painted')

  // the helper's adopted grid — the same cols the browser fitted
  const cols = Number(tmux('display-message', '-p', '-t', scratch, '#{pane_width}').stdout.trim())
  assert.ok(cols > 40, `pane width ${cols}`)

  // Every ancestor of the composition textarea that has been scrolled off origin, plus the pane's
  // on-screen x. The textarea's own internal caret scroll is native and harmless — excluded.
  const paneState = () => page.evaluate(() => {
    const helper = document.querySelector('.si-term-layer[style*="visibility: visible"] .xterm-helper-textarea')
    const scrolled = []
    for (let el = helper.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      if (el.scrollLeft !== 0 || el.scrollTop !== 0) {
        scrolled.push({ el: `${el.tagName}.${[...el.classList].join('.')}`, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop })
      }
    }
    return { scrolled, xtermX: document.querySelector('.si-term-layer[style*="visibility: visible"] .xterm').getBoundingClientRect().x }
  })
  const home = await paneState()
  assert.deepEqual(home.scrolled, [], 'pane chrome starts unscrolled')

  // march the cursor into the rightmost columns with ordinary echoed keys
  await page.keyboard.type('a'.repeat(cols - 3), { delay: 0 })
  await page.waitForTimeout(300)
  const atEdge = await paneState()
  step('cursor at the rightmost columns')

  // compose pinyin at the edge — the widened composition textarea is what pokes past the pane
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.imeSetComposition', {
    text: 'zhongwenshurufa', selectionStart: 15, selectionEnd: 15, replacementStart: 0, replacementEnd: 0,
  })
  await page.waitForTimeout(400)
  const duringIme = await paneState()
  await page.screenshot({ path: join(OUT, 'during-ime.png') })
  step('IME composition open at the right edge')

  await cdp.send('Input.insertText', { text: '中文输入法' })
  await page.waitForTimeout(400)
  const afterCommit = await paneState()
  step('composition committed')

  // the candidate still lands in the real pane — the stillness must not cost the IME path
  // (the scratch pane runs canonical-mode tee, so the line reaches it on Enter)
  await page.keyboard.press('Enter')
  for (let attempt = 0; attempt < 40; attempt++) {
    if (readFileSync(capturePath, 'utf8').includes('中文输入法')) break
    await page.waitForTimeout(50)
  }
  assert.ok(readFileSync(capturePath, 'utf8').includes('中文输入法'), 'IME commit reaches the tmux pane')

  const video = page.video()
  await context.close()
  context = null
  await video.saveAs(join(OUT, 'terminal-hscroll.webm'))
  const result = { cols, home, atEdge, duringIme, afterCommit }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2))
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))

  for (const [phase, state] of [['atEdge', atEdge], ['duringIme', duringIme], ['afterCommit', afterCommit]]) {
    assert.deepEqual(state.scrolled, [], `${phase}: no terminal ancestor may scroll — ${JSON.stringify(state.scrolled)}`)
    assert.equal(state.xtermX, home.xtermX, `${phase}: the pane moved from x=${home.xtermX} to x=${state.xtermX}`)
  }
  console.log(JSON.stringify({ ok: true, video: join(OUT, 'terminal-hscroll.webm'), result: join(OUT, 'result.json') }))
} finally {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  tmux('kill-session', '-t', scratch)
}
