// Real-browser evidence for [[dashboard-shell]]'s conditional-key contract: while the delta stream is
// delivering, the fallback poll beside it must stay BODYLESS. The measurement is the whole point, so it is
// taken from the product's own two channels — Chromium's network events for /api/graph, and an in-page
// EventSource wrapper that only counts frames — never from a substitute client.
//
// The scenario is inconclusive, not passing, when the board never moves: a poll that 304s because nothing
// happened proves nothing about a PUSHED board. So the run fails loudly unless a patch actually arrived.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5173'
const LABEL = process.env.LABEL || 'board-poll'
const WINDOW_MS = Number(process.env.WINDOW_MS || 100_000)
const OUT = resolve(process.env.OUT || join(here, '..', '..', '.e2e-out'))
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

// count push frames in the page itself — the product's own EventSource, merely observed
await page.addInitScript(() => {
  window.__frames = []
  const Native = window.EventSource
  window.EventSource = class extends Native {
    constructor(...args) {
      super(...args)
      if (!String(args[0]).includes('/api/graph/stream')) return
      for (const name of ['graph-full', 'graph-delta'])
        this.addEventListener(name, (e) => {
          let to = null
          try { to = JSON.parse(e.data).to } catch { to = null }
          window.__frames.push({ at: Date.now(), name, bytes: e.data.length, to, data: e.data })
        })
    }
  }
})

const polls = []
// A poll's conditional key is chosen when the REQUEST goes out, so its body has to be judged against what
// the client held at that instant — not at response time. Judging by response time reads a legitimate
// correction as waste whenever a frame lands mid-flight: the client really was a patch behind when it
// asked, and by the time the answer arrives its mirror has caught up on its own.
const askedAt = new WeakMap()
page.on('request', (req) => { if (new URL(req.url()).pathname === '/api/graph') askedAt.set(req, Date.now()) })
page.on('response', async (res) => {
  const url = new URL(res.url())
  if (url.pathname !== '/api/graph') return
  const sent = (await res.request().allHeaders())['if-none-match'] || null
  // a still-full body is only a defect if it carries nothing the display lacks, so read it and say which
  const body = res.status() === 200 ? await res.text().catch(() => null) : null
  polls.push({ at: Date.now(), askedAt: askedAt.get(res.request()) ?? Date.now(),
    status: res.status(), bytes: Number(res.headers()['content-length'] || 0), conditional: sent, body })
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__frames?.some((f) => f.name === 'graph-full'), null, { timeout: 60_000 })
const start = Date.now()
await page.waitForTimeout(WINDOW_MS)
const frames = await page.evaluate(() => window.__frames)
const shot = join(OUT, `${LABEL}.png`)
await page.screenshot({ path: shot })
await browser.close()

// mirror the display's unit map from the frames the page received, so a 200's body can be judged by what
// it actually ADDS rather than by its size ([[graph-delta]]'s decomposition, recomputed here as a witness)
const unitize = (b) => { const u = new Map()
  const keyed = (arr, p, ok) => { const o = []
    for (const it of arr || []) { u.set(p + it.id, JSON.stringify(it)); o.push(it.id) }
    u.set(ok, JSON.stringify(o)) }
  const { nodes, sessions, ...meta } = b
  keyed(nodes, 'node:', 'nodes#order'); keyed(sessions, 'sess:', 'sess#order')
  u.set('meta', JSON.stringify(meta)); return u }
const displayAt = (at) => {
  let mirror = null
  for (const f of frames) {
    if (f.at > at) break
    const d = JSON.parse(f.data)
    if (f.name === 'graph-full') mirror = unitize(d.graph)
    else if (mirror) { for (const k of d.del || []) mirror.delete(k)
      for (const [k, v] of Object.entries(d.set || {})) mirror.set(k, JSON.stringify(v)) }
  }
  return mirror
}
for (const p of polls) {
  if (!p.body) continue
  const mirror = displayAt(p.askedAt)
  if (!mirror) { p.novelUnits = null; continue }
  let novel = 0
  for (const [k, j] of unitize(JSON.parse(p.body))) if (mirror.get(k) !== j) novel++
  p.novelUnits = novel
}
const patches = frames.filter((f) => f.name === 'graph-delta')
const fullBody = polls.filter((p) => p.status === 200)
const bodyless = polls.filter((p) => p.status === 304)
// a poll is only meaningful once a pushed board is what the tab is displaying
const afterFirstPatch = patches.length ? polls.filter((p) => p.at > patches[0].at) : []
const report = {
  label: LABEL, base: BASE, windowMs: WINDOW_MS,
  frames: { full: frames.length - patches.length, patches: patches.length, patchBytes: patches.reduce((a, f) => a + f.bytes, 0) },
  polls: { total: polls.length, full200: fullBody.length, bodyless304: bodyless.length, fullBytes: fullBody.reduce((a, p) => a + p.bytes, 0) },
  fullBodies: fullBody.map((p) => ({ t: ((p.at - start) / 1000) | 0, bytes: p.bytes, hadKey: !!p.conditional, novelUnits: p.novelUnits })),
  afterFirstPatch: { total: afterFirstPatch.length, full200: afterFirstPatch.filter((p) => p.status === 200).length },
  timeline: polls.map((p) => ({ t: ((p.at - start) / 1000) | 0, kind: `HTTP ${p.status}`, bytes: p.bytes, key: p.conditional ? p.conditional.slice(0, 10) + '…' : 'NONE' }))
    .concat(frames.map((f) => ({ t: ((f.at - start) / 1000) | 0, kind: `SSE ${f.name}`, bytes: f.bytes, key: f.to ? f.to.slice(0, 10) + '…' : '' })))
    .sort((a, b) => a.t - b.t),
  screenshot: shot,
}
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(report, null, 2))
for (const row of report.timeline) console.log(String(row.t).padStart(4) + 's', row.kind.padEnd(16), String(row.bytes).padStart(8), row.key || '')
console.log('\n' + JSON.stringify({ ...report, timeline: undefined }, null, 2))

assert.ok(patches.length > 0, 'inconclusive: no graph-delta arrived in the window, so no pushed board was ever the display')
assert.ok(report.afterFirstPatch.total > 0, 'inconclusive: no poll fired after a pushed board landed')
// A 200 is CORRECT when the display genuinely diverged — [[dashboard-shell]]'s other obligation is that the
// poll corrects push-delivered staleness. The defect this scenario forbids is the other one: a full body
// that the display already holds every unit of, paid because the lanes could not name the same board.
// Two ways to fail, and the first is the one the old shape took: a poll that fires while a pushed board IS
// the display and sends no conditional key at all cannot be answered bodyless no matter what the server does.
const firstPatchT = ((patches[0].at - start) / 1000) | 0
const wasted = report.fullBodies.filter((p) => p.t >= firstPatchT && (!p.hadKey || p.novelUnits === 0))
assert.deepEqual(wasted, [],
  `${wasted.length} poll(s) re-downloaded the whole graph without cause — either unconditional while holding `
  + `a pushed board, or conditional but carrying zero units the display lacked`)
console.log(`\nPASS ${LABEL}: ${report.afterFirstPatch.total} poll(s) after a pushed board; `
  + `${report.polls.bodyless304} bodyless, ${report.fullBodies.filter((p) => p.hadKey).length} conditional full `
  + `(each carrying real divergence), 0 wasted`)
