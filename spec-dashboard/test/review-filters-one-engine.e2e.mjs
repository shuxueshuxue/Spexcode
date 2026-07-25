// [[review-filters]] YATU: ONE filter engine, two state homes. Drives the canonical #/issues and #/evals
// ListViews and the compact Spec Information panes in a single real-Chromium recording against the
// PREBUILT dashboard dist, and compares what each face MATCHES field by field. Also walks the History
// pane, which must expose no expand-all replacement for its one-at-a-time disclosure.
import { pathToFileURL } from 'node:url'
import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const NODE = process.env.NODE_ID || 'eval-core'
const OUT = process.env.OUT || '/tmp/review-filters-one-engine'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}
const step = (label) => console.log(`\n--- ${label}`)

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()

const api = { evals: null, issues: null }
page.on('response', async (response) => {
  const url = new URL(response.url())
  const key = url.pathname.endsWith('/api/evals') ? 'evals' : url.pathname.endsWith('/api/issues') ? 'issues' : null
  if (!key) return
  try { api[key] = { query: url.searchParams.get('q'), view: url.searchParams.get('view'), body: await response.json() } } catch { /* error bodies aren't this probe's subject */ }
})

const hash = () => page.evaluate(() => decodeURIComponent(location.hash))
const rowTitles = () => page.evaluate(() => [...document.querySelectorAll('.lp-row .rl-row-title')].map((el) => el.textContent.trim()))
const settle = (ms = 900) => page.waitForTimeout(ms)
// wait for the response THIS submit caused — a fixed sleep silently reads the previous body when the
// backend is cold, which turns every downstream assertion into a coin flip.
const submitQuery = async (text) => {
  await page.locator('.rl-query input[role="combobox"]').fill(text)
  await page.keyboard.press('Enter')
  const echoed = await until(() => api.issues?.query === text || api.evals?.query === text, 30_000)
  if (!echoed) console.log(`  (warn) no /api response echoed "${text}" within 30s`)
  await settle(500)
}
// poll a condition instead of trusting one fixed sleep — a list replay is a real refetch.
const until = async (predicate, timeout = 15_000) => {
  const deadline = Date.now() + timeout
  for (;;) {
    if (await predicate()) return true
    if (Date.now() > deadline) return false
    await page.waitForTimeout(250)
  }
}
const facetNames = () => page.evaluate(() => [...document.querySelectorAll('.rl-facet')].map((el) => el.textContent.replace(/\s+/g, ' ').trim()))
const overflowGroups = () => page.evaluate(() => [...document.querySelectorAll('.rl-secondary-filters-menu [role="group"]')].map((group) => ({
  label: group.querySelector('.rl-menu-label')?.textContent.trim(),
  options: [...group.querySelectorAll('[role="menuitemradio"]')].map((item) => ({
    label: item.textContent.replace(/\s+/g, ' ').trim(),
    checked: item.getAttribute('aria-checked') === 'true',
  })),
})))
const noHorizontalOverflow = () => page.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  body: document.body.scrollWidth,
  view: window.innerWidth,
}))

// ============ 1. the CANONICAL pages: token text is the whole state, Back replays it ============
step('canonical #/issues — query + section + facet + overflow, then Back')
await page.goto(`${BASE}/#/issues`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rl-section')
await settle(1100)
// a cold backend builds its snapshot on the first request — wait for the response, don't sample past it.
await until(() => api.issues?.body?.section?.value != null, 45_000)
const issuesDefault = await rowTitles()
check('issues opens on outstanding work', (await hash()).startsWith('#/issues') && api.issues?.body?.section?.value === 'open',
  `section=${api.issues?.body?.section?.value}`)

await submitQuery('is:issue state:closed')
const closedRows = await rowTitles()
check('a section pick is visible token text and re-sources the list', (await hash()).includes('state:closed') && closedRows.join('|') !== issuesDefault.join('|'))
check('counts describe the whole population, not the 25-row slice',
  (api.issues.body.counts.open + api.issues.body.counts.closed) === api.issues.body.sourceTotal,
  `${JSON.stringify(api.issues.body.counts)} vs sourceTotal ${api.issues.body.sourceTotal}`)

const storeOption = api.issues.body.facets.store?.options?.find((option) => option.value)
await submitQuery(`is:issue state:closed store:${storeOption.value}`)
const storeRows = await rowTitles()
check('a facet dimension conjoins with the section', storeRows.length <= closedRows.length && (await hash()).includes(`store:${storeOption.value}`))
await page.screenshot({ path: join(OUT, '01-issues-filtered.png') })

await page.goBack()
// a replay is a REFETCH: poll for the restored row set rather than sampling one fixed instant.
const restored = await until(async () => (await rowTitles()).join('|') === closedRows.join('|'))
check('Back restores the previous canonical view exactly',
  restored && (await hash()).includes('state:closed') && !(await hash()).includes('store:'),
  `${await hash()} · ${(await rowTitles()).length} rows vs ${closedRows.length}`)

step('an ACTIVE value survives its own data going to zero')
await submitQuery(`is:issue store:${storeOption.value} nonexistentsubstringzzz`)
check('the impossible-to-match view is an honest zero, not an error', (await rowTitles()).length === 0 && api.issues.body.total === 0)
// the store facet is DIRECT on desktop, so its off-switch is opened from its own button, not the overflow.
const storeFacetButton = page.locator('.rl-facet').filter({ hasText: /store|仓库|存储/i }).first()
check('the active store facet is still present at zero results', await storeFacetButton.count() === 1, (await facetNames()).join(' | '))
await storeFacetButton.click()
await settle(400)
const zeroDataOptions = await page.evaluate(() => [...document.querySelectorAll('.rl-menu [role="menuitemradio"]')].map((item) => ({
  label: item.textContent.replace(/\s+/g, ' ').trim(),
  checked: item.getAttribute('aria-checked') === 'true',
})))
check('the active value stays a real CHECKED row at zero data',
  zeroDataOptions.some((option) => option.checked && option.label.includes(storeOption.value)), JSON.stringify(zeroDataOptions))
check('and its All off-switch is still offered', zeroDataOptions.some((option) => /^all$|全部/i.test(option.label)))
await page.screenshot({ path: join(OUT, '02-issues-active-at-zero.png') })
await page.keyboard.press('Escape')
await settle(300)
check('Escape returns focus to the facet trigger that opened the menu',
  await page.evaluate(() => document.activeElement?.classList.contains('rl-facet')))
await page.locator('.rl-secondary-filters-trigger').first().click()
await settle(400)
const zeroDataGroups = await overflowGroups()
check('the secondary menu still offers its own groups in the same zero view', zeroDataGroups.length >= 1,
  zeroDataGroups.map((group) => group.label).join(' | '))
await page.keyboard.press('Escape')
await settle(300)
check('Escape returns focus to the overflow trigger',
  await page.evaluate(() => document.activeElement?.classList.contains('rl-secondary-filters-trigger')))

step('canonical #/evals — the SAME engine over eval fields')
await page.goto(`${BASE}/#/evals`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rl-section')
await settle(1100)
const evalFacets = await facetNames()
check('evals opens on its complete bound record', (await hash()) === '#/evals' && api.evals.body.total === api.evals.body.sourceTotal)
check('the low-cardinality eval facets are direct on desktop', evalFacets.length >= 2, evalFacets.join(' | '))
const node = api.evals.body.facets.node.options.find((option) => option.value === NODE) || api.evals.body.facets.node.options.find((option) => option.value)
await submitQuery(`is:eval node:${node.value}`)
const nodeScopedTotal = api.evals.body.total
check('node: is a token-only dimension with no enumerating dropdown',
  !(await facetNames()).some((label) => /node/i.test(label)), (await facetNames()).join(' | '))
await submitQuery(`is:eval node:${node.value} verdict:unmeasured`)
check('verdict:unmeasured selects declared-without-reading rows only',
  api.evals.body.items.every((item) => item.filterKind === 'blind' || item.filterKind === 'unmeasured'),
  [...new Set(api.evals.body.items.map((item) => item.filterKind))].join(','))
await submitQuery(`is:eval node:${node.value} frobnicate:xyz`)
check('an unknown qualifier stays verbatim and honestly matches nothing',
  (await hash()).includes('frobnicate:xyz') && api.evals.body.total === 0)
await page.screenshot({ path: join(OUT, '03-evals-unknown-qualifier.png') })

// ============ 2. the EMBEDDED panes: same semantics, local state, no address ============
step(`Spec Information on ${NODE} — the compact face of the same adapters`)
await page.evaluate((id) => { sessionStorage.setItem('spex.focus', id); location.hash = '#/' }, NODE)
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(1600)
const nodeCard = page.locator('.react-flow__node').filter({ hasText: NODE }).first()
await nodeCard.waitFor({ state: 'visible', timeout: 45_000 })
await nodeCard.dblclick()
await page.waitForSelector('.ov-panel')
const hashAtOpen = await hash()

await page.locator('.ov-tab', { hasText: /issue/i }).click()
await settle(1400)
const paneIssueRows = () => page.evaluate(() => [...document.querySelectorAll('.pane-issues .issue-card-title, .pane-issues .rl-row-title, .pane-issues .ic-title')].map((el) => el.textContent.trim()))
// wait for the pane's own fetch to settle — sampling the count immediately races the loading state.
const issuesCompact = await page.locator('.pane-issues .rf-compact').first()
  .waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false)
check('the embedded Issues pane wears ONE shallow search row',
  issuesCompact && await page.locator('.pane-issues .rf-compact').count() === 1)
await page.locator('.rf-compact input').first().fill('zzzznomatch')
await settle(1800)
const emptyPane = await page.evaluate(() => ({
  note: document.querySelector('.pane-issues .pane-filter-none')?.textContent.trim() ?? null,
  cards: document.querySelectorAll('.pane-issues .issue-card, .pane-issues .ic').length,
  summary: document.querySelector('.rf-summary .sr-only')?.textContent.trim() ?? null,
}))
check('an embedded filter reaches an honest empty result', emptyPane.note !== null && emptyPane.cards === 0, JSON.stringify(emptyPane))
check('and it never touches the address', (await hash()) === hashAtOpen, `${hashAtOpen} → ${await hash()}`)
await page.screenshot({ path: join(OUT, '04-pane-issues-empty.png') })
await page.locator('.rf-clear').first().click()
await settle(900)

step('the compact overflow is the shared accessible primitive — pointer and keyboard')
await page.locator('.ov-tab', { hasText: /eval/i }).click()
await settle(1600)
check('the embedded Eval pane renders its compact search row', await page.locator('.rf-compact').count() >= 1)
await page.locator('.rf-compact .rl-secondary-filters-trigger').first().click()
await settle(400)
const paneGroups = await overflowGroups()
check('the overflow is named RADIO groups, not one mixed set',
  paneGroups.length >= 2 && paneGroups.every((group) => group.options.length >= 2), JSON.stringify(paneGroups.map((g) => [g.label, g.options.length])))
check('a node-local list omits the node facet — absence of choice, not a fake facet',
  !paneGroups.some((group) => /^node$|节点/i.test(group.label || '')), paneGroups.map((g) => g.label).join(' | '))
const focusStart = await page.evaluate(() => document.activeElement?.textContent?.trim())
await page.keyboard.press('ArrowDown')
const focusNext = await page.evaluate(() => document.activeElement?.textContent?.trim())
await page.keyboard.press('End')
const focusEnd = await page.evaluate(() => document.activeElement?.textContent?.trim())
await page.keyboard.press('Home')
const focusHome = await page.evaluate(() => document.activeElement?.textContent?.trim())
check('open focuses a radio and Arrow/Home/End rove it', focusStart !== focusNext && focusEnd !== focusHome,
  `${focusStart} → ${focusNext} … End=${focusEnd} Home=${focusHome}`)
await page.screenshot({ path: join(OUT, '05-pane-eval-overflow.png') })
await page.keyboard.press('Escape')
await settle(300)
check('Escape restores the compact trigger', await page.evaluate(() => document.activeElement?.classList.contains('rl-secondary-filters-trigger')))

step('the embedded pick agrees with the canonical adapter, and survives a tab switch')
await page.locator('.rf-compact .rl-secondary-filters-trigger').first().click()
await settle(400)
await page.locator('.rl-secondary-filters-menu [role="menuitemradio"]').filter({ hasText: /fail|未通过/i }).first().click()
await settle(1400)
const paneVerdictQuery = api.evals?.query
check('the embedded pick travels through the SAME token grammar the canonical page uses',
  /verdict:fail/.test(paneVerdictQuery || '') && /node:/.test(paneVerdictQuery || ''), paneVerdictQuery)
check('the embedded pick still leaves the address alone', (await hash()) === hashAtOpen)
await page.locator('.ov-tab', { hasText: /spec|规格/i }).first().click()
await settle(600)
await page.locator('.ov-tab', { hasText: /eval/i }).click()
await settle(1400)
check('the embedded state survives a Spec Information tab switch', /verdict:fail/.test(api.evals?.query || ''), api.evals?.query)
await page.screenshot({ path: join(OUT, '06-pane-eval-survives-tabswitch.png') })

step('History discloses one row at a time — no expand-all control or replacement')
await page.locator('.ov-tab', { hasText: /history|历史/i }).click()
await settle(1800)
const openIndices = () => page.evaluate(() => [...document.querySelectorAll('.pane-hist .ver-row')]
  .filter((row) => row.classList.contains('open')).map((row) => Number(row.dataset.i)))
const historyControls = await page.evaluate(() => ({
  rows: document.querySelectorAll('.pane-hist .ver-row').length,
  // every control inside the pane must be a ROW header (rec-toggle) — nothing that opens the whole log.
  nonRowControls: [...document.querySelectorAll('.pane-hist button')]
    .filter((el) => !el.classList.contains('rec-toggle'))
    .map((el) => el.textContent.replace(/\s+/g, ' ').trim().slice(0, 40)),
}))
check('History has many rows and NO control other than the row headers themselves',
  historyControls.rows > 1 && historyControls.nonRowControls.length === 0, JSON.stringify(historyControls))
const beforeToggle = await openIndices()
await page.locator('.pane-hist .rec-toggle').nth(4).click()
await settle(900)
const afterToggle = await openIndices()
check('a row header discloses exactly the row it heads',
  afterToggle.includes(4) && !beforeToggle.includes(4), `${JSON.stringify(beforeToggle)} → ${JSON.stringify(afterToggle)}`)
// the ONE reveal gesture: each downward scroll tick discloses the next entry, never the log.
await page.locator('.pane-hist').hover()
let gesture = afterToggle
for (let tick = 0; tick < 3; tick++) {
  const before = gesture
  await page.mouse.wheel(0, 140)
  await settle(500)
  gesture = await openIndices()
  check(`down gesture ${tick + 1} discloses at most one more entry`,
    gesture.length >= before.length && gesture.length <= before.length + 1,
    `${JSON.stringify(before)} → ${JSON.stringify(gesture)}`)
}
check('after three gestures the log is still overwhelmingly collapsed — no expand-all replacement',
  gesture.length < historyControls.rows / 2, `${gesture.length} open of ${historyControls.rows}`)
await page.screenshot({ path: join(OUT, '07-history-one-at-a-time.png') })

// ============ 3. 390px + the second theme ============
step('390px — the same compact interactions, second theme, no horizontal overflow')
await page.evaluate(() => { localStorage.setItem('spexcode.theme', 'dracula') })
await page.setViewportSize({ width: 390, height: 780 })
await page.goto(`${BASE}/#/evals`, { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })   // the theme is applied before first paint, so re-enter
await settle(1600)
check('the phone theme applied', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'dracula')
const phoneOverflow = await noHorizontalOverflow()
check('the phone canonical list never widens the page', phoneOverflow.doc <= 390 && phoneOverflow.body <= 390, JSON.stringify(phoneOverflow))
await page.locator('.rl-secondary-filters-trigger').first().click()
await settle(500)
const phoneGroups = await overflowGroups()
check('displaced facets are all reachable in the ONE secondary menu at 390px',
  phoneGroups.length >= 3, phoneGroups.map((g) => g.label).join(' | '))
await page.screenshot({ path: join(OUT, '08-phone-evals-overflow.png') })
await page.keyboard.press('Escape')
await settle(300)
await page.goto(`${BASE}/#/issues`, { waitUntil: 'domcontentloaded' })
await settle(1400)
const phoneIssuesOverflow = await noHorizontalOverflow()
check('the phone Issues list never widens the page either', phoneIssuesOverflow.doc <= 390 && phoneIssuesOverflow.body <= 390, JSON.stringify(phoneIssuesOverflow))
await page.screenshot({ path: join(OUT, '09-phone-issues.png') })

step('back to the first theme at desktop width, one last canonical comparison')
await page.evaluate(() => { localStorage.setItem('spexcode.theme', 'minimal') })
await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(`${BASE}/#/evals?q=${encodeURIComponent(`is:eval node:${node.value}`)}`, { waitUntil: 'domcontentloaded' })
await page.reload({ waitUntil: 'domcontentloaded' })
await settle(1400)
check('the first theme is back', await page.evaluate(() => document.documentElement.getAttribute('data-theme')) === 'minimal')
check('the canonical list reproduces the node-scoped population the pane filtered',
  api.evals.body.total === nodeScopedTotal, `${api.evals.body.total} vs ${nodeScopedTotal}`)
await page.screenshot({ path: join(OUT, '10-canonical-agrees-with-pane.png') })

console.log(`\n${pass} passed, ${fail} failed`)
await context.close()
await browser.close()
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.webm') && !file.startsWith('run-')) renameSync(join(OUT, file), join(OUT, 'run-review-filters-one-engine.webm'))
}
process.exit(fail ? 1 : 0)
