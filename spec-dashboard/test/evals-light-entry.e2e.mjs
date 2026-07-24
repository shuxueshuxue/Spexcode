import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const SESSION = process.env.SESSION || ''
const OUT = process.env.OUT || '/tmp/evals-light-entry-e2e'
const EVAL_NODE = process.env.EVAL_NODE || 'session-console'
const SCENARIO = process.env.SCENARIO || 'headless-conversation-mount-is-bounded'
const { chromium } = await import(pathToFileURL(PW).href)

if (!SESSION) throw new Error('SESSION must name a live scope containing the selected eval')
mkdirSync(OUT, { recursive: true })

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const canonicalHash = `#/evals/${encodeURIComponent(EVAL_NODE)}/${encodeURIComponent(SCENARIO)}`
const legacyHash = `#/sessions/${encodeURIComponent(SESSION)}/eval/${encodeURIComponent(EVAL_NODE)}/${encodeURIComponent(SCENARIO)}`

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM || '/snap/bin/chromium',
  args: ['--no-sandbox', '--no-proxy-server'],
})

async function probe({ label, hash, viewport, navigateToGraph = false }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })

  const requests = new Map()
  const websockets = []
  cdp.on('Network.requestWillBeSent', (event) => requests.set(event.requestId, {
    url: event.request.url,
    method: event.request.method,
    type: event.type,
    start: event.timestamp,
    status: null,
    bytes: 0,
    failed: false,
  }))
  cdp.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId)
    if (request) request.status = event.response.status
  })
  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId)
    if (request) request.bytes = event.encodedDataLength || 0
  })
  cdp.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId)
    if (request) { request.failed = true; request.error = event.errorText }
  })
  cdp.on('Network.webSocketCreated', (event) => websockets.push(event.url))

  const started = performance.now()
  await page.goto(`${BASE}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForSelector('.ds-page', { state: 'visible', timeout: 120_000 })
  const firstScreenMs = Math.round(performance.now() - started)
  await page.waitForTimeout(1_500)
  await page.screenshot({ path: join(OUT, `${label}.png`), fullPage: true })

  const cold = [...requests.values()].map((request) => ({ ...request }))
  const api = cold.filter((request) => request.url.includes('/api/'))
  const graph = api.filter((request) => request.url.includes('/api/graph'))
  const sessions = api.filter((request) => new URL(request.url).pathname.includes('/api/sessions'))
  const evals = api.filter((request) => new URL(request.url).pathname === '/api/evals/detail')
  const sessionSockets = websockets.filter((url) => new URL(url).pathname.includes('/api/sessions/'))
  const boardChunk = /(?:\/src\/(?:App|Dashboard|SessionInterface)\.jsx|\/assets\/(?:App|Dashboard|SessionInterface)-|@xyflow|@xterm|\/xterm)/i
  const boardChunks = cold.filter((request) => boardChunk.test(request.url))
  const finalHash = new URL(page.url()).hash
  const detailTitle = await page.locator('.ds-title').first().textContent()

  check(`${label} canonical detail`, finalHash.startsWith(canonicalHash), finalHash)
  check(`${label} detail rendered`, !!detailTitle?.trim(), String(detailTitle || ''))
  check(`${label} one bounded detail read`, evals.length === 1, `count=${evals.length}`)
  check(`${label} no graph transport`, graph.length === 0, graph.map((request) => request.url).join(', '))
  check(`${label} no session reads`, sessions.length === 0, sessions.map((request) => request.url).join(', '))
  check(`${label} no session socket`, sessionSockets.length === 0, sessionSockets.join(', '))
  check(`${label} no board chunks`, boardChunks.length === 0, boardChunks.map((request) => request.url).join(', '))

  let graphAfterNavigation = []
  let graphAfterReturn = []
  if (navigateToGraph) {
    await page.locator('a[href="#/graph"]').click()
    await page.waitForFunction(() => location.hash === '#/graph')
    await page.waitForTimeout(2_500)
    graphAfterNavigation = [...requests.values()].filter((request) => request.url.includes('/api/graph'))
    check(`${label} graph starts after navigation`, graphAfterNavigation.length > 0,
      graphAfterNavigation.map((request) => request.url).join(', '))
    await page.goBack()
    await page.waitForSelector('.ds-page', { state: 'visible', timeout: 120_000 })
    await page.waitForTimeout(500)
    graphAfterReturn = [...requests.values()].filter((request) => request.url.includes('/api/graph'))
    check(`${label} started runtime stays warm on return`, graphAfterReturn.length === graphAfterNavigation.length,
      `before=${graphAfterNavigation.length} after=${graphAfterReturn.length}`)
  }

  const first = cold[0]?.start || 0
  const ledger = cold.map(({ start, ...request }) => ({ ...request, startMs: Math.round((start - first) * 1_000) }))
  const result = {
    label,
    hash,
    finalHash,
    viewport,
    firstScreenMs,
    requestCount: cold.length,
    encodedBytes: cold.reduce((sum, request) => sum + request.bytes, 0),
    apiRequestCount: api.length,
    apiEncodedBytes: api.reduce((sum, request) => sum + request.bytes, 0),
    graphRequests: graph.map((request) => request.url),
    sessionRequests: sessions.map((request) => request.url),
    sessionSockets,
    boardChunks: boardChunks.map((request) => request.url),
    graphAfterNavigation: graphAfterNavigation.map((request) => request.url),
    graphAfterReturn: graphAfterReturn.map((request) => request.url),
    requests: ledger,
  }
  await context.close()
  return result
}

const results = []
try {
  results.push(await probe({ label: 'canonical-desktop', hash: canonicalHash, viewport: { width: 1440, height: 900 }, navigateToGraph: true }))
  results.push(await probe({ label: 'legacy-desktop', hash: legacyHash, viewport: { width: 1440, height: 900 } }))
  results.push(await probe({ label: 'canonical-mobile', hash: canonicalHash, viewport: { width: 390, height: 844 } }))
} finally {
  await browser.close()
}

const summary = { base: BASE, node: EVAL_NODE, scenario: SCENARIO, session: SESSION, pass, fail, results }
writeFileSync(join(OUT, 'result.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
if (fail) process.exitCode = 1
