import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const SESSION = process.env.SESSION
const OUT = resolve(process.env.OUT || '/tmp/command-box-e2e')
if (!SESSION) throw new Error('SESSION=<live-session-id> is required')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const issuePage = await fetch(`${BASE}/api/issues?q=is%3Aissue%20state%3Aopen&page=1`).then((response) => response.json())
const evalPage = await fetch(`${BASE}/api/evals?q=is%3Aeval&page=1`).then((response) => response.json())
const issue = issuePage.items.find((item) => item.store === 'local') || issuePage.items[0]
const reading = evalPage.items.find((item) => item.filterKind !== 'blind')
const commandNode = graph.nodes.find((node) => node.id === 'command-box')
assert.ok(graph.sessions.some((session) => session.id === SESSION), 'live session must exist')
assert.ok(issue, 'an issue detail is required to compare the shared composer')
assert.ok(reading, 'an eval result detail is required to compare the shared composer')
assert.ok(commandNode, 'the command-box spec node is required to prove mention expansion')

const events = []
const started = Date.now()
const step = (name) => events.push({ at: Date.now() - started, step: name })
const inputs = []
let failNext = true

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({
  viewport: { width: 1360, height: 840 },
  recordVideo: { dir: OUT, size: { width: 1360, height: 840 } },
})
await context.addInitScript(() => {
  if (!sessionStorage.getItem('command-box-e2e-initialized')) {
    localStorage.removeItem('spex.siListWidth')
    sessionStorage.setItem('command-box-e2e-initialized', '1')
  }
  window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
})
const page = await context.newPage()
await page.route('**/api/graph*', async (route) => {
  const fixture = structuredClone(graph)
  const session = fixture.sessions.find((candidate) => candidate.id === SESSION)
  session.status = 'working'
  session.lifecycle = 'active'
  session.liveness = 'online'
  session.headline = 'A deliberately long selected session headline proving the compact sidebar reveals useful context but never grows beyond exactly three stable lines'
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture) })
})
await page.route(`**/api/sessions/${SESSION}/input`, async (route) => {
  inputs.push(route.request().postDataJSON())
  if (failNext) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'forced failure' }) })
  else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
})
await page.route('**/api/uploads', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ path: '/tmp/spexcode-uploads/command-proof.txt' }),
  })
})

await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
await page.locator('.si-tool.command').waitFor({ state: 'visible', timeout: 30_000 })
await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
const tuiBefore = await page.evaluate(() => ({
  cls: document.activeElement?.className,
  sink: document.activeElement?.hasAttribute('data-focus-sink'),
}))
assert.equal(tuiBefore.sink, true)

const sidebar = await page.evaluate(() => {
  const list = document.querySelector('.si-list')
  const row = document.querySelector('.si-item.on')
  const headline = row.querySelector('.sess-id')
  const line = parseFloat(getComputedStyle(row).lineHeight)
  return {
    width: list.getBoundingClientRect().width,
    rowHeight: row.getBoundingClientRect().height,
    headlineHeight: headline.getBoundingClientRect().height,
    line,
    maxHeight: getComputedStyle(headline).maxHeight,
    clipped: headline.scrollHeight > headline.clientHeight,
    fullText: headline.textContent === headline.getAttribute('data-tip'),
  }
})
assert.equal(sidebar.width, 204)
assert.ok(sidebar.headlineHeight <= sidebar.line * 3 + 0.5, JSON.stringify(sidebar))
assert.ok(sidebar.clipped && sidebar.fullText, JSON.stringify(sidebar))
step('sidebar default and three-line cap')

const divider = page.locator('.si-resizer')
const dividerBox = await divider.boundingBox()
await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + 100)
await page.mouse.down()
await page.mouse.move(dividerBox.x + dividerBox.width / 2 + 96, dividerBox.y + 100, { steps: 5 })
await page.mouse.up()
const widened = await page.locator('.si-list').evaluate((element) => element.getBoundingClientRect().width)
assert.ok(widened >= 295 && widened <= 305, widened)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.locator('.si-tool.command').waitFor({ state: 'visible', timeout: 30_000 })
await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
const persisted = await page.locator('.si-list').evaluate((element) => ({
  width: element.getBoundingClientRect().width,
  stored: Number(localStorage.getItem('spex.siListWidth')),
}))
assert.equal(persisted.width, widened)
assert.equal(persisted.stored, widened)
await page.locator('.si-resizer').dblclick()
const reset = await page.locator('.si-list').evaluate((element) => ({
  width: element.getBoundingClientRect().width,
  stored: localStorage.getItem('spex.siListWidth'),
}))
assert.deepEqual(reset, { width: 204, stored: null })
step('sidebar drag persists and divider double-click resets')

await page.keyboard.press('Alt+i')
const command = page.locator('.si-command-box')
const input = page.locator('.si-command-input')
await command.waitFor({ state: 'visible' })
await page.waitForFunction(() => document.activeElement?.classList?.contains('si-command-input'))
const geometry = () => page.evaluate(() => {
  const rect = (selector) => {
    const r = document.querySelector(selector).getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
  }
  const term = rect('.si-term-body')
  const box = rect('.si-command-box')
  return {
    term,
    box,
    input: rect('.si-command-input'),
    footer: rect('.si-command-tools'),
    bottomRatio: (box.bottom - term.y) / term.height,
  }
})
const empty = await geometry()
assert.ok(Math.abs(empty.bottomRatio - 0.78) < 0.015, JSON.stringify(empty))
await page.screenshot({ path: join(OUT, 'command-box-empty.png'), fullPage: true })
step('Command Box opens at lower-middle anchor')

await input.fill('/')
const slashMenu = page.locator('.si-command-box .mention-menu')
await slashMenu.waitFor({ state: 'visible' })
const slashRows = await slashMenu.locator('.mention-item').allTextContents()
assert.ok(slashRows.some((row) => row.includes('/eval')), slashRows.join('\n'))
assert.ok(slashRows.every((row) => !row.includes('/type')), slashRows.join('\n'))

await input.fill('[[command-b')
const commandMention = page.locator('.si-command-box .mention-item', { hasText: 'command-box' }).first()
await commandMention.waitFor({ state: 'visible' })
await commandMention.click()
assert.equal(await input.inputValue(), '[[command-box]] ')

await input.fill('@')
const sessionMention = page.locator('.si-command-box .mention-item:not(.new)').first()
await sessionMention.waitFor({ state: 'visible' })
await sessionMention.click()
assert.match(await input.inputValue(), /^@[a-f0-9-]+ $/)

await input.fill('')
const [chooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('.si-command-tool').click(),
])
await chooser.setFiles({ name: 'command-proof.txt', mimeType: 'text/plain', buffer: Buffer.from('command box evidence') })
await page.waitForFunction(() => document.querySelector('.si-command-input').value.includes('/tmp/spexcode-uploads/command-proof.txt'))
step('node, session, slash, and file controls stay in Command Box')

const draft = [
  ...Array.from({ length: 6 }, (_, index) => `line ${index + 1} keeps the footer fixed`),
  'review [[command-box]]',
].join('\n')
const expandedDraft = draft.replace('[[command-box]]', `[[command-box]] (${commandNode.path})`)
await input.fill(draft)
await page.waitForFunction(() => document.querySelector('.si-command-input').getBoundingClientRect().height > 80)
const grown = await geometry()
assert.ok(grown.box.y < empty.box.y - 40, JSON.stringify({ empty, grown }))
assert.ok(Math.abs(grown.box.bottom - empty.box.bottom) < 1, JSON.stringify({ empty, grown }))
assert.deepEqual(grown.term, empty.term)
await page.screenshot({ path: join(OUT, 'command-box-grown.png'), fullPage: true })
step('textarea grows upward above fixed footer')

await page.keyboard.press('Escape')
await command.waitFor({ state: 'hidden' })
await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
await page.keyboard.press('Alt+i')
await page.waitForFunction(() => document.activeElement?.classList?.contains('si-command-input'))
assert.equal(await input.inputValue(), draft)
step('draft survives close and TUI focus returns')

const beforeIme = inputs.length
await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', {
  key: 'Enter', bubbles: true, cancelable: true, isComposing: true,
})))
assert.equal(inputs.length, beforeIme)

await page.locator('.si-command-send').click()
await page.locator('.si-send-err').waitFor({ state: 'visible' })
assert.equal(await input.inputValue(), draft)
assert.equal(await command.count(), 1)
step('failed send preserves visible draft')

failNext = false
await page.locator('.si-command-send').click()
await command.waitFor({ state: 'hidden' })
await page.waitForFunction(() => document.activeElement?.classList?.contains('xterm-helper-textarea'))
assert.deepEqual(inputs.at(-1), { kind: 'text', text: expandedDraft })
step('successful atomic send clears, closes, returns TUI focus')

const composerProbe = async () => page.locator('.composer-surface').first().evaluate((surface) => {
  const textarea = surface.querySelector('.composer-textarea')
  const footer = surface.querySelector('.composer-footer')
  const style = getComputedStyle(surface)
  const taStyle = getComputedStyle(textarea)
  return {
    classes: surface.className,
    radius: style.borderRadius,
    border: style.borderStyle,
    textareaBorder: taStyle.borderStyle,
    textareaMinHeight: taStyle.minHeight,
    footerAtBottom: Math.abs(footer.getBoundingClientRect().bottom - surface.getBoundingClientRect().bottom) < 12,
  }
})

await page.goto(`${BASE}/#/issues/${encodeURIComponent(issue.id)}`, { waitUntil: 'domcontentloaded' })
await page.locator('.fv-compose.composer-surface').waitFor({ state: 'visible', timeout: 30_000 })
const issueComposer = await composerProbe()
step('issue detail uses shared composer')

await page.goto(`${BASE}/#/evals/${encodeURIComponent(reading.node)}/${encodeURIComponent(reading.scenario)}`, { waitUntil: 'domcontentloaded' })
await page.locator('.fv-compose.composer-surface').waitFor({ state: 'visible', timeout: 30_000 })
const evalComposer = await composerProbe()
step('eval detail uses shared composer')

for (const probe of [issueComposer, evalComposer]) {
  assert.equal(probe.border, 'solid')
  assert.equal(probe.textareaBorder, 'none')
  assert.equal(probe.radius, '6px')
  assert.equal(probe.footerAtBottom, true)
}

const video = page.video()
await context.close()
await video.saveAs(join(OUT, 'command-box.webm'))
await browser.close()
writeFileSync(join(OUT, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ session: SESSION, sidebar, widened, persisted, reset, empty, grown, inputs, issueComposer, evalComposer }, null, 2))
console.log(JSON.stringify({ ok: true, video: join(OUT, 'command-box.webm'), timeline: join(OUT, 'timeline.json') }))
