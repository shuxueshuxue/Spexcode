// Prompt 1.4 YATU acceptance: the same authored Markdown renders through the shared Prose boundary on
// Issues detail and Spec detail. This fixture is browser-isolated; no shared backend or fixed port is used.
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const CHROMIUM = process.env.CHROMIUM || '/snap/bin/chromium'
const root = resolve(new URL('../..', import.meta.url).pathname)
const viteEntry = resolve(root, 'node_modules/vite/dist/node/index.js')
const OUT = resolve(process.env.OUT || '/tmp/prose-issues-spec-e2e')
const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})
const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((done) => setTimeout(done, 80))
  }
  throw new Error(`timed out waiting for ${label}`)
}

if (!root || !PW || !CHROMIUM) throw new Error('browser fixture paths are required')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const issueId = `prose-acceptance-${process.pid}`
const nodeId = 'prose-renderer'
const body = [
  '# Fixture title',
  '',
  '## Section heading',
  '',
  'Paragraph with [a live link](https://example.com), `inline code`, $x^2$, and \\(a+b\\).',
  '',
  '> A quoted paragraph',
  '> with a second line',
  '',
  '| Name | Value |',
  '| --- | --- |',
  '| alpha | 1 |',
  '| beta | 2 |',
  '',
  '- unordered item',
  '- another item',
  '',
  '1. ordered item',
  '2. second ordered item',
  '',
  '```js',
  'const fixture = true',
  '```',
  '',
  '$$\\int_0^1 x^2 dx$$',
].join('\n')
const issue = {
  id: issueId, concern: 'Rich prose acceptance', body, status: 'open', store: 'local', by: null,
  created: new Date().toISOString(), labels: [], nodes: [nodeId], replies: [], url: null,
}
const graph = {
  nodes: [{ id: nodeId, title: 'Prose renderer', desc: 'Shared Markdown renderer', status: 'active', version: 1,
    parent: null, path: '.spec/spexcode/spec-dashboard/dashboard-ui/ui-primitives/prose-renderer/spec.md',
    body, parts: null, code: ['spec-dashboard/src/Prose.js'] }],
  sessions: [], issues: [], issuesStamp: 'prose-acceptance', edges: [],
}
const review = {
  enabled: true, items: [issue], counts: { open: 1, closed: 0 }, page: 1, pageCount: 1,
  prev: null, next: null, sourceTotal: 1, stores: [{ id: 'local', label: 'local', kind: 'local' }],
  facets: { store: { options: [{ value: 'local' }] }, session: { options: [] }, author: { options: [] }, node: { options: [{ value: nodeId }] }, label: { options: [] } },
}

const { preview } = await import(pathToFileURL(viteEntry).href)
const port = await freePort()
const base = `http://127.0.0.1:${port}/p/fixture`
const ui = await preview({ root: resolve(root, 'spec-dashboard'), configFile: false, preview: { host: '127.0.0.1', port, strictPort: true } })
const { chromium } = await import(pathToFileURL(PW).href)
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
const page = await context.newPage()
const errors = []
const failedResponses = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error}`))
page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('/projects')) errors.push(`console: ${message.text()}`) })
page.on('response', (response) => { if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() }) })
// A pre-hub server answers this path as absent; the dashboard then stays on the scoped board surface.
await page.route('**/projects', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ adminGated: false, projects: [{ id: 'fixture', root: process.cwd(), online: true, identity: { title: 'Fixture', icon: 'gateway' } }] }) }))
await page.route('**/p/fixture/api/**', async (route) => {
  const { pathname: rawPath } = new URL(route.request().url())
  const pathname = rawPath.replace(/^\/p\/fixture/, '')
  if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) })
  if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
  if (pathname === '/api/issues') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(review) })
  if (pathname === `/api/issues/${issueId}`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(issue) })
  if (pathname === `/api/specs/${nodeId}/content`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body, parts: null }) })
  if (pathname === `/api/specs/${nodeId}/files`) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ files: [] }) })
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
})
await page.route('https://example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>fixture link</title>' }))

const readProse = async (locator, label, { expectStamps = false } = {}) => {
  await locator.waitFor({ state: 'visible', timeout: 30_000 })
  const result = await locator.evaluate((root) => {
    const text = root.textContent || ''
    const selection = document.createRange()
    const paragraph = root.querySelector('p')
    if (!paragraph?.firstChild) throw new Error('prose paragraph has no selectable text')
    selection.selectNodeContents(paragraph)
    const browserSelection = window.getSelection()
    browserSelection.removeAllRanges(); browserSelection.addRange(selection)
    return {
      text,
      headings: [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((el) => el.tagName),
      paragraphs: root.querySelectorAll('p').length,
      tables: root.querySelectorAll('table').length,
      links: [...root.querySelectorAll('a')].map((el) => el.getAttribute('href')),
      code: [...root.querySelectorAll('code')].map((el) => el.textContent),
      math: root.querySelectorAll('.doc-math, .doc-math-block, .katex').length,
      lists: { ul: root.querySelectorAll('ul').length, ol: root.querySelectorAll('ol').length },
      selection: browserSelection.toString(),
      stamps: root.querySelectorAll('[data-l0]').length,
    }
  })
  assert.deepEqual(result.headings, ['H2'], `${label}: heading hierarchy survives title stripping`)
  assert.ok(result.paragraphs >= 1, `${label}: paragraph renders`) 
  assert.equal(result.tables, 1, `${label}: table renders`) 
  assert.ok(result.links.includes('https://example.com'), `${label}: link is live`)
  assert.ok(result.code.some((value) => value.includes('inline code')) && result.code.some((value) => value.includes('const fixture = true')), `${label}: inline/fenced code renders`)
  assert.ok(result.math >= 3, `${label}: inline, bracket, and display math render`)
  assert.deepEqual(result.lists, { ul: 1, ol: 1 }, `${label}: unordered/ordered lists render`)
  assert.match(result.selection, /Paragraph with a live link/, `${label}: prose supports browser selection`)
  if (expectStamps) assert.ok(result.stamps > 0, `${label}: source provenance stamps survive`)
  return result
}

let issueProbe, specProbe
try {
  await page.goto(`${base}/#/issues/${issueId}`, { waitUntil: 'domcontentloaded' })
  issueProbe = await readProse(page.locator('.ds-page .doc-body:visible'), 'Issues detail')
  await page.screenshot({ path: `${OUT}/issues.png`, fullPage: true })
  await page.goto(`${base}/#/spec/${nodeId}`, { waitUntil: 'domcontentloaded' })
  specProbe = await readProse(page.locator('.pane-doc .doc-body:visible'), 'Spec detail', { expectStamps: true })
  await page.screenshot({ path: `${OUT}/spec.png`, fullPage: true })
  assert.deepEqual(errors, [], `browser errors: ${errors.join(' | ')}`)
  assert.deepEqual(failedResponses, [], `failed responses: ${JSON.stringify(failedResponses)}`)
  const result = { pass: true, routes: [`#/issues/${issueId}`, `#/spec/${nodeId}`], issueProbe, specProbe, errors, failedResponses, out: OUT }
  writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await context.close(); await browser.close(); await ui.close()
}
