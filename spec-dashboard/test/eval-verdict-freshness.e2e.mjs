// [[evals-feed]] / [[review-filters]] YATU: the measured verdict chips LEAD with fresh and NAME their
// stale remeasurement debt. Drives a real Chromium against the PREBUILT dashboard dist (never a dev
// server), reads each chip's rendered text beside the very /api/evals response that produced it, and
// checks the split against the row population a verdict click actually returns.
import { pathToFileURL } from 'node:url'
import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5183'
const OUT = process.env.OUT || '/tmp/eval-verdict-freshness'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

let pass = 0, fail = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  ok ? pass++ : fail++
}

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()

// the LAST /api/evals payload the page actually consumed — the chips must be a pure read of this.
let lastEvals = null
page.on('response', async (response) => {
  if (!response.url().includes('/api/evals')) return
  try { lastEvals = await response.json() } catch { /* non-JSON error bodies are not this probe's subject */ }
})

// each chip as the human sees it: the label, the count pill, and the quieter split suffix (or null).
const chips = () => page.evaluate(() => [...document.querySelectorAll('.rl-section')].map((el) => ({
  label: el.querySelector('.review-state-label')?.textContent.trim() ?? '',
  count: el.querySelector('.rl-section-count')?.textContent.trim() ?? '',
  suffix: el.querySelector('.rl-section-suffix')?.textContent.trim() ?? null,
  text: el.textContent.replace(/\s+/g, ' ').trim(),
  pressed: el.getAttribute('aria-pressed') === 'true',
})))

const submit = async (text) => {
  lastEvals = null
  await page.locator('.rl-query input[role="combobox"]').fill(text)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1200)
}

const view = async (label) => {
  const seen = chips()
  const [rendered, data] = [await seen, lastEvals]
  console.log(`\n--- ${label}\n    hash   ${await page.evaluate(() => location.hash || '(bare)')}\n` +
    `    chips  ${rendered.map((c) => c.text).join('  |  ')}\n` +
    `    counts ${JSON.stringify(data?.counts)}  total=${data?.total} sourceTotal=${data?.sourceTotal}`)
  return { rendered, data }
}

// ---- 1. the DEFAULT view: fresh leads, stale trails, unmeasured owns neither -------------------------
await page.goto(`${BASE}/#/evals`, { waitUntil: 'networkidle' })
await page.waitForSelector('.rl-section')
await page.waitForTimeout(1200)
const base = await view('default #/evals (bare address)')
const [failChip, passChip, unmeasuredChip] = base.rendered
const staleWord = (await page.evaluate(() => document.querySelector('.rl-section-suffix')?.textContent.trim() ?? ''))
  .replace(/^\+\d+\s*/, '')

check('default address is bare', await page.evaluate(() => location.hash) === '#/evals')
check('no verdict is pressed by default', base.rendered.every((chip) => !chip.pressed))
for (const [name, chip] of [['fail', failChip], ['pass', passChip]]) {
  const split = base.data.counts[name]
  check(`${name} count is the server's fresh half`, chip.count === String(split.fresh), `chip ${chip.count} vs counts.${name}.fresh ${split.fresh}`)
  check(`${name} suffix names the stale half with the stale word`, chip.suffix === `+${split.stale} ${staleWord}`, `chip "${chip.suffix}"`)
}
check('unmeasured is one number with no suffix', unmeasuredChip.count === String(base.data.counts.unmeasured) && unmeasuredChip.suffix === null,
  `chip ${unmeasuredChip.count}/${unmeasuredChip.suffix} vs ${base.data.counts.unmeasured}`)
check('the split is the whole population, not a shrunken one',
  base.data.counts.pass.fresh + base.data.counts.pass.stale + base.data.counts.fail.fresh + base.data.counts.fail.stale + base.data.counts.unmeasured === base.data.total,
  `${JSON.stringify(base.data.counts)} vs total ${base.data.total}`)
await page.screenshot({ path: join(OUT, '01-default-chips.png') })
await page.locator('.lp-head').screenshot({ path: join(OUT, '01-default-header.png') })

// ---- 2. clicking a verdict returns the WHOLE split, fresh + stale --------------------------------
lastEvals = null
await page.locator('.rl-section').nth(1).click()
await page.waitForTimeout(1400)
const passOnly = await view('verdict:pass selected')
check('verdict:pass is in the visible query', (await page.evaluate(() => decodeURIComponent(location.hash))).includes('verdict:pass'))
check('selecting pass returns fresh + stale rows', passOnly.data.total === base.data.counts.pass.fresh + base.data.counts.pass.stale,
  `total ${passOnly.data.total} vs ${base.data.counts.pass.fresh}+${base.data.counts.pass.stale}`)
check('counts stay stable under the active verdict token', JSON.stringify(passOnly.data.counts) === JSON.stringify(base.data.counts))
await page.screenshot({ path: join(OUT, '02-verdict-pass.png') })

// ---- 3. freshness:fresh drops every suffix — because the count IS zero ----------------------------
await submit('is:eval freshness:fresh')
const fresh = await view('is:eval freshness:fresh')
check('freshness:fresh renders no stale suffix at all', fresh.rendered.every((chip) => chip.suffix === null),
  fresh.rendered.map((chip) => chip.suffix).join(','))
check('freshness:fresh zeroes every stale half server-side',
  fresh.data.counts.pass.stale === 0 && fresh.data.counts.fail.stale === 0 && fresh.data.counts.unmeasured === 0)
check('fresh halves survive the token unchanged',
  fresh.data.counts.pass.fresh === base.data.counts.pass.fresh && fresh.data.counts.fail.fresh === base.data.counts.fail.fresh,
  `${JSON.stringify(fresh.data.counts)} vs ${JSON.stringify(base.data.counts)}`)
check('the fresh view total is exactly the fresh halves',
  fresh.data.total === fresh.data.counts.pass.fresh + fresh.data.counts.fail.fresh)
await page.screenshot({ path: join(OUT, '03-freshness-fresh.png') })
await page.locator('.lp-head').screenshot({ path: join(OUT, '03-freshness-fresh-header.png') })

// ---- 4. freshness:stale is the mirror: zero fresh, the debt in the suffixes -----------------------
await submit('is:eval freshness:stale')
const stale = await view('is:eval freshness:stale')
check('freshness:stale empties the fresh halves', stale.rendered.slice(0, 2).every((chip) => chip.count === '0'),
  stale.rendered.map((chip) => chip.count).join(','))
check('freshness:stale keeps the whole debt in the suffixes',
  stale.data.counts.pass.stale === base.data.counts.pass.stale && stale.data.counts.fail.stale === base.data.counts.fail.stale,
  `${JSON.stringify(stale.data.counts)} vs ${JSON.stringify(base.data.counts)}`)
check('the stale view total is exactly the stale halves',
  stale.data.total === stale.data.counts.pass.stale + stale.data.counts.fail.stale)
await page.screenshot({ path: join(OUT, '04-freshness-stale.png') })

// ---- 5. the page never re-derives the split from the 25 rows it holds -----------------------------
await page.goto(`${BASE}/#/evals`, { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
const rows = await page.locator('.lp-row').count()
const again = await view('back on the default view')
check('the page holds one 25-row slice', rows <= 25, `${rows} rows`)
check('yet the chips still show the full population', Number(again.rendered[1].count) + Number(again.rendered[1].suffix.match(/\d+/)[0]) > rows,
  `${again.rendered[1].text} over ${rows} rows`)

console.log(`\nfresh=${base.data.counts.pass.fresh + base.data.counts.fail.fresh} stale=${base.data.counts.pass.stale + base.data.counts.fail.stale} unmeasured=${base.data.counts.unmeasured} population=${base.data.total}`)
console.log(`${pass} passed, ${fail} failed`)

await context.close()
await browser.close()
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.webm') && !file.startsWith('run-')) renameSync(join(OUT, file), join(OUT, 'run-eval-verdict-freshness.webm'))
}
process.exit(fail ? 1 : 0)
