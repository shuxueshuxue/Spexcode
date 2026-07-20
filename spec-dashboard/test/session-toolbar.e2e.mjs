// Real-Chromium measurement for [[session-console]]'s desktop session toolbar.
// BASE defaults to the worktree Vite server; SESSION may pin a live row, otherwise the first
// session-console row is selected from the real graph. Whole-run media + structured geometry/AX/keyboard
// evidence land under OUT.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5177'
const OUT = process.env.OUT || '/tmp/session-toolbar-e2e'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const board = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const claudeSlash = await fetch(`${BASE}/api/slash-commands?harness=claude`).then((response) => response.json())
const SESSION = process.env.SESSION || board.sessions.find((session) => session.node === 'session-console')?.id
if (!SESSION) throw new Error('no session-console session on the live board; pass SESSION=<id>')

const checks = []
const result = { base: BASE, session: SESSION, checks, wide: null, narrow: null, themes: [], states: [], evalModels: [] }
const check = (name, ok, detail = null) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail == null ? '' : ` - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}
const waitToolbar = async (page) => {
  await page.locator('.si-tabbar').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.si-eval-measured, .si-eval-wait').first().waitFor({ state: 'visible', timeout: 20000 })
}
const toolbarProbe = (page) => page.evaluate(() => {
  const toolbar = document.querySelector('.si-tabbar')
  const rect = (element) => {
    const r = element.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }
  }
  const bounds = rect(toolbar)
  const visible = [...toolbar.querySelectorAll('*')].filter((element) => element.getClientRects().length > 0)
  const overflow = visible.filter((element) => {
    const r = element.getBoundingClientRect()
    return r.left < bounds.x - 0.5 || r.right > bounds.right + 0.5
  }).map((element) => element.className || element.tagName)
  const door = document.querySelector('.si-eval-door')
  const term = document.querySelector('.si-term-body')
  const style = getComputedStyle(toolbar)
  return {
    bounds,
    children: [...toolbar.children].map((element) => ({ className: element.className, ...rect(element) })),
    overflow,
    scrollWidth: toolbar.scrollWidth,
    clientWidth: toolbar.clientWidth,
    identityCount: toolbar.querySelectorAll('.si-identity, .si-th-name, .si-session-status, .si-session-live').length,
    sidebarHeadline: document.querySelector('.si-item.on .sess-id')?.textContent || null,
    door: { tag: door.tagName, href: door.getAttribute('href'), label: door.getAttribute('aria-label'), inTablist: !!door.closest('[role=tablist]'), iconColor: getComputedStyle(door.querySelector(':scope > svg')).color },
    roles: {
      tablists: toolbar.querySelectorAll('[role=tablist]').length,
      tabs: toolbar.querySelectorAll('[role=tab]').length,
      selected: toolbar.querySelector('[role=tab]')?.getAttribute('aria-selected'),
      actions: [...toolbar.querySelectorAll('.si-actions button')].map((button) => button.dataset.command),
    },
    actionDetails: [...toolbar.querySelectorAll('.si-actions button')].map((button) => {
      const buttonStyle = getComputedStyle(button)
      return {
        name: button.dataset.command,
        text: button.textContent.trim(),
        label: button.getAttribute('aria-label'),
        tip: button.getAttribute('data-tip'),
        pressed: button.getAttribute('aria-pressed'),
        icon: button.querySelector('svg')?.outerHTML || null,
        color: buttonStyle.color,
        borderColor: buttonStyle.borderColor,
        box: rect(button),
      }
    }),
    text: toolbar.innerText.replace(/\s+/g, ' ').trim(),
    html: toolbar.outerHTML,
    toolbarBackground: style.backgroundColor,
    terminalBackground: term ? getComputedStyle(term).backgroundColor : null,
  }
})

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })

// Real session journey: native focus order, typed/click twin, native Eval navigation, warm return.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
  await context.addInitScript(() => {
    window.EventSource = class FixtureEventSource {
      constructor() { throw new Error('fixture disables board SSE') }
    }
  })
  const page = await context.newPage()
  await page.route('**/api/graph*', async (route) => {
    const graph = structuredClone(board)
    const session = graph.sessions.find((candidate) => candidate.id === SESSION)
    session.status = 'review'
    session.lifecycle = 'awaiting'
    session.liveness = 'online'
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
  })
  // The parity scenario names Claude Code's /exit specifically. Feed the backend's real Claude command
  // catalog to this browser fixture even when the live proof session itself was launched through Codex.
  await page.route('**/api/slash-commands*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(claudeSlash) }))
  const timeline = []
  const started = Date.now()
  const step = (name) => timeline.push({ at: Date.now() - started, step: name })
  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.locator('.si-eval-measured').waitFor({ state: 'visible', timeout: 20000 })
  step('toolbar loaded')
  result.wide = await toolbarProbe(page)
  result.wide.aria = typeof page.locator('.si-tabbar').ariaSnapshot === 'function'
    ? await page.locator('.si-tabbar').ariaSnapshot()
    : null
  check('wide toolbar stays inside its pane', result.wide.overflow.length === 0 && result.wide.scrollWidth === result.wide.clientWidth, result.wide)
  check('one selected Terminal tab', result.wide.roles.tablists === 1 && result.wide.roles.tabs === 1 && result.wide.roles.selected === 'true', result.wide.roles)
  check('toolbar omits duplicate identity and headline payload', result.wide.identityCount === 0 && !result.wide.text.includes(result.wide.sidebarHeadline) && !result.wide.html.includes(result.wide.sidebarHeadline), { identityCount: result.wide.identityCount, toolbar: result.wide.text, sidebar: result.wide.sidebarHeadline })
  check('Eval is a canonical real anchor outside tablist', result.wide.door.tag === 'A' && !result.wide.door.inTablist && decodeURIComponent(result.wide.door.href).includes(`scope:${SESSION}`), result.wide.door)
  check('toolbar chrome is distinct from terminal', result.wide.toolbarBackground !== result.wide.terminalBackground, { toolbar: result.wide.toolbarBackground, terminal: result.wide.terminalBackground })
  check('toolbar commands are uniform localized icon tools', result.wide.actionDetails.length > 0 && result.wide.actionDetails.every((tool) => !tool.text && tool.icon && tool.label && tool.label === tool.tip && tool.box.width === 24 && tool.box.height === 24), result.wide.actionDetails)
  await page.screenshot({ path: join(OUT, 'B-wide-1440.png'), fullPage: true })

  await page.locator('[role=tab]').focus()
  await page.keyboard.press('Tab')
  const firstTab = await page.evaluate(() => ({ className: document.activeElement.className, tag: document.activeElement.tagName }))
  await page.keyboard.press('Tab')
  const secondTab = await page.evaluate(() => ({ className: document.activeElement.className, tag: document.activeElement.tagName }))
  result.wide.keyboardOrder = [firstTab, secondTab]
  check('focus order reaches Eval then a command', firstTab.tag === 'A' && String(firstTab.className).includes('si-eval-door') && secondTab.tag === 'BUTTON' && String(secondTab.className).includes('si-tool'), result.wide.keyboardOrder)

  const input = page.locator('.si-bottom textarea')
  const readSlashRows = () => page.locator('.mention-menu.up .mention-item').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.slash-name')?.textContent?.trim(),
    ui: row.querySelector('.slash-src')?.textContent?.trim() === '[ui]',
    color: getComputedStyle(row.querySelector('.slash-name')).color,
  })))
  await input.fill('/')
  await page.locator('.mention-menu.up').waitFor({ state: 'visible' })
  const slashLead = await readSlashRows()
  await input.fill('/stop')
  const stopRows = (await readSlashRows()).filter((row) => row.name === '/stop')
  await input.fill('/exit')
  const exitRows = (await readSlashRows()).filter((row) => row.name === '/exit')
  const tokenColors = await page.evaluate(() => {
    const probe = (name) => {
      const element = document.createElement('span')
      element.style.color = `var(--${name})`
      document.body.appendChild(element)
      const color = getComputedStyle(element).color
      element.remove()
      return color
    }
    return Object.fromEntries(['yellow', 'green', 'cyan', 'muted', 'red'].map((name) => [name, probe(name)]))
  })
  const slashColors = Object.fromEntries(slashLead.filter((row) => row.ui).map((row) => [row.name, row.color]))
  const toolColors = Object.fromEntries(result.wide.actionDetails.map((tool) => [tool.name, tool.color]))
  const slashParity = JSON.stringify(slashLead.filter((row) => row.ui).slice(0, 5).map((row) => row.name)) === JSON.stringify(['/type', '/eval', '/merge', '/stop', '/close'])
    && stopRows.length === 1 && stopRows[0].ui && exitRows.length === 1 && !exitRows[0].ui
    && toolColors.type === tokenColors.yellow && toolColors.merge === tokenColors.green
    && slashColors['/type'] === toolColors.type && slashColors['/merge'] === toolColors.merge
    && slashColors['/eval'] === result.wide.door.iconColor && slashColors['/eval'] === tokenColors.cyan
    && slashColors['/stop'] === tokenColors.muted && slashColors['/close'] === tokenColors.red
  await input.fill('/type')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await page.locator('.si-bottom.type').waitFor({ state: 'visible' })
  const activeProbe = await toolbarProbe(page)
  check('slash registry parity and typed /type activate one twin', slashParity && await page.locator('.si-tool.type.on[aria-pressed="true"]').count() === 1 && activeProbe.bounds.height === 32 && activeProbe.overflow.length === 0, { slashLead, stopRows, exitRows, tokenColors, active: { height: activeProbe.bounds.height, overflow: activeProbe.overflow } })
  await page.locator('.si-tool.type').click()
  await input.waitFor({ state: 'visible' })
  check('click twin exits type mode', await page.locator('.si-tool.type[aria-pressed="false"]').count() === 1)
  step('typed and clicked type')

  const warm = `warm-${Date.now()}`
  await page.locator('.si-term-body').evaluate((element, value) => { element.dataset.warmProbe = value }, warm)
  const doorHref = await page.locator('.si-eval-door').getAttribute('href')
  const typedHistoryBefore = await page.evaluate(() => history.length)
  await input.fill('/eval')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.hash.startsWith('#/evals'))
  const typedEval = { history: await page.evaluate(() => history.length), hash: await page.evaluate(() => location.hash) }
  await page.goBack()
  await waitToolbar(page)
  const historyBefore = await page.evaluate(() => history.length)
  await page.locator('.si-eval-door').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.hash.startsWith('#/evals'))
  const historyAfter = await page.evaluate(() => history.length)
  const anchorHash = await page.evaluate(() => location.hash)
  // Back preserves the forward entry in history.length; the anchor push replaces that forward slot, so the
  // length stays stable on the second visit. The following Back assertion proves the anchor still pushed a
  // navigable entry rather than replacing the sessions page.
  check('typed /eval and keyboard anchor share one canonical door', typedEval.history === typedHistoryBefore + 1 && historyAfter === historyBefore && typedEval.hash === anchorHash && typedEval.hash === doorHref, { typedEval, anchor: { historyBefore, historyAfter, hash: anchorHash }, doorHref })
  await page.goBack()
  await waitToolbar(page)
  check('Back returns to the same warm terminal DOM', await page.locator('.si-term-body').getAttribute('data-warm-probe') === warm)
  step('Eval door and warm Back')
  await page.screenshot({ path: join(OUT, 'B-wide-return.png'), fullPage: true })
  writeFileSync(join(OUT, 'B-timeline.json'), JSON.stringify({ v: 2, axis: 'time', events: timeline }, null, 2))
  const video = page.video()
  await context.close()
  await video.saveAs(join(OUT, 'B-toolbar.webm'))
}

const evalFixture = {
  nodes: [{
    id: 'session-console', hue: 280,
    scenarios: [
      { name: 'pass-case', expected: 'pass' },
      { name: 'fail-case', expected: 'fail' },
      { name: 'blind-case', expected: 'measured' },
    ],
    evals: [
      { scenario: 'pass-case', ts: '2026-07-20T01:00:00Z', fresh: true, verdict: { status: 'pass' }, inSession: true },
      { scenario: 'fail-case', ts: '2026-07-20T00:59:00Z', fresh: true, verdict: { status: 'fail' }, inSession: true },
    ],
  }],
  gates: [],
}

async function fixturePage({ width = 1440, listWidth = 240, lang = 'en', theme = 'minimal', status = 'working', liveness = 'online', evalMode = 'mixed' }) {
  let evalReads = 0
  let lastEvalReadAt = 0
  let evalRefreshed = false
  const context = await browser.newContext({ viewport: { width, height: 760 } })
  await context.addInitScript(({ listWidth, lang, theme }) => {
    localStorage.setItem('spex.siListWidth', String(listWidth))
    localStorage.setItem('spexcode.lang', lang)
    localStorage.setItem('spexcode.theme', theme)
    // The initial HTTP graph below is the fixture source of truth. Disable the live SSE lane so its
    // immediate real-board snapshot cannot overwrite the fixture before the toolbar is measured.
    window.EventSource = class FixtureEventSource {
      constructor() { throw new Error('fixture disables board SSE') }
    }
  }, { listWidth, lang, theme })
  const page = await context.newPage()
  await page.route('**/api/graph*', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/stream')) return route.abort()
    const graph = structuredClone(board)
    const session = graph.sessions.find((candidate) => candidate.id === SESSION)
    session.status = status
    session.lifecycle = status === 'review' || status === 'done' ? 'awaiting' : 'active'
    session.liveness = liveness
    session.headline = 'An intentionally enormous <section data-test="headline-noise"> shared session headline for validating English and 中文 without moving commands or navigation'
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
  })
  await page.route(`**/api/sessions/${SESSION}/evals`, (route) => {
    const now = Date.now()
    if (lastEvalReadAt && now - lastEvalReadAt > 1_000) evalRefreshed = true
    lastEvalReadAt = now
    evalReads++
    if (evalMode === 'error') return route.fulfill({ status: 503, body: 'fixture unavailable' })
    const refreshModel = {
      nodes: [{
        id: 'session-console', hue: 280,
        scenarios: [{ name: 'refresh-case', expected: 'measured' }],
        evals: evalRefreshed ? [{ scenario: 'refresh-case', ts: '2026-07-20T01:00:00Z', fresh: true, verdict: { status: 'pass' }, inSession: true }] : [],
      }],
      gates: [],
    }
    const model = evalMode === 'zero' ? { nodes: [], gates: [] } : evalMode === 'refresh' ? refreshModel : evalFixture
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(model) })
  })
  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.waitForTimeout(100)
  return { context, page, evalReads: () => evalReads }
}

// Exact 390px terminal pane: 922 viewport - 52 rail - 480 persisted list.
{
  const { context, page } = await fixturePage({ width: 922, listWidth: 480, evalMode: 'mixed' })
  result.narrow = await toolbarProbe(page)
  result.narrow.aria = typeof page.locator('.si-tabbar').ariaSnapshot === 'function'
    ? await page.locator('.si-tabbar').ariaSnapshot()
    : null
  check('390px pane has no toolbar overflow', Math.round(result.narrow.bounds.width) === 390 && result.narrow.overflow.length === 0 && result.narrow.scrollWidth === result.narrow.clientWidth, result.narrow)
  check('long and HTML-like headline stays out of toolbar channels', result.narrow.identityCount === 0 && !result.narrow.text.includes('headline-noise') && !result.narrow.html.includes('headline-noise'), { text: result.narrow.text, identityCount: result.narrow.identityCount })
  check('narrow AX contains no repeated identity or liveness noise', !result.narrow.aria || (!result.narrow.aria.includes('headline-noise') && !result.narrow.aria.includes('working, online')), result.narrow.aria)
  check('mixed eval model is honest and symbolic', result.narrow.door.label.includes('2/3') && result.narrow.door.label.includes('1 fresh pass') && result.narrow.door.label.includes('1 fresh fail') && result.narrow.door.label.includes('1 unmeasured'), result.narrow.door)
  await page.screenshot({ path: join(OUT, 'B-pane-390.png'), fullPage: true })
  await context.close()
}

// The actual desktop/mobile boundary is narrower than a 390px pane when the persisted list is wide.
// The list must yield enough room for a review toolbar carrying both registry tools.
{
  const { context, page } = await fixturePage({ width: 641, listWidth: 480, status: 'review', liveness: 'online' })
  const edge = await toolbarProbe(page)
  result.desktopEdge = edge
  check('desktop boundary preserves the review toolbar', edge.bounds.width >= 279 && edge.overflow.length === 0 && edge.scrollWidth === edge.clientWidth && JSON.stringify(edge.roles.actions) === JSON.stringify(['type', 'merge']), edge)
  await page.screenshot({ path: join(OUT, 'B-desktop-edge-641.png'), fullPage: true })
  await context.close()
}

// Eight palettes in both locales: token contrast and geometry remain stable.
for (const lang of ['en', 'zh']) {
  for (const theme of ['minimal', 'things', 'tokyonight', 'catppuccin', 'everforest', 'gruvbox', 'rosepine', 'dracula']) {
    const { context, page } = await fixturePage({ lang, theme })
    const probe = await toolbarProbe(page)
    const localized = probe.actionDetails.every((tool) => tool.label === tool.tip && (lang === 'zh' ? /[\u3400-\u9fff]/.test(tool.label) : !/[\u3400-\u9fff]/.test(tool.label)))
    const row = { lang, theme, height: probe.bounds.height, overflow: probe.overflow, chromeDistinct: probe.toolbarBackground !== probe.terminalBackground, localized }
    result.themes.push(row)
    check(`${lang}/${theme} theme geometry`, row.height === 32 && row.overflow.length === 0 && row.chromeDistinct && row.localized, row)
    await context.close()
  }
}

for (const state of [
  { status: 'working', liveness: 'online', actions: ['type'] },
  { status: 'review', liveness: 'online', actions: ['type', 'merge'] },
  { status: 'done', liveness: 'online', actions: ['type', 'merge'] },
  { status: 'asking', liveness: 'offline', actions: ['relaunch'] },
  { status: 'review', liveness: 'offline', actions: ['relaunch'] },
  { status: 'queued', liveness: 'offline', actions: [] },
]) {
  const { context, page } = await fixturePage(state)
  const probe = await toolbarProbe(page)
  if (state.liveness === 'offline' || state.status === 'queued') await page.keyboard.press('Alt+i')
  const shortcutType = await page.locator('.si-bottom.type').count() > 0
  const row = { ...state, actual: probe.roles.actions, tools: probe.actionDetails, overflow: probe.overflow, shortcutType }
  result.states.push(row)
  const toolShape = row.tools.every((tool) => !tool.text && tool.icon && tool.label === tool.tip && tool.box.width === 24 && tool.box.height === 24)
  check(`${state.status}/${state.liveness} commands`, JSON.stringify(row.actual) === JSON.stringify(state.actions) && row.overflow.length === 0 && toolShape && (!shortcutType || state.liveness === 'online'), row)
  await context.close()
}

for (const evalMode of ['zero', 'error']) {
  const { context, page } = await fixturePage({ evalMode })
  const probe = await toolbarProbe(page)
  const row = { evalMode, label: probe.door.label, text: probe.text }
  result.evalModels.push(row)
  check(evalMode === 'zero' ? 'zero model says 0/0' : 'failed model never says 0/0', evalMode === 'zero' ? row.label.includes('0/0') : !row.label.includes('0/0'), row)
  await context.close()
}

{
  const { context, page, evalReads } = await fixturePage({ evalMode: 'refresh' })
  const first = await page.locator('.si-eval-door').getAttribute('aria-label')
  await page.waitForFunction(() => document.querySelector('.si-eval-door')?.getAttribute('aria-label')?.includes('1/1'), null, { timeout: 20_000 })
  const refreshed = await page.locator('.si-eval-door').getAttribute('aria-label')
  const row = { first, refreshed, requests: evalReads() }
  result.evalModels.push({ evalMode: 'refresh', ...row })
  check('stable working session refreshes its eval glance', first.includes('0/1') && refreshed.includes('1/1') && row.requests >= 2, row)
  await context.close()
}

writeFileSync(join(OUT, 'B-results.json'), JSON.stringify(result, null, 2))
await browser.close()
const failed = checks.filter((entry) => !entry.ok)
console.log(`\n${checks.length - failed.length} pass, ${failed.length} fail`)
if (failed.length) process.exit(1)
