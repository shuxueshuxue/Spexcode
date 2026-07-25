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
// `suffix` is what a SIGHTED reader sees at this width (offsetParent-visible spans only); `suffixName` is
// what a screen reader hears. The two may differ in wording — never in the number.
const chips = () => page.evaluate(() => [...document.querySelectorAll('.rl-section')].map((el) => {
  const suffix = el.querySelector('.rl-section-suffix')
  const visible = suffix
    ? [...suffix.querySelectorAll('span')].filter((span) => span.offsetParent !== null && !span.classList.contains('sr-only'))
      .map((span) => span.textContent.trim()).join(' ')
    : ''
  const rect = el.getBoundingClientRect()
  const label = el.querySelector('.review-state-label')?.textContent.trim() ?? ''
  const count = el.querySelector('.rl-section-count')?.textContent.trim() ?? ''
  return {
    label,
    count,
    suffix: visible || null,
    suffixName: suffix?.querySelector('.sr-only')?.textContent.trim() ?? null,
    suffixTip: suffix?.getAttribute('data-tip') ?? null,
    text: `${label}${count}${visible ? ` ${visible}` : ''}`,
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    pressed: el.getAttribute('aria-pressed') === 'true',
  }
}))

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
// the localized stale word, read off the chip's own accessible name — the probe never hardcodes copy.
const staleWord = (await page.evaluate(() => document.querySelector('.rl-section-suffix .sr-only')?.textContent.trim() ?? ''))
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

// ---- 6. 390px: the DEBT survives the phone header — only the wording condenses ---------------------
await page.setViewportSize({ width: 390, height: 780 })
await page.goto(`${BASE}/#/evals`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rl-section')
await page.waitForTimeout(1400)
const phone = await view('390px default #/evals')
// the honest overflow question is whether the header clips its OWN content, not whether the page scrolls:
// a control pushed past the header's client box is invisible even while document.scrollWidth stays 390.
// Lines are clustered by vertical CENTER, not by `top` — controls of different heights share one row.
const headGeometry = () => page.evaluate(() => {
  const head = document.querySelector('.lp-head')
  const rect = head.getBoundingClientRect()
  const firstRow = document.querySelector('.lp-rows .lp-row')?.getBoundingClientRect()
  const centers = [...head.querySelectorAll('.rl-section, .rl-secondary-filters-trigger')]
    .map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 }).sort((a, b) => a - b)
  const lines = centers.reduce((rows, y) => (rows.length && y - rows[rows.length - 1] < 20 ? rows : [...rows, y]), []).length
  return {
    head: Math.round(rect.height),
    headScroll: head.scrollWidth,
    headClient: head.clientWidth,
    lines,
    doc: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    filters: !!document.querySelector('.rl-secondary-filters-trigger'),
    coversFirstRow: firstRow ? Math.round(rect.bottom) > Math.round(firstRow.top) + 1 : null,
  }
})
const geometry = await headGeometry()
for (const [name, chip] of [['fail', phone.rendered[0]], ['pass', phone.rendered[1]]]) {
  const split = phone.data.counts[name]
  check(`390px ${name} still shows the fresh count`, chip.count === String(split.fresh), `${chip.text}`)
  check(`390px ${name} still shows the stale count — visibly, not via a menu`,
    chip.suffix === `+${split.stale}`, `visible "${chip.suffix}" for stale ${split.stale}`)
  check(`390px ${name} keeps the full wording in its accessible name`,
    chip.suffixName === `+${split.stale} ${staleWord}` && chip.suffixTip === chip.suffixName,
    `name "${chip.suffixName}" tip "${chip.suffixTip}"`)
}
check('390px chips carry the same numbers desktop showed',
  JSON.stringify(phone.data.counts) === JSON.stringify(base.data.counts),
  `${JSON.stringify(phone.data.counts)} vs ${JSON.stringify(base.data.counts)}`)
check('the header clips NOTHING against its own box — every control is really rendered',
  geometry.headScroll === geometry.headClient && geometry.filters, JSON.stringify(geometry))
check('it buys that width with exactly two contained lines, not by hiding a control',
  geometry.lines === 2 && geometry.coversFirstRow === false, JSON.stringify(geometry))
check('nothing scrolls horizontally past 390px',
  geometry.doc <= 390 && geometry.body <= 390, JSON.stringify(geometry))
check('each status button keeps a 44px hit target', phone.rendered.every((chip) => chip.h >= 44),
  phone.rendered.map((chip) => `${chip.label}:${chip.w}x${chip.h}`).join(' '))
await page.screenshot({ path: join(OUT, '05-phone-default.png') })
await page.locator('.lp-head').screenshot({ path: join(OUT, '05-phone-header.png') })

await submit('is:eval freshness:fresh')
const phoneFresh = await view('390px is:eval freshness:fresh')
check('390px freshness:fresh renders no suffix at all', phoneFresh.rendered.every((chip) => chip.suffix === null),
  phoneFresh.rendered.map((chip) => chip.text).join(' | '))
await page.locator('.lp-head').screenshot({ path: join(OUT, '06-phone-header-fresh.png') })

// the lighter Issues header shares this chrome and must NOT pay for the Evals split.
await page.goto(`${BASE}/#/issues`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rl-section')
await page.waitForTimeout(1400)
const issuesPhone = await headGeometry()
check('the Issues phone header still measures ONE 49px unclipped row',
  issuesPhone.head === 49 && issuesPhone.lines === 1 && issuesPhone.headScroll === issuesPhone.headClient && issuesPhone.doc <= 390,
  JSON.stringify(issuesPhone))
await page.locator('.lp-head').screenshot({ path: join(OUT, '07-phone-issues-header.png') })
await page.setViewportSize({ width: 1440, height: 900 })

console.log(`\nfresh=${base.data.counts.pass.fresh + base.data.counts.fail.fresh} stale=${base.data.counts.pass.stale + base.data.counts.fail.stale} unmeasured=${base.data.counts.unmeasured} population=${base.data.total}`)
console.log(`${pass} passed, ${fail} failed`)

await context.close()
await browser.close()
for (const file of readdirSync(OUT)) {
  if (file.endsWith('.webm') && !file.startsWith('run-')) renameSync(join(OUT, file), join(OUT, 'run-eval-verdict-freshness.webm'))
}
process.exit(fail ? 1 : 0)
