// Reproduces the reported bug: a codex-shaped session whose record has the prompt quote, then a `queued`
// row, then the working seam — and whose transcript's first turn is that same launch prompt. Before the fix
// the `queued` row between the quote and the seam defeated the positional opener lookup, so the prompt was
// drawn again inside the expanded seam. Option 3 makes a seam draw the agent's work only, so it never is.
//   BASE_URL=http://127.0.0.1:5199 OUT=/tmp/x node spec-dashboard/test/transcript-dedup.e2e.mjs
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5199'
const OUT = process.env.OUT || '/tmp/transcript-dedup'
const TAG = process.env.TAG || 'after'
const SID = 'transcript-dedup-fixture'
const PROMPT = '就是我想把咱们目前的 harness adapter、transcript 读取/渲染、terminal / conversation ui 切换这一部分去做成一个独立的模块/包，从而让我的另一个项目 gugu 能够用上这个包。你分析一下可行性。'
mkdirSync(OUT, { recursive: true })
const NOW = Date.now(), iso = (o) => new Date(NOW + o).toISOString()
const board = { sessions: [{
  id: SID, label: SID, headline: SID, title: SID, raw: { name: SID, title: null }, node: null, branch: `node/${SID}`,
  path: '/tmp/fixture', parent: null, harness: 'codex-headless', capabilities: { headless: true }, launcher: 'codex-headless',
  lifecycle: 'awaiting', proposal: null, merges: 0, note: '分析完成', status: 'asking', liveness: 'offline', archived: false, closedAt: null,
  archiveHazard: null, prompt: PROMPT, promptPreview: null, created: iso(-300_000), activity: null, sortKey: '', files: [], web: [],
}], nodes: [], edges: [] }
// the reported shape: the prompt (sent), a queued row, then the agent works, then it declares — the queued row
// is the non-quote item that used to sit between the quote and the seam and break the opener lookup
const timeline = { events: [
  // the launch prompt is the record's detail.prompt (drawn once at the top), NOT a sent event; then the
  // reported non-quote row (queued) sits between it and the working seam — the shape that broke the old opener
  { kind: 'status', ts: iso(-199_000), status: 'queued', display: 'queued', note: 'queued' },
  { kind: 'status', ts: iso(-198_000), status: 'active', display: 'working', note: null },
  { kind: 'status', ts: iso(-30_000), status: 'asking', display: 'asking', note: '分析完成' },
] }
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 })
try {
  await context.addInitScript(() => localStorage.setItem('spexcode.session-surface.v1.root', JSON.stringify({ defaultSurface: 'conversation', sessions: {} })))
  const page = await context.newPage()
  const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(e.message + ' @ ' + (e.stack||'').split('\n').slice(1,3).join(' | ')))
  const json = (body, status = 200) => (route) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  const seamFrom = Date.parse(iso(-198_000))
  // the transcript for the working interval: its FIRST turn is the launch prompt (codex records it), then work
  const transcript = { from: seamFrom, to: seamFrom + 168_000, truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0, turns: [
    { id: 'u1', at: seamFrom + 100, role: 'user', text: PROMPT },
    { id: 'a1', at: seamFrom + 2000, role: 'assistant', text: '可行。核心是把 harness adapter、transcript reader、terminal/conversation UI 三块的边界理清。', tools: [
      { id: 't1', name: 'Read', input: '{"file_path":"spec-cli/src/harness.ts"}', output: null, outputLines: 40, outputBytes: 1200 },
      { id: 't2', name: 'Grep', input: '{"pattern":"transcript"}', output: null, outputLines: 12, outputBytes: 300 },
    ] },
    { id: 'a2', at: seamFrom + 160_000, role: 'assistant', text: '结论：可行，建议从抽出 transcript-reader 的独立包边界入手。' },
  ] }
  await page.route('**/api/**', json({}, 404))
  await page.route('**/api/graph*', json(board))
  await page.route('**/api/settings*', json({ launchers: [], default: null }))
  await page.route(`**/api/sessions/${SID}`, json({ ...board.sessions[0] }))
  await page.route(`**/api/sessions/${SID}/timeline*`, json(timeline))
  await page.route(`**/api/sessions/${SID}/transcript?*`, json(transcript))
  await page.goto(`${BASE}/#/sessions/${encodeURIComponent(SID)}?surface=conversation`, { waitUntil: 'domcontentloaded' })
  const seam = page.locator('.m-ev-seam').last()
  await seam.locator('.m-seam-row').waitFor({ state: 'visible', timeout: 30_000 })
  // the record shows the prompt exactly once, as the sent quote above the seam
  const outerQuotes = await page.locator('.tl-chat .m-quote .m-ev-text').allTextContents()
  const promptCopies = outerQuotes.filter((t) => t.includes('harness adapter')).length
  await seam.locator('.m-seam-row').click()
  await seam.locator('.m-seam-inset').waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(200)
  const asksInside = await seam.locator('.m-seam-inset .tc-ask').count()
  const promptInsideSeam = await seam.locator('.m-seam-inset').evaluate((el, needle) => (el.textContent || '').split(needle).length - 1, 'harness adapter，从而让我的另一个项目')
  await page.screenshot({ path: `${OUT}/transcript-dedup-${TAG}.png`, fullPage: true })
  console.log(`[${TAG}] prompt copies in record quotes: ${promptCopies}`)
  console.log(`[${TAG}] user turns drawn inside expanded seam (.tc-ask): ${asksInside}`)
  console.log(`[${TAG}] prompt sentence occurrences inside seam DOM: ${promptInsideSeam}`)
  console.log(`[${TAG}] page errors: ${JSON.stringify(pageErrors)}`)
  if (TAG === 'after') {
    assert.equal(asksInside, 0, 'AFTER: the prompt is not re-drawn inside the seam')
    assert.equal(promptInsideSeam, 0, 'AFTER: the prompt sentence appears zero times inside the seam DOM')
    assert.equal(promptCopies, 1, 'AFTER: the record still shows the prompt exactly once, as the quote')
    const relevant = pageErrors.filter((e) => !e.includes('getComputedStyle'))
    assert.deepEqual(relevant, [], 'no conversation-side page errors')
    console.log('PASS after')
  }
} finally { await browser.close() }
