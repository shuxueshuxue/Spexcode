// [[conversation]]: loading an earlier page must keep the pressed way-in under the reader's eye. This uses
// the reported shape exactly: 395 omitted events and a text-bounded five-event current window. Anchoring the
// old window instead would scroll past the entire arriving page and land this short window at the bottom.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const dashboardRoot = resolve(process.env.SPEXCODE_DASHBOARD_ROOT || join(root, 'spec-dashboard'))
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : sharedRoot
const modules = join(dependencyRoot, 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const out = resolve(process.env.OUT || join(tmpdir(), 'timeline-load-earlier-position-e2e'))
const SID = 'timeline-load-earlier-position'

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const now = Date.now()
const session = {
  id: SID, branch: null, path: process.cwd(), label: SID, headline: SID, title: SID,
  raw: { name: SID, title: null }, harness: 'codex', capabilities: { headless: true }, launcher: null,
  status: 'idle', lifecycle: 'active', proposal: null, merges: 0, liveness: 'offline', parent: null,
  note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null,
  created: now, activity: null, sortKey: now, files: [], web: [],
}
const events = Array.from({ length: 400 }, (_, index) => ({
  kind: 'sent', mid: `m${index}`, from: null,
  ts: new Date(now - (400 - index) * 60_000).toISOString(),
  text: `history event ${index + 1}`,
}))
const windowOf = (offset, rows) => ({ events: rows, stamp: '400', offset, total: 400, priorWorking: false })

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
let vite
let browser
try {
  const uiPort = await freePort()
  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true },
  })
  await vite.listen()

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({
    viewport: { width: 1100, height: 800 }, locale: 'en-US',
    recordVideo: { dir: out, size: { width: 1100, height: 800 } },
  })
  await context.addInitScript(() => {
    localStorage.removeItem('spexcode.tabs')
    window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
  })
  const page = await context.newPage()
  const video = page.video()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const json = (body) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/graph*', json({ sessions: [session], specs: [], files: [], issues: [] }))
  await page.route('**/api/sessions/archive-index*', json([]))
  await page.route('**/api/slash-commands*', json([]))
  await page.route('**/api/plugins*', json([]))
  await page.route('**/api/settings*', json({}))
  await page.route(`**/api/sessions/${SID}/timeline*`, (route) => {
    const before = new URL(route.request().url()).searchParams.get('before')
    return json(before === '395' ? windowOf(195, events.slice(195, 395)) : windowOf(395, events.slice(395)))(route)
  })
  await page.route(`**/api/sessions/${SID}`, json(session))

  await page.goto(`http://127.0.0.1:${uiPort}/#/sessions/${SID}`, { waitUntil: 'domcontentloaded' })
  const timeline = page.locator('.m-timeline:visible')
  const earlier = timeline.locator('.m-earlier')
  await earlier.waitFor({ state: 'visible', timeout: 30_000 })
  assert.match(await earlier.textContent(), /395 earlier events/)
  await timeline.evaluate((element) => { element.scrollTop = 0 })
  await page.waitForTimeout(100)

  const topWithinTimeline = async (locator) => {
    const [rowBox, timelineBox] = await Promise.all([locator.boundingBox(), timeline.boundingBox()])
    if (!rowBox || !timelineBox) throw new Error('timeline geometry is unavailable')
    return rowBox.y - timelineBox.y
  }
  const beforeTop = await topWithinTimeline(earlier)
  const scrollBefore = await timeline.evaluate((element) => element.scrollTop)
  const started = Date.now()
  const steps = [{ at: 0, step: '395 earlier events visible' }]
  await earlier.click()
  steps.push({ at: Date.now() - started, step: 'press load earlier' })
  await timeline.getByText('history event 196', { exact: true }).waitFor({ state: 'attached', timeout: 10_000 })
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  const afterTop = await topWithinTimeline(earlier)
  const scroll = await timeline.evaluate((element) => ({
    top: element.scrollTop,
    gap: element.scrollHeight - element.clientHeight - element.scrollTop,
  }))

  steps.push({ at: Date.now() - started, step: 'earlier page settled' })
  const facts = {
    beforeTop, afterTop, movement: afterTop - beforeTop, scrollBefore, scrollAfter: scroll.top,
    bottomGap: scroll.gap, errors,
  }
  facts.pass = Math.abs(facts.movement) <= 1 && Math.abs(scroll.top - scrollBefore) <= 1
    && scroll.gap > 100 && errors.length === 0
  writeFileSync(join(out, 'result.json'), JSON.stringify(facts, null, 2))
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events: steps }, null, 2))
  await page.waitForTimeout(500)
  await page.close()
  await video?.saveAs(join(out, 'timeline-load-earlier-position.webm'))
  await context.close()
  assert.ok(Math.abs(afterTop - beforeTop) <= 1, `pressed earlier control moved ${Math.round(afterTop - beforeTop)}px`)
  assert.ok(Math.abs(scroll.top - scrollBefore) <= 1, `back-load changed scrollTop by ${Math.round(scroll.top - scrollBefore)}px`)
  assert.ok(scroll.gap > 100, `back-load jumped to the bottom (gap ${scroll.gap}px)`)
  assert.deepEqual(errors, [], 'no page errors')
  console.log(JSON.stringify({ ok: true, ...facts, out }))
} finally {
  await browser?.close()
  await vite?.close()
}
