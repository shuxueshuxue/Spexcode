import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// [[tab-strip]] `divider-seam-and-group-head-geometry`: the band meets the page at a hairline EXCEPT under the
// active tab, which is joined to its pane; group heads share the one divider rule. Measured on the real board
// (a spec document and a live session), by computed style AND by the pixels the band's bottom row actually
// paints — a computed `box-shadow` proves a rule exists, only the pixels prove where the line breaks.
//
//   BASE=http://127.0.0.1:5199 OUT=<dir> node spec-dashboard/test/divider-geometry.e2e.mjs
const BASE = process.env.BASE || 'http://127.0.0.1:5198'
const OUT = process.env.OUT || '/home/jeffry/spexcode-evidence/lane-dividers-2026-08-23'
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const HOLD = process.platform === 'darwin' ? 'Meta' : 'Control'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const graph = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const node = graph.nodes.find((item) => item.id === 'spexcode')
const live = graph.sessions.filter((item) => item.liveness !== 'offline')
const [session, other] = live
assert.ok(node && session, 'the live board needs a spec node and a live session')

// the colour the page actually painted at viewport points (device scale 1: one CSS px is one pixel)
const samplePixels = async (page, points) => {
  const b64 = (await page.screenshot({ type: 'png' })).toString('base64')
  return page.evaluate(async ({ b64, points }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width; canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    return points.map(([x, y]) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3).join(','))
  }, { b64, points })
}

// the band's bottom row under a tab (or in the empty band) versus the band just above it and the page just
// below it: `joined` means that row is the page; `ruled` means a line sits there
const seamAt = async (page, stripSelector) => {
  const geometry = await page.evaluate((stripSelector) => {
    const strip = document.querySelector(stripSelector)
    const rect = (element) => element?.getBoundingClientRect().toJSON() || null
    const tabs = [...strip.querySelectorAll('.tab')].map((tab) => ({ ...rect(tab), on: tab.classList.contains('on') }))
    return { strip: rect(strip), tabs, actions: rect(strip.querySelector('.tabstrip-actions')), boxShadow: getComputedStyle(strip).boxShadow }
  }, stripSelector)
  const lineY = Math.floor(geometry.strip.bottom) - 1
  const active = geometry.tabs.find((tab) => tab.on)
  const inactive = geometry.tabs.find((tab) => !tab.on)
  const lastTab = geometry.tabs[geometry.tabs.length - 1]
  const bandX = geometry.actions && lastTab && geometry.actions.left - lastTab.right > 8 ? (lastTab.right + geometry.actions.left) / 2 : null
  const columns = [['active', active && (active.left + active.right) / 2], ['inactive', inactive && (inactive.left + inactive.right) / 2], ['band', bandX]].filter(([, x]) => x)
  const points = columns.flatMap(([, x]) => [[x, lineY - 3], [x, lineY], [x, lineY + 3]])
  const colours = await samplePixels(page, points)
  const seam = {}
  columns.forEach(([name], index) => {
    const [above, line, below] = colours.slice(index * 3, index * 3 + 3)
    seam[name] = { above, line, below, joined: line === below, ruled: line !== above && line !== below }
  })
  return { ...geometry, lineY, seam }
}

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
      await page.locator('.tabstrip .tab.on').waitFor({ state: 'visible', timeout: 60000 })
      await page.waitForTimeout(400)   // the tab's entrance animation settles before its pixels are read
      specGeometry = await page.evaluate(() => {
        const strip = document.querySelector('.tabstrip')
        const host = document.querySelector('.viewhost')
        const group = document.querySelector('.ft-section + .ft-section')
        const stripRect = strip.getBoundingClientRect()
        const hostRect = host.getBoundingClientRect()
        return {
          strip: stripRect.toJSON(), host: hostRect.toJSON(), group: group.getBoundingClientRect().toJSON(),
          seamGap: hostRect.top - stripRect.bottom,
          stripBottom: getComputedStyle(strip).borderBottomWidth,
          hostTop: getComputedStyle(host).borderTopWidth,
          groupTop: getComputedStyle(group).borderTopWidth,
          overflowX: document.documentElement.scrollWidth - window.innerWidth,
        }
      })
      specGeometry.seam = await seamAt(page, '.tabstrip')
      assert.equal(specGeometry.seamGap, 0, `${viewport.name}: tab/content seam moved`)
      assert.equal(specGeometry.stripBottom, '0px', `${viewport.name}: the strip draws its rule as a border, not the band's inset`)
      assert.match(specGeometry.seam.boxShadow, /inset/, `${viewport.name}: the band owns no inset hairline`)
      assert.equal(specGeometry.hostTop, '0px', `${viewport.name}: the content host still owns a top divider — two owners for one seam`)
      assert.equal(specGeometry.groupTop, '1px', `${viewport.name}: explorer group has no shared divider`)
      assert.equal(specGeometry.seam.seam.active.joined, true, `${viewport.name}: a line runs under the active tab (${JSON.stringify(specGeometry.seam.seam.active)})`)
      assert.equal(specGeometry.seam.seam.band?.ruled, true, `${viewport.name}: no hairline in the empty band (${JSON.stringify(specGeometry.seam.seam.band)})`)
    }
    assert.ok(specGeometry.overflowX <= 1, `${viewport.name}: horizontal overflow ${specGeometry.overflowX}px`)
    await page.screenshot({ path: join(OUT, `${viewport.name}-explorer-divider.png`) })

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
      await page.locator('.si-zone').first().waitFor({ state: 'visible', timeout: 60000 })
      await page.locator('.si-document > .tabstrip .tab.on').waitFor({ state: 'visible', timeout: 60000 })
      if (other) {
        // a second live session beside the first: the document strip now holds an inactive tab
        await page.locator(`.si-list .si-item[data-sid="${other.id}"]`).click({ modifiers: [HOLD] })
        await page.locator('.si-document > .tabstrip .tab:not(.on)').first().waitFor({ state: 'visible', timeout: 60000 })
      }
      await page.mouse.move(viewport.width - 4, viewport.height - 4)   // no hover wash on any tab while sampling
      await page.waitForTimeout(400)
      sessionGeometry = await page.evaluate(() => {
        const zone = document.querySelector('.si-zone')
        const host = document.querySelector('.viewhost')
        const zoneStyle = getComputedStyle(zone, '::after')
        return { zone: zone.getBoundingClientRect().toJSON(), zoneDivider: zoneStyle.borderTopWidth, hostTop: getComputedStyle(host).borderTopWidth }
      })
      sessionGeometry.seam = await seamAt(page, '.si-document > .tabstrip')
      assert.equal(sessionGeometry.hostTop, '0px', `${viewport.name}: the session content host still owns a top divider`)
      assert.match(sessionGeometry.seam.boxShadow, /inset/, `${viewport.name}: the session document's band owns no inset hairline`)
      assert.equal(sessionGeometry.seam.seam.active.joined, true, `${viewport.name}: a line runs under the active session tab (${JSON.stringify(sessionGeometry.seam.seam.active)})`)
      if (other) assert.equal(sessionGeometry.seam.seam.inactive?.ruled, true, `${viewport.name}: no hairline under the inactive tab (${JSON.stringify(sessionGeometry.seam.seam.inactive)})`)
      else console.log('only one live session on the board: the inactive-tab column was not measured')
    }
    assert.equal(sessionGeometry.zoneDivider, '1px', `${viewport.name}: session zone lacks shared divider`)
    measurements.push({ viewport, spec: specGeometry, session: sessionGeometry })
    await page.screenshot({ path: join(OUT, `${viewport.name}-sessions-divider.png`) })
    await context.close()
  }
} finally {
  await browser.close()
}
writeFileSync(join(OUT, 'geometry.json'), `${JSON.stringify({ base: BASE, measurements }, null, 2)}\n`)
console.log(JSON.stringify({ ok: true, out: OUT, measurements }))
