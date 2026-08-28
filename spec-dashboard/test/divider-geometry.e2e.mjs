import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:5198'
const OUT = process.env.OUT || '/home/jeffry/spexcode-evidence/lane-dividers-2026-08-23'
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const node = graph.nodes.find((item) => item.id === 'spexcode')
const session = graph.sessions.find((item) => item.liveness !== 'offline')
assert.ok(node && session, 'the live board needs a spec node and a live session')

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const measurements = []
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    await context.addInitScript(() => {
      localStorage.setItem('spexcode.dock', '1')
      localStorage.setItem('spexcode.dockMode', 'explorer')
    })
    const page = await context.newPage()
    await page.goto(`${BASE}/#/spec/${encodeURIComponent(node.id)}`, { waitUntil: 'domcontentloaded' })
    const isMobile = viewport.name === 'mobile'
    let specGeometry
    if (isMobile) {
      await page.locator('.m-tabbar').waitFor({ state: 'visible', timeout: 60000 })
      await page.locator('.m-main').waitFor({ state: 'visible', timeout: 60000 })
      specGeometry = await page.evaluate(() => {
        const main = document.querySelector('.m-main')
        const tabbar = document.querySelector('.m-tabbar')
        const mainRect = main.getBoundingClientRect()
        const tabbarRect = tabbar.getBoundingClientRect()
        const tabbarStyle = getComputedStyle(tabbar)
        return {
          main: mainRect.toJSON(), tabbar: tabbarRect.toJSON(),
          seamGap: tabbarRect.top - mainRect.bottom,
          tabbarTop: tabbarStyle.borderTopWidth,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        }
      })
      assert.equal(specGeometry.seamGap, 0, 'mobile: content/tab seam moved')
      assert.equal(specGeometry.tabbarTop, '1px', 'mobile: tab bar lacks shared top divider')
    } else {
      await page.locator('.tabstrip').waitFor({ state: 'visible', timeout: 60000 })
      await page.locator('.viewhost').waitFor({ state: 'visible', timeout: 60000 })
      await page.locator('.ft-section + .ft-section').waitFor({ state: 'attached', timeout: 60000 })
      specGeometry = await page.evaluate(() => {
        const strip = document.querySelector('.tabstrip')
        const host = document.querySelector('.viewhost')
        const group = document.querySelector('.ft-section + .ft-section')
        const stripRect = strip.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        const groupRect = group.getBoundingClientRect()
        const groupStyle = getComputedStyle(group)
        const hostStyle = getComputedStyle(host)
        const stripStyle = getComputedStyle(strip)
        return {
          strip: stripRect.toJSON(), host: hostRect.toJSON(), group: groupRect.toJSON(),
          seamGap: hostRect.top - stripRect.bottom,
          stripBottom: stripStyle.borderBottomWidth,
          hostTop: hostStyle.borderTopWidth,
          groupTop: groupStyle.borderTopWidth,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        }
      })
      assert.equal(specGeometry.seamGap, 0, `${viewport.name}: tab/content seam moved`)
      assert.equal(specGeometry.stripBottom, '0px', `${viewport.name}: tab strip still owns a bottom border`)
      assert.equal(specGeometry.hostTop, '1px', `${viewport.name}: content host has no shared top divider`)
      assert.equal(specGeometry.groupTop, '0px', `${viewport.name}: explorer has an extra section divider`)
    }
    assert.ok(specGeometry.overflowX <= 1, `${viewport.name}: horizontal overflow ${specGeometry.overflowX}px`)
    await page.screenshot({ path: join(OUT, `${viewport.name}-explorer-divider.png`), fullPage: true })

    let sessionGeometry
    if (isMobile) {
      await page.locator('.m-tabbar-btn').nth(1).click()
      await page.locator('.m-zone').first().waitFor({ state: 'visible', timeout: 60000 })
      sessionGeometry = await page.evaluate(() => {
        const zone = document.querySelector('.m-zone')
        const main = document.querySelector('.m-main')
        const zoneStyle = getComputedStyle(zone, '::after')
        return { zone: zone.getBoundingClientRect().toJSON(), zoneDivider: zoneStyle.borderTopWidth, main: main.getBoundingClientRect().toJSON() }
      })
    } else {
      await page.evaluate(() => localStorage.setItem('spexcode.dockMode', 'sessions'))
      await page.goto(`${BASE}/#/sessions/${encodeURIComponent(session.id)}`, { waitUntil: 'domcontentloaded' })
      await page.locator('.dock-session-zone').first().waitFor({ state: 'visible', timeout: 60000 })
      sessionGeometry = await page.evaluate(() => {
        const zone = document.querySelector('.dock-session-zone')
        const host = document.querySelector('.viewhost')
        const zoneStyle = getComputedStyle(zone, '::after')
        const hostStyle = getComputedStyle(host)
        return { zone: zone.getBoundingClientRect().toJSON(), zoneDivider: zoneStyle.borderTopWidth, hostTop: hostStyle.borderTopWidth }
      })
      assert.equal(sessionGeometry.hostTop, '1px', `${viewport.name}: session content seam changed`)
    }
    assert.equal(sessionGeometry.zoneDivider, '1px', `${viewport.name}: session zone lacks shared divider`)
    measurements.push({ viewport, spec: specGeometry, session: sessionGeometry })
    await page.screenshot({ path: join(OUT, `${viewport.name}-sessions-divider.png`), fullPage: true })
    await context.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(OUT, 'geometry.json'), `${JSON.stringify({ base: BASE, measurements }, null, 2)}\n`)
console.log(JSON.stringify({ ok: true, out: OUT, measurements }))
