// Real-browser proof for the resident Spec tab. BASE must point at the dashboard gateway
// serving this worktree's built UI and a backend with at least two graph nodes.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const OUT = resolve(process.env.OUT || '/tmp/spec-resident-tab-e2e')
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })
const graph = await fetch(`${BASE}/api/graph`).then(async (response) => {
  assert.equal(response.ok, true, `graph request failed: ${response.status}`)
  return response.json()
})
const nodes = (graph.nodes || []).filter((node) => node.id && node.id !== 'spexcode')
assert.ok(nodes.length >= 2, 'the graph needs two non-root nodes for the resident Spec proof')
const first = nodes[0].id
const second = nodes[1].id
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const state = async () => page.evaluate(() => ({
  hash: location.hash,
  tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => ({ key: tab.dataset.tabKey, label: tab.querySelector('.tab-label')?.textContent?.trim(), active: tab.getAttribute('aria-selected') === 'true' })),
}))
try {
  await page.goto(`${BASE}/#/spec/${encodeURIComponent(first)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tabstrip').waitFor()
  await page.locator('[role="tab"]').first().waitFor()
  const initial = await state()
  assert.equal(initial.hash, `#/spec/${encodeURIComponent(first)}`)
  assert.deepEqual(initial.tabs, [{ key: '#/spec', label: 'Spec', active: true }])

  await page.goto(`${BASE}/#/spec/${encodeURIComponent(second)}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[role="tab"]').first().waitFor()
  const switched = await state()
  assert.equal(switched.hash, `#/spec/${encodeURIComponent(second)}`)
  assert.deepEqual(switched.tabs, [{ key: '#/spec', label: 'Spec', active: true }])

  await page.goto(`${BASE}/#/file/spec-dashboard/src/views.jsx`, { waitUntil: 'domcontentloaded' })
  await page.locator('[role="tab"]').first().waitFor()
  const file = await state()
  assert.equal(file.hash, '#/file/spec-dashboard/src/views.jsx')
  assert.deepEqual(file.tabs.map(({ key, label, active }) => ({ key, label, active })), [
    { key: '#/spec', label: 'Spec', active: false },
    { key: '#/file/spec-dashboard/src/views.jsx', label: 'views.jsx', active: true },
  ])
  await page.screenshot({ path: resolve(OUT, 'spec-resident-file-focus.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, first, second, initial, switched, file, screenshot: resolve(OUT, 'spec-resident-file-focus.png') }))
} finally {
  await page.close()
  await browser.close()
}
