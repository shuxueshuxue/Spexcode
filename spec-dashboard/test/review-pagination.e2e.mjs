// review-pagination.e2e.mjs — [[review-chrome]] product proof against a real dashboard/backend.
// The ledger starts at first app entry: graph bootstrap and list response are measured together.
import assert from 'node:assert/strict'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE || 'http://127.0.0.1:5198'
const out = resolve(process.env.OUT || `/tmp/review-pagination-e2e-${Date.now()}`)
const requireLeanGraph = process.env.EXPECT_GRAPH_LEAN !== '0'
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const { chromium } = await import(pathToFileURL(playwrightPath).href)

const browser = await chromium.launch({ executablePath: chromiumPath })
const metrics = { base, requireLeanGraph, network: [], checks: {} }
const events = []
const started = Date.now()
const mark = (label) => events.push({ atMs: Date.now() - started, kind: 'frame', label })
const apiPath = (response) => new URL(response.url()).pathname
const waitApi = (page, domain, predicate = () => true) => page.waitForResponse((response) => {
  const url = new URL(response.url())
  return url.pathname.endsWith(`/api/${domain}`) && predicate(url)
}, { timeout: 45_000 })

async function measure(response, label) {
  const body = await response.text()
  const data = JSON.parse(body)
  const row = {
    label,
    url: response.url(),
    status: response.status(),
    bytes: Buffer.byteLength(body),
    items: Array.isArray(data.items) ? data.items.length : null,
    page: data.page ?? null,
    perPage: data.perPage ?? null,
    total: data.total ?? null,
    sourceTotal: data.sourceTotal ?? null,
    pageCount: data.pageCount ?? null,
    prev: data.prev ?? null,
    next: data.next ?? null,
    revision: data.revision ?? null,
  }
  metrics.network.push(row)
  return { data, row }
}

function graphRows(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  return {
    evalItems: nodes.reduce((count, node) => count + (Array.isArray(node.evals) ? node.evals.length : 0), 0),
    scenarioItems: nodes.reduce((count, node) => count + (Array.isArray(node.scenarios) ? node.scenarios.length : 0), 0),
    issueItems: nodes.reduce((count, node) => count + (Array.isArray(node.issues) ? node.issues.length : 0), 0),
    openIssueItems: nodes.reduce((count, node) => count + (Array.isArray(node.openIssues) ? node.openIssues.length : 0), 0),
  }
}

async function readGraph(response) {
  const body = await response.text()
  const graph = JSON.parse(body)
  const reading = { label: 'initial-graph', url: response.url(), status: response.status(), bytes: Buffer.byteLength(body), ...graphRows(graph) }
  metrics.network.push(reading)
  return reading
}

async function settleRows(page, count) {
  await page.locator('.lp-page').waitFor({ state: 'visible', timeout: 45_000 })
  await page.waitForFunction((expected) => document.querySelectorAll('.lp-row').length === expected, count)
  await page.waitForTimeout(80)
}

async function verifyPage(page, measured, label) {
  const { data, row } = measured
  assert.equal(row.status, 200, `${label}: HTTP 200`)
  assert.equal(data.perPage, 25, `${label}: fixed perPage`)
  assert.ok(data.items.length <= 25, `${label}: response has at most one page`)
  assert.equal(Object.hasOwn(data, 'issues'), false, `${label}: no legacy full issues field`)
  assert.equal(Object.hasOwn(data, 'evals'), false, `${label}: no legacy full evals field`)
  await settleRows(page, data.items.length)
  assert.equal(await page.locator('.lp-row').count(), data.items.length, `${label}: DOM equals response slice`)
}

async function setHash(page, hash, domain, expectedPage) {
  const waiting = waitApi(page, domain, (url) => url.searchParams.get('page') === String(expectedPage))
  await page.evaluate((next) => { location.hash = next }, hash)
  return measure(await waiting, `${domain}-page-${expectedPage}`)
}

let desktop
let mobile
try {
  desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: out, size: { width: 1440, height: 900 } } })
  const page = await desktop.newPage()
  const video = page.video()
  const requestUrls = []
  page.on('request', (request) => requestUrls.push(request.url()))

  const graphWaiting = page.waitForResponse((response) => apiPath(response).endsWith('/api/graph'), { timeout: 45_000 })
  const evalWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '1')
  await page.goto(`${base}/#/evals`)
  const graph = await readGraph(await graphWaiting)
  const eval1 = await measure(await evalWaiting, 'evals-initial-page-1')
  metrics.checks.initialLedgerBytes = graph.bytes + eval1.row.bytes
  if (requireLeanGraph) {
    assert.deepEqual(
      { evalItems: graph.evalItems, scenarioItems: graph.scenarioItems, issueItems: graph.issueItems, openIssueItems: graph.openIssueItems },
      { evalItems: 0, scenarioItems: 0, issueItems: 0, openIssueItems: 0 },
      'initial graph carries no reconstructable Issues/Evals row arrays',
    )
  }
  await verifyPage(page, eval1, 'Evals initial')
  assert.equal(eval1.data.items.length, 25)
  assert.ok(eval1.data.total > 25)
  assert.equal(await page.evaluate(() => location.hash), '#/evals')
  mark(`initial ledger graph=${graph.bytes}B list=${eval1.row.bytes}B/25`)

  const navFlow = await page.locator('.rl-pagination').evaluate((nav) => ({
    sameOwner: nav.closest('.page-scroll') === document.querySelector('.page-scroll'),
    afterList: !!(document.querySelector('.rl-list').compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING),
    position: getComputedStyle(nav).position,
  }))
  assert.deepEqual(navFlow, { sameOwner: true, afterList: true, position: 'static' })

  const historyBefore = await page.evaluate(() => history.length)
  const eval2Waiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '2')
  await page.locator('.rl-page-link[rel="next"]').click()
  const eval2 = await measure(await eval2Waiting, 'evals-pagination-page-2')
  await verifyPage(page, eval2, 'Evals page 2')
  assert.equal(await page.evaluate(() => location.hash), '#/evals?page=2')
  assert.equal(await page.evaluate(() => history.length), historyBefore + 1, 'pagination anchor PUSHes')
  assert.match(eval2.row.url, /\?q=is%3Aeval&page=2$/, 'request serializes q before page')

  const evalExplicit1Waiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '1')
  await page.locator('.rl-page-link.number', { hasText: /^1$/ }).click()
  const evalExplicit1 = await measure(await evalExplicit1Waiting, 'evals-pagination-explicit-page-1')
  await verifyPage(page, evalExplicit1, 'Evals explicit page 1')
  assert.equal(await page.evaluate(() => location.hash), '#/evals?page=1', 'pagination back to first mints page=1')
  const reloadWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '1')
  await page.reload()
  await measure(await reloadWaiting, 'evals-refresh-explicit-page-1')
  assert.equal(await page.evaluate(() => location.hash), '#/evals?page=1', 'refresh preserves explicit page=1')
  const backWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '2')
  await page.goBack()
  await measure(await backWaiting, 'evals-back-page-2')
  assert.equal(await page.evaluate(() => location.hash), '#/evals?page=2')
  const forwardWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '1')
  await page.goForward()
  await measure(await forwardWaiting, 'evals-forward-explicit-page-1')
  assert.equal(await page.evaluate(() => location.hash), '#/evals?page=1')

  await setHash(page, '#/evals?page=2', 'evals', 2)
  const filterWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('q')?.includes('verdict:fail') && url.searchParams.get('page') === '1')
  await page.locator('.rl-section').first().click()
  const filtered = await measure(await filterWaiting, 'evals-filter-reset')
  await verifyPage(page, filtered, 'Evals filter reset')
  assert.match(await page.evaluate(() => location.hash), /^#\/evals\?q=is%3Aeval%20verdict%3Afail$/)
  assert.equal(new URL(filtered.row.url).searchParams.get('page'), '1', 'server receives repaired page 1 while address omits page')

  const lastNumber = eval1.data.pageCount
  const last = await setHash(page, `#/evals?page=${lastNumber}`, 'evals', lastNumber)
  await verifyPage(page, last, 'Evals last page')
  assert.equal(last.data.next, null)
  assert.equal(await page.locator('.rl-page-link.disabled').filter({ hasText: /Next/ }).count(), 1)

  for (const requested of [41, 999999]) {
    const overflow = await setHash(page, `#/evals?page=${requested}`, 'evals', requested)
    await verifyPage(page, overflow, `Evals overflow ${requested}`)
    assert.equal(overflow.data.items.length, 0)
    assert.equal(overflow.data.prev, requested - 1)
    assert.equal(overflow.data.next, requested + 1)
    assert.equal(await page.locator('.rl-pagination [aria-current="page"]').count(), 0)
    assert.match(await page.locator('.rl-page-link[rel="prev"]').getAttribute('href'), new RegExp(`page=${requested - 1}$`))
    assert.match(await page.locator('.rl-page-link[rel="next"]').getAttribute('href'), new RegExp(`page=${requested + 1}$`))
  }

  await setHash(page, '#/evals?page=2', 'evals', 2)
  const row = page.locator('.lp-row[href]').nth(12)
  await row.scrollIntoViewIfNeeded()
  const beforeDetail = await page.locator('.page-scroll').evaluate((element) => element.scrollTop)
  await row.click()
  await page.locator('.ds-page').waitFor({ state: 'visible', timeout: 45_000 })
  const detailBackWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '2')
  await page.goBack()
  const restored = await measure(await detailBackWaiting, 'evals-detail-browser-back')
  await settleRows(page, restored.data.items.length)
  const afterDetail = await page.locator('.page-scroll').evaluate((element) => element.scrollTop)
  assert.equal(afterDetail, beforeDetail, 'detail browser Back restores exact q+page+scroll')
  mark(`detail back restored scrollTop=${afterDetail}`)

  const issueOverflow = await setHash(page, '#/issues?page=2', 'issues', 2)
  await verifyPage(page, issueOverflow, 'Issues open page 2')
  const closedWaiting = waitApi(page, 'issues', (url) => url.searchParams.get('q')?.includes('state:closed') && url.searchParams.get('page') === '1')
  await page.locator('.rl-section').nth(1).click()
  const closed1 = await measure(await closedWaiting, 'issues-closed-reset-page-1')
  await verifyPage(page, closed1, 'Issues closed page 1')
  assert.ok(closed1.data.total > 25)
  assert.equal(await page.evaluate(() => location.hash), '#/issues?q=is%3Aissue%20state%3Aclosed')
  const closed2Waiting = waitApi(page, 'issues', (url) => url.searchParams.get('page') === '2')
  await page.locator('.rl-page-link[rel="next"]').click()
  const closed2 = await measure(await closed2Waiting, 'issues-closed-page-2')
  await verifyPage(page, closed2, 'Issues closed page 2')
  assert.match(await page.evaluate(() => location.hash), /^#\/issues\?q=is%3Aissue%20state%3Aclosed&page=2$/)
  assert.match(closed2.row.url, /\?q=is%3Aissue(?:%20|\+)state%3Aclosed&page=2$/)
  const closedExplicit1Waiting = waitApi(page, 'issues', (url) => url.searchParams.get('page') === '1')
  await page.locator('.rl-page-link.number', { hasText: /^1$/ }).click()
  await measure(await closedExplicit1Waiting, 'issues-closed-explicit-page-1')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?q=is%3Aissue%20state%3Aclosed&page=1')

  const sessionsResponse = await fetch(`${base}/api/sessions`)
  const sessionsBody = await sessionsResponse.json()
  const sessions = Array.isArray(sessionsBody) ? sessionsBody : sessionsBody.sessions || []
  const scoped = sessions.find((session) => String(session.id).startsWith('796190de')) || sessions[0]
  if (scoped) {
    const q = `is:eval scope:${scoped.id}`
    const scopedWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('q') === q && url.searchParams.get('page') === '1')
    const requestMark = requestUrls.length
    await page.evaluate((hash) => { location.hash = hash }, `#/evals?q=${encodeURIComponent(q).replace(/%20/g, '%20')}`)
    const scopedPage = await measure(await scopedWaiting, 'evals-scoped-page-1')
    await verifyPage(page, scopedPage, 'Scoped Evals page 1')
    const scopedRequests = requestUrls.slice(requestMark).map((url) => new URL(url).pathname)
    assert.ok(scopedRequests.some((path) => path.endsWith('/api/evals')))
    assert.equal(scopedRequests.some((path) => /\/api\/sessions\/[^/]+\/evals$/.test(path)), false,
      'scoped list does not receive its old full REST model')
  }

  const slow = await desktop.newPage()
  await slow.route('**/api/issues?*', async (route) => {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    await route.continue()
  })
  await slow.goto(`${base}/#/issues`)
  await slow.locator('.lp-rows[aria-busy="true"] .lp-empty').waitFor({ state: 'visible' })
  assert.match(await slow.locator('.lp-empty').innerText(), /loading/i)
  await slow.close()

  const failed = await desktop.newPage()
  await failed.route('**/api/issues?*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"fixture unavailable"}' }))
  await failed.goto(`${base}/#/issues`)
  await failed.getByRole('alert').waitFor({ state: 'visible' })
  assert.match(await failed.getByRole('alert').innerText(), /fixture unavailable/)
  await failed.close()

  await page.screenshot({ path: join(out, 'desktop-pagination.png'), fullPage: false })
  mark('desktop Issues/Evals history, overflow, scoped, loading, error complete')
  await desktop.close()
  desktop = null
  const videoPath = join(out, 'review-pagination-desktop.webm')
  renameSync(await video.path(), videoPath)

  mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: out, size: { width: 390, height: 844 } } })
  const phone = await mobile.newPage()
  const phoneVideo = phone.video()
  const phoneWaiting = waitApi(phone, 'evals', (url) => url.searchParams.get('page') === '2')
  await phone.goto(`${base}/#/evals?page=2`)
  const phonePage = await measure(await phoneWaiting, 'evals-mobile-page-2')
  await verifyPage(phone, phonePage, 'Mobile Evals page 2')
  const phoneLayout = await phone.locator('.rl-pagination').evaluate((nav) => {
    const bounds = nav.getBoundingClientRect()
    const links = [...nav.querySelectorAll('.rl-page-link')].map((link) => {
      const box = link.getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    return {
      width: bounds.width,
      height: bounds.height,
      sameOwner: nav.closest('.page-scroll') === document.querySelector('.page-scroll'),
      position: getComputedStyle(nav).position,
      links,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  assert.ok(phoneLayout.width <= 390)
  assert.ok(phoneLayout.height > 32 && phoneLayout.height <= 110, `mobile pagination wraps: ${phoneLayout.height}px`)
  assert.equal(phoneLayout.sameOwner, true)
  assert.equal(phoneLayout.position, 'static')
  assert.equal(phoneLayout.documentOverflow, 0)
  assert.ok(phoneLayout.links.every((link) => link.width >= 32 && link.height === 32))
  const aria = await phone.locator('.rl-pagination').ariaSnapshot()
  assert.match(aria, /navigation "Pagination"/)
  assert.match(aria, /link "Previous page"/)
  assert.match(aria, /link "Next page"/)
  const phoneNextWaiting = waitApi(phone, 'evals', (url) => url.searchParams.get('page') === '3')
  await phone.locator('.rl-page-link[rel="next"]').focus()
  await phone.keyboard.press('Enter')
  await measure(await phoneNextWaiting, 'evals-mobile-keyboard-page-3')
  assert.equal(await phone.evaluate(() => location.hash), '#/evals?page=3')
  await phone.screenshot({ path: join(out, 'mobile-pagination-390.png'), fullPage: false })
  metrics.checks.mobile = { ...phoneLayout, aria }
  mark(`390px pagination ${phoneLayout.width}x${phoneLayout.height}, AX and keyboard complete`)
  await mobile.close()
  mobile = null
  renameSync(await phoneVideo.path(), join(out, 'review-pagination-mobile.webm'))

  writeFileSync(join(out, 'review-pagination.timeline.json'), `${JSON.stringify({ events }, null, 2)}\n`)
  writeFileSync(join(out, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  console.log(`PASS review pagination e2e — evidence: ${out}`)
  console.log(JSON.stringify(metrics, null, 2))
} finally {
  if (desktop) await desktop.close().catch(() => {})
  if (mobile) await mobile.close().catch(() => {})
  writeFileSync(join(out, 'review-pagination.timeline.json'), `${JSON.stringify({ events }, null, 2)}\n`)
  writeFileSync(join(out, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  await browser.close()
}
