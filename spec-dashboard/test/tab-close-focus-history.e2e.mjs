// YATU proof for [[tab-strip]]'s close heir rule: closing returns the reader where they came from, SAME
// KIND FIRST. Scene A checks the focus history beats the positional neighbour across board kinds; Scene B
// checks same-kind recency beats both a nearer same-kind tab and a more recently focused other-kind tab.
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
const out = resolve(process.env.OUT || '/tmp/tab-close-focus-history-e2e')
const port = Number(process.env.PORT || 5403)
const base = `http://127.0.0.1:${port}`

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const board = await fetch(`${apiUrl}/api/graph`).then((r) => { assert.equal(r.ok, true, 'backend /api/graph'); return r.json() })
const node = (board.nodes || []).find((n) => n.parent && /^[a-z][a-z0-9-]*$/.test(n.id))
assert.ok(node, 'one addressable spec node required')

const { createServer } = await import(pathToFileURL(viteEntry).href)
const ui = await createServer({
  root: dashboardRoot, configFile: join(dashboardRoot, 'vite.config.js'),
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': { target: apiUrl, ws: true } } },
})
await ui.listen()
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

const strip = () => page.locator('[role="tab"][data-tab-key]:visible').evaluateAll((t) => t.map((x) => x.dataset.tabKey))
const go = async (hash) => {
  await page.evaluate((h) => { window.location.hash = h }, hash)
  await page.waitForTimeout(450)
}
const closeActive = async () => {
  const active = page.locator('[role="tab"][data-tab-key][aria-selected="true"]:visible').first()
  await active.locator('.tab-x').click()
  await page.waitForTimeout(600)
  return page.evaluate(() => location.hash)
}
const fresh = async (hash) => {
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('spexcode.tabs'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[role="tab"][data-tab-key]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(700)
}

try {
  // Scene A — the focus history, not the positional neighbour. Issues sits beside Evals in the strip;
  // #/spec is where the reader actually came from.
  await fresh('#/spec')
  await go('#/evals'); await go('#/issues'); await go('#/spec'); await go('#/evals')
  const sceneAStrip = await strip()
  const sceneA = await closeActive()
  await page.screenshot({ path: join(out, 'scene-a.png'), fullPage: true })

  // Scene B — same kind first, and same-kind recency over same-kind distance. README and CLAUDE.md are
  // held by double-click; package.json takes the replaceable file slot.
  await fresh('#/file/README.md')
  await page.locator('[data-tab-key="#/file/README.md"]').dblclick()
  await page.waitForTimeout(350)
  await go('#/file/CLAUDE.md')
  await page.locator('[data-tab-key="#/file/CLAUDE.md"]').dblclick()
  await page.waitForTimeout(350)
  await go(`#/spec/${encodeURIComponent(node.id)}`)
  await go('#/file/package.json')
  await go('#/file/README.md')
  await go(`#/spec/${encodeURIComponent(node.id)}`)
  await go('#/file/package.json')
  const sceneBStrip = await strip()
  const sceneB = await closeActive()
  const sceneBAfter = await strip()
  await page.screenshot({ path: join(out, 'scene-b.png'), fullPage: true })

  const report = { sceneA: { strip: sceneAStrip, landed: sceneA }, sceneB: { before: sceneBStrip, landed: sceneB, after: sceneBAfter }, browserErrors: errors }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.equal(sceneA, '#/spec', 'Scene A must land on the tab the reader was on before Evals, not the positional neighbour')
  assert.equal(sceneB, '#/file/README.md', 'Scene B must land on the most recently focused surviving tab of the SAME kind')
  assert.deepEqual(sceneBAfter, sceneBStrip.filter((key) => key !== '#/file/package.json'), 'only the closed tab leaves the strip')
  assert.ok(errors.length === 0, `browser errors: ${errors.join(' | ')}`)
} finally { await page.close(); await browser.close(); await ui.close() }
