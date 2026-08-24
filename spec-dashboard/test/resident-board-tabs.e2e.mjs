import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const state = () => page.evaluate(() => ({
  hash: location.hash,
  tabs: [...document.querySelectorAll('[role="tab"][data-tab-key]')].map((tab) => ({
    key: tab.dataset.tabKey,
    selected: tab.getAttribute('aria-selected') === 'true',
  })),
}))
try {
  await page.goto(`${BASE}/#/sessions`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('spexcode.tabs'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  const opened = []
  for (const route of ['#/sessions', '#/evals', '#/issues', '#/spec', '#/settings']) {
    await page.evaluate((next) => { location.hash = next }, route)
    await page.waitForURL(new RegExp(`${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await page.locator('.tabstrip').waitFor({ state: 'visible', timeout: 60000 })
    await page.waitForFunction(() => document.querySelector('.tabstrip-tabs'))
    const current = await state()
    if (route !== '#/sessions' && !opened.includes(route)) opened.push(route)
    assert.deepEqual(current.tabs.map((tab) => tab.key), opened, `${route} only keeps visited dynamic tabs`)
    const expectedFocus = route === '#/sessions' ? [] : [route]
    assert.deepEqual(current.tabs.filter((tab) => tab.selected).map((tab) => tab.key), expectedFocus, `${route} focuses its resident tab`)
  }

  // A board detail is route state in the same top-level tab, not a second review surface or a rail memory.
  await page.goto(`${BASE}/#/issues`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-tab-key="#/evals"] .tab-face').click()
  await page.waitForFunction(() => location.hash === '#/evals')
  const clicked = await state()
  assert.deepEqual(clicked.tabs.filter((tab) => tab.selected).map((tab) => tab.key), ['#/evals'])
  await page.goto(`${BASE}/#/spec`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tabstrip').waitFor({ state: 'visible', timeout: 60000 })
  await page.locator('[data-tab-key="#/spec"] .tab-x').click()
  await page.waitForURL(/#\/graph$/)
  await page.waitForTimeout(220)
  const afterClose = await state()
  assert.equal(afterClose.tabs.some((tab) => tab.key === '#/spec'), false, 'closing a dynamic page removes its tab')
  console.log(JSON.stringify({ ok: true, opened, clicked, afterClose }))
} finally {
  await page.close()
  await browser.close()
}
