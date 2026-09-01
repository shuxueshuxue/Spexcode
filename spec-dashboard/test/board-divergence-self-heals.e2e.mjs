// Real-browser evidence for [[dashboard-shell]]'s self-verification: a client must not be able to hold a
// board the server never had. The failure is injected at the one place the equivalence argument cannot
// cover from inside itself — a patch whose CONTENT does not match the tag it is named with, which is what a
// server-side diff bug looks like on the wire. The chain check cannot see it (from/to line up), so before
// self-verification this state was undetectable AND certifiable: the poll would answer 304 forever.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5179'
const LABEL = process.env.LABEL || 'divergence'
const WINDOW_MS = Number(process.env.WINDOW_MS || 70_000)
const OUT = resolve(process.env.OUT || join(here, '..', '..', '.e2e-out'))
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.addInitScript(() => {
  window.__streamOpens = 0
  window.__corrupted = null
  const Native = window.EventSource
  window.EventSource = class extends Native {
    constructor(...args) {
      super(...args)
      this.__board = String(args[0]).includes('/api/graph/stream')
      if (this.__board) window.__streamOpens += 1
    }
    addEventListener(type, fn, ...rest) {
      if (!this.__board || type !== 'graph-delta') return super.addEventListener(type, fn, ...rest)
      // corrupt exactly ONE patch, the first one, leaving from/to untouched
      return super.addEventListener(type, (e) => {
        if (window.__corrupted) return fn(e)
        const d = JSON.parse(e.data)
        const key = Object.keys(d.set || {})[0]
        if (!key) return fn(e)
        const victim = d.set[key]
        if (victim && typeof victim === 'object' && !Array.isArray(victim)) victim.__injected = 'not-what-the-server-has'
        else d.set[key] = { __injected: 'not-what-the-server-has' }
        window.__corrupted = { at: Date.now(), key, to: d.to }
        fn({ data: JSON.stringify(d) })
      }, ...rest)
    }
  }
})

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push({ at: Date.now(), text: m.text() }) })
const polls = []
page.on('response', async (res) => {
  if (new URL(res.url()).pathname !== '/api/graph') return
  polls.push({ at: Date.now(), status: res.status(), key: ((await res.request().allHeaders())['if-none-match'] || 'NONE').slice(0, 12) })
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__streamOpens > 0, null, { timeout: 60_000 })
const start = Date.now()
await page.waitForFunction(() => window.__corrupted !== null, null, { timeout: WINDOW_MS })
    .catch(() => { throw new Error('inconclusive: no graph-delta arrived to corrupt in the window') })
const corrupted = await page.evaluate(() => window.__corrupted)
// the self-heal: a replacement stream opens and re-anchors on a fresh full
const healed = await page.waitForFunction(() => window.__streamOpens > 1, null, { timeout: 30_000 })
  .then(() => Date.now()).catch(() => null)
await page.waitForTimeout(4000)
const opens = await page.evaluate(() => window.__streamOpens)
const shot = join(OUT, `${LABEL}.png`)
await page.screenshot({ path: shot })
await browser.close()

const divergence = errors.filter((e) => e.text.includes('BOARD-DIVERGENCE'))
const report = {
  label: LABEL, base: BASE,
  injected: { unit: corrupted.key, namedTag: corrupted.to, atMs: corrupted.at - start },
  detected: divergence.map((d) => ({ atMs: d.at - start, text: d.text })),
  streamOpens: opens,
  healedAfterMs: healed ? healed - corrupted.at : null,
  polls: polls.map((p) => ({ t: ((p.at - start) / 1000) | 0, status: p.status, key: p.key })),
  screenshot: shot,
}
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

assert.ok(divergence.length > 0, 'a patch whose content contradicted its tag was applied and NOT detected')
assert.ok(opens > 1, 'divergence was detected but the stream never reopened onto a fresh anchor')
assert.ok(report.healedAfterMs !== null && report.healedAfterMs < 30_000,
  `self-heal took ${report.healedAfterMs}ms`)
console.log(`\nPASS ${LABEL}: divergence detected in ${divergence[0].at - corrupted.at}ms, reopened after ${report.healedAfterMs}ms`)
