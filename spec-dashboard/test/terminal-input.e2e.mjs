import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = resolve(process.env.OUT || '/tmp/terminal-input-e2e')
const TMUX_SOCKET = process.env.SPEXCODE_TMUX || 'spexcode'
const scratch = `spex-ime-${process.pid}-${Date.now()}`
const scratchDir = mkdtempSync(join(tmpdir(), 'spex-ime-'))
const capturePath = join(scratchDir, 'input.txt')
mkdirSync(OUT, { recursive: true })

const tmux = (...args) => spawnSync('tmux', ['-L', TMUX_SOCKET, ...args], { encoding: 'utf8' })
const created = tmux('new-session', '-d', '-s', scratch, `printf 'IME_READY\\n'; exec tee ${capturePath}`)
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
    name: 'Chinese IME input proof',
    headline: 'Chinese IME input proof',
    created: Date.now(),
  }, ...fixture.sessions.filter((session) => session.id !== scratch)]

  const events = []
  const frames = []
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
  page.on('websocket', (socket) => socket.on('framesent', (event) => {
    if (typeof event.payload !== 'string') return
    try {
      const message = JSON.parse(event.payload)
      if (message?.t === 'input') frames.push(message.data)
    } catch { /* binary output and non-input controls are outside this assertion */ }
  }))
  await page.route('**/api/graph*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixture),
  }))

  await page.goto(`${BASE}/#/sessions/${scratch}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-tool.command').waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('IME_READY'))
  frames.length = 0
  step('native xterm focused without a mode')

  const cdp = await context.newCDPSession(page)
  const helperState = () => page.evaluate(() => {
    const helper = document.querySelector('.si-term-layer[style*="visibility: visible"] .xterm-helper-textarea')
    return { active: document.activeElement === helper, value: helper?.value || '' }
  })
  const beginComposition = async (text) => {
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
      replacementStart: 0,
      replacementEnd: 0,
    })
    assert.deepEqual(await helperState(), { active: true, value: text })
  }
  const commitComposition = async (text) => {
    await cdp.send('Input.insertText', { text })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(60)
    assert.deepEqual(await helperState(), { active: true, value: '' })
  }

  const phrases = ['苹果', '香蕉', '葡萄', '，。！？「」【】']
  await beginComposition('pingguo')
  await commitComposition(phrases[0])
  step('first IME candidate commits')

  await beginComposition('xiangjiao')
  await page.locator('.si-item.on').click()
  assert.deepEqual(await helperState(), { active: true, value: 'xiangjiao' })
  await commitComposition(phrases[1])
  step('selected-row activation preserves current composition')

  await beginComposition('putao')
  await page.locator('#si-terminal-tab').click()
  assert.deepEqual(await helperState(), { active: true, value: 'putao' })
  await commitComposition(phrases[2])
  step('Terminal-tab activation preserves current composition')

  await beginComposition('biaodian')
  await commitComposition(phrases[3])
  step('full-width Chinese punctuation stays byte-exact')

  for (let attempt = 0; attempt < 40; attempt++) {
    if (existsSync(capturePath) && readFileSync(capturePath, 'utf8').includes(phrases[3])) break
    await page.waitForTimeout(50)
  }
  await page.waitForFunction((expected) => document.querySelector('.xterm-rows')?.textContent?.includes(expected), phrases[3])
  await page.screenshot({ path: join(OUT, 'terminal-input.png'), fullPage: true })
  step('real tmux pane contains every current UTF-8 commit')

  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(80)
  step('Shift+Enter emits modified Enter without submitting as plain CR')

  const captured = readFileSync(capturePath, 'utf8')
  const sent = frames.join('')
  assert.equal(captured, `${phrases.join('\n')}\n\x1b\n`, JSON.stringify({ captured }))
  for (const phrase of phrases) assert.equal(frames.filter((frame) => frame === phrase).length, 1, JSON.stringify({ phrase, frames }))
  assert.equal(frames.filter((frame) => frame === '\r').length, phrases.length, JSON.stringify({ frames }))
  assert.equal(frames.filter((frame) => frame === '\x1b\r').length, 1, JSON.stringify({ frames }))
  assert.ok(!['pingguo', 'xiangjiao', 'putao', 'biaodian'].some((raw) => sent.includes(raw)), JSON.stringify({ frames }))
  const video = page.video()
  await context.close()
  context = null
  await video.saveAs(join(OUT, 'terminal-input.webm'))
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ scratch, phrases, frames, captured }, null, 2))
  console.log(JSON.stringify({ ok: true, video: join(OUT, 'terminal-input.webm'), result: join(OUT, 'result.json') }))
} finally {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  tmux('kill-session', '-t', scratch)
}
