import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const OUT = resolve(process.env.OUT || '/tmp/spec-resident-tab-e2e')
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true })
const graph = await fetch(`${BASE}/api/graph`).then(async (response) => { assert.equal(response.ok, true); return response.json() })
const nodes = (graph.nodes || []).filter((node) => node.id && node.id !== 'spexcode')
assert.ok(nodes.length >= 2, 'two graph nodes required')
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const state = () => page.evaluate(() => ({ hash: location.hash, tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => ({ key: tab.dataset.tabKey, label: tab.querySelector('.tab-label')?.textContent?.trim(), active: tab.getAttribute('aria-selected') === 'true' })) }))
const resident = [
  { key: '#/spec', label: 'Spec' },
  { key: '#/evals', label: 'Evals' },
  { key: '#/issues', label: 'Issues' },
  { key: '#/settings', label: 'Settings' },
]
try {
  await page.goto(`${BASE}/#/spec/${encodeURIComponent(nodes[0].id)}`, { waitUntil: 'domcontentloaded' }); await page.locator('.specview').first().waitFor({ state: 'attached' }); await page.locator('[role="tab"]').first().waitFor()
  const initial = await state(); assert.deepEqual(initial.tabs, resident.map((tab) => ({ ...tab, active: tab.key === '#/spec' })))
  await page.goto(`${BASE}/#/spec/${encodeURIComponent(nodes[1].id)}`, { waitUntil: 'domcontentloaded' }); await page.locator('.specview').first().waitFor({ state: 'attached' })
  const switched = await state(); assert.deepEqual(switched.tabs, resident.map((tab) => ({ ...tab, active: tab.key === '#/spec' })))
  await page.goto(`${BASE}/#/file/spec-dashboard/src/views.jsx`, { waitUntil: 'domcontentloaded' }); await page.locator('.srcview-cm .cm-editor').waitFor(); await page.locator('.srcview-progress').waitFor({ state: 'detached' })
  const file = await state(); assert.deepEqual(file.tabs.map(({ key, label, active }) => ({ key, label, active })), [
    ...resident.map((tab) => ({ ...tab, active: false })),
    { key: '#/file/spec-dashboard/src/views.jsx', label: 'views.jsx', active: true },
  ])
  await page.screenshot({ path: resolve(OUT, 'spec-resident-file-focus.png'), fullPage: true }); console.log(JSON.stringify({ ok: true, initial, switched, file, screenshot: resolve(OUT, 'spec-resident-file-focus.png') }))
} finally { await page.close(); await browser.close() }
