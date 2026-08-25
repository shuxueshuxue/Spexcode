// YATU proof for [[tab-strip]]'s hold whitelist across EVERY row surface that lists a workspace object.
// One law, five surfaces: the law says ctrl/⌘-click, a double-click, and a document's own explicit
// "open in a new tab" action are the gestures that mint a tab. This run performs each of them through the
// real dashboard against the running backend and reports how many surfaces kept it.
//
// Each probe establishes a same-kind SLOT first, then performs the gesture on a DIFFERENT object: a
// surface that honours the law ends with one more tab, held (no `.slot` class); a surface that ignores it
// replaces the slot and the count never moves. That distinction is why the slot is established first —
// a deep link into an empty workspace also mints a tab, and would read as a false pass.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = resolve(root, '..', '..')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const apiUrl = process.env.API_URL || 'http://127.0.0.1:8787'
const out = resolve(process.env.OUT || '/tmp/tab-hold-surfaces-e2e')
const port = Number(process.env.PORT || 5293)
const base = `http://127.0.0.1:${port}`
const HOLD = process.platform === 'darwin' ? 'Meta' : 'Control'

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })

const board = await fetch(`${apiUrl}/api/graph`).then((r) => { assert.equal(r.ok, true, 'backend /api/graph'); return r.json() })
const liveSessions = (board.sessions || []).filter((s) => s.id && !s.archived)
assert.ok(liveSessions.length >= 3, `three live sessions required, have ${liveSessions.length}`)
const specNodes = (board.nodes || []).filter((n) => n.parent && /^[a-z][a-z0-9-]*$/.test(n.id))
assert.ok(specNodes.length >= 2, 'two addressable spec nodes required')
const [nodeA, nodeB] = specNodes

let anchorSession = null

const { createServer } = await import(pathToFileURL(viteEntry).href)
const ui = await createServer({
  root: dashboardRoot,
  configFile: join(dashboardRoot, 'vite.config.js'),
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/api': { target: apiUrl, ws: true } } },
})
await ui.listen()
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1500, height: 940 }, recordVideo: { dir: out } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

// The workspace strip is drawn once per SHOWING document host; pooled hidden documents keep their own
// copy mounted. Only the visible strip is the workspace the reader sees, so only it is measured.
const tabState = () => page.locator('[role="tab"][data-tab-key]:visible')
  .evaluateAll((tabs) => tabs.map((tab) => ({ key: tab.dataset.tabKey, held: !tab.classList.contains('slot') })))

// A probe always starts from a known workspace: no persisted tabs, then one plain navigation that mints
// exactly one slot of the kind the gesture will be measured on.
const settle = async (hash, ready) => {
  await page.evaluate(() => localStorage.removeItem('spexcode.tabs'))
  await page.goto(`${base}/${hash}`, { waitUntil: 'domcontentloaded' })
  await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 })
  await page.waitForTimeout(600)
}

// One settled Sessions workspace: the anchor session holds the only session slot, and the returned list
// starts with it so every probe acts on a DIFFERENT visible row.
const sessionsOnScreen = async () => {
  await settle(`#/sessions/${anchorSession.id}`, sessionsReady)
  const shown = await visibleSessionIds()
  const others = shown.filter((id) => id !== anchorSession.id)
  assert.ok(others.length, 'the forest must show a second session row')
  return [anchorSession.id, others[0]]
}

const results = []
const probe = async (surface, gesture, run) => {
  try {
    const before = await run()
    results.push({ surface, gesture, ...before })
  } catch (error) {
    results.push({ surface, gesture, held: false, error: String(error?.message || error) })
  }
}

const sessionsReady = '.si-list .si-item[data-sid]'
const sessionRow = (id) => page.locator(`.si-list .si-item[data-sid="${id}"]`)
// The rows the forest is actually SHOWING — folded zones and collapsed subtrees are not clickable
// surfaces, so the probes take their objects from what the product rendered rather than from the board.
const visibleSessionIds = () => page.locator('.si-list .si-item[data-sid]:visible').evaluateAll((rows) => rows.map((row) => row.dataset.sid))

// A gesture's verdict: the tab list before, the tab list after, and whether the arriving tab is HELD.
const verdict = (before, after, key) => {
  const arrived = after.find((tab) => tab.key === key)
  return {
    held: !!arrived?.held && after.length === before.length + 1,
    before: before.map((t) => t.key),
    after: after.map((t) => `${t.key}${t.held ? '' : ' (slot)'}`),
  }
}

try {
  await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator(sessionsReady).first().waitFor({ state: 'visible', timeout: 60_000 })
  const shownFirst = await visibleSessionIds()
  assert.ok(shownFirst.length >= 2, `the forest must show two session rows, showed ${shownFirst.length}`)
  anchorSession = liveSessions.find((s) => s.id === shownFirst[0]) || { id: shownFirst[0] }

  // 1 — the Sessions page's own forest row, ctrl/⌘-click.
  await probe('sessions-page forest row', 'ctrl/⌘-click', async () => {
    const [, other] = await sessionsOnScreen()
    const before = await tabState()
    await sessionRow(other).click({ modifiers: [HOLD] })
    await page.waitForTimeout(700)
    return verdict(before, await tabState(), `#/sessions/${other}`)
  })

  // 2 — the same row, double-click.
  await probe('sessions-page forest row', 'double-click', async () => {
    const [, other] = await sessionsOnScreen()
    const before = await tabState()
    await sessionRow(other).dblclick()
    await page.waitForTimeout(700)
    return verdict(before, await tabState(), `#/sessions/${other}`)
  })

  // 3 — the session row's own context menu action.
  await probe('session row context menu', 'open in a new tab', async () => {
    const [, other] = await sessionsOnScreen()
    const before = await tabState()
    await sessionRow(other).click({ button: 'right' })
    const item = page.getByRole('menuitem', { name: 'open in a new tab' })
    await item.waitFor({ state: 'visible', timeout: 5_000 })
    await item.click()
    await page.waitForTimeout(700)
    return verdict(before, await tabState(), `#/sessions/${other}`)
  })

  // 4 — the graph node's context menu action (the spec document, held).
  await probe('graph node context menu', 'open in a new tab', async () => {
    await settle(`#/spec/${encodeURIComponent(nodeA.id)}`, '.tabstrip-tabs [role="tab"]')
    const before = await tabState()
    await page.goto(`${base}/#/graph/${encodeURIComponent(nodeB.id)}`, { waitUntil: 'domcontentloaded' })
    const node = page.locator('.react-flow__node.selected')
    await node.waitFor({ state: 'visible', timeout: 60_000 })
    await node.click({ button: 'right' })
    const item = page.getByRole('menuitem', { name: 'open in a new tab' })
    await item.waitFor({ state: 'visible', timeout: 5_000 })
    await item.click()
    await page.waitForTimeout(800)
    return verdict(before, await tabState(), `#/spec/${nodeB.id}`)
  })

  // 5 — the search palette row, ctrl/⌘-click.
  await probe('search palette row', 'ctrl/⌘-click', async () => {
    await settle(`#/spec/${encodeURIComponent(nodeA.id)}`, '.tabstrip-tabs [role="tab"]')
    const before = await tabState()
    await page.keyboard.press('Alt+Slash')
    await page.locator('.search-panel').waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('.search-input').fill(nodeB.id)
    const row = page.locator(`.search-item[data-kind="spec"][data-target="${nodeB.id}"]`)
    await row.waitFor({ state: 'visible', timeout: 10_000 })
    await row.click({ modifiers: [HOLD] })
    await page.waitForTimeout(800)
    return verdict(before, await tabState(), `#/spec/${nodeB.id}`)
  })

  const kept = results.filter((r) => r.held)
  await page.screenshot({ path: join(out, 'tab-hold-final.png'), fullPage: true })
  const report = {
    population: `${kept.length} of ${results.length} row surfaces keep the hold gesture`,
    results,
    browserErrors: errors,
    screenshot: join(out, 'tab-hold-final.png'),
    video: await page.video()?.path(),
  }
  console.log(JSON.stringify(report, null, 2))
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  assert.equal(kept.length, results.length, report.population)
} finally {
  await context.close(); await browser.close(); await ui.close()
}
