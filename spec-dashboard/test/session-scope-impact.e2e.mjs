// [[session-eval]] YATU: real Session terminal -> affected-scenario list -> detail -> browser Back.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE || 'http://127.0.0.1:5174'
const SESSION = process.env.SESSION
const OUT = process.env.OUT || '/tmp/session-scope-impact'
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
if (!SESSION) throw new Error('SESSION must name a live session')
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const scopedQuery = `is:eval scope:${SESSION}`
const scopedHash = `#/evals?q=${encodeURIComponent(scopedQuery).replaceAll('%20', '+')}`
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`)
}

const source = spawnSync(join(ROOT, 'spec-eval/node_modules/.bin/tsx'), ['--test', 'src/sessioneval.test.ts'], {
  cwd: join(ROOT, 'spec-eval'), encoding: 'utf8',
})
check('controlled scope/export fixtures pass', source.status === 0, `exit ${source.status}`)

const [modelResponse, reviewResponse] = await Promise.all([
  fetch(`${BASE}/api/sessions/${SESSION}/evals`),
  fetch(`${BASE}/api/sessions/${SESSION}/review`),
])
if (!modelResponse.ok) throw new Error(`session model HTTP ${modelResponse.status}`)
if (!reviewResponse.ok) throw new Error(`session review HTTP ${reviewResponse.status}`)
const [model, review] = await Promise.all([modelResponse.json(), reviewResponse.json()])
const states = model.nodes.flatMap((node) => node.scenarios.map((scenario) => {
  const reading = node.evals.find((entry) => entry.scenario === scenario.name) || null
  return { node: node.id, scenario: scenario.name, impact: scenario.impact, reading }
}))
check('every API scenario carries an explicit impact reason', states.every((state) => (
  Array.isArray(state.impact) && state.impact.length > 0
)), `${states.length} scenarios`)
const expected = {
  total: states.length,
  measured: states.filter((state) => state.reading).length,
  pass: states.filter((state) => state.reading?.verdict?.status === 'pass').length,
  fail: states.filter((state) => state.reading?.verdict?.status === 'fail').length,
  freshPass: states.filter((state) => state.reading?.fresh && state.reading?.verdict?.status === 'pass').length,
  freshFail: states.filter((state) => state.reading?.fresh && state.reading?.verdict?.status === 'fail').length,
  needsReview: states.filter((state) => state.reading && !(
    state.reading.fresh && ['pass', 'fail'].includes(state.reading.verdict?.status)
  )).length,
  blind: states.filter((state) => !state.reading).length,
  stale: states.filter((state) => state.reading && !state.reading.fresh).length,
  unknown: model.nodes.reduce((count, node) => count + (node.unknownCoverage?.length || 0), 0),
  diffFiles: review.diff.length,
  names: states.map((state) => `${state.node}/${state.scenario}`).sort(),
}

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()

try {
  await page.goto(`${BASE}/#/sessions/${SESSION}`)
  await page.waitForSelector('.si-eval-stats', { timeout: 20_000 })
  const toolbar = await page.evaluate(() => ({
    fraction: document.querySelector('.si-eval-measured')?.textContent?.trim() || '',
    review: document.querySelector('.si-eval-stats .st-review')?.textContent?.trim() || '',
    tips: [...document.querySelectorAll('.si-eval-stats [data-tip]')].map((el) => el.getAttribute('data-tip')),
    href: document.querySelector('.si-tab-door')?.getAttribute('href') || '',
  }))
  check('toolbar uses the scoped measured/declared fraction', toolbar.fraction.includes(`${expected.measured}/${expected.total}`), toolbar.fraction)
  check('toolbar visibly accounts for measured scenarios still needing review', toolbar.review === String(expected.needsReview), `${toolbar.review}/${expected.needsReview}`)
  check('toolbar preserves blind scenarios', expected.blind === 0 || toolbar.tips.some((tip) => tip?.includes(`${expected.blind}`)), JSON.stringify(toolbar.tips))
  check('toolbar reports unknown separately', expected.unknown === 0 || toolbar.tips.some((tip) => tip?.includes(`${expected.unknown}`) && tip?.toLowerCase().includes('unknown')), JSON.stringify(toolbar.tips))
  check('Terminal Eval door has the canonical scoped query', toolbar.href.split('?')[0] === '#/evals'
    && new URLSearchParams(toolbar.href.split('?')[1]).get('q') === scopedQuery, toolbar.href)

  await page.click('.si-tab-door')
  await page.waitForSelector('.se-gates > .se-door', { timeout: 20_000 })
  await page.waitForFunction((count) => document.querySelectorAll('.lp-row').length === count, expected.total)
  const list = await page.evaluate(() => ({
    hash: location.hash,
    rows: [...document.querySelectorAll('.lp-row')].map((row) => {
      const node = row.querySelector('.ef-node')?.textContent?.trim() || ''
      const scenario = row.querySelector('.rl-row-title')?.textContent?.trim() || ''
      return `${node}/${scenario}`
    }).sort(),
    measured: document.querySelectorAll('a.lp-row').length,
    blind: document.querySelectorAll('.lp-row.inert.se-blind').length,
    verdicts: [...document.querySelectorAll('.rl-sections > button')].map((button) => ({
      pressed: button.getAttribute('aria-pressed'),
      text: button.textContent.trim(),
    })),
    unknownTips: [...document.querySelectorAll('.se-gates > .se-gate')].map((gate) => gate.getAttribute('data-tip')).filter(Boolean),
    scrollOwners: document.querySelectorAll('.page-scroll').length,
  }))
  check('scoped list lands on the canonical default address', list.hash === scopedHash, list.hash)
  check('scoped list row set equals the API affected-scenario set', JSON.stringify(list.rows) === JSON.stringify(expected.names), `${list.rows.length}/${expected.names.length}`)
  check('measured rows stay navigable and missing rows stay inert', list.measured === expected.measured && list.blind === expected.blind, `${list.measured} links, ${list.blind} blind`)
  check('Fail/Pass remain non-exhaustive by default', list.verdicts.length === 2 && list.verdicts.every((item) => item.pressed === 'false'), JSON.stringify(list.verdicts))
  check('Fail/Pass counts match the scoped latest verdicts', list.verdicts[0]?.text.endsWith(String(expected.fail)) && list.verdicts[1]?.text.endsWith(String(expected.pass)), JSON.stringify(list.verdicts))
  check('unknown coverage stays in leading, outside scenario rows', expected.unknown === 0 || list.unknownTips.some((tip) => tip?.includes(`${expected.unknown}`) && tip?.toLowerCase().includes('unknown')), JSON.stringify(list.unknownTips))
  check('scoped gates and rows share one PageScroll', list.scrollOwners === 1, String(list.scrollOwners))
  await page.screenshot({ path: join(OUT, 'scoped-list.png'), fullPage: true })

  const listHash = await page.evaluate(() => location.hash)
  await page.click('a.lp-row')
  await page.waitForSelector('.ds-back', { timeout: 20_000 })
  check('detail has no terminal door', await page.locator('.se-door').count() === 0)
  await page.screenshot({ path: join(OUT, 'scoped-detail.png'), fullPage: true })
  await page.goBack()
  await page.waitForFunction((count) => document.querySelectorAll('.lp-row').length === count, expected.total)
  check('browser Back restores the exact scoped list and row set', await page.evaluate(() => location.hash) === listHash
    && await page.locator('.lp-row').count() === expected.total)

  const [exportPage] = await Promise.all([
    context.waitForEvent('page'),
    page.click('.se-export'),
  ])
  await exportPage.waitForSelector('main.evals', { timeout: 20_000 })
  await exportPage.waitForLoadState('load')
  await exportPage.waitForFunction(({ scenarios, files }) => (
    document.querySelectorAll('.eval-entry').length === scenarios
    && document.querySelectorAll('.fpath').length === files
  ), { scenarios: expected.total, files: expected.diffFiles }, { timeout: 60_000 })
  const exported = await exportPage.evaluate(() => ({
    ribbon: document.querySelector('.ribbon')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    scenarios: document.querySelectorAll('.eval-entry').length,
    unmeasured: document.querySelectorAll('.eval-entry.unmeasured').length,
    files: document.querySelectorAll('.fpath').length,
  }))
  check('plain export uses affected scenarios as its denominator', exported.ribbon.includes(`${expected.freshPass}/${expected.total} passing`), exported.ribbon)
  check('plain export renders every affected scenario including blind rows', exported.scenarios === expected.total && exported.unmeasured === expected.blind, `${exported.scenarios} cards, ${exported.unmeasured} unmeasured`)
  check('plain export retains every review diff file', exported.files === expected.diffFiles, `${exported.files}/${expected.diffFiles}`)
  await exportPage.screenshot({ path: join(OUT, 'scoped-export.png') })
  await exportPage.close()
} finally {
  const video = page.video()
  await page.close()
  await context.close()
  if (video) renameSync(await video.path(), join(OUT, 'terminal-scoped-detail-back.webm'))
  await browser.close()
}

const result = {
  session: SESSION,
  source: { status: source.status, output: `${source.stdout}${source.stderr}`.trim() },
  expected,
  checks,
  passed: checks.every((item) => item.ok),
}
writeFileSync(join(OUT, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
if (!result.passed) process.exitCode = 1
