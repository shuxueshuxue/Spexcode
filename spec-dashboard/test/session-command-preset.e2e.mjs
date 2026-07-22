import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:15187'
const SESSION = process.env.SESSION
const OUT = resolve(process.env.OUT || '/tmp/session-command-preset-e2e')
if (!SESSION) throw new Error('SESSION=<disposable-session-id> is required')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const started = Date.now()
const events = []
const step = (name) => events.push({ at: Date.now() - started, step: name })
const sessions = async () => {
  const response = await fetch(`${BASE}/api/sessions`)
  if (!response.ok) throw new Error(`sessions ${response.status}`)
  return await response.json()
}
const waitForName = async () => {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const session = (await sessions()).find((item) => item.id === SESSION)
    if (session?.raw?.name) return session
    await new Promise((done) => setTimeout(done, 1_000))
  }
  throw new Error('session did not rename itself within 120s')
}

const plugins = await fetch(`${BASE}/api/plugins`).then((response) => response.json())
assert.ok(plugins.some((plugin) => plugin.name === 'rename'), 'rename must be a live command plugin')

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()
const inputs = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.pathname === `/api/sessions/${SESSION}/input`) inputs.push(request.postDataJSON())
})

const pluginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/plugins' && response.ok())
await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
await pluginResponse
await page.keyboard.press('Alt+i')
const input = page.locator('.si-command-input')
await input.waitFor({ state: 'visible', timeout: 30_000 })
step('open live session')

await input.fill('/rename')
const rows = page.locator('.mention-menu.up .mention-item').filter({ hasText: '/rename' })
await rows.first().waitFor({ state: 'visible' })
assert.equal(await rows.count(), 1, '/rename must be deduplicated across preset and harness sources')
assert.equal((await rows.first().locator('.slash-src').textContent())?.trim(), '[preset]')
step('choose preset')
await rows.first().click()
assert.equal(await input.inputValue(), '/rename ')

await input.press('Enter')
await page.locator('.si-command-box').waitFor({ state: 'hidden' })
assert.deepEqual(inputs.at(-1), { kind: 'text', text: '/rename ' })
step('submit raw invocation')

const renamed = await waitForName()
const capture = await fetch(`${BASE}/api/sessions/${SESSION}/capture`).then((response) => response.text())
assert.match(capture, /spex session rename \. /, 'the agent must use the self selector')
assert.doesNotMatch(capture, /no such session: \./, 'an explicit-id fallback is not a passing self-selector proof')
await page.waitForFunction(({ id, name }) => {
  const row = document.querySelector(`.si-item[data-sid="${id}"] .sess-id`)
  return row?.textContent?.includes(name)
}, { id: SESSION, name: renamed.raw.name })
step('board shows agent name')
await page.screenshot({ path: join(OUT, 'renamed-session.png'), fullPage: true })

const video = page.video()
await context.close()
const videoPath = await video.path()
await browser.close()
const timeline = { v: 2, axis: 'time', events }
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2))
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ session: SESSION, name: renamed.raw.name, inputs, capture, video: videoPath }, null, 2))
console.log(JSON.stringify({ ok: true, name: renamed.raw.name, video: videoPath, timeline: join(OUT, 'timeline.json') }))
