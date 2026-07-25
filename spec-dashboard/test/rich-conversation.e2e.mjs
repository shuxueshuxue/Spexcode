import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5198'
const OUT = process.env.OUT || '/tmp/rich-conversation-e2e'
mkdirSync(OUT, { recursive: true })

const board = await fetch(`${BASE}/api/graph`).then((response) => response.json())
const session = board.sessions.find((candidate) => candidate.capabilities?.headless)
if (!session) throw new Error('a real headless session row is required')

const rich = [
  '# Derivation',
  '',
  '**Result:** ~~old~~ current with [safe link](https://example.com).',
  '',
  '- first item',
  '- second item',
  '',
  '| quantity | value |',
  '| --- | ---: |',
  `| ${'wide-column-'.repeat(20)} | 42 |`,
  '',
  'Inline math $E = mc^2$ and bracket math \\(a+b\\).',
  '',
  `$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2} ${'+ x'.repeat(80)}$$`,
  '',
  '```js',
  `const unbroken = '${'x'.repeat(500)}'`,
  '```',
  '',
  '<img src=x onerror="window.__richPwned=1">',
  '[unsafe](javascript:window.__richPwned=1)',
  '![Rendered Markdown image](https://example.test/render.svg "remote image")',
  '$\\definitelyNotACommand{$',
  '',
  'plain-' + 'z'.repeat(600),
].join('\n')

const timeline = {
  events: [
    { kind: 'sent', ts: Date.now() - 2000, text: rich, from: null, replyVia: 'note' },
    { kind: 'status', ts: Date.now() - 1000, status: 'asking', display: 'asking', proposal: null, note: rich },
  ],
}

const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const results = []

try {
  for (const [name, viewport] of [['desktop', { width: 1280, height: 800 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport })
    await context.addInitScript(() => {
      window.__richPwned = 0
      window.EventSource = class FixtureEventSource {
        constructor() { throw new Error('fixture disables board SSE') }
      }
    })
    const page = await context.newPage()
    const remoteImageRequests = []
    page.on('request', (request) => {
      if (request.url() === 'https://example.test/render.svg') remoteImageRequests.push(request.url())
    })
    await page.route('https://example.test/render.svg', (route) => route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240" viewBox="0 0 640 240"><rect width="640" height="240" fill="#262626"/><rect x="12" y="12" width="616" height="216" rx="4" fill="#363636" stroke="#6c99bb"/><text x="320" y="128" fill="#ededed" font-family="monospace" font-size="30" text-anchor="middle">Markdown image</text></svg>',
    }))
    await page.route('**/api/graph*', async (route) => {
      const graph = structuredClone(board)
      const row = graph.sessions.find((candidate) => candidate.id === session.id)
      row.status = 'asking'
      row.lifecycle = 'asking'
      row.liveness = 'online'
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
    })
    await page.route(`**/api/sessions/${session.id}/timeline*`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(timeline),
    }))
    await page.route(`**/api/sessions/${session.id}`, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...session, prompt: rich }),
    }))

    await page.goto(`${BASE}/#/sessions/${session.id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30000 })
    await page.locator('.katex:visible').first().waitFor({ state: 'visible', timeout: 30000 })
    await page.evaluate(() => document.fonts.ready)

    const composer = page.locator('.m-input:visible')
    const selectionTarget = page.locator('.m-ev-note .rich-text p').last()
    await selectionTarget.scrollIntoViewIfNeeded()
    await composer.focus()
    const targetBox = await selectionTarget.boundingBox()
    assert.ok(targetBox, `${name}: selection target is visible`)
    const y = targetBox.y + Math.min(10, targetBox.height / 2)
    await page.mouse.move(targetBox.x + 6, y)
    await page.mouse.down()
    await page.mouse.move(Math.min(targetBox.x + 120, targetBox.x + targetBox.width - 6), y, { steps: 4 })
    await page.mouse.up()

    const selection = await page.evaluate(() => {
      const highlight = CSS.highlights?.get('timeline-sel')
      return {
        composerFocused: document.activeElement?.classList.contains('m-input'),
        text: highlight ? [...highlight].map((range) => range.toString()).join('') : '',
      }
    })
    assert.equal(selection.composerFocused, true, `${name}: selecting rich text preserves the composer focus sink`)
    assert.ok(selection.text.length > 0, `${name}: rich text remains selectable`)
    await page.keyboard.press('Escape')

    const probe = await page.evaluate(() => {
      const rect = (element) => {
        const box = element.getBoundingClientRect()
        return { left: box.left, right: box.right, width: box.width }
      }
      const timelineElement = [...document.querySelectorAll('.m-timeline')]
        .find((element) => element.getClientRects().length)
      const richElements = [...document.querySelectorAll('.rich-text')].filter((element) => element.getClientRects().length)
      const images = [...document.querySelectorAll('.rich-text img')]
      const bounded = richElements.every((element) => {
        const box = element.getBoundingClientRect()
        const host = element.closest('.m-ev-note, .m-ev-text').getBoundingClientRect()
        return box.left >= host.left - 1 && box.right <= host.right + 1
      })
      const localScrollers = [...document.querySelectorAll('.rich-text pre, .rich-text table, .rich-text .katex-block, .rich-text .katex-display')]
      return {
        pwned: window.__richPwned,
        richCount: richElements.length,
        headings: document.querySelectorAll('.rich-text h1').length,
        tables: document.querySelectorAll('.rich-text table').length,
        codeBlocks: document.querySelectorAll('.rich-text pre code').length,
        inlineMath: document.querySelectorAll('.rich-text .katex').length,
        displayMath: document.querySelectorAll('.rich-text .katex-block, .rich-text .katex-display').length,
        mathFont: getComputedStyle(document.querySelector('.rich-text .katex .mord')).fontFamily,
        rawHtmlReadable: document.querySelector('.m-timeline').innerText.includes('<img src=x onerror='),
        invalidMathReadable: document.querySelector('.m-timeline').innerText.includes('definitelyNotACommand'),
        unsafeAnchors: document.querySelectorAll('.rich-text a[href^="javascript:"], .rich-text a[href^="data:"], .rich-text a[href^="file:"]').length,
        images: images.length,
        imagesLoaded: images.every((element) => element.complete && element.naturalWidth > 0),
        imagesBounded: images.every((element) => element.getBoundingClientRect().width <= element.closest('.rich-text').getBoundingClientRect().width + 1),
        bounded,
        viewport: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
        timeline: { ...rect(timelineElement), clientWidth: timelineElement.clientWidth, scrollWidth: timelineElement.scrollWidth },
        localOverflow: localScrollers.some((element) => element.scrollWidth > element.clientWidth),
        fontRequests: performance.getEntriesByType('resource').map((entry) => entry.name).filter((url) => /KaTeX_.*\.(?:woff2?|ttf)/.test(url)),
      }
    })

    assert.ok(probe.richCount >= 2, `${name}: all timeline prose uses RichText`)
    assert.ok(probe.headings >= 2 && probe.tables >= 2 && probe.codeBlocks >= 2, `${name}: Markdown structure rendered`)
    assert.ok(probe.inlineMath >= 4 && probe.displayMath >= 2, `${name}: math rendered`)
    assert.match(probe.mathFont, /KaTeX_/)
    assert.equal(probe.pwned, 0)
    assert.equal(probe.unsafeAnchors, 0)
    assert.ok(probe.images >= 2, `${name}: Markdown images render`)
    assert.equal(probe.imagesLoaded, true)
    assert.equal(probe.imagesBounded, true)
    assert.ok(remoteImageRequests.length >= 1, `${name}: remote Markdown image loads`)
    assert.equal(probe.rawHtmlReadable, true)
    assert.equal(probe.invalidMathReadable, true)
    assert.equal(probe.bounded, true)
    assert.equal(probe.viewport.scrollWidth, probe.viewport.clientWidth)
    assert.ok(probe.timeline.scrollWidth <= probe.timeline.clientWidth + 1)
    assert.equal(probe.localOverflow, true)
    assert.ok(probe.fontRequests.length > 0)
    assert.ok(probe.fontRequests.every((url) => url.endsWith('.woff2')), `${name}: browser should choose only WOFF2 fonts`)

    await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true })
    results.push({ name, viewport, remoteImageRequests, ...probe })
    await context.close()
  }
} finally {
  await browser.close()
}

writeFileSync(join(OUT, 'result.json'), JSON.stringify({ base: BASE, session: session.id, results }, null, 2))
console.log(JSON.stringify({ pass: true, out: OUT, session: session.id, results }, null, 2))
