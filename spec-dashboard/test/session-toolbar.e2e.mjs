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
const SWITCH_SESSION = board.sessions.find((session) => session.id !== SESSION && !session.parent && !session.capabilities?.headless)?.id
if (!SWITCH_SESSION) throw new Error('A→B→A proof needs a second top-level session row')

const checks = []
const result = { base: BASE, session: SESSION, checks, wide: null, narrow: null, themes: [], states: [], surfaces: [], evalModels: [], requests: [], frames: [] }
const check = (name, ok, detail = null) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail == null ? '' : ` - ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}
const waitToolbar = async (page) => {
  await page.locator('.si-tabbar').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('.si-eval-tab').waitFor({ state: 'visible', timeout: 20000 })
  await page.waitForFunction(() => Boolean(document.querySelector('.si-eval-tab')?.getAttribute('aria-label')))
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
  const evalTab = document.querySelector('.si-eval-tab')
  const picker = document.querySelector('.si-resource-picker')
  const tabs = document.querySelector('.si-tabs')
  const baseTabs = document.querySelector('.si-base-tabs')
  const resourceTabs = document.querySelector('.si-resource-tabs')
  const term = document.querySelector('.si-term-body')
  const files = document.querySelector('.si-files')
  const surfaceSwitch = document.querySelector('[data-surface-switch]')
  const commandTools = [...toolbar.querySelectorAll('.si-actions [data-command]')]
  const lastCommandTool = commandTools.at(-1)
  const style = getComputedStyle(toolbar)
  return {
    bounds,
    children: [...toolbar.children].map((element) => ({ className: element.className, ...rect(element) })),
    overflow,
    scrollWidth: toolbar.scrollWidth,
    clientWidth: toolbar.clientWidth,
    identityCount: toolbar.querySelectorAll('.si-identity, .si-th-name, .si-session-status, .si-session-live').length,
    sidebarHeadline: document.querySelector('.si-item.on .sess-id')?.textContent || null,
    evalTab: { tag: evalTab.tagName, href: evalTab.getAttribute('href'), label: evalTab.getAttribute('aria-label'), iconColor: getComputedStyle(evalTab.querySelector(':scope > svg')).color, box: rect(evalTab) },
    tabs: rect(tabs),
    baseTabs: rect(baseTabs),
    resourceTabs: rect(resourceTabs),
    picker: { ...rect(picker), borderLeft: getComputedStyle(picker).borderLeftWidth, borderRight: getComputedStyle(picker).borderRightWidth },
    add: { ...rect(document.querySelector('.si-tab-add')), borderRadius: getComputedStyle(document.querySelector('.si-tab-add')).borderRadius },
    files: { ...rect(files), borderLeft: getComputedStyle(files).borderLeftWidth, gapFromLastCommand: lastCommandTool ? files.getBoundingClientRect().left - lastCommandTool.getBoundingClientRect().right : null },
    surfaceSwitch: surfaceSwitch ? { ...rect(surfaceSwitch), target: surfaceSwitch.dataset.surfaceSwitch, label: surfaceSwitch.getAttribute('aria-label') } : null,
    roles: {
      tablists: toolbar.querySelectorAll('[role=tablist]').length,
      tabs: toolbar.querySelectorAll('[role=tab]').length,
      selected: toolbar.querySelector('[role=tab]')?.getAttribute('aria-selected'),
      actions: commandTools.map((button) => button.dataset.command),
    },
    actionDetails: commandTools.map((button) => {
      const buttonStyle = getComputedStyle(button)
      return {
        name: button.dataset.command,
        text: button.textContent.trim(),
        label: button.getAttribute('aria-label'),
        tip: button.getAttribute('data-tip'),
        disabled: button.disabled,
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

const evalValue = {
  mixed: { measured: 2, total: 3, pass: 1, fail: 1, review: 0, blind: 1, unknown: 0 },
  zero: { measured: 0, total: 0, pass: 0, fail: 0, review: 0, blind: 0, unknown: 0 },
  refresh: { measured: 0, total: 1, pass: 0, fail: 0, review: 0, blind: 1, unknown: 0 },
}
const evalProjection = (mode, generation = 1, value = evalValue[mode]) => mode === 'error'
  ? { epoch: 'fixture', generation, phase: 'error' }
  : { epoch: 'fixture', generation, phase: 'ready', revision: `fixture-${generation}`, value }

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })

// Real session journey: native focus order, Command Box registry, Eval navigation, warm return.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
  await context.addInitScript(() => {
    window.EventSource = class FixtureEventSource {
      constructor() { throw new Error('fixture disables board SSE') }
    }
    window.__toolbarFrames = []
    const sample = (at) => {
      const toolbar = document.querySelector('.si-tabbar')
      window.__toolbarFrames.push({
        at,
        text: toolbar?.innerText?.replace(/\s+/g, ' ').trim() || '',
        label: document.querySelector('.si-eval-tab')?.getAttribute('aria-label') || '',
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  const page = await context.newPage()
  const evalRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/evals' && (url.searchParams.get('q') || '').includes(`scope:${SESSION}`)) {
      evalRequests.push({ at: Date.now(), method: request.method(), url: request.url() })
    }
  })
  await page.route('**/api/graph*', async (route) => {
    const graph = structuredClone(board)
    const session = graph.sessions.find((candidate) => candidate.id === SESSION)
    session.status = 'review'
    session.lifecycle = 'awaiting'
    session.proposal = 'merge'
    session.liveness = 'online'
    session.evalSummary = evalProjection('refresh', 10, { measured: 9, total: 10, pass: 1, fail: 0, review: 8, blind: 1, unknown: 0 })
    const other = graph.sessions.find((candidate) => candidate.id === SWITCH_SESSION)
    if (other) {
      other.status = 'review'
      other.lifecycle = 'awaiting'
      other.proposal = 'merge'
      other.liveness = 'online'
      other.evalSummary = evalProjection('refresh', 20, { measured: 4, total: 5, pass: 1, fail: 0, review: 3, blind: 1, unknown: 0 })
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
  })
  // The parity scenario names Claude Code's /exit specifically. Feed the backend's real Claude command
  // catalog to this browser fixture even when the live proof session itself was launched through Codex.
  await page.route('**/api/slash-commands*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(claudeSlash) }))
  const timeline = [{ at: 0, step: 'open session toolbar' }]
  const started = Date.now()
  const step = (name) => timeline.push({ at: Date.now() - started, step: name })
  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  step('toolbar loaded')
  const firstLabel = await page.locator('.si-eval-tab').getAttribute('aria-label')
  await page.locator(`.si-item[data-sid="${SWITCH_SESSION}"]`).click()
  await page.locator(`.si-item[data-sid="${SWITCH_SESSION}"].on`).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('.si-eval-tab')?.getAttribute('aria-label')?.includes('3 need review'))
  const otherLabel = await page.locator('.si-eval-tab').getAttribute('aria-label')
  await page.locator(`.si-item[data-sid="${SESSION}"]`).click()
  await page.locator(`.si-item[data-sid="${SESSION}"].on`).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('.si-eval-tab')?.getAttribute('aria-label')?.includes('8 need review'))
  const returnedLabel = await page.locator('.si-eval-tab').getAttribute('aria-label')
  check('A→B→A keeps graph summaries warm with zero full-model reads',
    firstLabel.includes('8 need review') && otherLabel.includes('3 need review') && returnedLabel.includes('8 need review') && evalRequests.length === 0,
    { firstLabel, otherLabel, returnedLabel, requests: evalRequests.length })
  step('A→B→A summaries stayed warm')
  result.wide = await toolbarProbe(page)
  result.wide.aria = typeof page.locator('.si-tabbar').ariaSnapshot === 'function'
    ? await page.locator('.si-tabbar').ariaSnapshot()
    : null
  check('wide toolbar stays inside its pane', result.wide.overflow.length === 0 && result.wide.scrollWidth === result.wide.clientWidth, result.wide)
  check('one selected Terminal tab', result.wide.roles.tablists === 1 && result.wide.roles.tabs === 1 && result.wide.roles.selected === 'true', result.wide.roles)
  check('toolbar omits duplicate identity and headline payload', result.wide.identityCount === 0 && !result.wide.text.includes(result.wide.sidebarHeadline) && !result.wide.html.includes(result.wide.sidebarHeadline), { identityCount: result.wide.identityCount, toolbar: result.wide.text, sidebar: result.wide.sidebarHeadline })
  check('Eval is a canonical real navigation tab', result.wide.evalTab.tag === 'A' && decodeURIComponent(result.wide.evalTab.href).includes(`scope:${SESSION}`), result.wide.evalTab)
  check('Eval directly follows the current base surface', Math.abs(result.wide.baseTabs.right - result.wide.evalTab.box.x) <= 1, { baseTabs: result.wide.baseTabs, evalTab: result.wide.evalTab.box })
  check('resource strip follows Eval', Math.abs(result.wide.evalTab.box.right - result.wide.resourceTabs.x) <= 1, { evalTab: result.wide.evalTab.box, resourceTabs: result.wide.resourceTabs })
  check('resource picker is divided from the resource strip and its plus is a circle quieter than a command tool', Math.abs(result.wide.resourceTabs.right - result.wide.picker.x) <= 1
    && result.wide.picker.borderLeft === '1px' && result.wide.picker.borderRight === '0px' && result.wide.add.x > result.wide.picker.x
    && result.wide.add.width === 20 && result.wide.add.height === 20 && result.wide.add.borderRadius === '50%'
    && result.wide.add.width < (result.wide.actionDetails[0]?.box?.width ?? 0),
  { evalTab: result.wide.evalTab.box, picker: result.wide.picker, add: result.wide.add, tool: result.wide.actionDetails[0]?.box })
  check('toolbar chrome is distinct from terminal', result.wide.toolbarBackground !== result.wide.terminalBackground, { toolbar: result.wide.toolbarBackground, terminal: result.wide.terminalBackground })
  check('the top-right tools are one continuous icon row', result.wide.files.borderLeft === '0px' && result.wide.files.gapFromLastCommand <= 3.5 && result.wide.surfaceSwitch?.target === 'conversation', { files: result.wide.files, switch: result.wide.surfaceSwitch })
  check('toolbar commands are uniform localized icon tools', result.wide.actionDetails.length > 0 && result.wide.actionDetails.every((tool) => !tool.text && tool.icon && tool.label && tool.label === tool.tip && tool.box.width === 24 && tool.box.height === 24), result.wide.actionDetails)
  await page.screenshot({ path: join(OUT, 'B-wide-1440.png'), fullPage: true })

  await page.locator('[role=tab]').focus()
  await page.keyboard.press('Tab')
  const firstTab = await page.evaluate(() => ({ className: document.activeElement.className, tag: document.activeElement.tagName }))
  await page.keyboard.press('Tab')
  const secondTab = await page.evaluate(() => ({ className: document.activeElement.className, tag: document.activeElement.tagName }))
  await page.keyboard.press('Tab')
  const thirdTab = await page.evaluate(() => ({ className: document.activeElement.className, tag: document.activeElement.tagName }))
  result.wide.keyboardOrder = [firstTab, secondTab, thirdTab]
  check('focus order reaches Eval, its adjacent picker, then a command', firstTab.tag === 'A' && String(firstTab.className).includes('si-eval-tab') && secondTab.tag === 'BUTTON' && String(secondTab.className).includes('si-tab-add') && thirdTab.tag === 'BUTTON' && String(thirdTab.className).includes('si-tool'), result.wide.keyboardOrder)

  await page.locator('.si-tool.command').click()
  const input = page.locator('.si-command-input')
  await input.waitFor({ state: 'visible' })
  const readSlashRows = () => page.locator('.mention-menu.up .mention-item').evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector('.slash-name')?.textContent?.trim(),
    source: row.querySelector('.slash-src')?.textContent?.trim(),
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
  await input.fill('/rename')
  const renameRows = (await readSlashRows()).filter((row) => row.name === '/rename')
  const tokenColors = await page.evaluate(() => {
    const probe = (name) => {
      const element = document.createElement('span')
      element.style.color = `var(--${name})`
      document.body.appendChild(element)
      const color = getComputedStyle(element).color
      element.remove()
      return color
    }
    return Object.fromEntries(['blue', 'green', 'cyan', 'muted', 'red'].map((name) => [name, probe(name)]))
  })
  const slashColors = Object.fromEntries(slashLead.filter((row) => row.ui).map((row) => [row.name, row.color]))
  const toolColors = Object.fromEntries(result.wide.actionDetails.map((tool) => [tool.name, tool.color]))
  // the WHOLE board vocabulary, in registry order — not a prefix. A prefix pin silently stops covering
  // whatever gets appended after it; the archive pair ([[archive]]) landed between /stop and /close and a
  // 4-name slice would have kept passing while saying nothing about it.
  const boardNames = slashLead.filter((row) => row.ui).map((row) => row.name)
  const archiveRows = slashLead.filter((row) => row.name === '/archive' || row.name === '/unarchive')
  const slashParity = JSON.stringify(boardNames) === JSON.stringify(['/eval', '/merge', '/stop', '/archive', '/close'])
    // exactly ONE direction of the archive pair is ever offered, keyed on `archived` alone ([[archive]])
    && archiveRows.length === 1 && archiveRows[0].ui
    && stopRows.length === 1 && stopRows[0].ui && exitRows.length === 1 && !exitRows[0].ui
    && renameRows.length === 1 && renameRows[0].source === '[preset]'
    && toolColors.command === tokenColors.blue && toolColors.merge === tokenColors.green
    && slashColors['/merge'] === toolColors.merge
    && slashColors['/eval'] === result.wide.evalTab.iconColor && slashColors['/eval'] === tokenColors.cyan
    && slashColors['/stop'] === tokenColors.muted && slashColors['/close'] === tokenColors.red
  const activeProbe = await toolbarProbe(page)
  check('slash registry parity and resident Command Box share one registry', slashParity && await page.locator('.si-tool.command.on[aria-pressed="true"]').count() === 1 && activeProbe.bounds.height === 32 && activeProbe.overflow.length === 0, { boardNames, stopRows, exitRows, renameRows, tokenColors, active: { height: activeProbe.bounds.height, overflow: activeProbe.overflow } })
  await page.locator('.si-tool.command').click()
  await input.waitFor({ state: 'hidden' })
  check('click twin closes Command Box', await page.locator('.si-tool.command[aria-pressed="false"]').count() === 1)
  step('opened and closed Command Box')

  const warm = `warm-${Date.now()}`
  await page.locator('.si-term-body').evaluate((element, value) => { element.dataset.warmProbe = value }, warm)
  const doorHref = await page.locator('.si-eval-tab').getAttribute('href')
  const typedHistoryBefore = await page.evaluate(() => history.length)
  await page.locator('.si-tool.command').click()
  await input.fill('/eval')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.hash.startsWith('#/evals'))
  await page.locator('.se-gates').waitFor({ state: 'visible', timeout: 30_000 })
  const typedEval = { history: await page.evaluate(() => history.length), hash: await page.evaluate(() => location.hash) }
  const requestsAfterFirstOpen = evalRequests.length
  await page.goBack()
  await waitToolbar(page)
  const historyBefore = await page.evaluate(() => history.length)
  await page.locator('.si-eval-tab').focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.hash.startsWith('#/evals'))
  await page.locator('.se-gates').waitFor({ state: 'visible', timeout: 30_000 })
  const historyAfter = await page.evaluate(() => history.length)
  const anchorHash = await page.evaluate(() => location.hash)
  // Back preserves the forward entry in history.length; the anchor push replaces that forward slot, so the
  // length stays stable on the second visit. The following Back assertion proves the anchor still pushed a
  // navigable entry rather than replacing the sessions page.
  check('typed /eval and keyboard anchor share one canonical door', typedEval.history === typedHistoryBefore + 1 && historyAfter === historyBefore && typedEval.hash === anchorHash && typedEval.hash === doorHref, { typedEval, anchor: { historyBefore, historyAfter, hash: anchorHash }, doorHref })
  check('paged session list is demand-only and reused after Back', requestsAfterFirstOpen === 1 && evalRequests.length === 1,
    { beforeOpen: 0, afterFirstOpen: requestsAfterFirstOpen, afterSecondOpen: evalRequests.length })
  await page.goBack()
  await waitToolbar(page)
  check('Back returns to the same warm terminal DOM', await page.locator('.si-term-body').getAttribute('data-warm-probe') === warm)
  step('Eval tab and warm Back')
  await page.screenshot({ path: join(OUT, 'B-wide-return.png'), fullPage: true })
  result.requests = evalRequests
  result.frames = await page.evaluate(() => window.__toolbarFrames)
  writeFileSync(join(OUT, 'B-toolbar.timeline.json'), JSON.stringify({ v: 2, axis: 'time', events: timeline }, null, 2))
  const video = page.video()
  await context.close()
  await video.saveAs(join(OUT, 'B-toolbar.webm'))
}

async function fixturePage({ width = 1440, listWidth = 240, lang = 'en', theme = 'minimal', status = 'working', liveness = 'online', proposal, lifecycle, archived = false, evalMode = 'mixed', surfaceFile = false } = {}) {
  let evalReads = 0
  let mergeDispatches = 0
  const mergeRequests = []
  const context = await browser.newContext({ viewport: { width, height: 760 } })
  await context.addInitScript(({ listWidth, lang, theme }) => {
    localStorage.setItem('spex.siListWidth', String(listWidth))
    localStorage.setItem('spexcode.lang', lang)
    localStorage.setItem('spexcode.theme', theme)
    // The initial HTTP graph below is the fixture source of truth. The in-page EventSource records the
    // canonical envelope without opening a second transport; focused cases can emit graph-full explicitly.
    window.EventSource = class FixtureEventSource {
      constructor() { this.listeners = {}; window.__boardSource = this }
      addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn) }
      close() {}
      emit(name, data) { for (const fn of this.listeners[name] || []) fn({ data: JSON.stringify(data) }) }
    }
    window.__toolbarFrames = []
    const sample = (at) => {
      const toolbar = document.querySelector('.si-tabbar')
      window.__toolbarFrames.push({
        at,
        text: toolbar?.innerText?.replace(/\s+/g, ' ').trim() || '',
        label: document.querySelector('.si-eval-tab')?.getAttribute('aria-label') || '',
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, { listWidth, lang, theme })
  const page = await context.newPage()
  await page.route('**/api/graph*', async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/stream')) return route.abort()
    const graph = structuredClone(board)
    const session = graph.sessions.find((candidate) => candidate.id === SESSION)
    session.status = status
    session.lifecycle = lifecycle ?? (status === 'review' || status === 'done' || status === 'close-pending' ? 'awaiting' : 'active')
    session.proposal = proposal ?? (status === 'review' ? 'merge' : status === 'done' ? 'nothing' : status === 'close-pending' ? 'close' : null)
    session.liveness = liveness
    session.archived = archived
    if (surfaceFile) session.files = ['/tmp/surface-proof.md']
    session.headline = 'An intentionally enormous <section data-test="headline-noise"> shared session headline for validating English and 中文 without moving commands or navigation'
    session.evalSummary = evalProjection(evalMode)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
  })
  await page.route('**/api/sessions/*/merge', async (route) => {
    const request = { body: route.request().postData(), idempotencyKey: route.request().headers()['idempotency-key'] }
    mergeRequests.push(request)
    if (request.body || request.idempotencyKey) {
      await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ dispatched: false, error: 'merge must be a plain intent' }) })
      return
    }
    mergeDispatches++
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ dispatched: true }) })
  })
  if (surfaceFile) {
    await page.route('**/api/sessions/*/files/download?*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/plain', body: 'surface resource proof' })
    })
  }
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname === '/api/evals' && (url.searchParams.get('q') || '').includes(`scope:${SESSION}`)) evalReads++
  })
  await page.goto(`${BASE}/#/sessions/${SESSION}`, { waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.waitForTimeout(100)
  return { context, page, evalReads: () => evalReads, mergeDispatches: () => mergeDispatches, mergeRequests: () => [...mergeRequests] }
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
  check('mixed eval model is categorical without a repeated aggregate', !result.narrow.evalTab.label.includes('2/3') && result.narrow.evalTab.label.includes('1 fresh pass') && result.narrow.evalTab.label.includes('1 fresh fail') && result.narrow.evalTab.label.includes('1 unmeasured'), result.narrow.evalTab)
  await page.screenshot({ path: join(OUT, 'B-pane-390.png'), fullPage: true })
  await context.close()
}

// The actual desktop/mobile boundary is narrower than a 390px pane when the persisted list is wide.
// The list must yield enough room for a review toolbar carrying both registry tools.
{
  const { context, page } = await fixturePage({ width: 641, listWidth: 480, status: 'review', liveness: 'online' })
  const edge = await toolbarProbe(page)
  result.desktopEdge = edge
  // The resident Command Box tool anchors right, so transient `merge` renders to its left.
  check('desktop boundary preserves the review toolbar', edge.bounds.width >= 279 && edge.overflow.length === 0 && edge.scrollWidth === edge.clientWidth && JSON.stringify(edge.roles.actions) === JSON.stringify(['merge', 'command']), edge)
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

{
  const { context, page, mergeDispatches, mergeRequests } = await fixturePage({ status: 'review', liveness: 'online', proposal: 'merge' })
  const mergeButton = page.locator('.si-tool.merge')
  const dispatch = async () => {
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/merge') && response.status() === 200),
      mergeButton.click(),
    ])
    await page.waitForFunction(() => !document.querySelector('.si-tool.merge')?.disabled)
  }
  await dispatch()
  await dispatch()
  const requests = mergeRequests()
  check('merge dispatch stays a plain intent', mergeDispatches() === 2 && requests.length === 2 && requests.every((request) => !request.body && !request.idempotencyKey), { dispatches: mergeDispatches(), requests })
  await context.close()
}

let stableMergeX = null
for (const state of [
  { status: 'review', liveness: 'online', proposal: 'merge', actions: ['merge', 'command'], mergeEnabled: true },
  { status: 'done', liveness: 'online', proposal: 'nothing', actions: ['merge', 'command'], mergeEnabled: false, reason: 'done --propose nothing' },
  { status: 'working', liveness: 'online', proposal: null, actions: ['merge', 'command'], mergeEnabled: false, reason: 'has not proposed a merge' },
  { status: 'asking', liveness: 'online', proposal: null, actions: ['merge', 'command'], mergeEnabled: false, reason: 'has not proposed a merge' },
  { status: 'review', liveness: 'offline', proposal: 'merge', actions: ['merge', 'relaunch'], mergeEnabled: false, reason: 'not online' },
  { status: 'queued', liveness: 'offline', proposal: null, actions: ['merge'], mergeEnabled: false, reason: 'has not proposed a merge' },
  { status: 'review', liveness: 'online', proposal: 'merge', archived: true, actions: ['merge'], mergeEnabled: false, reason: 'archived' },
]) {
  const { context, page, mergeDispatches } = await fixturePage(state)
  const probe = await toolbarProbe(page)
  await page.keyboard.press('Alt+i')
  const shortcutCommand = await page.locator('.si-command-box').count() > 0
  if (shortcutCommand) await page.keyboard.press('Alt+i')
  const merge = probe.actionDetails.find((tool) => tool.name === 'merge')
  const colors = await page.evaluate(() => {
    const token = (name) => {
      const element = document.createElement('span')
      element.style.color = `var(--${name})`
      document.body.appendChild(element)
      const color = getComputedStyle(element).color
      element.remove()
      return color
    }
    return { green: token('green'), muted: token('muted') }
  })
  const beforeDispatch = mergeDispatches()
  const mergeButton = page.locator('.si-tool.merge')
  if (state.mergeEnabled) await mergeButton.click()
  else {
    const box = await mergeButton.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  }
  await page.waitForTimeout(25)
  const dispatches = mergeDispatches() - beforeDispatch
  const row = { ...state, actual: probe.roles.actions, tools: probe.actionDetails, merge, dispatches, overflow: probe.overflow, shortcutCommand }
  result.states.push(row)
  const toolShape = row.tools.every((tool) => !tool.text && tool.icon && tool.label === tool.tip && tool.box.width === 24 && tool.box.height === 24)
  const mergeSlotStable = row.actual.length === 2
    ? (stableMergeX == null ? (stableMergeX = Math.round(merge.box.x), true) : Math.round(merge.box.x) === stableMergeX)
    : true
  check(`${state.status}/${state.liveness} merge affordance`, JSON.stringify(row.actual) === JSON.stringify(state.actions)
    && row.overflow.length === 0 && toolShape && shortcutCommand === (state.liveness === 'online' && !state.archived)
    && merge.disabled === !state.mergeEnabled && dispatches === (state.mergeEnabled ? 1 : 0)
    && merge.color === colors[state.mergeEnabled ? 'green' : 'muted']
    && (state.mergeEnabled || merge.label.includes(state.reason)) && mergeSlotStable, row)
  await context.close()
}

for (const evalMode of ['zero', 'error']) {
  const { context, page } = await fixturePage({ evalMode })
  const probe = await toolbarProbe(page)
  const row = { evalMode, label: probe.evalTab.label, text: probe.text }
  result.evalModels.push(row)
  check(evalMode === 'zero' ? 'zero model names zero categories without an aggregate' : 'failed model has no aggregate',
    !row.label.includes('0/0') && (evalMode === 'zero' ? row.label.includes('0 fresh pass') : row.label.includes('no last-known value')), row)
  await context.close()
}

{
  const { context, page, evalReads } = await fixturePage({ evalMode: 'refresh' })
  const first = await page.locator('.si-eval-tab').getAttribute('aria-label')
  const refreshedGraph = structuredClone(board)
  refreshedGraph.sessions.find((session) => session.id === SESSION).evalSummary = evalProjection(
    'refresh', 2, { measured: 1, total: 1, pass: 1, fail: 0, review: 0, blind: 0, unknown: 0 },
  )
  await page.evaluate((graph) => window.__boardSource.emit('graph-full', { to: 'fixture-refresh-2', graph }), refreshedGraph)
  await page.waitForFunction(() => document.querySelector('.si-eval-tab')?.getAttribute('aria-label')?.includes('1 fresh pass'), null, { timeout: 20_000 })
  const refreshed = await page.locator('.si-eval-tab').getAttribute('aria-label')
  const frames = await page.evaluate(() => window.__toolbarFrames)
  const row = { first, refreshed, requests: evalReads(), frames }
  result.evalModels.push({ evalMode: 'refresh', ...row })
  check('graph-full refreshes the category glance with zero full-model reads', first.includes('1 unmeasured') && refreshed.includes('1 fresh pass') && row.requests === 0, row)
  await context.close()
}

// One pane-backed session proves the mutually exclusive Conversation surface, its reload memory, and the
// temporary resource overlay through the real browser UI. The file endpoint is fixture data only; selection,
// focus, localStorage, and every view transition are the shipped dashboard code.
{
  const { context, page } = await fixturePage({ surfaceFile: true })
  const toConversation = page.locator('[data-surface-switch="conversation"]')
  await toConversation.click()
  await page.locator('.si-term-body.is-conversation .tl-chat:visible').waitFor({ state: 'visible', timeout: 20_000 })
  const firstConversation = await page.evaluate(() => ({
    visibleLayers: [...document.querySelectorAll('.si-term-layer')]
      .filter((layer) => getComputedStyle(layer).visibility === 'visible')
      .map((layer) => ({ terminal: !!layer.querySelector('.xterm'), conversation: !!layer.querySelector('.tl-chat') })),
    switchTarget: document.querySelector('[data-surface-switch]')?.getAttribute('data-surface-switch'),
    mergeTools: document.querySelectorAll('.si-actions [data-command="merge"]').length,
  }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.locator('.si-term-body.is-conversation .tl-chat:visible').waitFor({ state: 'visible', timeout: 20_000 })
  const afterReload = await page.evaluate(() => ({
    switchTarget: document.querySelector('[data-surface-switch]')?.getAttribute('data-surface-switch'),
    sessionSurface: JSON.parse(localStorage.getItem('spexcode.session-surface.v1.root') || '{}'),
  }))
  await page.locator('.si-files .si-tool').click()
  const fileRow = page.locator('.si-files-row').filter({ hasText: 'surface-proof.md' })
  await fileRow.locator('.si-files-name').click()
  const resourceTab = page.locator('.si-resource-tab').filter({ hasText: 'surface-proof.md' })
  await resourceTab.waitFor({ state: 'visible' })
  const resourceDocking = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect()
      return rect && { left: rect.left, right: rect.right }
    }
    return {
      base: box('.si-base-tabs [role="tab"]'),
      eval: box('.si-eval-tab'),
      resource: box('.si-resource-tab'),
    }
  })
  check('opening a resource keeps Eval docked to the current base surface',
    Math.abs(resourceDocking.base.right - resourceDocking.eval.left) <= 1
      && Math.abs(resourceDocking.eval.right - resourceDocking.resource.left) <= 1,
  resourceDocking)
  await page.screenshot({ path: join(OUT, 'B-eval-resource-docking.png'), fullPage: true })
  await resourceTab.locator('.si-resource-tab-action').click()
  await page.locator('.si-term-body.is-conversation .tl-chat:visible').waitFor({ state: 'visible', timeout: 20_000 })
  const afterClose = await page.evaluate(() => ({
    openResourceTabs: document.querySelectorAll('.si-resource-tab').length,
    switchTarget: document.querySelector('[data-surface-switch]')?.getAttribute('data-surface-switch'),
  }))
  const row = { firstConversation, afterReload, afterClose }
  result.surfaces.push({ name: 'pane-backed Conversation reload and resource return', ...row })
  check('pane-backed Conversation is exclusive, survives reload, and resumes after resource close',
    JSON.stringify(firstConversation.visibleLayers) === JSON.stringify([{ terminal: false, conversation: true }])
      && firstConversation.switchTarget === 'terminal' && firstConversation.mergeTools === 0
      && afterReload.switchTarget === 'terminal' && afterReload.sessionSurface.sessions?.[SESSION] === 'conversation'
      && afterClose.openResourceTabs === 0 && afterClose.switchTarget === 'terminal', row)
  await page.screenshot({ path: join(OUT, 'B-conversation-resource-return.png'), fullPage: true })
  await context.close()
}

// Settings is the fallback, not an overwrite: its Conversation default reaches an unchosen pane-backed
// session, while the session's later explicit Terminal choice survives a subsequent default change and reload.
{
  const { context, page } = await fixturePage()
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'conversation', exact: true }).click()
  await page.screenshot({ path: join(OUT, 'B-settings-session-surface.png'), fullPage: true })
  await page.goto(`${BASE}/#/sessions/${SWITCH_SESSION}`, { waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.locator('.si-term-body.is-conversation .tl-chat:visible').waitFor({ state: 'visible', timeout: 20_000 })
  const defaultConversation = await page.evaluate(() => JSON.parse(localStorage.getItem('spexcode.session-surface.v1.root') || '{}'))
  await page.locator('[data-surface-switch="terminal"]').click()
  await page.locator('.si-term-body:not(.is-conversation)').waitFor({ state: 'visible', timeout: 20_000 })
  await page.goto(`${BASE}/#/settings`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'terminal', exact: true }).click()
  await page.getByRole('button', { name: 'conversation', exact: true }).click()
  await page.goto(`${BASE}/#/sessions/${SWITCH_SESSION}`, { waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.locator('.si-term-body:not(.is-conversation)').waitFor({ state: 'visible', timeout: 20_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitToolbar(page)
  await page.locator('.si-term-body:not(.is-conversation)').waitFor({ state: 'visible', timeout: 20_000 })
  const explicitTerminal = await page.evaluate(() => JSON.parse(localStorage.getItem('spexcode.session-surface.v1.root') || '{}'))
  const row = { defaultConversation, explicitTerminal }
  result.surfaces.push({ name: 'Settings default and explicit session priority', ...row })
  check('Settings default only fills unchosen sessions; explicit Terminal survives a Conversation default',
    defaultConversation.defaultSurface === 'conversation' && !defaultConversation.sessions?.[SWITCH_SESSION]
      && explicitTerminal.defaultSurface === 'conversation' && explicitTerminal.sessions?.[SWITCH_SESSION] === 'terminal', row)
  await context.close()
}

writeFileSync(join(OUT, 'B-results.json'), JSON.stringify(result, null, 2))
await browser.close()
const failed = checks.filter((entry) => !entry.ok)
console.log(`\n${checks.length - failed.length} pass, ${failed.length} fail`)
if (failed.length) process.exit(1)
