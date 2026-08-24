// YATU proof for the explicit empty workspace and the retired live graph rail entrance.
// Run with BASE pointing at this worktree's Vite server and OUT pointing at a persistent evidence folder.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5260'
const OUT = process.env.OUT || '/tmp/empty-workspace'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const response = await fetch(`${BASE.replace(/:\d+\/?$/, ':8787')}/api/sessions`)
if (!response.ok) throw new Error(`sessions API: ${response.status}`)
const sessions = await response.json()
const session = sessions.find((s) => !s.archived && s.id)
if (!session) throw new Error('no session fixture available')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  // A Vite-only fixture has no catalog gateway, so the shell's optional /projects probe is expected 404;
  // every product-route or chunk failure remains fatal.
  if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text())
})

// A cold boot without a hash is the daily sessions face. The explicit empty state is only the result of
// closing the last object, so the two states are measured separately rather than conflated.
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app-shell .side-rail', { timeout: 45_000 })
await page.waitForTimeout(400)
const fresh = await page.evaluate(() => ({ hash: location.hash, page: document.querySelector('.viewhost')?.className }))
if (fresh.hash !== '#/sessions' || !fresh.page?.includes('view-sessions')) throw new Error(`fresh route mismatch: ${JSON.stringify(fresh)}`)

// Seed one real session object into the persisted working set, then close it through the visible tab X.
await page.evaluate((id) => {
  localStorage.setItem('spexcode.tabs', JSON.stringify([{ page: 'sessions', param: id, query: null, pinned: true }]))
  location.hash = `#/sessions/${encodeURIComponent(id)}`
}, session.id)
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.viewhost.view-sessions .si-session-wrap', { timeout: 45_000 })
await page.locator('.tab[data-tab-key]').first().waitFor({ state: 'visible', timeout: 45_000 })
const railGraphBefore = await page.locator('.side-rail a[href="#/graph"]').count()
if (railGraphBefore !== 0) throw new Error('live rail still exposes graph anchor')
await page.screenshot({ path: join(OUT, 'session-before-close.png') })
await page.locator('.tab-x').first().click()
await page.waitForURL(/#\/empty$/, { timeout: 15_000 })
await page.waitForSelector('.viewhost.view-empty .empty-view', { timeout: 45_000 })
await page.waitForFunction(() => document.querySelectorAll('.tab').length === 0, null, { timeout: 15_000 })
const closed = await page.evaluate(() => ({
  hash: location.hash,
  title: document.querySelector('.empty-title')?.textContent?.trim(),
  tabs: document.querySelectorAll('.tab').length,
  graphRail: document.querySelectorAll('.side-rail a[href="#/graph"]').length,
}))
if (closed.hash !== '#/empty' || closed.tabs !== 0 || closed.graphRail !== 0 || !closed.title) throw new Error(`empty state mismatch: ${JSON.stringify(closed)}`)
await page.screenshot({ path: join(OUT, 'empty-after-last-session-close.png') })

// Unknown addresses must recover to the daily sessions route, not revive the graph.
await page.evaluate(() => { location.hash = '#/unknown-empty-workspace-route' })
await page.waitForURL(/#\/sessions$/, { timeout: 15_000 })
await page.waitForSelector('.viewhost.view-sessions .si-page', { timeout: 45_000 })
const unknown = await page.evaluate(() => ({ hash: location.hash, graphRail: document.querySelectorAll('.side-rail a[href="#/graph"]').length }))
if (unknown.hash !== '#/sessions' || unknown.graphRail !== 0) throw new Error(`unknown route mismatch: ${JSON.stringify(unknown)}`)
await page.screenshot({ path: join(OUT, 'unknown-route-sessions.png') })

if (errors.length) throw new Error(`browser errors: ${errors.join(' | ')}`)
console.log(JSON.stringify({ ok: true, session: session.id, fresh, closed, unknown, errors, screenshots: OUT }))
await browser.close()
