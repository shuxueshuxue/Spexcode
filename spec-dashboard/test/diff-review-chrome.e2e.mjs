// YATU regression for [[diff-document]]'s chrome and the [[diff-marks]] it draws with, through a real Chromium:
// the changed-file panel lists rows in the explorer's band (never a button's own border and face), a path
// gives at its FRONT while the leaf stays whole and the DOM still reads front to back, the toolbar and each
// scope heading carry the review's size, the fold band and the change tints follow the dashboard theme
// instead of the merge package's light defaults, wrapping reaches both split panes, the panel is a resizable
// pane, and a line comment is written in the shared composer shell.
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
const out = resolve(process.env.OUT || join(tmpdir(), 'diff-review-chrome-e2e'))
const sessionId = 'diff-review-chrome'

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
  id: sessionId, branch: `node/${sessionId}`, path: '/tmp/diff-review-chrome-fixture',
  label: 'diff review chrome', headline: 'diff review chrome', title: 'diff review chrome',
  raw: { name: 'diff review chrome', title: null }, harness: 'codex', capabilities: { headless: false }, launcher: null,
  status: 'working', lifecycle: 'active', proposal: null, merges: 0, liveness: 'online', parent: null,
  note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null,
  created: now, activity: null, sortKey: now, files: [], web: [],
}
const graph = { sessions: [session], specs: [], files: [], issues: [] }

// One hunk with a long unchanged run (so the viewer folds it) and a changed line far wider than any pane.
const lead = Array.from({ length: 30 }, (_, index) => ` unchanged context line ${index + 1}`)
const wide = 'a changed sentence that runs on well past the width of either split pane '.repeat(4).trim()
const patch = `@@ -1,32 +1,32 @@\n${lead.join('\n')}\n-the old ${wide}\n+the new ${wide}\n unchanged tail\n`
const DEEP = '.spec/spexcode/spec-dashboard/dashboard-ui/app-frame/mobile-ui/spec.md'
const row = (path, status, additions, deletions, extra = {}) => ({ path, status, additions, deletions, diffIdentity: `fixture:${path}`, patch: '', ...extra })
const branchFiles = [
  row(DEEP, 'modified', 15, 29, { patch }),
  row('.spec/spexcode/spec-dashboard/dashboard-ui/graph/focus-return/spec.md', 'modified', 11, 24),
  row('spec-dashboard/src/selectionController.js', 'added', 81, 0),
  row('spec-dashboard/src/readerSelection.js', 'deleted', 0, 14),
  row('spec-dashboard/test/conversation-scroll-survives-switch.e2e.mjs', 'modified', 22, 1),
]
const workingFiles = [
  row('packages/zcode/.zcode-plugin/plugin.json', 'renamed', 2, 2, { oldPath: 'packages/zcode/plugin.json' }),
  row('README.md', 'untracked', 21, 0),
]
const diff = {
  branch: session.branch, baseRef: 'main', head: '1'.repeat(40), base: '2'.repeat(40), branchState: 'open',
  files: branchFiles, working: { readable: true, files: workingFiles }, comments: [],
}
const sum = (files) => files.reduce((acc, file) => ({ files: acc.files + 1, add: acc.add + file.additions, del: acc.del + file.deletions }), { files: 0, add: 0, del: 0 })
const LETTER = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U' }

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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  await context.addInitScript(() => {
    localStorage.removeItem('spexcode.tabs.root')
    localStorage.removeItem('spex.diffPanelWidth')
    class FixtureEventSource { constructor() { this.listeners = new Map() } addEventListener(name, fn) { this.listeners.set(name, [...(this.listeners.get(name) || []), fn]) } close() {} }
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
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  await page.route('**/api/**', json({}, 404))
  await page.route('**/api/graph*', json(graph))
  await page.route(`**/api/sessions/${sessionId}/diff*`, json(diff))
  await page.route('**/api/sessions/archive-index*', json([]))
  await page.route('**/api/slash-commands*', json([]))
  await page.route('**/api/settings*', json({ launchers: [], default: null }))

  await page.goto(`http://127.0.0.1:${uiPort}/#/sessions/${sessionId}?surface=diff`, { waitUntil: 'domcontentloaded' })
  await page.locator('.diff-editor .cm-editor').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.cm-collapsedLines').first().waitFor({ state: 'visible', timeout: 10_000 })
  await page.screenshot({ path: join(out, 'unified.png') })

  const chrome = await page.evaluate(() => {
    const style = (element) => getComputedStyle(element)
    const rows = [...document.querySelectorAll('.diff-tree-file')]
    const head = document.querySelector('.diff-file-head')
    const fold = document.querySelector('.cm-collapsedLines')
    return {
      rows: rows.map((element) => ({
        path: element.dataset.tip, border: style(element).borderTopWidth, background: style(element).backgroundColor,
        selected: element.getAttribute('aria-current') === 'true', status: element.querySelector('.diff-status')?.textContent,
        stat: element.querySelector('.diffstat')?.textContent,
      })),
      summary: document.querySelector('.diff-summary')?.textContent,
      zones: [...document.querySelectorAll('.diff-zone')].map((zone) => ({
        count: zone.querySelector('.si-zone-count')?.textContent, stat: zone.querySelector('.diffstat')?.textContent,
      })),
      headPath: head.querySelector('.path-label')?.textContent ?? null,
      headStatus: head.querySelector('.diff-status')?.textContent ?? null,
      fold: fold && { text: fold.textContent, image: style(fold).backgroundImage, color: style(fold).backgroundColor },
    }
  })

  // the explorer band, not a button's border and face
  assert.equal(chrome.rows.length, branchFiles.length + workingFiles.length, 'every changed file has one row')
  for (const item of chrome.rows) {
    assert.equal(item.border, '0px', `${item.path} is drawn with a border`)
    if (!item.selected) assert.equal(item.background, 'rgba(0, 0, 0, 0)', `${item.path} rests on a face of its own`)
  }
  // the one status letter per row, in git's vocabulary, and the row's own tally
  const expectedRows = [...branchFiles, ...workingFiles]
  for (const file of expectedRows) {
    const item = chrome.rows.find((candidate) => candidate.path === file.path)
    assert.ok(item, `${file.path} has a row`)
    assert.equal(item.status, LETTER[file.status], `${file.path} status`)
    assert.equal(item.stat, `+${file.additions}−${file.deletions}`, `${file.path} tally`)
  }
  // the review's size in the toolbar, and each scope's share under its heading
  const total = sum(expectedRows)
  assert.match(chrome.summary, new RegExp(`^${total.files} files changed\\+${total.add}−${total.del}$`), chrome.summary)
  const branchSum = sum(branchFiles); const workingSum = sum(workingFiles)
  assert.deepEqual(chrome.zones, [
    { count: String(branchSum.files), stat: `+${branchSum.add}−${branchSum.del}` },
    { count: String(workingSum.files), stat: `+${workingSum.add}−${workingSum.del}` },
  ])
  // the header's path reads front to back in the DOM — a copy or a screen reader gets the real path
  assert.equal(chrome.headPath, DEEP)
  assert.equal(chrome.headStatus, 'M')
  // the fold band is the dashboard's, not @codemirror/merge's light gradient
  assert.match(chrome.fold.text, /^\d+ unchanged lines$/)
  assert.equal(chrome.fold.image, 'none')

  // SPLIT + WRAP: the wide line wraps in both panes, so the new side is never pushed out of view
  await page.locator('.diff-toolbar .seg-option', { hasText: 'split' }).click()
  await page.locator('.cm-merge-b .cm-changedLine').first().waitFor({ state: 'visible', timeout: 10_000 })
  const split = await page.evaluate(() => {
    const line = (side) => [...document.querySelectorAll(`.cm-merge-${side} .cm-line`)].find((element) => element.textContent.includes('runs on well past'))
    const height = (element) => element?.getBoundingClientRect().height || 0
    const lineHeight = parseFloat(getComputedStyle(document.querySelector('.cm-merge-b .cm-line')).lineHeight)
    return { a: height(line('a')), b: height(line('b')), lineHeight, pressed: document.querySelector('.diff-toolbar .seg-option.on')?.textContent }
  })
  await page.screenshot({ path: join(out, 'split-wrapped.png') })
  assert.equal(split.pressed, 'split')
  assert.ok(split.a > split.lineHeight * 1.5 && split.b > split.lineHeight * 1.5, `split panes must wrap the wide line: ${JSON.stringify(split)}`)

  // A NARROW PANE: the directories give at their front, the leaf stays whole
  await page.setViewportSize({ width: 900, height: 800 })
  await page.waitForTimeout(250)
  const narrow = await page.evaluate(() => {
    const head = document.querySelector('.diff-file-head')
    const dir = head.querySelector('.path-dir'); const leaf = head.querySelector('.path-leaf')
    const style = getComputedStyle(dir)
    return {
      dirClipped: dir.scrollWidth > dir.clientWidth + 1, leafWhole: leaf.scrollWidth <= leaf.clientWidth + 1,
      direction: style.direction, overflow: style.textOverflow, text: head.querySelector('.path-label').textContent,
    }
  })
  await page.screenshot({ path: join(out, 'narrow-front-gives.png') })
  assert.deepEqual(narrow, { dirClipped: true, leafWhole: true, direction: 'rtl', overflow: 'ellipsis', text: DEEP })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForTimeout(250)

  // THE PANEL IS A PANE: its seam drags wider and the width survives as the reader's choice
  const panelBefore = (await page.locator('.diff-file-panel').boundingBox()).width
  const seam = await page.locator('.diff-panel-resize').boundingBox()
  await page.mouse.move(seam.x + seam.width / 2, seam.y + 200)
  await page.mouse.down()
  await page.mouse.move(seam.x + seam.width / 2 + 120, seam.y + 200, { steps: 6 })
  await page.mouse.up()
  const panelAfter = (await page.locator('.diff-file-panel').boundingBox()).width
  const stored = await page.evaluate(() => localStorage.getItem('spex.diffPanelWidth'))
  assert.ok(panelAfter >= panelBefore + 100, `the seam must widen the panel: ${panelBefore} -> ${panelAfter}`)
  assert.equal(Number(stored), Math.round(panelAfter))

  // A LINE COMMENT is written in the shared composer shell, and Escape peels it
  await page.locator('.cm-merge-b .cm-line').nth(2).click()
  const composer = page.locator('.diff-comment-compose')
  await composer.waitFor({ state: 'visible', timeout: 5_000 })
  const shell = await composer.evaluate((element) => ({
    surface: element.classList.contains('composer-surface'), textarea: !!element.querySelector('textarea.composer-textarea'),
    focused: document.activeElement === element.querySelector('textarea'),
  }))
  await page.screenshot({ path: join(out, 'composer.png') })
  assert.deepEqual(shell, { surface: true, textarea: true, focused: true })
  await page.keyboard.press('Escape')
  await composer.waitFor({ state: 'detached', timeout: 5_000 })

  const report = { dashboardRoot, chrome, split, narrow, panel: { before: panelBefore, after: panelAfter, stored }, shell, errors }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'the browser reports no product errors')
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
}
