import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { extname, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(new URL('../dist-public/', import.meta.url).pathname)
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || process.env.CHROMIUM || '/snap/bin/chromium'
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.zip': 'application/zip', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(readFileSync(join(root, 'public-spec-release.json'), 'utf8'))
assert.equal(manifest.schema, 'spexcode.public-spec-release/v1')
assert.equal(manifest.graph.path, 'public-graph.json')
assert.equal(manifest.graph.sha256, sha256(readFileSync(join(root, manifest.graph.path))))
assert.equal(manifest.publication.hostname, 'spexcode.spexcode.net')
assert.equal(manifest.metadata.path, 'public-graph-meta.json')
assert.equal(manifest.metadata.sha256, sha256(readFileSync(join(root, manifest.metadata.path))))
assert.equal(manifest.archive.path, 'spexcode.spec.zip')
assert.equal(manifest.archive.sha256, sha256(readFileSync(join(root, manifest.archive.path))))
const metadata = JSON.parse(readFileSync(join(root, manifest.metadata.path), 'utf8'))
assert.equal(metadata.schema, 'spexcode.public-spec-site/v1')
assert.equal(metadata.publication.hostname, manifest.publication.hostname)
assert.equal(metadata.release.archive.sha256, manifest.archive.sha256)
assert.equal(metadata.release.revision, manifest.revision)
const zipContents = spawnSync('unzip', ['-Z1', join(root, manifest.archive.path)], { encoding: 'utf8' })
assert.equal(zipContents.status, 0, zipContents.stderr)
assert.ok(zipContents.stdout.includes('.spec/spec-cli/public-mode/public-spec-graph/spec.md'))
assert.equal(zipContents.stdout.includes('.spec/.issues/'), false)
assert.equal(manifest.documents.length, JSON.parse(readFileSync(join(root, manifest.graph.path), 'utf8')).nodes.length)
for (const asset of manifest.documents) {
  const bytes = readFileSync(join(root, asset.path))
  assert.equal(asset.bytes, bytes.byteLength)
  assert.equal(asset.sha256, sha256(bytes))
}

const server = createServer((request, response) => {
  const raw = new URL(request.url || '/', 'http://static.test').pathname
  if (raw.startsWith('/api/')) { response.writeHead(404); response.end('no public API'); return }
  const file = normalize(join(root, raw === '/' ? 'index.html' : raw))
  if (!file.startsWith(root)) { response.writeHead(400); response.end('invalid path'); return }
  try {
    response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' })
    response.end(readFileSync(file))
  } catch {
    response.writeHead(404); response.end('not found')
  }
})

const address = await new Promise((resolveAddress, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => resolveAddress(server.address()))
})
const base = `http://127.0.0.1:${address.port}`
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox', '--no-proxy-server'] })

try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const requests = []
  const errors = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(String(error)))

  await page.goto(`${base}/#/issues`, { waitUntil: 'domcontentloaded' })
  try {
    await page.waitForSelector('.react-flow', { state: 'visible', timeout: 30_000 })
  } catch (error) {
    throw new Error(`public graph did not render: ${await page.locator('body').innerText()}\n${errors.join('\n')}\n${requests.join('\n')}`, { cause: error })
  }
  await page.waitForFunction(() => location.hash === '#/graph')

  assert.equal(await page.locator('.side-rail a[href="#/graph"]').count(), 1)
  assert.equal(await page.locator('.side-rail .rail-btn.disabled[aria-disabled="true"]').count(), 4)
  await page.locator('.react-flow__node').first().dblclick()
  await page.waitForSelector('.ov-panel .pane-doc', { state: 'visible', timeout: 10_000 })
  await page.waitForFunction(() => {
    const body = document.querySelector('.ov-panel .pane-doc .doc-body')
    return Boolean(body?.textContent?.trim())
  }, undefined, { timeout: 10_000 })
  await page.keyboard.press('Escape')
  await page.waitForSelector('.ov-backdrop', { state: 'hidden', timeout: 10_000 })
  await page.getByRole('button', { name: 'About this public graph' }).click()
  await page.waitForSelector('.public-about', { state: 'visible', timeout: 10_000 })
  await page.waitForFunction(() => Boolean(document.querySelector('.public-about-actions')))
  assert.equal(await page.locator('.public-about-link').first().getAttribute('href'), 'https://github.com/shuxueshuxue/spexcode')
  assert.equal(await page.locator('.public-about-link.primary').getAttribute('href'), '/spexcode.spec.zip')
  assert.equal(await page.locator('.public-about-link.primary').getAttribute('download'), 'spexcode.spec.zip')
  assert.equal(requests.filter((url) => new URL(url).pathname === '/public-graph.json').length, 1)
  assert.equal(requests.filter((url) => new URL(url).pathname === '/public-graph-meta.json').length, 1)
  assert.ok(requests.some((url) => new URL(url).pathname.startsWith('/specs/')))
  assert.equal(requests.some((url) => /(?:SessionInterface|IssuesPage|EvalsPage|Settings|MobileApp|ProjectsPage)-/.test(url)), false)
  assert.equal(requests.some((url) => new URL(url).pathname.startsWith('/api/')), false, requests.join('\n'))
  assert.deepEqual(errors, [])
  await page.screenshot({ path: process.env.PUBLIC_GRAPH_SCREENSHOT || '/tmp/public-graph-static.png', fullPage: true })
  await context.close()
  console.log('PASS static public graph: rendered one graph page with no API transport and four inert rail entries')
} finally {
  await browser.close()
  await new Promise((resolveClose) => server.close(resolveClose))
}
