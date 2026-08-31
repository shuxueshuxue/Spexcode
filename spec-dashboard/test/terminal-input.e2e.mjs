import assert from 'node:assert/strict'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = resolve(process.env.OUT || '/tmp/terminal-input-e2e')
const LAUNCHER = process.env.LAUNCHER || 'fake'
const capturePath = process.env.CAPTURE_PATH || ''
mkdirSync(OUT, { recursive: true })

let browser
let context
let scratch = ''
try {
  assert.ok(capturePath, 'CAPTURE_PATH must point at the backend fixture input ledger')
  const createdResponse = await fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'Chinese IME input proof', launcher: LAUNCHER }),
  })
  const createdText = await createdResponse.text()
  let created
  try { created = JSON.parse(createdText) } catch { created = null }
  assert.equal(createdResponse.status, 201, `POST /api/sessions failed: ${createdText}`)
  scratch = created?.id || ''
  assert.ok(scratch, 'fixture session has a durable id')
  const waitForOnline = async () => {
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const response = await fetch(`${BASE}/api/sessions/${scratch}`)
      if (response.ok) {
        const session = await response.json()
        if (session?.liveness === 'online' && session?.lifecycle === 'active') return session
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`fixture session ${scratch} did not become online`)
  }
  await waitForOnline()
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
  const visibleTerminal = '.si-term-layer[style*="visibility: visible"]'
  await page.waitForFunction((selector) => !!document.querySelector(`${selector} .xterm`), visibleTerminal)
  await page.waitForFunction((selector) => (document.querySelector(`${selector} .xterm-rows`)?.textContent || '').trim().length > 20, visibleTerminal)
  await page.waitForFunction((selector) => document.activeElement?.closest?.(selector)?.querySelector('.xterm-helper-textarea'), visibleTerminal)
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('FAKE-HARNESS READY'))
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
  const typeImePunctuation = async ({ key, code, keyCode, text }) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key, code, text, unmodifiedText: text,
      windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
    })
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key, code,
      windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode,
    })
  }

  const ordinary = 'ascii-123'
  await page.keyboard.type(ordinary)
  await page.keyboard.press('Enter')
  step('ordinary printable keys stay byte-exact')

  const phrases = ['苹果', '香蕉', '葡萄']
  await beginComposition('pingguo')
  await commitComposition(phrases[0])
  step('first IME candidate commits')

  await beginComposition('xiangjiao')
  await page.locator('.si-item.on').click()
  assert.deepEqual(await helperState(), { active: true, value: 'xiangjiao' })
  await commitComposition(phrases[1])
  step('selected-row activation preserves current composition')

  await beginComposition('putao')
  // The surface switcher is a document action in the current shell, not a second tab inside the
  // terminal. Clicking the already-visible terminal surface itself is the equivalent activation and must
  // leave the native composition sink untouched.
  await page.locator('.si-term-layer[style*="visibility: visible"]').click({ position: { x: 12, y: 12 } })
  assert.deepEqual(await helperState(), { active: true, value: 'putao' })
  await commitComposition(phrases[2])
  step('terminal surface activation preserves current composition')

  await typeImePunctuation({ key: ',', code: 'Comma', keyCode: 188, text: '，' })
  await typeImePunctuation({ key: '.', code: 'Period', keyCode: 190, text: '。' })
  await page.keyboard.press('Enter')
  const punctuation = '，。'
  step('IME punctuation keys stay full-width')

  for (let attempt = 0; attempt < 40; attempt++) {
    if (existsSync(capturePath) && readFileSync(capturePath, 'utf8').includes(punctuation)) break
    await page.waitForTimeout(50)
  }
  await page.screenshot({ path: join(OUT, 'terminal-input.png'), fullPage: true })
  step('real tmux pane contains every current UTF-8 commit')

  await page.keyboard.press('Shift+Enter')
  await page.waitForTimeout(80)
  step('Shift+Enter emits modified Enter without submitting as plain CR')

  const captured = readFileSync(capturePath, 'utf8')
  const sent = frames.join('')
  assert.equal(captured, `${ordinary}\n${phrases.join('\n')}\n${punctuation}\n\x1b\n`, JSON.stringify({ captured }))
  assert.ok(sent.includes(ordinary), JSON.stringify({ frames }))
  for (const phrase of phrases) assert.equal(frames.filter((frame) => frame === phrase).length, 1, JSON.stringify({ phrase, frames }))
  assert.equal(frames.filter((frame) => frame === '，').length, 1, JSON.stringify({ frames }))
  assert.equal(frames.filter((frame) => frame === '。').length, 1, JSON.stringify({ frames }))
  assert.equal(frames.filter((frame) => frame === '\r').length, phrases.length + 2, JSON.stringify({ frames }))
  assert.equal(frames.filter((frame) => frame === '\x1b\r').length, 1, JSON.stringify({ frames }))
  assert.ok(!['pingguo', 'xiangjiao', 'putao'].some((raw) => sent.includes(raw)), JSON.stringify({ frames }))
  const video = page.video()
  await context.close()
  context = null
  await video.saveAs(join(OUT, 'terminal-input.webm'))
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ scratch, ordinary, phrases, punctuation, frames, captured }, null, 2))
  console.log(JSON.stringify({ ok: true, video: join(OUT, 'terminal-input.webm'), result: join(OUT, 'result.json') }))
} finally {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  if (scratch) {
    await fetch(`${BASE}/api/sessions/${scratch}/close`, { method: 'POST' }).catch(() => {})
  }
}
