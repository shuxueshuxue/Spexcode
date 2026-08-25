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

// The band's order is DOM order over every control it holds, not just the icon buttons: the Eval door is a
// real anchor and would be invisible to a `.document-action-button` sweep, which is exactly how it went
// missing without a single check turning red.
const bandProbe = () => page.evaluate(() => {
  const slot = document.querySelector('.tabstrip-actions')
  const controls = slot ? [...slot.querySelectorAll('[data-action]')] : []
  const door = slot?.querySelector('.si-eval-door') || null
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
    door: door ? {
      tag: door.tagName,
      href: door.getAttribute('href'),
      label: door.getAttribute('aria-label'),
      glance: Boolean(door.querySelector('.si-eval-stats, .si-eval-wait')),
      rect: rect(door),
    } : null,
    buttonHeights: [...document.querySelectorAll('.document-action-button')].map((el) => Math.round(el.getBoundingClientRect().height)),
    slotRect: rect(slot),
  }
})
const sessionState = await bandProbe()
check('session document has one shell action slot and no internal chrome', !sessionState.hasRetiredToolbar && sessionState.hasSlot, sessionState)
check('merge and lifecycle actions stay out of the document slot', !sessionState.actions.some((item) => item.action === 'merge' || item.action === 'session-menu'), sessionState.actions)
check('the slot carries no disabled merge witness', !sessionState.actions.some((item) => item.action === 'merge'), sessionState.actions)
check('the Eval door is a real anchor on the scoped address, carrying its glance', Boolean(
  sessionState.door && sessionState.door.tag === 'A'
  && sessionState.door.href === `#/evals?q=${encodeURIComponent(`is:eval scope:${session}`)}`
  && sessionState.door.glance), sessionState.door)
check('the door keeps the band control height rather than its own geometry',
  Boolean(sessionState.door) && sessionState.buttonHeights.every((h) => Math.abs(h - Math.round(sessionState.door.rect.height)) <= 1),
  { door: sessionState.door && Math.round(sessionState.door.rect.height), buttons: sessionState.buttonHeights })
const pickerOpened = await page.locator('.document-action-button[data-action="resource-picker"]').click().then(() => true).catch(() => false)
const withPicker = pickerOpened ? await bandProbe() : null
check('opening the picker leaves the door where it was', !withPicker || withPicker.order.indexOf('eval') === sessionState.order.indexOf('eval'),
  { before: sessionState.order, after: withPicker && withPicker.order })
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
const specState = await page.evaluate(() => ({ hasSlot: Boolean(document.querySelector('.tabstrip-actions')), hasRetiredToolbar: Boolean(document.querySelector('.si-tabbar, .si-toolbar, .si-tool')) }))
check('non-session documents leave the action slot empty', !specState.hasSlot && !specState.hasRetiredToolbar, specState)
await page.screenshot({ path: join(OUT, 'spec-document-no-actions.png'), fullPage: true })

await context.close()
await browser.close()
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ base: BASE, session, checks }, null, 2))
if (checks.some((item) => !item.ok)) process.exitCode = 1
