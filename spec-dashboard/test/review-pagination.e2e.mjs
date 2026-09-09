// review-pagination.e2e.mjs — [[review-chrome]] product proof against a real dashboard/backend.
// The ledger starts at first app entry: graph bootstrap and the Issues list response are measured together.
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
const recording = (name, title) => {
  const dir = join(out, name)
  const raw = join(dir, 'raw')
  mkdirSync(raw, { recursive: true })
  const started = Date.now()
  const events = [{ atMs: 0, kind: 'narrate', label: `▶ ${name} · ${title}` }]
  return {
    name, dir, raw, events,
    mark: (label) => events.push({ atMs: Date.now() - started, kind: 'frame', label: `📷 ${label}` }),
  }
}
const finishRecording = async (run, video) => {
  renameSync(await video.path(), join(run.dir, `${run.name}.webm`))
  rmSync(run.raw, { recursive: true, force: true })
  writeFileSync(join(run.dir, `${run.name}.timeline.json`), `${JSON.stringify({ events: run.events }, null, 2)}\n`)
}
const apiPath = (response) => new URL(response.url()).pathname
const isIssuesList = (url) => url.pathname.endsWith('/api/issues')
const isIssueDetail = (url) => /\/api\/issues\/[^/]+$/.test(url.pathname)
// the Issues page default and the one section pick this journey makes — the raw token texts the address
// and the request both carry ([[review-query]]: the default is the bare address, anything else is ?q=<text>).
const OPEN = 'is:issue state:open'
const CLOSED = 'is:issue state:closed'
// a wait pins the exact q+page the step expects, so a pane or dock request for the same endpoint cannot
// satisfy a wait meant for the canonical list.
const wants = (q, pageNumber) => (url) => url.searchParams.get('q') === q && url.searchParams.get('page') === String(pageNumber)
const waitApi = (page, predicate = () => true) => page.waitForResponse((response) => {
  const url = new URL(response.url())
  return isIssuesList(url) && predicate(url)
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
  const rows = { issueItems: 0, openIssueItems: 0 }
  const fields = { issues: 'issueItems', openIssues: 'openIssueItems' }
  const visit = (value) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(visit); return }
    for (const [key, child] of Object.entries(value)) {
      if (fields[key] && Array.isArray(child)) rows[fields[key]] += child.length
      visit(child)
    }
  }
  visit(graph)
  return rows
}

async function readGraph(response) {
  const body = await response.text()
  const graph = JSON.parse(body)
  const reading = { label: 'initial-graph', url: response.url(), status: response.status(), bytes: Buffer.byteLength(body), ...graphRows(graph) }
  metrics.network.push(reading)
  return reading
}

// Hidden pool documents stay mounted ([[workspace-shell]]): the list keeps its DOM beside an open detail,
// so every reading is scoped to what is actually shown.
const shown = (page, selector) => page.locator(`${selector}:visible`)

async function settleRows(page, count) {
  await shown(page, '.lp-page').waitFor({ state: 'visible', timeout: 45_000 })
  await page.waitForFunction((expected) => [...document.querySelectorAll('.lp-row')].filter((row) => row.getClientRects().length > 0).length === expected, count)
  await page.waitForTimeout(80)
}

async function verifyPage(page, measured, label) {
  const { data, row } = measured
  assert.equal(row.status, 200, `${label}: HTTP 200`)
  assert.equal(data.perPage, 25, `${label}: fixed perPage`)
  assert.ok(data.items.length <= 25, `${label}: response has at most one page`)
  assert.equal(Object.hasOwn(data, 'issues'), false, `${label}: no legacy full issues field`)
  await settleRows(page, data.items.length)
  assert.equal(await shown(page, '.lp-row').count(), data.items.length, `${label}: DOM equals response slice`)
}

async function setHash(page, hash, q, expectedPage, label = `issues-page-${expectedPage}`) {
  const waiting = waitApi(page, wants(q, expectedPage))
  await page.evaluate((next) => { location.hash = next }, hash)
  return measure(await waiting, label)
}

// An Issue detail is one single-object read ([[paged-review]]): the row's href names the id its response carries.
async function openDetail(page, rowLink, label) {
  const href = await rowLink.getAttribute('href')
  assert.ok(href?.startsWith('#/issues/'), `${label}: list row is a real detail anchor`)
  const id = decodeURIComponent(href.slice('#/issues/'.length))
  const waiting = page.waitForResponse((response) => isIssueDetail(new URL(response.url())), { timeout: 45_000 })
  await rowLink.click()
  const response = await waiting
  const body = await response.text()
  const data = JSON.parse(body)
  metrics.network.push({ label, url: response.url(), status: response.status(), bytes: Buffer.byteLength(body), id: data.id })
  assert.equal(response.status(), 200, `${label}: HTTP 200`)
  assert.equal(data.id, id, `${label}: detail is the row's own object`)
  await shown(page, '.ds-page').waitFor({ state: 'visible', timeout: 45_000 })
  return { href, id, data }
}

let desktop
let mobile
try {
  const graphOnly = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const graphOnlyPage = await graphOnly.newPage()
  const graphOnlyReviewRequests = []
  graphOnlyPage.on('request', (request) => {
    if (isIssuesList(new URL(request.url()))) graphOnlyReviewRequests.push(request.url())
  })
  const graphOnlyResponse = graphOnlyPage.waitForResponse((response) => apiPath(response).endsWith('/api/graph'), { timeout: 45_000 })
  await graphOnlyPage.goto(`${base}/#/graph`)
  await graphOnlyResponse
  await graphOnlyPage.waitForTimeout(300)
  assert.deepEqual(graphOnlyReviewRequests, [], 'opening Graph receives no Issues rows')
  metrics.checks.graphOnlyReviewRequests = [...graphOnlyReviewRequests]
  // [[paged-palette]]: the search palette ranks the board it was already handed and makes no review request.
  await graphOnlyPage.evaluate(() => { location.hash = '#/sessions' })
  await graphOnlyPage.locator('.si-pill.search').waitFor({ state: 'visible', timeout: 45_000 })
  await graphOnlyPage.locator('.si-pill.search').click()
  await graphOnlyPage.locator('.search-input').waitFor({ state: 'visible', timeout: 45_000 })
  await graphOnlyPage.waitForTimeout(300)
  assert.deepEqual(graphOnlyReviewRequests, [], 'the open Palette receives no Issues rows')
  metrics.checks.paletteReviewRequests = [...graphOnlyReviewRequests]
  await graphOnly.close()

  const desktopRecording = recording('paged-review-desktop-yatu', 'request pagination, history, overflow, detail return, loading and failure')
  desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: desktopRecording.raw, size: { width: 1440, height: 900 } } })
  const page = await desktop.newPage()
  const video = page.video()
  const requestUrls = []
  desktop.on('request', (request) => requestUrls.push(request.url()))

  const graphWaiting = page.waitForResponse((response) => apiPath(response).endsWith('/api/graph'), { timeout: 45_000 })
  await page.goto(`${base}/#/graph`)
  const graph = await readGraph(await graphWaiting)
  const open1Waiting = waitApi(page, wants(OPEN, 1))
  await page.locator('.rail-btn[href="#/issues"]').click()
  const open1 = await measure(await open1Waiting, 'issues-initial-page-1')
  metrics.checks.initialLedgerBytes = graph.bytes + open1.row.bytes
  if (requireLeanGraph) {
    assert.deepEqual(
      { issueItems: graph.issueItems, openIssueItems: graph.openIssueItems },
      { issueItems: 0, openIssueItems: 0 },
      'initial graph carries no reconstructable Issues row arrays',
    )
  }
  await verifyPage(page, open1, 'Issues initial')
  assert.equal(open1.data.items.length, 25)
  assert.ok(open1.data.total > 25)
  assert.equal(await page.evaluate(() => location.hash), '#/issues')
  desktopRecording.mark(`initial ledger graph=${graph.bytes}B list=${open1.row.bytes}B/25`)

  const navFlow = await shown(page, '.rl-pagination').evaluate((nav) => ({
    sameOwner: nav.closest('.page-scroll') === nav.closest('.viewhost, body').querySelector('.page-scroll'),
    afterList: !!(nav.closest('.page-scroll').querySelector('.rl-list').compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING),
    position: getComputedStyle(nav).position,
  }))
  assert.deepEqual(navFlow, { sameOwner: true, afterList: true, position: 'static' })

  const historyBefore = await page.evaluate(() => history.length)
  const open2Waiting = waitApi(page, wants(OPEN, 2))
  await shown(page, '.rl-page-link[rel="next"]').click()
  const open2 = await measure(await open2Waiting, 'issues-pagination-page-2')
  await verifyPage(page, open2, 'Issues page 2')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?page=2')
  assert.equal(await page.evaluate(() => history.length), historyBefore + 1, 'pagination anchor PUSHes')
  assert.match(open2.row.url, /\?q=is%3Aissue\+state%3Aopen&page=2$/, 'request serializes q before page')

  const openExplicit1Waiting = waitApi(page, wants(OPEN, 1))
  await shown(page, '.rl-page-link.number').filter({ hasText: /^1$/ }).click()
  const openExplicit1 = await measure(await openExplicit1Waiting, 'issues-pagination-explicit-page-1')
  await verifyPage(page, openExplicit1, 'Issues explicit page 1')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?page=1', 'pagination back to first mints page=1')
  const reloadWaiting = waitApi(page, wants(OPEN, 1))
  await page.reload()
  await measure(await reloadWaiting, 'issues-refresh-explicit-page-1')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?page=1', 'refresh preserves explicit page=1')
  const backWaiting = waitApi(page, wants(OPEN, 2))
  await page.goBack()
  await measure(await backWaiting, 'issues-back-page-2')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?page=2')
  const forwardWaiting = waitApi(page, wants(OPEN, 1))
  await page.goForward()
  await measure(await forwardWaiting, 'issues-forward-explicit-page-1')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?page=1')

  await setHash(page, '#/issues?page=2', OPEN, 2)
  const filterWaiting = waitApi(page, wants(CLOSED, 1))
  await shown(page, '.rl-section').nth(1).click()
  const closed1 = await measure(await filterWaiting, 'issues-filter-reset-closed-page-1')
  await verifyPage(page, closed1, 'Issues closed page 1')
  assert.ok(closed1.data.total > 25)
  assert.equal(await page.evaluate(() => location.hash), '#/issues?q=is%3Aissue%20state%3Aclosed')
  assert.equal(new URL(closed1.row.url).searchParams.get('page'), '1', 'server receives repaired page 1 while address omits page')

  const closed2Waiting = waitApi(page, wants(CLOSED, 2))
  await shown(page, '.rl-page-link[rel="next"]').click()
  const closed2 = await measure(await closed2Waiting, 'issues-closed-page-2')
  await verifyPage(page, closed2, 'Issues closed page 2')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?q=is%3Aissue%20state%3Aclosed&page=2')
  assert.match(closed2.row.url, /\?q=is%3Aissue\+state%3Aclosed&page=2$/)
  const closedExplicit1Waiting = waitApi(page, wants(CLOSED, 1))
  await shown(page, '.rl-page-link.number').filter({ hasText: /^1$/ }).click()
  const closedExplicit1 = await measure(await closedExplicit1Waiting, 'issues-closed-explicit-page-1')
  await verifyPage(page, closedExplicit1, 'Issues closed explicit page 1')
  assert.equal(await page.evaluate(() => location.hash), '#/issues?q=is%3Aissue%20state%3Aclosed&page=1')

  await openDetail(page, shown(page, '.lp-row-link').first(), 'issue-detail-from-closed-page-1')
  const closedBackWaiting = waitApi(page, wants(CLOSED, 1))
  await page.goBack()
  await closedBackWaiting
  assert.equal(await page.evaluate(() => location.hash), '#/issues?q=is%3Aissue%20state%3Aclosed&page=1', 'detail Back replays the q+page=1 form')

  const lastNumber = open1.data.pageCount
  const last = await setHash(page, `#/issues?page=${lastNumber}`, OPEN, lastNumber, 'issues-last-page')
  await verifyPage(page, last, 'Issues last page')
  assert.equal(last.data.next, null)
  assert.equal(await shown(page, '.rl-page-link.disabled').filter({ hasText: /Next/ }).count(), 1)

  for (const requested of [lastNumber + 35, 999999]) {
    const overflow = await setHash(page, `#/issues?page=${requested}`, OPEN, requested, `issues-overflow-page-${requested}`)
    await verifyPage(page, overflow, `Issues overflow ${requested}`)
    assert.equal(overflow.data.items.length, 0)
    assert.equal(overflow.data.prev, requested - 1)
    assert.equal(overflow.data.next, requested + 1)
    assert.equal(await shown(page, '.rl-pagination').locator('[aria-current="page"]').count(), 0)
    assert.match(await shown(page, '.rl-page-link[rel="prev"]').getAttribute('href'), new RegExp(`page=${requested - 1}$`))
    assert.match(await shown(page, '.rl-page-link[rel="next"]').getAttribute('href'), new RegExp(`page=${requested + 1}$`))
  }

  const detailSource = await setHash(page, '#/issues?page=2', OPEN, 2, 'issues-detail-source-page-2')
  await verifyPage(page, detailSource, 'Issues detail source page 2')
  const scrollport = shown(page, '.lp-page')
  await scrollport.hover()
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(100)
  const visibleRow = await shown(page, '.lp-row').evaluateAll((rows) => {
    const port = rows[0].closest('.page-scroll').getBoundingClientRect()
    return rows.findIndex((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top >= port.top + 80 && rect.bottom <= port.bottom - 80
    })
  })
  assert.ok(visibleRow >= 0, 'a real wheel leaves a fully visible detail row')
  const row = shown(page, '.lp-row').nth(visibleRow).locator('.lp-row-link')

  const beforeDetail = await scrollport.evaluate((element) => element.scrollTop)
  assert.ok(beforeDetail > 0, 'the wheel moved the review scrollport')
  // the scroll position is keyed on the PANE's address ([[page-scroll]]), under the serving-scope prefix.
  const storedFor = (address) => page.evaluate((suffix) => {
    const keys = Object.keys(sessionStorage).filter((key) => key.startsWith('spex.page-scroll') && key.endsWith(`:${suffix}`))
    return keys.length === 1 ? sessionStorage.getItem(keys[0]) : null
  }, address)
  metrics.checks.detailBack = { before: beforeDetail, storedBefore: await storedFor('#/issues?page=2') }
  await openDetail(page, row, 'issue-detail-from-open-page-2')
  metrics.checks.detailBack.storedAfterClick = await storedFor('#/issues?page=2')
  assert.equal(Number(metrics.checks.detailBack.storedAfterClick), beforeDetail, 'the real click snapshots the user scroll position')
  const detailBackWaiting = waitApi(page, wants(OPEN, 2))
  await page.goBack()
  const restored = await measure(await detailBackWaiting, 'issues-detail-browser-back')
  await settleRows(page, restored.data.items.length)
  const afterDetail = await shown(page, '.lp-page').evaluate((element) => element.scrollTop)
  metrics.checks.detailBack.after = afterDetail
  metrics.checks.detailBack.storedAfterBack = await storedFor('#/issues?page=2')
  assert.equal(afterDetail, beforeDetail, 'detail browser Back restores exact q+page+scroll')
  desktopRecording.mark(`detail back restored scrollTop=${afterDetail}`)

  // the whole-journey ledger: every list read the browser made is one q+page slice — no consumer bootstraps
  // a full collection to slice or hide it ([[review-chrome]]).
  const unpagedListReads = requestUrls.map((value) => new URL(value)).filter(isIssuesList)
    .filter((url) => url.searchParams.get('q') == null || !/^[1-9]\d*$/.test(url.searchParams.get('page') || ''))
    .map(String)
  assert.deepEqual(unpagedListReads, [], 'browser never requests an unpaged Issues collection')
  metrics.checks.unpagedListReads = unpagedListReads

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
  desktopRecording.mark('desktop Issues history, filter reset, overflow, detail return, loading, error complete')
  await desktop.close()
  desktop = null
  await finishRecording(desktopRecording, video)

  const mobileRecording = recording('paged-review-mobile-yatu', '390px wrapping, accessibility, and keyboard navigation')
  mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: mobileRecording.raw, size: { width: 390, height: 844 } } })
  const phone = await mobile.newPage()
  const phoneVideo = phone.video()
  const phoneWaiting = waitApi(phone, wants(OPEN, 2))
  await phone.goto(`${base}/#/issues?page=2`)
  const phonePage = await measure(await phoneWaiting, 'issues-mobile-page-2')
  await verifyPage(phone, phonePage, 'Mobile Issues page 2')
  const phoneLayout = await shown(phone, '.rl-pagination').evaluate((nav) => {
    const bounds = nav.getBoundingClientRect()
    const links = [...nav.querySelectorAll('.rl-page-link')].map((link) => {
      const box = link.getBoundingClientRect()
      return { width: box.width, height: box.height }
    })
    return {
      width: bounds.width,
      height: bounds.height,
      sameOwner: nav.closest('.page-scroll') === nav.closest('.viewhost, body').querySelector('.page-scroll'),
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
  const aria = await shown(phone, '.rl-pagination').ariaSnapshot()
  assert.match(aria, /navigation "Pagination"/)
  assert.match(aria, /link "Previous Page"/)
  assert.match(aria, /link "Next Page"/)
  const phoneNextWaiting = waitApi(phone, wants(OPEN, 3))
  await shown(phone, '.rl-page-link[rel="next"]').focus()
  await phone.keyboard.press('Enter')
  await measure(await phoneNextWaiting, 'issues-mobile-keyboard-page-3')
  assert.equal(await phone.evaluate(() => location.hash), '#/issues?page=3')
  await phone.screenshot({ path: join(out, 'mobile-pagination-390.png'), fullPage: false })
  metrics.checks.mobile = { ...phoneLayout, aria }
  mobileRecording.mark(`390px pagination ${phoneLayout.width}x${phoneLayout.height}, AX and keyboard complete`)
  await mobile.close()
  mobile = null
  await finishRecording(mobileRecording, phoneVideo)

  writeFileSync(join(out, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  console.log(`PASS review pagination e2e — evidence: ${out}`)
  console.log(JSON.stringify(metrics, null, 2))
} finally {
  if (desktop) await desktop.close().catch(() => {})
  if (mobile) await mobile.close().catch(() => {})
  writeFileSync(join(out, 'measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  await browser.close()
}
