// Real-browser resource-tab evidence for [[resource-tabs]]. The fixture uses the current document-action
// menu and route tabs; it must not depend on the retired per-panel file picker markup.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const API = process.env.API || process.env.SPEXCODE_API_URL || 'http://127.0.0.1:8787'
const PROJECT = process.env.PROJECT || process.cwd()
const SESSION = process.env.SESSION
const SECOND_SESSION = process.env.SECOND_SESSION
const SECOND_FILE = process.env.SECOND_FILE
const CLI = process.env.SPEXCODE_CLI || resolve(here, '..', '..', 'spec-cli', 'bin', 'spex.mjs')
const OUT = resolve(process.env.OUT || '/tmp/session-web-e2e')
if (!SESSION || !SECOND_SESSION || !SECOND_FILE) throw new Error('SESSION, SECOND_SESSION, and SECOND_FILE are required')
mkdirSync(OUT, { recursive: true })
const FILE = resolve(process.env.FILE || join(OUT, 'posted-preview.md'))
if (!process.env.FILE) writeFileSync(FILE, '# Preview starts here\n\nWarm resource line\n')

const command = (sessionId, ...args) => execFileSync(process.execPath, [CLI, 'session', ...args], {
  cwd: PROJECT, env: {
    ...process.env,
    SPEXCODE_SESSION_ID: sessionId,
    SPEXCODE_API_URL: API,
  }, encoding: 'utf8',
}).trim()
const waitFor = async (read, label, timeout = 45_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const currentGraph = async (predicate) => {
  const response = await fetch(`${BASE}/api/graph`)
  if (!response.ok || response.headers.get('x-spexcode-graph')?.includes('stale')) return false
  const board = await response.json()
  return predicate(board) ? board : false
}
const slides = await new Promise((resolveServer, reject) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Resource proof</title><main id="resource-proof">resource frame</main>')
  })
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolveServer({ server, url: `http://127.0.0.1:${server.address().port}/` }))
})
const webLabel = `${new URL(slides.url).hostname}:${new URL(slides.url).port}`
let postedFile = false
let postedWeb = false
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
try {
  if (!command(SESSION, 'files', 'ls').split('\n').includes(FILE)) {
    assert.equal(command(SESSION, 'files', 'add', FILE), `posted ${FILE}`)
    postedFile = true
  }
  await waitFor(() => currentGraph((board) => {
    const primary = board.sessions?.find((session) => session.id === SESSION)
    const secondary = board.sessions?.find((session) => session.id === SECOND_SESSION)
    return primary?.files?.includes(FILE) && secondary?.files?.includes(SECOND_FILE)
  }), 'authoritative graph with both files')

  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SESSION)}`, { waitUntil: 'domcontentloaded' })
  const picker = page.locator('.document-action-button[data-action="resource-picker"]')
  await picker.waitFor({ state: 'visible', timeout: 20_000 })
  await picker.click()
  const fileItem = page.getByRole('menuitem', { name: basename(FILE) })
  await fileItem.waitFor({ state: 'visible', timeout: 20_000 })
  await fileItem.click()
  const fileTab = page.locator('.tab[role="tab"]').filter({ hasText: basename(FILE) }).first()
  await fileTab.waitFor({ state: 'visible', timeout: 20_000 })
  await page.locator('.si-resource-file:not(.loading)').first().waitFor({ state: 'visible', timeout: 20_000 })
  const fileState = await page.locator('.si-resource-file:not(.loading)').first().evaluate((element) => {
    window.__spexResourceNode = element
    element.scrollTop = 12
    return { scrollTop: element.scrollTop, text: element.textContent?.trim(), width: element.getBoundingClientRect().width }
  })
  assert.ok(fileState.text && fileState.text.trim().length > 0, 'the resource preview must render posted content')
  assert.ok(fileState.width > 0, 'the painted resource must have non-zero geometry')

  assert.equal(command(SESSION, 'web', 'add', slides.url), `posted ${slides.url}`)
  postedWeb = true
  await waitFor(() => currentGraph((board) => board.sessions?.some((session) => session.id === SESSION && session.web?.some((web) => web.url === slides.url))), 'web resource in authoritative graph')
  await page.locator('.tab[role="tab"] .tab-face').filter({ hasText: basename(FILE) }).click()
  await picker.click()
  const webItem = page.getByRole('menuitem', { name: webLabel })
  await webItem.waitFor({ state: 'visible', timeout: 20_000 })
  await webItem.click()
  const webTab = page.locator('.tab[role="tab"]').filter({ hasText: webLabel }).first()
  await webTab.waitFor({ state: 'visible', timeout: 20_000 })
  const frame = page.locator('.si-resource-web')
  await frame.waitFor({ state: 'visible', timeout: 20_000 })
  await frame.evaluate((element) => { window.__spexResourceFrame = element.contentWindow })

  const sessionTab = page.locator(`.tab[role="tab"][data-tab-key^="#/sessions/${SESSION}"]:not([data-tab-key*="surface="])`).first()
  await sessionTab.click()
  await page.locator(`.si-item[data-sid="${SECOND_SESSION}"]`).click()
  await page.locator(`.si-item[data-sid="${SESSION}"]`).click()
  await fileTab.click()
  const warm = await page.locator('.si-resource-file:not(.loading)').first().evaluate((element) => ({
    sameNode: element === window.__spexResourceNode, scrollTop: element.scrollTop,
  }))
  assert.equal(warm.sameNode, true, 'returning to the file must keep the mounted resource instance')
  assert.equal(warm.scrollTop, fileState.scrollTop, 'returning to the file must preserve scroll')
  await page.screenshot({ path: join(OUT, 'resource-tabs-live.png'), fullPage: true })
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ session: SESSION, secondSession: SECOND_SESSION, file: FILE, web: slides.url, fileState, warm, errors }, null, 2) + '\n')
  console.log(JSON.stringify({ session: SESSION, secondSession: SECOND_SESSION, file: FILE, web: slides.url, fileState, warm, errors }))
} finally {
  if (postedWeb) { try { command(SESSION, 'web', 'retract', slides.url) } catch {} }
  if (postedFile) { try { command(SESSION, 'files', 'retract', FILE) } catch {} }
  await context.close()
  await browser.close()
  await new Promise((resolveClose) => slides.server.close(resolveClose))
}
