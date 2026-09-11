// YATU regression for [[diff-document]]: a graph refresh is live board bookkeeping, not a navigation away
// from the file being reviewed. The CodeMirror scroll node and its reading position must survive it.
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
const out = resolve(process.env.OUT || join(tmpdir(), 'diff-scroll-survives-refresh-e2e'))
const sessionId = 'diff-scroll-survives-refresh'

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

const now = Date.now()
const session = {
  id: sessionId, branch: `node/${sessionId}`, path: '/tmp/diff-scroll-fixture',
  label: 'long diff review', headline: 'long diff review', title: 'long diff review',
  raw: { name: 'long diff review', title: null }, harness: 'codex', capabilities: { headless: false }, launcher: null,
  status: 'working', lifecycle: 'active', proposal: null, merges: 0, liveness: 'online', parent: null,
  note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null,
  created: now, activity: null, sortKey: now, files: [], web: [],
}
const graph = { sessions: [session], specs: [], files: [], issues: [] }
const oldLines = Array.from({ length: 260 }, (_, index) => `-old version line ${index + 1}`)
const newLines = Array.from({ length: 260 }, (_, index) => `+new version line ${index + 1}`)
const patch = `@@ -1,260 +1,260 @@\n${[...oldLines, ...newLines].join('\n')}`
const diff = {
  branch: session.branch, baseRef: 'main', head: '1'.repeat(40), base: '2'.repeat(40), branchState: 'open',
  files: [{ path: 'src/long-review-file.js', status: 'modified', additions: 260, deletions: 260, diffIdentity: 'fixture-diff', patch }],
  working: { readable: true, files: [] }, comments: [],
}

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
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'), '@codemirror/state': join(modules, '@codemirror', 'state'),
      '@codemirror/view': join(modules, '@codemirror', 'view'), '@codemirror/merge': join(modules, '@codemirror', 'merge'),
      '@codemirror/language': join(modules, '@codemirror', 'language'), '@codemirror/lang-javascript': join(modules, '@codemirror', 'lang-javascript'),
      '@lezer/highlight': join(modules, '@lezer', 'highlight'),
      '@spexcode/archify/browser': join(modules, '@spexcode', 'archify', 'browser.mjs'),
      '@spexcode/archify/diagram.css': join(modules, '@spexcode', 'archify', 'assets', 'diagram.css'),
      '@spexcode/archify': join(modules, '@spexcode', 'archify', 'index.mjs'),
      '@spexcode/spec-cli/ranker': join(modules, '@spexcode', 'spec-cli', 'dist', 'ranker.js'),
      '@spexcode/spec-core/graph-delta': join(modules, '@spexcode', 'spec-core', 'dist', 'graph-delta.js'),
      '@spexcode/spec-core/review': join(modules, '@spexcode', 'spec-core', 'dist', 'review', 'index.js'),
      '@spexcode/spec-core/identity': join(modules, '@spexcode', 'spec-core', 'dist', 'identity-presets.js'),
      '@spexcode/transcript/frames': join(modules, '@spexcode', 'transcript', 'dist', 'frames.js'),
      '@spexcode/transcript-ui/styles.css': join(modules, '@spexcode', 'transcript-ui', 'styles.css'),
      '@spexcode/transcript-ui': join(modules, '@spexcode', 'transcript-ui', 'dist', 'index.js'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true },
  })
  await vite.listen()

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', permissions: ['clipboard-read', 'clipboard-write'] })
  await context.addInitScript(() => {
    localStorage.removeItem('spexcode.tabs.root')
    const streams = []
    class FixtureEventSource {
      constructor() { this.listeners = new Map(); streams.push(this) }
      addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) }
      close() {}
      emit(name, data = '') { for (const fn of this.listeners.get(name) || []) fn({ data }) }
    }
    class FixtureWebSocket {
      constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); setTimeout(() => { this.readyState = 1; this.emit('open', {}) }, 0) }
      addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) }
      removeEventListener(name, fn) { this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== fn)) }
      emit(name, event) { for (const fn of this.listeners.get(name) || []) fn(event); this[`on${name}`]?.(event) }
      send() {}
      close() { this.readyState = 3; this.emit('close', {}) }
    }
    window.EventSource = FixtureEventSource
    window.WebSocket = FixtureWebSocket
    window.__refreshGraph = () => streams.at(-1)?.emit('graph-changed')
  })
  const page = await context.newPage()
  const errors = []
  let graphReads = 0
  page.on('pageerror', (error) => errors.push(String(error)))
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/**', json({}, 404))
  await page.route('**/api/graph*', (route) => { graphReads += 1; return json(graph)(route) })
  await page.route(`**/api/sessions/${sessionId}/diff*`, json(diff))
  await page.route('**/api/sessions/archive-index*', json([]))
  await page.route('**/api/slash-commands*', json([]))
  await page.route('**/api/settings*', json({ launchers: [], default: null }))

  await page.goto(`http://127.0.0.1:${uiPort}/#/sessions/${sessionId}?surface=diff`, { waitUntil: 'domcontentloaded' })
  const editor = page.locator('.diff-editor .cm-scroller')
  await editor.waitFor({ state: 'visible', timeout: 30_000 })
  const content = page.locator('.diff-editor .cm-content').first()
  const contentBox = await content.boundingBox()
  const lineHeight = await content.evaluate((element) => Number.parseFloat(getComputedStyle(element).lineHeight))
  assert.ok(contentBox && Number.isFinite(lineHeight), 'the diff content exposes native selection geometry')
  await page.mouse.move(contentBox.x + 8, contentBox.y + lineHeight * 2.5)
  await page.mouse.down()
  await page.mouse.move(contentBox.x + 180, contentBox.y + lineHeight * 8.5, { steps: 8 })
  await page.mouse.up()
  const selected = await page.evaluate(() => window.getSelection()?.toString() || '')
  assert.ok(selected.includes('old version line 3'), `the diff body must keep browser selection, got ${JSON.stringify(selected)}`)
  await page.keyboard.press('Control+c')
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  assert.equal(copied, selected, 'native copy must receive exactly the selected diff text')
  await page.evaluate(() => {
    const input = document.createElement('textarea')
    input.id = 'paste-audit'
    document.body.appendChild(input)
    input.focus()
  })
  await page.keyboard.press('Control+v')
  const pasted = await page.locator('#paste-audit').inputValue()
  assert.equal(pasted, selected, 'native paste must accept the copied diff text in an ordinary input')
  await page.locator('#paste-audit').evaluate((input) => input.remove())
  const commentGutter = page.locator('.diff-editor .cm-lineNumbers .cm-gutterElement:visible').first()
  await commentGutter.click()
  await page.locator('.diff-comment-compose').waitFor({ state: 'visible', timeout: 10_000 })
  const commentOpened = true
  await page.locator('.diff-comment-compose button').first().click()
  await editor.hover()
  await page.mouse.wheel(0, 1800)
  await page.waitForTimeout(250)
  const before = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('.diff-editor, .diff-editor .cm-scroller')]
    const owner = candidates.sort((left, right) => right.scrollTop - left.scrollTop)[0]
    owner.dataset.scrollAudit = 'reader-position'
    return { tag: owner.className, top: Math.round(owner.scrollTop), max: owner.scrollHeight - owner.clientHeight }
  })
  assert.ok(before.max > 500, `the fixture must have a long scrollable diff, got ${JSON.stringify(before)}`)
  assert.ok(before.top > 200, `the wheel must park the reader away from the top, got ${JSON.stringify(before)}`)
  await page.screenshot({ path: join(out, 'before-refresh.png') })

  await page.evaluate(() => window.__refreshGraph())
  const started = Date.now()
  while (graphReads < 2 && Date.now() - started < 10_000) await page.waitForTimeout(50)
  assert.ok(graphReads >= 2, 'the graph refresh must reach the product')
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => {
    const tagged = document.querySelector('[data-scroll-audit="reader-position"]')
    const candidates = [...document.querySelectorAll('.diff-editor, .diff-editor .cm-scroller')]
    const owner = candidates.sort((left, right) => right.scrollTop - left.scrollTop)[0]
    return { sameNode: tagged === owner, top: Math.round(owner.scrollTop), max: owner.scrollHeight - owner.clientHeight }
  })
  await page.screenshot({ path: join(out, 'after-refresh.png') })
  const report = {
    dashboardRoot, graphReads, before, after, errors,
    nativeSelection: { chars: selected.length, copied: copied === selected, pasted: pasted === selected, commentOpened },
  }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'the browser reports no product errors')
  assert.equal(after.sameNode, true, 'an unrelated graph refresh keeps the mounted diff scroller')
  assert.ok(Math.abs(after.top - before.top) <= 1, `the graph refresh moved the reader from ${before.top}px to ${after.top}px`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
}
