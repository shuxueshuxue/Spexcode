// Real-browser evidence for [[gugu-atlas-tab]]: the tab's own scripts, loaded the way gugu loads them —
// classic <script> tags from one origin, sharing one global scope — driven against a stub of the documented
// `window.gugu` surface over a real spec tree.
//
// This is the probe the unit checks cannot be. `distribution.test.mjs` evaluates the page's helpers one file
// at a time, which is how a collision between two files stayed invisible until a real Electron run reported
// `SyntaxError: Identifier "buildTree" has already been declared` and the whole tab rendered nothing. Parsing
// the scripts together is now an automated check; ACTUALLY RUNNING them — the bridge, the tree, a node's body,
// archify drawing a diagram.json, and the one button that starts an agent — needs a browser, so it lives here
// beside the dashboard's other hand-run probes.
//
// The package is served from a real origin through request interception rather than a static server, because
// `file://` cannot resolve the page's relative dynamic import of archify.mjs.
//
//   node scripts/gugu-tab.e2e.mjs                 # over this repository's own .spec tree
//   REPO=/path/to/other/repo node scripts/gugu-tab.e2e.mjs
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, extname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const PKG = resolve(process.env.PKG || join(here, '..', 'distribution', 'gugu', 'spexcode-atlas'))
const REPO = resolve(process.env.REPO || join(here, '..'))
const ORIGIN = 'https://ext.invalid'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1400, height: 980 } })
const errors = []
page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`) })

await page.route(`${ORIGIN}/**`, async (route) => {
  const file = join(PKG, new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html')
  if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not in the package' })
  await route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
})
// The host bridge: only the methods the manifest's capabilities justify, answering from the real tree.
await page.exposeBinding('__listFiles', (_s, dir) => readdirSync(join(REPO, dir), { withFileTypes: true })
  .map((e) => ({ path: relative(REPO, join(REPO, dir, e.name)), kind: e.isDirectory() ? 'directory' : 'file' })))
await page.exposeBinding('__readFile', (_s, path) => readFileSync(join(REPO, path), 'utf8'))
await page.addInitScript(() => {
  window.__events = { spawned: null, errors: [] }
  window.gugu = {
    getContext: async () => ({ capabilities: ['workspace:read', 'agents:control'], themeMode: 'dark' }),
    onContextChanged: () => {}, onCommand: (cb) => { window.__onCommand = cb }, onFilesChanged: (cb) => { window.__onFiles = cb },
    listFiles: (dir) => window.__listFiles(dir), readFile: (path) => window.__readFile(path),
    spawnAgent: async (prompt, name) => { window.__events.spawned = { name, prompt: String(prompt) }; return true },
    reportError: async (message) => { window.__events.errors.push(message) },
    openBrowserTab: () => {},
  }
})

await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' })
// Errors first: a page whose script did not parse renders nothing, and "nothing appeared" is a far worse
// report than the reason it did not. This is the exact failure a real Electron run saw.
await page.waitForTimeout(1500)
assert.equal(errors.length, 0, `the page must load with no error: ${errors.join(' | ')}`)
await page.waitForFunction(() => document.getElementById('atlas') && !document.getElementById('atlas').hidden, null, { timeout: 30_000 })

const rowCount = await page.evaluate(() => document.querySelectorAll('.row').length)
assert.ok(rowCount > 0, 'the spec tree renders at least one node')

// A node with a diagram: archify draws it in the page, with one focusable box per component.
const withDiagram = await page.evaluate(() => {
  const marked = [...document.querySelectorAll('.row')].find((r) => r.querySelector('.has-diagram'))
  if (marked) { marked.click(); return marked.textContent.trim() }
  return null
})
if (withDiagram) {
  await page.waitForFunction(() => !document.getElementById('diagram').hidden, null, { timeout: 15_000 })
  const boxes = await page.evaluate(() => document.querySelectorAll('#diagram-box svg [data-node-id]').length)
  assert.ok(boxes > 0, `'${withDiagram}' draws its diagram.json as boxes`)
  const failed = await page.evaluate(() => !!document.querySelector('.diagram-error'))
  assert.equal(failed, false, `'${withDiagram}' draws without archify reporting a reason`)
}

// A node's own page: title, description, governed file and body all come from its spec.md.
const shown = await page.evaluate(() => ({
  title: document.getElementById('title').textContent,
  body: document.getElementById('body').textContent.length,
}))
assert.ok(shown.title.length > 0, 'the selected node shows its title')
assert.ok(shown.body > 0, 'the selected node shows its body')

// The one action: it hands the atlas instructions to the host and says so, and writes nothing itself.
await page.click('#draw')
await page.waitForFunction(() => window.__events.spawned !== null, null, { timeout: 15_000 })
const spawned = await page.evaluate(() => window.__events)
assert.match(spawned.spawned.prompt, /Draw the SpexCode atlas of this repository/)
assert.equal(spawned.errors.length, 0, 'no capability was reported missing')
assert.match(await page.evaluate(() => document.getElementById('status').textContent), /agent/i)
assert.equal(errors.length, 0, `no error may appear at any point: ${errors.join(' | ')}`)

console.log(`gugu tab e2e: ok — ${rowCount} node row(s), diagram node ${withDiagram ?? '(none in this tree)'}, agent started, 0 page errors`)
await browser.close()
