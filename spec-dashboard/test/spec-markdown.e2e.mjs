import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5198'
const UPSTREAM = process.env.UPSTREAM_URL || 'http://127.0.0.1:5173'
const OUT = process.env.OUT || '/tmp/spec-markdown-e2e'
mkdirSync(OUT, { recursive: true })

const board = await fetch(`${UPSTREAM}/api/graph`).then((response) => response.json())
const node = board.nodes.find((candidate) => candidate.id === 'prose-renderer') || board.nodes.find((candidate) => candidate.id)
if (!node) throw new Error('a fixture spec node is required')
const body = [
  '# Fixture title',
  '',
  '## Section heading',
  '',
  '### Nested heading',
  '',
  '> Quoted line',
  '> second line',
  '',
  '[Guide](https://example.com) and $E = mc^2$ plus \\(a+b\\).',
  '',
  '![Diagram](https://example.test/diagram.svg "fixture image")',
  '',
  '$$\\int_0^1 x^2 dx$$',
].join('\n')

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const results = []
try {
  // Spec documents are a desktop workspace surface; phone width mounts MobileApp and intentionally has no
  // spec route. The second viewport still exercises a narrow desktop document without the phone remount.
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['narrow', { width: 900, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    await page.route('**/api/graph*', async (route) => {
      const graph = structuredClone(board)
      const target = graph.nodes.find((candidate) => candidate.id === node.id)
      target.body = body
      target.parts = null
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
    })
    await page.route('**/api/specs/*/content', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ body, parts: null }),
    }))
    await page.route('https://example.test/diagram.svg', (route) => route.fulfill({
      status: 200, contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="180"><rect width="640" height="180" fill="#363636"/><text x="320" y="100" text-anchor="middle" fill="#ededed">Fixture diagram</text></svg>',
    }))
    await page.goto(`${BASE}/#/spec/${encodeURIComponent(node.id)}`, { waitUntil: 'domcontentloaded' })
    const bodyLocator = page.locator('.doc-body:visible')
    await bodyLocator.waitFor({ state: 'visible', timeout: 30_000 })
    await bodyLocator.locator('h2').waitFor({ state: 'visible' })
    await bodyLocator.locator('.doc-image').waitFor({ state: 'visible' })
    await page.evaluate(() => document.fonts.ready)
    const probe = await page.evaluate(() => {
      const root = document.querySelector('.doc-body')
      const rect = (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect()
        return box ? { left: box.left, right: box.right, top: box.top, bottom: box.bottom } : null
      }
      return {
        headings: [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => el.tagName),
        quote: root.querySelector('.doc-quote')?.innerText || '',
        link: root.querySelector('.doc-external')?.getAttribute('href') || null,
        image: { src: root.querySelector('.doc-image')?.getAttribute('src') || null, loaded: root.querySelector('.doc-image')?.complete && root.querySelector('.doc-image')?.naturalWidth > 0 },
        math: root.querySelectorAll('.doc-math, .doc-math-block').length,
        stamps: [...root.querySelectorAll('[data-l0]')].map((el) => [el.tagName, el.dataset.l0, el.dataset.l1]),
        viewport: { width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        boxes: { quote: rect('.doc-quote'), image: rect('.doc-image') },
      }
    })
    assert.deepEqual(probe.headings, ['H2', 'H3'], `${name}: heading levels survive`)
    assert.equal(probe.quote, 'Quoted line\nsecond line', `${name}: blockquote survives`)
    assert.equal(probe.link, 'https://example.com', `${name}: link is live`)
    assert.equal(probe.image.loaded, true, `${name}: image decodes`)
    assert.equal(probe.math, 3, `${name}: dollar, bracket, and display math render`)
    assert.ok(probe.stamps.some((stamp) => stamp[0] === 'H2'), `${name}: heading carries provenance`)
    assert.ok(probe.stamps.some((stamp) => stamp[0] === 'BLOCKQUOTE'), `${name}: quote carries provenance`)
    assert.equal(probe.viewport.scrollWidth, probe.viewport.width, `${name}: prose does not widen viewport`)
    results.push({ name, viewport, probe })
    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
    await context.close()
  }
} finally {
  await browser.close()
}
const report = { pass: true, out: OUT, results }
writeFileSync(join(OUT, 'result.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
