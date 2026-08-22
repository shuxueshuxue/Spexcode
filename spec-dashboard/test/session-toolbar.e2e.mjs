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

const sessionState = await page.evaluate(() => {
  const slot = document.querySelector('.tabstrip-actions')
  const actions = [...document.querySelectorAll('.document-action-button')].map((button) => ({
    action: button.dataset.action,
    label: button.getAttribute('aria-label'),
    disabled: button.disabled,
  }))
  return {
    hasRetiredToolbar: Boolean(document.querySelector('.si-tabbar, .si-toolbar, .si-tool')),
    hasSlot: Boolean(slot),
    actions,
    slotRect: slot ? slot.getBoundingClientRect().toJSON() : null,
  }
})
check('session document has one shell action slot and no internal chrome', !sessionState.hasRetiredToolbar && sessionState.hasSlot, sessionState)
check('merge and session actions are registered in the slot', sessionState.actions.some((item) => item.action === 'merge') && sessionState.actions.some((item) => item.action === 'session-menu'), sessionState.actions)
check('disabled merge keeps its reason in the accessible label', sessionState.actions.some((item) => item.action === 'merge' && item.disabled && item.label?.includes('merge unavailable')), sessionState.actions.find((item) => item.action === 'merge'))
await page.screenshot({ path: join(OUT, 'session-document-actions.png'), fullPage: true })

await page.goto(`${BASE}/#/spec/spexcode`)
await page.locator('.tabstrip').waitFor({ state: 'visible', timeout: 20000 })
const specState = await page.evaluate(() => ({ hasSlot: Boolean(document.querySelector('.tabstrip-actions')), hasRetiredToolbar: Boolean(document.querySelector('.si-tabbar, .si-toolbar, .si-tool')) }))
check('non-session documents leave the action slot empty', !specState.hasSlot && !specState.hasRetiredToolbar, specState)
await page.screenshot({ path: join(OUT, 'spec-document-no-actions.png'), fullPage: true })

await context.close()
await browser.close()
writeFileSync(join(OUT, 'result.json'), JSON.stringify({ base: BASE, session, checks }, null, 2))
if (checks.some((item) => !item.ok)) process.exitCode = 1
