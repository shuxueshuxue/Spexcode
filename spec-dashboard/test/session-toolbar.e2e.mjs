// Real-Chromium proof for the shell-owned document-actions slot.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = process.env.OUT || '/tmp/document-actions-e2e'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const board = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const session = process.env.SESSION || board.sessions.find((row) => !row.capabilities?.headless)?.id
if (!session) throw new Error('no session row on the live board; pass SESSION=<id>')

const checks = []
const check = (name, ok, detail = null) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail == null ? '' : ` - ${JSON.stringify(detail)}`}`)
}
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
await page.goto(`${BASE}/#/sessions/${session}`)
await page.locator('.tabstrip').waitFor({ state: 'visible', timeout: 20000 })
await page.locator('.si-content').waitFor({ state: 'visible', timeout: 20000 })

// The band's order is DOM order over every control it holds, not just the icon buttons — a probe that only
// sweeps `.document-action-button` is blind to any control that is not a button, so the sweep is over every
// `[data-action]` the slot holds.
const bandProbe = () => page.evaluate(() => {
  const slot = document.querySelector('.tabstrip-actions')
  const controls = slot ? [...slot.querySelectorAll('[data-action]')] : []
  const statusRect = document.querySelector('.statusbar')?.getBoundingClientRect().toJSON() || null
  const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
  return {
    hasRetiredToolbar: Boolean(document.querySelector('.si-tabbar, .si-toolbar, .si-tool')),
    hasSlot: Boolean(slot),
    order: controls.map((el) => el.dataset.action),
    actions: [...document.querySelectorAll('.document-action-button')].map((button) => ({
      action: button.dataset.action,
      label: button.getAttribute('aria-label'),
      disabled: button.disabled,
    })),
    statusRect,
    buttonHeights: [...document.querySelectorAll('.document-action-button')].map((el) => Math.round(el.getBoundingClientRect().height)),
    slotRect: rect(slot),
  }
})
const sessionState = await bandProbe()
check('session document has one shell action slot and no internal chrome', !sessionState.hasRetiredToolbar && sessionState.hasSlot, sessionState)
check('merge and lifecycle actions stay out of the document slot', !sessionState.actions.some((item) => item.action === 'merge' || item.action === 'session-menu'), sessionState.actions)
check('the slot carries no disabled merge witness', !sessionState.actions.some((item) => item.action === 'merge'), sessionState.actions)
const pickerOpened = await page.locator('.document-action-button[data-action="resource-picker"]').click().then(() => true).catch(() => false)
if (pickerOpened) await page.keyboard.press('Escape')
await page.locator('.tab[data-tab-key^="#/sessions/"]').first().click({ button: 'right' })
const sessionTabMenu = await page.locator('[role="menu"]').last().textContent().catch(() => '')
check('session tab context menu owns the lifecycle actions', /rename/i.test(sessionTabMenu) && /close/i.test(sessionTabMenu), sessionTabMenu)
await page.keyboard.press('Escape')
await page.keyboard.press('Alt+I')
const commandOpen = await page.locator('.si-command-layer').isVisible().catch(() => false)
check('Alt+I opens the Command Box through the console keyboard scope', commandOpen)
await page.keyboard.press('Alt+I')
await page.screenshot({ path: join(OUT, 'session-document-actions.png'), fullPage: true })

await page.goto(`${BASE}/#/spec/spexcode`)
// `.first()`: a workspace that has held a split carries a tab strip PER PANE, and a bare `.tabstrip`
// locator is a strict-mode violation the moment a second pane exists — the check is about the ACTIVE
// document's band, so the active pane's strip is the one to wait on.
await page.locator('.tabstrip').first().waitFor({ state: 'visible', timeout: 20000 })
// A spec document registers no ACTIONS, so the band holds only the context toggle while its dock is closed.
// Once opened, the same control moves into the context head's trailing door at the window's right edge.
const specState = await page.evaluate(() => {
  // ONLY the visible band. The workspace keeps recent documents mounted and display-hidden, so the Sessions
  // document's own strip is still in the DOM with its actions on it — a bare `document.querySelector` reads
  // that hidden strip and reports the neighbour's controls as this document's. Ask for the painted one.
  const painted = (el) => el.getBoundingClientRect().width > 0
  const slot = [...document.querySelectorAll('.tabstrip-actions')].find(painted) || null
  return {
    actions: slot ? [...slot.querySelectorAll('[data-action]')].map((el) => el.dataset.action) : [],
    trailing: Boolean(slot?.querySelector('.context-toggle')),
    hasRetiredToolbar: [...document.querySelectorAll('.si-tabbar, .si-toolbar, .si-tool')].some(painted),
  }
})
check('a spec document registers no actions and carries only its own trailing context control',
  specState.actions.length === 0 && specState.trailing && !specState.hasRetiredToolbar, specState)

const contextProbe = () => page.evaluate(() => {
  const painted = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
  const toggle = [...document.querySelectorAll('.context-toggle')].find(painted) || null
  const rect = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
  return {
    toggle: rect(toggle),
    height: toggle ? Math.round(toggle.getBoundingClientRect().height) : null,
    pressed: toggle?.getAttribute('aria-pressed') || null,
    inStrip: Boolean(toggle?.closest('.tabstrip-actions')),
    inHead: Boolean(toggle?.closest('.ctx-head-acts')),
    dock: rect(document.querySelector('.context-dock')),
  }
})
const closedContext = await contextProbe()
await page.locator('.context-toggle').click()
await page.locator('.context-dock .context-toggle').waitFor({ state: 'visible', timeout: 20000 })
await page.waitForTimeout(220)
const openContext = await contextProbe()
check('closed context toggle uses the strip mount', closedContext.inStrip && !closedContext.inHead && closedContext.pressed === 'false', closedContext)
check('open context toggle moves into the dock head at the same right edge',
  openContext.inHead && !openContext.inStrip && openContext.pressed === 'true'
    && openContext.height === 22
    && Math.abs((closedContext.toggle?.right || 0) - (openContext.toggle?.right || 0)) <= 1,
  { closed: closedContext, open: openContext })
await page.locator('.context-dock .context-toggle').click()
await page.locator('.tabstrip-actions .context-toggle').waitFor({ state: 'visible', timeout: 20000 })
await page.screenshot({ path: join(OUT, 'spec-document-no-actions.png'), fullPage: true })

await context.close()
await browser.close()
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ base: BASE, session, checks }, null, 2))
if (checks.some((item) => !item.ok)) process.exitCode = 1
