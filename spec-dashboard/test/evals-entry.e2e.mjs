// [[session-eval]]/[[evals-view]] YATU: Terminal -> scoped LIST -> scoped DETAIL.
// Records the real desktop/mobile journeys plus screenshots under OUT.
import { pathToFileURL } from 'node:url'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://localhost:5183'
const SESSION = process.env.SESSION || '5ce40dbf-0c90-4ff9-86f6-a6fa462ee6b7'
const OUT = process.env.OUT || '/tmp/evals-entry-e2e'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const SHORT = SESSION.slice(0, 8)
const SCOPED_Q = `is:eval state:current scope:${SESSION}`
const LIST_HASH = `#/evals?q=${encodeURIComponent(SCOPED_Q).replaceAll('%20', '+')}`
let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const qOf = (hash) => new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('q')
const pathOf = (hash) => hash.split('?')[0]
const settle = (page, ms = 700) => page.waitForTimeout(ms)

const listProbe = (page) => page.evaluate(() => {
  const toolbar = document.querySelector('.se-gates')
  const door = toolbar?.querySelector(':scope > .se-door')
  const gate = toolbar?.querySelector(':scope > .se-gate')
  const rect = door?.getBoundingClientRect()
  const gateRect = gate?.getBoundingClientRect()
  const focusables = toolbar
    ? [...toolbar.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    : []
  return {
    door: door ? {
      tag: door.tagName,
      href: door.getAttribute('href'),
      text: door.textContent.trim(),
      aria: door.getAttribute('aria-label'),
      tip: door.getAttribute('data-tip'),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      firstChild: toolbar.firstElementChild === door,
      firstFocusable: focusables[0] === door,
      beforeGate: !gateRect || rect.right <= gateRect.left,
    } : null,
    focusOrder: focusables.map((el) => el.className),
    doorCount: document.querySelectorAll('.se-door').length,
    headAction: !!document.querySelector('.ds-head-action'),
    banner: !!document.querySelector('.ds-banner, .se-banner-slot'),
    widths: { doc: document.documentElement.scrollWidth, body: document.body.scrollWidth },
  }
})

const detailProbe = (page) => page.evaluate(() => ({
  doorCount: document.querySelectorAll('.se-door').length,
  headAction: !!document.querySelector('.ds-head-action'),
  banner: !!document.querySelector('.ds-banner, .se-banner-slot'),
  back: document.querySelector('.ds-back, .ds-backlink')?.getAttribute('href') || null,
  failure: !!document.querySelector('.ds-failed'),
  missing: !!document.querySelector('.ds-missing'),
  widths: { doc: document.documentElement.scrollWidth, body: document.body.scrollWidth },
}))

const doorOk = (door, label) => !!door
  && door.tag === 'A'
  && door.href === `#/sessions/${SESSION}`
  && door.text === ''
  && door.aria === label
  && door.tip === label
  && door.w >= 32
  && door.h >= 32
  && door.firstChild
  && door.firstFocusable
  && door.beforeGate

const browser = await chromium.launch()
let scopedRowHref = null

// Desktop EN: enter through the real console door, then walk every return command.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/#/sessions/${SESSION}`)
  const consoleDoor = await page.waitForSelector('.si-tab-door', { timeout: 20000 }).catch(() => null)
  const entry = consoleDoor ? await consoleDoor.evaluate((el) => ({ tag: el.tagName, href: el.getAttribute('href') })) : null
  check('console Eval entry is a real scoped-list anchor', entry?.tag === 'A' && pathOf(entry.href) === '#/evals' && qOf(entry.href) === SCOPED_Q, JSON.stringify(entry))
  if (!entry) throw new Error('real console Eval door did not render')

  const historyBefore = await page.evaluate(() => history.length)
  await page.click('.si-tab-door')
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  await page.waitForSelector('.se-export', { timeout: 15000 })
  await page.waitForSelector('a.lp-row', { timeout: 15000 })
  check('console door pushes exactly once to canonical scoped list',
    await page.evaluate(() => location.hash) === LIST_HASH && await page.evaluate(() => history.length) === historyBefore + 1)

  const enList = await listProbe(page)
  check('list door is leftmost, first focusable, real, and short-labelled', doorOk(enList.door, 'Back to session terminal'), JSON.stringify(enList))
  check('scoped list has exactly one door and no banner/action seam', enList.doorCount === 1 && !enList.banner && !enList.headAction)
  check('1440 list has no horizontal overflow', enList.widths.doc <= 1440 && enList.widths.body <= 1440, JSON.stringify(enList.widths))
  await page.screenshot({ path: join(OUT, 'b-01-scoped-list-1440-en.png') })

  await page.reload()
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  const reloaded = await listProbe(page)
  check('reloaded list restores the same canonical door', doorOk(reloaded.door, 'Back to session terminal'))

  await page.waitForSelector('.se-export', { timeout: 15000 })
  await page.focus('.se-door')
  await page.keyboard.press('Tab')
  check('Tab after the first door reaches trailing export, skipping inert gates',
    await page.evaluate(() => document.activeElement?.classList.contains('se-export')))
  await page.keyboard.press('Shift+Tab')
  check('Shift+Tab returns to the list door', await page.evaluate(() => document.activeElement?.classList.contains('se-door')))
  await page.keyboard.press('Enter')
  await page.waitForSelector('.si-tab-door', { timeout: 15000 })
  check('keyboard Enter on list door opens the real session terminal',
    await page.evaluate(() => location.hash) === `#/sessions/${SESSION}` && await page.evaluate(() => !!document.querySelector('.si-term-body')))
  await page.goBack()
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  check('browser Back from terminal restores exact scoped list', await page.evaluate(() => location.hash) === LIST_HASH)

  const [popup] = await Promise.all([
    context.waitForEvent('page', { timeout: 8000 }).catch(() => null),
    page.click('.se-door', { modifiers: ['ControlOrMeta'] }),
  ])
  await popup?.waitForURL((url) => url.hash === `#/sessions/${SESSION}`, { timeout: 15000 }).catch(() => null)
  await popup?.waitForSelector('.si-term-body', { timeout: 15000 }).catch(() => null)
  const popupHash = await popup?.evaluate(() => location.hash).catch(() => null)
  check('Ctrl-click opens the terminal in a new tab', popupHash === `#/sessions/${SESSION}`)
  check('Ctrl-click leaves the scoped list in place', await page.evaluate(() => location.hash) === LIST_HASH)
  const popupVideo = popup?.video() || null
  await popup?.close().catch(() => null)

  scopedRowHref = await page.locator('a.lp-row').first().getAttribute('href')
  check('scoped row keeps only the scope token', !!scopedRowHref && qOf(scopedRowHref) === `scope:${SESSION}`, scopedRowHref)
  await page.click('a.lp-row')
  await page.waitForSelector('.ds-back', { timeout: 15000 })
  const detail = await detailProbe(page)
  check('scoped detail has one list back and no terminal/action duplicate', detail.back === LIST_HASH && detail.doorCount === 0 && !detail.headAction && !detail.banner, JSON.stringify(detail))
  check('1440 detail has no horizontal overflow', detail.widths.doc <= 1440 && detail.widths.body <= 1440, JSON.stringify(detail.widths))
  await page.screenshot({ path: join(OUT, 'b-02-scoped-detail-1440-en.png') })

  await page.goBack()
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  check('browser Back from detail restores exact list with door', await page.evaluate(() => location.hash) === LIST_HASH && (await listProbe(page)).doorCount === 1)
  await page.click('a.lp-row')
  await page.waitForSelector('.ds-back', { timeout: 15000 })
  await page.click('.ds-back')
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  check('detail back lands on scoped list and its door remains', await page.evaluate(() => location.hash) === LIST_HASH && doorOk((await listProbe(page)).door, 'Back to session terminal'))
  await page.click('.se-door')
  await page.waitForSelector('.si-term-body', { timeout: 15000 })
  check('list door alone completes the return to the real terminal', await page.evaluate(() => location.hash) === `#/sessions/${SESSION}`)
  await page.goBack()
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })

  // Trunk list/detail never grow a terminal door.
  await page.goto(`${BASE}/#/evals`)
  await page.waitForSelector('a.lp-row', { timeout: 15000 })
  check('trunk list has no terminal door', (await listProbe(page)).doorCount === 0)
  await page.click('a.lp-row')
  await page.waitForSelector('.ds-back', { timeout: 15000 })
  const trunk = await detailProbe(page)
  check('trunk detail has only bare-list back, no door/action', trunk.back === '#/evals' && trunk.doorCount === 0 && !trunk.headAction)

  const video = page.video()
  await page.close()
  await context.close()
  renameSync(await video.path(), join(OUT, 'b-journey-1440-en.webm'))
  const popupPath = await popupVideo?.path().catch(() => null)
  if (popupPath) rmSync(popupPath, { force: true })
}

// Desktop ZH: direct open/reload plus honest not-found all return only to the scoped list.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.setItem('spexcode.lang', 'zh'))
  await page.goto(`${BASE}/${LIST_HASH}`)
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  await page.waitForSelector('a.lp-row', { timeout: 15000 })
  const zh = await listProbe(page)
  check('zh list uses the exact short local command', doorOk(zh.door, '返回会话终端') && !zh.door.aria.includes(SHORT), JSON.stringify(zh.door))
  await page.screenshot({ path: join(OUT, 'b-03-scoped-list-1440-zh.png') })

  await page.goto(`${BASE}/${scopedRowHref}`)
  await page.waitForSelector('.ds-back', { timeout: 15000 })
  const direct = await detailProbe(page)
  check('direct-open scoped detail has only canonical list back', direct.back === LIST_HASH && direct.doorCount === 0 && !direct.headAction)
  await page.reload()
  await page.waitForSelector('.ds-back', { timeout: 15000 })
  const reload = await detailProbe(page)
  check('reloaded scoped detail preserves that single return target', reload.back === LIST_HASH && reload.doorCount === 0 && !reload.headAction)

  await page.goto(`${BASE}/#/evals/not-a-node/not-a-scenario?q=${encodeURIComponent(`scope:${SESSION}`)}`)
  await page.waitForSelector('.ds-missing', { timeout: 15000 })
  const missing = await detailProbe(page)
  check('not-found detail has only scoped-list link, no terminal door', missing.missing && missing.back === LIST_HASH && missing.doorCount === 0 && !missing.headAction)
  await page.click('.ds-backlink')
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  check('not-found link lands on list with its zh terminal door', doorOk((await listProbe(page)).door, '返回会话终端'))
  await page.close()
  await context.close()
}

// Transport failure is a distinct detail face on the same data-source axis.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.route(`**/api/sessions/${SESSION}/evals`, (route) => route.fulfill({ status: 503, contentType: 'text/plain', body: 'forced failure' }))
  await page.goto(`${BASE}/${scopedRowHref}`)
  await page.waitForSelector('.ds-failed', { timeout: 15000 })
  const failed = await detailProbe(page)
  check('load-failed detail has only scoped-list link, no terminal door', failed.failure && failed.back === LIST_HASH && failed.doorCount === 0 && !failed.headAction)
  await page.click('.ds-backlink')
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  const failedList = await listProbe(page)
  check('failed scoped list still leads with its real terminal door', doorOk(failedList.door, 'Back to session terminal'))
  await page.close()
  await context.close()
}

// Phone EN: identical hierarchy, no overflow, and the terminal destination is the real mobile session plane.
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    recordVideo: { dir: OUT, size: { width: 390, height: 844 } },
    isMobile: true,
    hasTouch: true,
  })
  const page = await context.newPage()
  await page.goto(`${BASE}/${LIST_HASH}`)
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  await page.waitForSelector('a.lp-row', { timeout: 15000 })
  const mobile = await listProbe(page)
  check('390 list keeps the leftmost first-focus door', doorOk(mobile.door, 'Back to session terminal') && mobile.door.top < 300, JSON.stringify(mobile.door))
  check('390 list has zero horizontal overflow', mobile.widths.doc <= 390 && mobile.widths.body <= 390, JSON.stringify(mobile.widths))
  await page.screenshot({ path: join(OUT, 'b-04-scoped-list-390-en.png') })

  await page.click('a.lp-row')
  await page.waitForSelector('.ds-back', { timeout: 15000 })
  const mobileDetail = await detailProbe(page)
  check('390 detail has only scoped-list back and zero overflow', mobileDetail.back === LIST_HASH && mobileDetail.doorCount === 0 && !mobileDetail.headAction && mobileDetail.widths.doc <= 390 && mobileDetail.widths.body <= 390, JSON.stringify(mobileDetail))
  await page.click('.ds-back')
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  check('390 detail back restores list door', doorOk((await listProbe(page)).door, 'Back to session terminal'))
  await page.click('.se-door')
  await page.waitForSelector('.m-sessdetail', { timeout: 15000 })
  const mobileTerminal = await page.evaluate(() => ({ hash: location.hash, id: document.querySelector('.m-sess-id8')?.textContent }))
  check('390 list door reaches the real mobile session terminal plane', mobileTerminal.hash === `#/sessions/${SESSION}` && mobileTerminal.id === SHORT, JSON.stringify(mobileTerminal))
  await page.goBack()
  await page.waitForSelector('.se-gates > .se-door', { timeout: 15000 })
  check('390 browser Back returns exactly to scoped list', await page.evaluate(() => location.hash) === LIST_HASH)

  const video = page.video()
  await page.close()
  await context.close()
  renameSync(await video.path(), join(OUT, 'b-journey-390-en.webm'))
}

await browser.close()
console.log(`\n${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)
