// [[workspace-shell]] MOUNTED-DOCUMENT POOL: switching tabs must not reload the document, and keeping
// documents mounted must not cost an idle workspace anything.
//
// Two measurements, both from the running product:
//   1. IDENTITY — a document's DOM node survives a round trip through another tab. A remount replaces the
//      node; a keep-alive switch only hides and shows it. The probe stamps the node and looks for its
//      stamp on return, which no amount of re-rendering can fake.
//   2. IDLE SCRIPT — CDP's Performance.getMetrics ScriptDuration over 10 idle seconds with the pool full.
//      The red line is 0.05s per 10s: a warm document is one that is not running.
//
//   BASE=http://127.0.0.1:5199 node spec-dashboard/test/keep-alive.e2e.mjs
//
// Env: BASE (dev server), OUT (artifact dir), SPEXCODE_PLAYWRIGHT_PATH, IDLE_MS (default 10000).
import { pathToFileURL } from 'node:url'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const OUT = process.env.OUT || '/tmp/keep-alive'
const IDLE_MS = Number(process.env.IDLE_MS || 10_000)
const SCRIPT_BUDGET = 0.05
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const fetchJson = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}
const board = await fetchJson('/api/graph')
const specs = board.specs || board.nodes || []
const sessionList = await fetchJson('/api/sessions')
const withCode = specs.filter((n) => (n.code || []).length)
if (withCode.length < 2) throw new Error('need two spec nodes with governed files')
const session = sessionList.find((s) => !s.archived && s.liveness === 'online') || sessionList.find((s) => !s.archived)
if (!session) throw new Error('no session on the board — cannot address #/sessions/<id>')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
const scriptSeconds = async () => {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return metrics.find((m) => m.name === 'ScriptDuration')?.value ?? 0
}

await page.goto(`${BASE}/#/empty`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  const set = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
  set('spexcode.lang', 'en'); set('spexcode.theme', 'minimal')
  set('spexcode.tabs', '[]'); set('spexcode.dock', '1'); set('spexcode.dockMode', 'explorer')
  try { localStorage.removeItem('spexcode.split') } catch { /* private mode */ }
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.app-shell .side-rail', { timeout: 45_000 })

// the pool means several panes share a view class; only the showing one is not aria-hidden. Waiting on
// the class alone resolves to a hidden sibling and never settles.
const shown = (cls) => `${cls}:not([aria-hidden="true"])`
const go = async (hash, ready) => {
  await page.evaluate((h) => { location.hash = h }, hash)
  await page.waitForSelector(shown(ready), { state: 'visible', timeout: 45_000 })
  await page.waitForTimeout(400)
}
const encode = (v) => String(v).split('/').map(encodeURIComponent).join('/')
const specA = `#/spec/${encode(withCode[0].id)}`
const specB = `#/spec/${encode(withCode[1].id)}`
const sessionHash = `#/sessions/${encode(session.id)}`

// fill the pool: a spec, a second spec, a governed file, the session console, both boards.
await go(specA, '.viewhost.view-spec')
await go(specB, '.viewhost.view-spec')
await go(`#/file/${encode(withCode[0].code[0])}`, '.viewhost.view-file')
await go(sessionHash, '.viewhost.view-sessions')
await page.waitForTimeout(2000)
await go('#/evals', '.viewhost.view-evals')
await go('#/issues', '.viewhost.view-issues')

const results = []
const check = (ok, msg) => { results.push({ ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`) }

// 1. IDENTITY: stamp the visible pane of each document, leave, come back, look for the stamp.
const stamp = async (selector, mark) => page.evaluate(({ sel, m }) => {
  const el = [...document.querySelectorAll(sel)].find((n) => n.offsetParent !== null || getComputedStyle(n).display !== 'none')
  if (!el) return false
  el.dataset.keepAliveMark = m
  return true
}, { sel: selector, m: mark })
const marked = async (selector, mark) => page.evaluate(({ sel, m }) => {
  const el = [...document.querySelectorAll(sel)].find((n) => getComputedStyle(n).display !== 'none')
  return el?.dataset.keepAliveMark === m
}, { sel: selector, m: mark })

await go(sessionHash, '.viewhost.view-sessions')
await stamp('.viewhost.view-sessions', 'session-1')
await go(specA, '.viewhost.view-spec')
await stamp('.viewhost.view-spec', 'spec-1')
await go('#/evals', '.viewhost.view-evals')
await go(sessionHash, '.viewhost.view-sessions')
check(await marked('.viewhost.view-sessions', 'session-1'), 'the session console survives a round trip through two other tabs')
await go(specA, '.viewhost.view-spec')
check(await marked('.viewhost.view-spec', 'spec-1'), 'a spec document survives a round trip')

// hidden panes are still in the DOM, and hidden
const panes = await page.evaluate(() => ({
  total: document.querySelectorAll('.viewhost').length,
  visible: [...document.querySelectorAll('.viewhost')].filter((n) => getComputedStyle(n).display !== 'none').length,
  hiddenAria: [...document.querySelectorAll('.viewhost')].filter((n) => n.getAttribute('aria-hidden') === 'true').length,
}))
check(panes.visible === 1, `exactly one pane is visible (${panes.visible} of ${panes.total} mounted)`)
check(panes.total > 1 && panes.total <= 6, `the pool holds ${panes.total} mounted documents, within its bound of 6`)
check(panes.hiddenAria === panes.total - 1, 'every hidden pane is aria-hidden')

// 2. SWITCH COST: a switch that shows a mounted document must not wait for anything.
const switchMs = async (hash, ready) => {
  const started = Date.now()
  await page.evaluate((h) => { location.hash = h }, hash)
  await page.waitForSelector(shown(ready), { state: 'visible', timeout: 20_000 })
  return Date.now() - started
}
const cold = []
for (const [hash, ready] of [[sessionHash, '.viewhost.view-sessions'], [specA, '.viewhost.view-spec'], ['#/evals', '.viewhost.view-evals'], [sessionHash, '.viewhost.view-sessions']]) {
  cold.push(await switchMs(hash, ready))
}
const worst = Math.max(...cold)
check(worst < 250, `every warm switch is immediate — ${cold.join('ms, ')}ms (worst ${worst}ms)`)

// 3. IDLE SCRIPT, measured in a FRESH window so the pool contains exactly what is being attributed.
// The budget is what the POOL costs: a workspace full of documents nobody is touching. A live session
// console is measured beside it and REPORTED rather than budgeted — a TUI streaming output is not idle,
// its cost is data arriving, and it is the same cost with or without a pool (measured alone, nothing else
// mounted, on a busy project: 0.15s+ per 10s). Warm terminals are the session console's own contract.
const idleWith = async (label, hashes) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const probe = await ctx.newPage()
  const probeCdp = await ctx.newCDPSession(probe)
  await probeCdp.send('Performance.enable')
  const script = async () => (await probeCdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'ScriptDuration').value
  await probe.goto(`${BASE}/#/empty`, { waitUntil: 'domcontentloaded' })
  await probe.evaluate(() => {
    const set = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
    set('spexcode.lang', 'en'); set('spexcode.theme', 'minimal'); set('spexcode.tabs', '[]')
    set('spexcode.dock', '1'); set('spexcode.dockMode', 'explorer')
    try { localStorage.removeItem('spexcode.split') } catch { /* private mode */ }
  })
  await probe.reload({ waitUntil: 'domcontentloaded' })
  await probe.waitForSelector('.app-shell .side-rail', { timeout: 45_000 })
  for (const hash of hashes) {
    await probe.evaluate((h) => { location.hash = h }, hash)
    await probe.waitForTimeout(2200)
  }
  await probe.waitForTimeout(800)
  const mounted = await probe.evaluate(() => document.querySelectorAll('.viewhost').length)
  const before = await script()
  await probe.waitForTimeout(IDLE_MS)
  const seconds = (await script()) - before
  console.log(`      ${label}: ${seconds.toFixed(4)}s of script per ${IDLE_MS / 1000}s, ${mounted} panes mounted`)
  await probe.screenshot({ path: join(OUT, `keep-alive-idle-${label.replace(/[^a-z0-9]+/gi, '-')}.png`) })
  await ctx.close()
  return { seconds, mounted }
}

const documents = [specA, specB, `#/file/${encode(withCode[0].code[0])}`, '#/evals', '#/issues', specA]
const pool = await idleWith('documents only', documents)
check(pool.seconds <= SCRIPT_BUDGET,
  `a warm pool is idle — ${pool.seconds.toFixed(4)}s over ${IDLE_MS / 1000}s with ${pool.mounted} panes mounted (budget ${SCRIPT_BUDGET}s)`)
await idleWith('with a live session console hidden in the pool', [...documents.slice(0, 3), sessionHash, ...documents.slice(3)])

await page.screenshot({ path: join(OUT, 'keep-alive-warm-pool.png') })

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
await context.close()
await browser.close()
process.exit(failed.length ? 1 : 0)
