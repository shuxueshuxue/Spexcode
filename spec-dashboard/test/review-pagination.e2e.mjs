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
const waitApi = (page, domain, predicate = () => true) => page.waitForResponse((response) => {
  const url = new URL(response.url())
  return url.pathname.endsWith(`/api/${domain}`) && predicate(url)
}, { timeout: 45_000 })
const waitEvalDetail = (page, predicate = () => true) => page.waitForResponse((response) => {
  const url = new URL(response.url())
  return url.pathname.endsWith('/api/evals/detail') && predicate(url)
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

async function measureDetail(response, label) {
  const body = await response.text()
  const data = JSON.parse(body)
  const neighbors = [...(data.neighbors?.prev || []), ...(data.neighbors?.next || [])]
  const row = {
    label,
    url: response.url(),
    status: response.status(),
    bytes: Buffer.byteLength(body),
    selected: data.selected ? `${data.selected.node}/${data.selected.scenario}` : null,
    history: data.history?.length ?? null,
    otherScenarioRows: data.selected ? (data.history || []).filter((item) => item.scenario !== data.selected.scenario).length : 0,
    neighbors: neighbors.length,
    neighborKeys: [...new Set(neighbors.flatMap((item) => Object.keys(item)))].sort(),
    total: data.neighbors?.total ?? null,
    index: data.neighbors?.index ?? null,
    order: data.neighbors?.order ?? null,
    revision: data.revision ?? null,
    evalRevision: data.evalRevision ?? null,
  }
  assert.equal(row.status, 200, `${label}: HTTP 200`)
  assert.equal(row.otherScenarioRows, 0, `${label}: no other scenario history`)
  assert.ok(row.neighbors <= 5, `${label}: bounded neighbors`)
  assert.deepEqual(row.neighborKeys, row.neighbors ? ['node', 'scenario', 'state'] : [], `${label}: lightweight neighbors`)
  assert.equal(row.order, 'default', `${label}: named stable order`)
  metrics.network.push(row)
  return { data, row }
}

function graphRows(graph) {
  const rows = { evalItems: 0, scenarioItems: 0, issueItems: 0, openIssueItems: 0 }
  const fields = { evals: 'evalItems', scenarios: 'scenarioItems', issues: 'issueItems', openIssues: 'openIssueItems' }
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
  const graphOnly = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const graphOnlyPage = await graphOnly.newPage()
  const graphOnlyReviewRequests = []
  graphOnlyPage.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.endsWith('/api/issues') || path.endsWith('/api/evals')) graphOnlyReviewRequests.push(request.url())
  })
  const graphOnlyResponse = graphOnlyPage.waitForResponse((response) => apiPath(response).endsWith('/api/graph'), { timeout: 45_000 })
  await graphOnlyPage.goto(`${base}/#/`)
  await graphOnlyResponse
  await graphOnlyPage.waitForTimeout(300)
  assert.deepEqual(graphOnlyReviewRequests, [], 'opening Graph receives no Issues/Evals rows')
  metrics.checks.graphOnlyReviewRequests = graphOnlyReviewRequests
  await graphOnly.close()

  const desktopRecording = recording('paged-review-desktop-yatu', 'request pagination, history, overflow, and bounded consumers')
  desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: desktopRecording.raw, size: { width: 1440, height: 900 } } })
  const page = await desktop.newPage()
  const video = page.video()
  const requestUrls = []
  desktop.on('request', (request) => requestUrls.push(request.url()))

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
  desktopRecording.mark(`initial ledger graph=${graph.bytes}B list=${eval1.row.bytes}B/25`)

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

  const detailSource = await setHash(page, '#/evals?page=2', 'evals', 2)
  await verifyPage(page, detailSource, 'Evals detail source page 2')
  const scrollport = page.locator('.page-scroll')
  await scrollport.hover()
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(100)
  const visibleRow = await page.locator('.lp-row[href]').evaluateAll((rows) => {
    const port = document.querySelector('.page-scroll').getBoundingClientRect()
    return rows.findIndex((row) => {
      const rect = row.getBoundingClientRect()
      return rect.top >= port.top + 80 && rect.bottom <= port.bottom - 80
    })
  })
  assert.ok(visibleRow >= 0, 'a real wheel leaves a fully visible detail row')
  const row = page.locator('.lp-row[href]').nth(visibleRow)
  const detailHref = await row.getAttribute('href')
  assert.ok(detailHref?.startsWith('#/evals/'), 'list row is a real detail anchor')

  const trunkDirect = await desktop.newPage()
  const trunkDirectWaiting = waitEvalDetail(trunkDirect)
  await trunkDirect.goto(`${base}/${detailHref}`)
  const trunkDirectReading = await measureDetail(await trunkDirectWaiting, 'eval-detail-trunk-direct')
  const trunkReloadWaiting = waitEvalDetail(trunkDirect)
  await trunkDirect.reload()
  const trunkReloadReading = await measureDetail(await trunkReloadWaiting, 'eval-detail-trunk-reload')
  assert.equal(trunkReloadReading.row.revision, trunkDirectReading.row.revision, 'trunk direct/reload share revision')
  const trunkQueueHrefs = await trunkDirect.locator('.ds-queue-row').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')))
  assert.ok(trunkQueueHrefs[0]?.startsWith('#/evals/'), 'trunk queue row is a real detail anchor')
  assert.ok(trunkQueueHrefs.length >= 2, 'real detail supplies two queue targets for response-order fencing')
  const scenarioFromHref = (href) => decodeURIComponent(href.split('?')[0].split('/').at(-1))
  const [queueHrefA, queueHrefB] = trunkQueueHrefs
  const [queueScenarioA, queueScenarioB] = [scenarioFromHref(queueHrefA), scenarioFromHref(queueHrefB)]
  await trunkDirect.route('**/api/evals/detail?*', async (route) => {
    const scenario = new URL(route.request().url()).searchParams.get('scenario')
    await new Promise((resolveWait) => setTimeout(resolveWait, scenario === queueScenarioA ? 650 : 80))
    await route.continue()
  })
  const queueAWaiting = waitEvalDetail(trunkDirect, (url) => url.searchParams.get('scenario') === queueScenarioA)
  const queueARequest = trunkDirect.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname.endsWith('/api/evals/detail') && url.searchParams.get('scenario') === queueScenarioA
  })
  await trunkDirect.evaluate((hash) => { location.hash = hash }, queueHrefA)
  await queueARequest
  assert.equal(await trunkDirect.locator('.ds-title').count(), 0, 'new detail URL first paint never shows the old object')
  await trunkDirect.locator('.fv-note').waitFor({ state: 'visible' })
  const queueBWaiting = waitEvalDetail(trunkDirect, (url) => url.searchParams.get('scenario') === queueScenarioB)
  await trunkDirect.evaluate((hash) => { location.hash = hash }, queueHrefB)
  const queueBReading = await measureDetail(await queueBWaiting, 'eval-detail-queue-new-response')
  assert.equal(queueBReading.data.selected.scenario, queueScenarioB)
  await trunkDirect.waitForFunction((scenario) => document.querySelector('.ds-title')?.textContent?.includes(scenario), queueScenarioB)
  const queueAReading = await measureDetail(await queueAWaiting, 'eval-detail-queue-old-response')
  assert.equal(queueAReading.data.selected.scenario, queueScenarioA)
  await trunkDirect.waitForTimeout(80)
  assert.match(await trunkDirect.locator('.ds-title').innerText(), new RegExp(queueScenarioB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    'late old response cannot replace the newest detail')
  metrics.checks.detailResponseFence = { delayed: queueScenarioA, kept: queueScenarioB }
  await trunkDirect.close()

  const beforeDetail = await page.locator('.page-scroll').evaluate((element) => element.scrollTop)
  metrics.checks.detailBack = {
    before: beforeDetail,
    storedBefore: await page.evaluate(() => sessionStorage.getItem(`spex.page-scroll:${location.pathname}${location.search}${location.hash}`)),
  }
  const listDetailWaiting = waitEvalDetail(page)
  await row.click()
  const listDetailReading = await measureDetail(await listDetailWaiting, 'eval-detail-trunk-list-click')
  assert.equal(listDetailReading.row.revision, trunkDirectReading.row.revision, 'direct and list-click detail share revision')
  await page.locator('.ds-page').waitFor({ state: 'visible', timeout: 45_000 })
  metrics.checks.detailBack.storedAfterClick = await page.evaluate(() => sessionStorage.getItem('spex.page-scroll:/#/evals?page=2'))
  assert.equal(Number(metrics.checks.detailBack.storedAfterClick), beforeDetail, 'the real click snapshots the user scroll position')
  const detailBackWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '2')
  await page.goBack()
  const restored = await measure(await detailBackWaiting, 'evals-detail-browser-back')
  await settleRows(page, restored.data.items.length)
  const afterDetail = await page.locator('.page-scroll').evaluate((element) => element.scrollTop)
  metrics.checks.detailBack.after = afterDetail
  metrics.checks.detailBack.storedAfterBack = await page.evaluate(() => sessionStorage.getItem('spex.page-scroll:/#/evals?page=2'))
  assert.equal(afterDetail, beforeDetail, 'detail browser Back restores exact q+page+scroll')
  desktopRecording.mark(`detail back restored scrollTop=${afterDetail}`)

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

  const issueRow = page.locator('.lp-row[href]').first()
  const issueHref = await issueRow.getAttribute('href')
  assert.ok(issueHref?.startsWith('#/issues/'), 'Issue row is a real detail anchor')
  const issueDetailWaiting = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname
    return path.includes('/api/issues/') && !path.endsWith('/reply') && !path.endsWith('/close') && !path.endsWith('/promote')
  }, { timeout: 45_000 })
  await issueRow.click()
  const issueDetailResponse = await issueDetailWaiting
  const issueDetailBody = await issueDetailResponse.text()
  const issueDetailData = JSON.parse(issueDetailBody)
  metrics.network.push({ label: 'issue-detail-single-object', url: issueDetailResponse.url(), status: issueDetailResponse.status(), bytes: Buffer.byteLength(issueDetailBody), id: issueDetailData.id })
  assert.equal(issueDetailResponse.status(), 200)
  assert.equal(issueDetailData.id, decodeURIComponent(issueHref.slice('#/issues/'.length)))
  assert.equal(await page.locator('.ds-queue-row').count(), 0, 'Issue detail has no Eval queue')
  const issueBackWaiting = waitApi(page, 'issues', (url) => url.searchParams.get('page') === '1')
  await page.goBack()
  await issueBackWaiting
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
    const scopedRow = page.locator('.lp-row[href]').first()
    const scopedHref = await scopedRow.getAttribute('href')
    assert.ok(scopedHref?.includes(`scope%3A${scoped.id}`), 'scoped row detail anchor preserves scope')
    const scopedDirect = await desktop.newPage()
    const scopedDirectWaiting = waitEvalDetail(scopedDirect, (url) => url.searchParams.get('scope') === scoped.id)
    await scopedDirect.goto(`${base}/${scopedHref}`)
    const scopedDirectReading = await measureDetail(await scopedDirectWaiting, 'eval-detail-scoped-direct')
    const scopedReloadWaiting = waitEvalDetail(scopedDirect, (url) => url.searchParams.get('scope') === scoped.id)
    await scopedDirect.reload()
    const scopedReloadReading = await measureDetail(await scopedReloadWaiting, 'eval-detail-scoped-reload')
    assert.equal(scopedReloadReading.row.revision, scopedDirectReading.row.revision, 'scoped direct/reload share revision')
    const projection = (await (await fetch(`${base}/api/graph`)).json()).sessions.find((session) => session.id === scoped.id)?.evalSummary
    assert.ok(projection, 'scoped detail has a graph projection fence')
    assert.equal(scopedDirectReading.data.evalRevision.epoch, projection.epoch)
    assert.equal(scopedDirectReading.data.evalRevision.generation, projection.generation)
    assert.equal(scopedDirectReading.data.evalRevision.content, projection.revision)
    assert.deepEqual(scopedDirectReading.data.summary, projection.value, 'scoped detail summary equals graph projection')
    const scopedQueueHref = await scopedDirect.locator('.ds-queue-row').first().getAttribute('href')
    assert.ok(scopedQueueHref?.includes(`scope%3A${scoped.id}`), 'scoped queue anchor preserves scope')
    await scopedDirect.close()
  }

  const forbiddenFullReads = requestUrls.filter((value) => {
    const url = new URL(value)
    return /\/api\/specs\/[^/]+\/evals$/.test(url.pathname)
      || (/\/api\/sessions\/[^/]+\/evals$/.test(url.pathname) && url.searchParams.get('format') !== 'html')
  })
  assert.deepEqual(forbiddenFullReads, [], 'browser never requests a node timeline or full session model for detail')
  metrics.checks.forbiddenFullReads = forbiddenFullReads

  await page.evaluate(() => { location.hash = '#/sessions' })
  await page.locator('.si-pill.search').waitFor({ state: 'visible', timeout: 45_000 })
  const paletteIssueWaiting = waitApi(page, 'issues', (url) => url.searchParams.get('page') === '1')
  const paletteEvalWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '1' && !url.searchParams.has('view'))
  await page.locator('.si-pill.search').click()
  const paletteIssues = await measure(await paletteIssueWaiting, 'palette-issues-page-1')
  const paletteEvals = await measure(await paletteEvalWaiting, 'palette-evals-page-1')
  assert.equal(paletteIssues.data.items.length, 25)
  assert.equal(paletteEvals.data.items.length, 25)
  assert.ok(paletteIssues.data.total > 25 && paletteEvals.data.total > 25)
  await page.waitForFunction(() => document.querySelectorAll('.search-item').length >= 17)
  const evalSeeAllText = `showing ${paletteEvals.data.items.length} of ${paletteEvals.data.total}`
  const evalSeeAllIndex = (await page.locator('.search-item').allTextContents())
    .findIndex((text) => text.toLowerCase().includes(evalSeeAllText))
  assert.ok(evalSeeAllIndex >= 0, 'Palette discloses its bounded Evals plane')
  for (let index = 0; index < evalSeeAllIndex; index++) await page.keyboard.press('ArrowDown')
  assert.match((await page.locator('.search-item.on').innerText()).toLowerCase(), new RegExp(evalSeeAllText))
  const canonicalEvalWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('page') === '1' && !url.searchParams.has('view'))
  await page.keyboard.press('Enter')
  await canonicalEvalWaiting
  assert.equal(await page.evaluate(() => location.hash), '#/evals?q=is%3Aeval')

  await page.evaluate(() => { sessionStorage.setItem('spex.focus', 'session-console'); location.hash = '#/' })
  const focusedGraphWaiting = page.waitForResponse((response) => apiPath(response).endsWith('/api/graph'), { timeout: 45_000 })
  await page.reload()
  await focusedGraphWaiting
  const focusedNode = page.locator('.react-flow__node').filter({ hasText: 'session-console' })
  await focusedNode.waitFor({ state: 'visible', timeout: 45_000 })
  await focusedNode.dblclick()
  const nodeTimelineWaiting = waitApi(page, 'evals', (url) => url.searchParams.get('view') === 'timeline'
    && url.searchParams.get('q')?.includes('node:session-console') && url.searchParams.get('page') === '1')
  await page.locator('.ov-tab').filter({ hasText: /eval/i }).click()
  const nodeTimeline = await measure(await nodeTimelineWaiting, 'nodeview-evals-timeline-page-1')
  assert.equal(nodeTimeline.data.items.length, 25)
  assert.ok(nodeTimeline.data.total > 25)
  await page.waitForFunction((expected) => document.querySelectorAll('.pane-eval .eval-row').length === expected, nodeTimeline.data.items.length)
  assert.match((await page.locator('.rf-summary').innerText()).toLowerCase(), /showing 25 of \d+/)
  assert.equal(await page.locator('.pane-view-all').getAttribute('href'), '#/evals?q=is%3Aeval%20node%3Asession-console')
  await page.screenshot({ path: join(out, 'bounded-consumers.png'), fullPage: false })
  desktopRecording.mark(`Palette and NodeView bounded consumers: 25/${paletteEvals.data.total}, 25/${nodeTimeline.data.total}`)

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
  desktopRecording.mark('desktop Issues/Evals history, overflow, scoped, loading, error complete')
  await desktop.close()
  desktop = null
  await finishRecording(desktopRecording, video)

  const paletteRecording = recording('bounded-review-planes', 'Search pill demand-loads bounded review planes')
  const paletteContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: paletteRecording.raw, size: { width: 1440, height: 900 } } })
  const palettePage = await paletteContext.newPage()
  const paletteVideo = palettePage.video()
  const paletteReviewRequests = []
  palettePage.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.endsWith('/api/issues') || path.endsWith('/api/evals')) paletteReviewRequests.push(request.url())
  })
  await palettePage.goto(`${base}/#/sessions`)
  await palettePage.locator('.si-pill.search').waitFor({ state: 'visible', timeout: 45_000 })
  assert.deepEqual(paletteReviewRequests, [], 'closed Palette receives no review rows')
  const paletteIssueResponse = palettePage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/issues'), { timeout: 45_000 })
  const paletteEvalResponse = palettePage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/evals'), { timeout: 45_000 })
  await palettePage.locator('.si-pill.search').click()
  const paletteIssueData = await (await paletteIssueResponse).json()
  const paletteEvalData = await (await paletteEvalResponse).json()
  assert.equal(paletteIssueData.items.length, 25)
  assert.equal(paletteEvalData.items.length, 25)
  await palettePage.waitForFunction(() => document.querySelectorAll('.search-item').length >= 17)
  const paletteTexts = await palettePage.locator('.search-item').allTextContents()
  const paletteEvalIndex = paletteTexts.findIndex((text) => text.toLowerCase().includes(`showing 25 of ${paletteEvalData.total}`))
  assert.ok(paletteEvalIndex >= 0)
  for (let index = 0; index < paletteEvalIndex; index++) await palettePage.keyboard.press('ArrowDown')
  assert.match((await palettePage.locator('.search-item.on').innerText()).toLowerCase(), /showing 25 of/)
  paletteRecording.mark(`Issues 25/${paletteIssueData.total}; Evals 25/${paletteEvalData.total}; see-all keyboard selected`)
  await palettePage.screenshot({ path: join(out, 'bounded-palette.png'), fullPage: false })
  await palettePage.keyboard.press('Enter')
  await palettePage.waitForFunction(() => location.hash === '#/evals?q=is%3Aeval')
  paletteRecording.mark('Enter routed to the canonical Evals query')
  await paletteContext.close()
  await finishRecording(paletteRecording, paletteVideo)

  const mobileRecording = recording('paged-review-mobile-yatu', '390px wrapping, accessibility, and keyboard navigation')
  mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: mobileRecording.raw, size: { width: 390, height: 844 } } })
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
  assert.match(aria, /link "Previous Page"/)
  assert.match(aria, /link "Next Page"/)
  const phoneNextWaiting = waitApi(phone, 'evals', (url) => url.searchParams.get('page') === '3')
  await phone.locator('.rl-page-link[rel="next"]').focus()
  await phone.keyboard.press('Enter')
  await measure(await phoneNextWaiting, 'evals-mobile-keyboard-page-3')
  assert.equal(await phone.evaluate(() => location.hash), '#/evals?page=3')
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
