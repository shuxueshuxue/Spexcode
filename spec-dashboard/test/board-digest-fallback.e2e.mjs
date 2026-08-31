// Real-browser evidence that the fingerprint lane is live WHERE THE PRODUCT RUNS, and that losing the
// digest can only cost that lane its cheapness — never the lane. `crypto.subtle` exists only in a secure
// context and these dashboards are opened over plain HTTP on tailnet addresses, so measuring this on
// localhost would measure the one origin no human uses.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const BASE = process.env.BASE
const OUT = resolve(process.env.OUT); mkdirSync(OUT, { recursive: true })
const WINDOW_MS = Number(process.env.WINDOW_MS || 50_000)

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true })

const drive = async (label, breakDigest) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  if (breakDigest) {
    await page.addInitScript(() => {
      // present but broken: the path a guard must survive, distinct from simply absent
      Object.defineProperty(globalThis.crypto ??= {}, 'subtle', {
        configurable: true, value: { digest: () => Promise.reject(new Error('digest unavailable')) },
      })
    })
  }
  const polls = []
  page.on('response', async (r) => {
    if (new URL(r.url()).pathname !== '/api/graph') return
    polls.push({ at: Date.now(), status: r.status(), key: ((await r.request().allHeaders())['if-none-match'] || 'NONE').slice(0, 12) })
  })
  await page.addInitScript(() => {
    window.__frames = 0
    const N = window.EventSource
    window.EventSource = class extends N {
      constructor(...a) { super(...a)
        if (String(a[0]).includes('/api/graph/stream'))
          for (const n of ['graph-full', 'graph-delta']) this.addEventListener(n, () => { window.__frames += 1 }) }
    }
  })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  const ctx = await page.evaluate(() => ({ secure: window.isSecureContext, subtle: typeof crypto?.subtle }))
  await page.waitForFunction(() => window.__frames > 0, null, { timeout: 60_000 })
  const start = Date.now()
  await page.waitForTimeout(WINDOW_MS)
  const shot = join(OUT, `digest-${label}.png`)
  await page.screenshot({ path: shot })
  const frames = await page.evaluate(() => window.__frames)
  await page.close()
  return { label, ...ctx, frames, polls: polls.map((p) => ({ t: ((p.at - start) / 1000) | 0, status: p.status, key: p.key })), shot }
}

const live = await drive('fallback', false)
const broken = await drive('digest-broken', true)
await browser.close()
const report = { base: BASE, live, broken }
writeFileSync(join(OUT, 'digest-fallback.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

assert.equal(live.secure, false, 'this must run on the INSECURE origin a human actually opens')
assert.equal(live.subtle, 'undefined', 'expected no crypto.subtle here — otherwise the fallback is untested')
assert.ok(live.polls.some((p) => p.key !== 'NONE'), 'no poll carried a conditional key: the fallback digest is not producing one')
assert.ok(live.polls.some((p) => p.status === 304), 'no poll was answered bodyless: the fallback digest disagrees with the server')

// the guard: a digest that REJECTS must cost the cheapness, not the lane
assert.ok(broken.polls.length >= 2, `the fallback poll stopped running entirely (${broken.polls.length} requests) — a rejecting digest took loadGraph down with it`)
assert.ok(broken.polls.every((p) => p.key === 'NONE'), 'a broken digest must produce no key at all, never a wrong one')
console.log(`\nPASS: insecure origin ${live.base ?? BASE} — ${live.polls.filter((p) => p.status === 304).length} bodyless of ${live.polls.length};`
  + ` with the digest broken the belt still ran ${broken.polls.length} times, unconditional`)
