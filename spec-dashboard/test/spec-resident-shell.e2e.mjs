// Deterministic browser contract for the resident Spec canvas. The fixture stays in the page's network
// boundary, so this proves the real shell/tab/view path without borrowing a shared backend or session.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:5280'
const OUT = resolve(process.env.OUT || '/tmp/spec-resident-shell-e2e')
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text())
})
const node = { id: 'root', title: 'Root spec', status: 'active', parent: null, body: '# Root spec\n\nReadable prose.', code: ['src/app.js'] }
const board = { nodes: [node], sessions: [], issuesStamp: null }
try {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
    if (pathname === '/api/specs/root/content') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: node.body, parts: null }) })
    if (pathname === '/api/source') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ size: 18, offset: 0, bytes: 18, text: 'export const app = 1', eof: true }) })
    if (pathname === '/api/projects') return route.fulfill({ status: 404, body: 'not found' })
    if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-sessions').waitFor({ state: 'attached' })
  const resident = page.locator('.tab[data-tab-key="#/spec"]')
  await resident.waitFor({ state: 'visible' })
  assert.equal((await resident.locator('.tab-label').textContent())?.trim(), 'Spec')
  await resident.locator('.tab-face').click()
  await page.waitForURL(/#\/spec$/)
  await page.locator('.viewhost.view-spec .graphview').waitFor({ state: 'visible' })
  assert.equal(await page.locator('.filetree').count(), 1, 'Spec canvas keeps the Explorer dock')
  assert.deepEqual((await page.locator('.ft-section-name').allTextContents()).map((text) => text.trim()), ['Specs', 'Files'])
  // Keep the already-booted board while opening the node, as a user click does; a full reload would
  // conflate the document transition with cold backend readiness.
  await page.evaluate(() => { location.hash = '#/spec/root' })
  await page.waitForURL(/#\/spec\/root/)
  await page.locator('.viewhost.view-spec .specview').waitFor({ state: 'visible' })
  await page.locator('.ft-row.ft-node').first().click()
  await page.locator('.ft-row.ft-code').first().click()
  await page.waitForURL(/#\/file\/src%2Fapp\.js|#\/file\/src\/app\.js/)
  await page.locator('.viewhost.view-file .cm-editor').waitFor({ state: 'visible' })
  const tabs = await page.locator('[role="tab"]:visible').evaluateAll((items) => items.map((tab) => ({ label: tab.querySelector('.tab-label')?.textContent?.trim(), active: tab.getAttribute('aria-selected') === 'true' })))
  assert.deepEqual(tabs, [{ label: 'Spec', active: false }, { label: 'app.js', active: true }])
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  await page.screenshot({ path: resolve(OUT, 'spec-resident-file-focus.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, tabs, sections: ['Specs', 'Files'], screenshot: resolve(OUT, 'spec-resident-file-focus.png') }))
} finally {
  await page.close(); await browser.close()
}
