// YATU proof for [[session-console]]'s warm working set: a Conversation that a reader has scrolled back into
// keeps that reading position across a switch away and back.
//
// The bug this pair reproduces: the console renders one absolutely-positioned layer per warm session by
// mapping over the conversation working set, and that set's ITERATION ORDER is the eviction recency order
// (the selection is re-added at the end on every selection). So selecting a session moved its own layer among
// its keyed siblings — React reorders keyed children by detaching and re-inserting the node, and a scroll
// container that leaves the document comes back at scrollTop 0. The reader saw an unexplained "refresh" jump
// the timeline to the top, on nothing but a tab switch.
//
// Three scenes, one browser, no backend: the graph and the timeline are fixtures, because what is measured is
// entirely the console's own DOM (layer order, node identity, scroll offset).
//   1. Park A's timeline mid-history (not pinned to the bottom, where the tail-follow would re-pin it and hide
//      the reset), then switch to B and back. A's offset must survive.
//   2. The same across two switches (A → B → C → A), which is where the recency order moves A furthest.
//   3. A's scroller must be the SAME DOM node throughout — a remount would explain a lost offset innocently,
//      and this test would then be measuring the wrong thing.
// `SPEXCODE_DASHBOARD_ROOT` points Vite at another checkout of `spec-dashboard`, so the A side of the repair
// pair is measured against the old committed source.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const dashboardRoot = resolve(process.env.SPEXCODE_DASHBOARD_ROOT || join(root, 'spec-dashboard'))
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : sharedRoot
const modules = join(dependencyRoot, 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const out = resolve(process.env.OUT || join(tmpdir(), 'conversation-scroll-survives-switch-e2e'))

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((done) => setTimeout(done, 60))
  }
  throw new Error(`timed out waiting for ${label}`)
}

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'index.html'))) throw new Error(`not a dashboard root: ${dashboardRoot}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

// Headless records: every lifecycle state uses the Conversation, so no terminal and no pty socket is involved.
const now = Date.now()
const session = (id, label) => ({
  id, branch: null, path: process.cwd(), label, headline: label, title: label,
  raw: { name: label, title: null }, harness: 'claude', capabilities: { headless: true }, launcher: null,
  status: 'idle', lifecycle: 'active', proposal: null, merges: 0, liveness: 'offline', parent: null,
  note: null, archived: false, archiveHazard: null, prompt: null, promptPreview: null,
  created: now, activity: null, sortKey: now, files: [], web: [],
})
const A = 'scroll-survives-a'
const B = 'scroll-survives-b'
const C = 'scroll-survives-c'
const graph = {
  sessions: [session(A, 'reader A'), session(B, 'reader B'), session(C, 'reader C')],
  specs: [], files: [], issues: [],
}
// Enough authored history that the timeline scrolls well past one viewport; the text names its session so a
// screenshot says which layer it is.
const timelineFor = (id) => ({
  events: Array.from({ length: 60 }, (_, index) => ({
    ts: new Date(now - (60 - index) * 60_000).toISOString(),
    kind: 'sent',
    mid: `${id}-m${index}`,
    from: null,
    text: `${id} message ${index + 1}. ${'reading position must survive a switch. '.repeat(3)}`,
  })),
  stamp: '60',
  offset: 0,
  total: 60,
  priorWorking: false,
})

let vite
let browser
try {
  const uiPort = await freePort()
  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true },
  })
  await vite.listen()
  const base = `http://127.0.0.1:${uiPort}`

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
  await context.addInitScript(() => {
    localStorage.removeItem('spexcode.tabs')
    window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) }))
  await page.route('**/api/sessions/*/timeline*', (route) => {
    const id = new URL(route.request().url()).pathname.split('/').at(-2)
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(timelineFor(id)) })
  })
  await page.route('**/api/sessions/archive-index*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/slash-commands*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/sessions/*/transcript*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/plugins*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/settings*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  // the record detail read, which the Conversation asks for per session
  for (const id of [A, B, C]) {
    const row = graph.sessions.find((item) => item.id === id)
    await page.route(`**/api/sessions/${id}`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...row, prompt: null }) }))
  }

  // A layer is named by the history inside it (each fixture message says its own session), not by which one
  // looks visible: a warm layer behind the reader is `content-visibility: hidden`, so its contents are skipped
  // and every geometry read on it is a lie. The shown layer is the only one that is laid out at all, which is
  // what makes it the scrollable one.
  const visit = async (id) => {
    await page.goto(`${base}/#/sessions/${id}`, { waitUntil: 'domcontentloaded' })
    await waitFor(() => page.evaluate((session) => [...document.querySelectorAll('.si-term-body .m-timeline')]
      .some((node) => node.textContent.includes(`${session} message 1.`) && node.scrollHeight > node.clientHeight + 40), id),
    `${id}'s conversation renders a scrollable history`)
  }
  // A tag written into the DOM once; reading it back later says whether this is still the same node.
  const tagShown = (id) => page.evaluate((session) => {
    const node = [...document.querySelectorAll('.si-term-body .m-timeline')]
      .find((item) => item.textContent.includes(`${session} message 1.`))
    node.dataset.auditId ||= session
    return node.dataset.auditId
  }, id)
  const readTagged = (auditId) => page.evaluate((id) => {
    const node = document.querySelector(`.si-term-body .m-timeline[data-audit-id="${id}"]`)
    if (!node) return null
    const layers = [...document.querySelectorAll('.si-term-body > *')]
    return {
      scrollTop: Math.round(node.scrollTop), scrollHeight: node.scrollHeight,
      slot: layers.findIndex((layer) => layer.contains(node)), layers: layers.length,
    }
  }, auditId)

  // B is warmed FIRST, so A's layer already has a mounted sibling when the reader parks in it. That is the
  // whole repro: with a sibling present, the very next switch away has to put the other layer first.
  await visit(B)
  await visit(A)
  const tagA = await tagShown(A)
  // Park mid-history: away from the bottom, so the tail-follow has no claim on this position.
  const parked = await page.evaluate((id) => {
    const node = document.querySelector(`.m-timeline[data-audit-id="${id}"]`)
    node.scrollTop = 240
    return Math.round(node.scrollTop)
  }, tagA)
  assert.ok(parked > 100, `the reader is parked mid-history, not at the top (scrollTop ${parked})`)
  await page.waitForTimeout(200)
  const atPark = await readTagged(tagA)
  await page.screenshot({ path: join(out, '0-parked-mid-history.png') })

  const scenes = []

  // 1 — one switch away and back, with B already warm.
  await visit(B)
  await visit(A)
  await page.waitForTimeout(400)
  const afterOne = await readTagged(tagA)
  await page.screenshot({ path: join(out, '1-after-one-switch.png') })
  scenes.push({
    scene: 'a parked reading position survives one switch away and back',
    parked: atPark, after: afterOne,
    pass: !!afterOne && afterOne.scrollTop === atPark.scrollTop,
  })

  // 2 — two switches, which is where the recency order moves A's layer furthest.
  await page.evaluate((id) => { document.querySelector(`.m-timeline[data-audit-id="${id}"]`).scrollTop = 240 }, tagA)
  await page.waitForTimeout(200)
  const reparked = await readTagged(tagA)
  await visit(B)
  await visit(C)
  await visit(A)
  await page.waitForTimeout(400)
  const afterTwo = await readTagged(tagA)
  await page.screenshot({ path: join(out, '2-after-two-switches.png') })
  scenes.push({
    scene: 'a parked reading position survives two switches through other sessions',
    parked: reparked, after: afterTwo,
    pass: !!afterTwo && afterTwo.scrollTop === reparked.scrollTop,
  })

  // 3 — the same node throughout: a remount would explain the loss innocently and invalidate scenes 1-2.
  scenes.push({
    scene: "the reader's scroller is the same DOM node throughout, so a lost offset is never a remount",
    parked: atPark, after: afterTwo,
    pass: !!afterOne && !!afterTwo && afterTwo.scrollHeight === atPark.scrollHeight,
  })

  const kept = scenes.filter((scene) => scene.pass).length
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors, sessions: { A, B, C } }
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'no product errors in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} scenes kept the reading position`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
}
