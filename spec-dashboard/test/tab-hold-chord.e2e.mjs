// YATU proof for the KEYBOARD half of [[tab-strip]]'s hold. Every pointer gesture names the address under
// the cursor; a keyboard has only the document already showing, so the chord holds that one — and it has to
// be reachable and legible from the one binding registry, not typed into a label ([[keyboard-nav]]).
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const viteEntry = join(resolve(root, '..', '..'), 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787'
const out = resolve(process.env.OUT || '/tmp/tab-hold-chord-e2e')
const port = Number(process.env.PORT || 5395)
const base = `http://127.0.0.1:${port}`

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const board = await fetch(`${apiUrl}/api/graph`).then((r) => { assert.equal(r.ok, true, 'backend /api/graph'); return r.json() })
const session = (board.sessions || []).find((s) => s.id && !s.archived)
assert.ok(session, 'one live session required')

const { createServer } = await import(pathToFileURL(viteEntry).href)
const ui = await createServer({
  root: dashboardRoot, configFile: join(dashboardRoot, 'vite.config.js'),
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': { target: apiUrl, ws: true } } },
})
await ui.listen()
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
const tabs = () => page.locator('[role="tab"][data-tab-key]:visible')
  .evaluateAll((list) => list.map((tab) => ({ key: tab.dataset.tabKey, held: !tab.classList.contains('slot') })))

try {
  // A session reached by ADDRESS lands in the replaceable slot — which is exactly the reader the chord is
  // for: they never clicked a row, so no pointer gesture was ever offered to them.
  await page.goto(`${base}/#/sessions/${session.id}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('spexcode.tabs'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[role="tab"][data-tab-key]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(800)
  const before = await tabs()
  await page.keyboard.press('Alt+Shift+KeyP')
  await page.waitForTimeout(600)
  const after = await tabs()
  await page.screenshot({ path: join(out, 'chord-hold.png'), fullPage: true })

  // The legend must name the chord WITH its modifiers, resolved from the registry. The session console owns
  // every key on its own page, so the help modal is asked for on the board that opens it.
  await page.goto(`${base}/#/graph`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  await page.keyboard.press('?')
  await page.locator('.legend-row').first().waitFor({ state: 'visible', timeout: 20_000 })
  const legend = await page.locator('.legend-row').evaluateAll((rows) => rows
    .map((row) => ({ keys: row.querySelector('.keymap-keys')?.textContent?.trim(), desc: row.querySelector('.legend-desc')?.textContent?.trim() }))
    .filter((row) => /hold the active tab/i.test(row.desc || '')))
  await page.screenshot({ path: join(out, 'chord-legend.png'), fullPage: true })

  const report = { before, after, legend, browserErrors: errors, evidence: out }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(before.map((t) => t.held), [false], 'an addressed session must start as the replaceable slot')
  assert.deepEqual(after.map((t) => ({ key: t.key, held: t.held })), [{ key: `#/sessions/${session.id}`, held: true }],
    'the chord must hold the showing tab, without changing which tab it is')
  assert.equal(legend.length, 1, 'the legend must name the chord exactly once')
  assert.equal(legend[0].keys, '⌥⇧P', 'the legend must print the chord with every modifier it has')
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
} finally { await page.close(); await browser.close(); await ui.close() }
