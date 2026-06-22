import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  playwrightDriver, resolveTargetUrl, parseStep,
  setLauncher, setNativeRunner, resetDriverSeams, type PageLike,
} from './driver-playwright.js'

// ---- a fake page: records the calls the driver makes, so the replay logic is tested with no browser ----

function stubSession(shot = Buffer.from('89504e470d0a1a0a', 'hex')) {
  const calls: string[] = []
  const page: PageLike = {
    async goto(url) { calls.push(`goto ${url}`) },
    async screenshot(opts) { calls.push(`screenshot fullPage=${opts?.fullPage}`); return shot },
    async click(sel) { calls.push(`click ${sel}`) },
    async fill(sel, val) { calls.push(`fill ${sel}=${val}`) },
    async press(sel, key) { calls.push(`press ${sel} ${key}`) },
    async waitForSelector(sel) { calls.push(`waitFor ${sel}`) },
    async waitForTimeout(ms) { calls.push(`waitTimeout ${ms}`) },
    async waitForLoadState(state) { calls.push(`loadState ${state}`) },
  }
  return { page, calls, close: async () => { calls.push('close') } }
}

// ---- target resolution (the WEB-only contract) ----

test('resolveTargetUrl: full url as-is, bare path against base, default base', () => {
  assert.equal(resolveTargetUrl('https://x.test/a?b=1'), 'https://x.test/a?b=1')
  const prev = process.env.YATSU_BASE_URL
  process.env.YATSU_BASE_URL = 'http://host:9/'
  assert.equal(resolveTargetUrl('/login'), 'http://host:9/login')   // trailing slash on base collapsed
  assert.equal(resolveTargetUrl('login'), 'http://host:9/login')    // bare → leading slash added
  delete process.env.YATSU_BASE_URL
  assert.equal(resolveTargetUrl('/x'), 'http://localhost:5173/x')   // default base
  if (prev !== undefined) process.env.YATSU_BASE_URL = prev
})

test('resolveTargetUrl: web-only — empty and non-http schemes fail loud', () => {
  assert.throws(() => resolveTargetUrl(''), /no `target`/)
  assert.throws(() => resolveTargetUrl('   '), /no `target`/)
  assert.throws(() => resolveTargetUrl('electron://app/main'), /WEB-only/)   // Electron is a separate driver node
  assert.throws(() => resolveTargetUrl('file:///tmp/x.html'), /WEB-only/)
})

// ---- the inline-step mini-language ----

test('parseStep: verb forms execute, prose is narration (null)', () => {
  assert.deepEqual(parseStep('goto: /login'), { verb: 'goto', arg: '/login' })
  assert.deepEqual(parseStep('click: #submit'), { verb: 'click', arg: '#submit' })
  assert.deepEqual(parseStep('fill: "#user = alice"'), { verb: 'fill', selector: '#user', value: 'alice' })
  assert.deepEqual(parseStep('wait: 250'), { verb: 'wait', ms: 250 })
  assert.deepEqual(parseStep('waitfor: .ready'), { verb: 'waitfor', arg: '.ready' })
  assert.equal(parseStep('click the logout button'), null)      // no `verb:` head → narration
  assert.equal(parseStep('assert the page is /login'), null)
  assert.equal(parseStep('note: just a comment'), null)         // unknown verb head → narration
})

test('parseStep: malformed executable steps fail loud', () => {
  assert.throws(() => parseStep('fill: #user'), /<selector> = <value>/)
  assert.throws(() => parseStep('wait: soon'), /millisecond number/)
})

// ---- capture: replay + settle-aware screenshot, with the browser stubbed ----

test('capture: drives goto + executable steps, settles, captures fullPage png; prose skipped', async () => {
  const sess = stubSession()
  setLauncher(async () => sess)
  try {
    const bytes = await playwrightDriver.capture(
      {
        name: 's', driver: 'playwright', target: 'http://localhost:3000/login',
        steps: ['fill: #user = alice', 'click: #submit', 'click the dashboard link', 'waitfor: .ready'],
      }, {})
    assert.ok(bytes, 'returned bytes')
    assert.equal(bytes!.slice(0, 4).toString('hex'), '89504e47')
  } finally { resetDriverSeams() }
  assert.deepEqual(sess.calls, [
    'goto http://localhost:3000/login',
    'fill #user=alice',
    'click #submit',
    // 'click the dashboard link' is prose narration → not executed
    'waitFor .ready',
    'loadState networkidle',     // settle before capture
    'screenshot fullPage=true',
    'close',                     // browser always closed (finally)
  ])
})

test('capture: a bare-path target resolves against YATSU_BASE_URL', async () => {
  const sess = stubSession()
  const prev = process.env.YATSU_BASE_URL
  process.env.YATSU_BASE_URL = 'http://app.local:8080'
  setLauncher(async () => sess)
  try {
    await playwrightDriver.capture({ name: 's', driver: 'playwright', target: '/dash' }, {})
  } finally {
    resetDriverSeams()
    if (prev === undefined) delete process.env.YATSU_BASE_URL; else process.env.YATSU_BASE_URL = prev
  }
  assert.equal(sess.calls[0], 'goto http://app.local:8080/dash')
})

test('capture: a `run` scenario delegates to the native runner (own browser)', async () => {
  const shot = Buffer.from('89504e47deadbeef', 'hex')
  let gotFile = ''
  let launched = false
  setLauncher(async () => { launched = true; return stubSession() })
  setNativeRunner(async (file) => { gotFile = file; return shot })
  try {
    const bytes = await playwrightDriver.capture(
      { name: 'n', driver: 'playwright', target: '/ignored', run: 'tests/login.spec.ts' }, {})
    assert.equal(bytes, shot)
  } finally { resetDriverSeams() }
  assert.equal(launched, false, 'run mode never launches our own browser')
  assert.ok(gotFile.endsWith('tests/login.spec.ts'), `resolved run path: ${gotFile}`)
})

// ---- real smoke: a genuine chromium capture against a local http page (gated on the global install) ----

test('smoke: real chromium captures a local http page', async (t) => {
  const http = await import('node:http')
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<!doctype html><meta charset="utf-8"><title>yatsu</title><h1 id="hi">yatsu smoke</h1>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  try {
    let bytes: Buffer | null = null
    try {
      bytes = await playwrightDriver.capture(
        { name: 'smoke', driver: 'playwright', target: `http://127.0.0.1:${port}/`, steps: ['waitfor: #hi'] }, {})
    } catch (e) {
      // no machine-global Playwright here (e.g. a CI box without it) → skip, never fail the suite.
      if (/no machine-global Playwright/.test(String((e as Error)?.message))) return t.skip('global Playwright not available')
      throw e
    }
    assert.ok(bytes, 'capture returned bytes')
    assert.equal(bytes!.slice(0, 4).toString('hex'), '89504e47', 'PNG magic bytes')
    assert.ok(bytes!.length > 1000, `a real screenshot is non-trivial (${bytes!.length} bytes)`)
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
  }
})
