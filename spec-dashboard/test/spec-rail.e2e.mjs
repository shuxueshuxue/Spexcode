import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import net from 'node:net'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const dashboardRoot = join(root, 'spec-dashboard')
const dependencyRoot = resolve(root, '..', '..')
const vitePath = join(existsSync(join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')) ? root : dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/spec-rail-e2e')
const freePort = () => new Promise((done, fail) => {
  const server = net.createServer()
  server.once('error', fail)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => done(port))
  })
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const port = await freePort()
const base = `http://127.0.0.1:${port}`
const { createServer } = await import(pathToFileURL(vitePath).href)
const { chromium } = await import(pathToFileURL(playwrightPath).href)
const vite = await createServer({ root: dashboardRoot, configFile: join(dashboardRoot, 'cvid.vite.config.mjs'), server: { host: '127.0.0.1', port, strictPort: true } })
await vite.listen()
const browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(String(error)))
page.on('console', (message) => {
  if (message.type() === 'error' && !message.text().includes('responded with a status of 404')) errors.push(message.text())
})
const node = { id: 'root', title: 'Root spec', status: 'active', parent: null, body: '# Root spec\n\nReadable prose.', code: ['src/app.js'] }
const board = { nodes: [node], sessions: [], issuesStamp: null }
try {
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === '/api/graph') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) })
    if (pathname === '/api/specs/root/content') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ body: node.body, parts: null }) })
    if (pathname === '/api/source') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ size: 18, offset: 0, bytes: 18, text: 'export const app = 1', eof: true }) })
    if (pathname === '/api/projects') return route.fulfill({ status: 404, body: 'not found' })
    if (pathname.endsWith('/stream')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: board\ndata: {}\n\n' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
  })
  await page.addInitScript(() => {
    localStorage.removeItem('spexcode.tabs')
    localStorage.setItem('spexcode.dock', '1')
    localStorage.setItem('spexcode.dockMode', 'explorer')
  })
  await page.goto(`${base}/#/spec`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'attached', timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}\nbody=${await page.locator('body').innerText()}\nerrors=${errors.join(' | ')}`)
  })
  await page.locator('.side-rail').waitFor()
  await page.locator('.viewhost.view-spec .graphview').waitFor({ state: 'visible' })
  const spec = await page.evaluate(() => ({
    hash: location.hash,
    rail: [...document.querySelectorAll('.side-rail a.rail-btn')].map((link) => ({ href: link.getAttribute('href'), selected: link.getAttribute('aria-current') === 'page' })),
    sections: [...document.querySelectorAll('.ft-section-name')].map((node) => node.textContent.trim()),
  }))
  assert.equal(spec.hash, '#/spec')
  assert.deepEqual(spec.rail, [
    { href: '#/spec', selected: true },
    { href: '#/sessions', selected: false },
    { href: '#/evals', selected: false },
    { href: '#/issues', selected: false },
    { href: '#/settings', selected: false },
  ])
  assert.deepEqual(spec.sections, ['Specs', 'Files'])
  await page.screenshot({ path: join(out, 'spec-rail-dock.png'), fullPage: true })

  await page.goto(`${base}/#/file/src/app.js`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-file .cm-editor').waitFor({ state: 'visible' })
  const file = await page.evaluate(() => ({
    hash: location.hash,
    selected: document.querySelector('.side-rail a[href="#/spec"]')?.getAttribute('aria-current') === 'page',
    sections: [...document.querySelectorAll('.ft-section-name')].map((node) => node.textContent.trim()),
  }))
  assert.equal(file.hash, '#/file/src/app.js')
  assert.equal(file.selected, true)
  assert.deepEqual(file.sections, ['Specs', 'Files'])
  await page.locator('.ft-graph-entry').click()
  await page.waitForFunction(() => location.hash === '#/spec')
  await page.locator('.viewhost.view-spec .graphview').waitFor({ state: 'visible' })
  assert.equal(await page.evaluate(() => location.hash), '#/spec', 'fixed Spec graph door returns to the bare graph address')
  await page.screenshot({ path: join(out, 'spec-file-selected.png'), fullPage: true })

  await page.goto(`${base}/#/issues`, { waitUntil: 'domcontentloaded' })
  await page.locator('.viewhost.view-issues').waitFor({ state: 'visible' })
  // Issues keeps the rail (the top-level board switch is on every route) with Issues selected, but mounts
  // no Explorer dock and therefore no fold control ([[side-nav]])
  const issues = await page.evaluate(() => ({
    hash: location.hash,
    rails: document.querySelectorAll('.side-rail').length,
    selected: document.querySelector('.side-rail a[href="#/issues"]')?.getAttribute('aria-current') === 'page',
    toggles: document.querySelectorAll('.rail-panel-toggle').length,
    docks: document.querySelectorAll('.filetree').length,
  }))
  assert.deepEqual(issues, { hash: '#/issues', rails: 1, selected: true, toggles: 0, docks: 0 })
  assert.equal(errors.length, 0, `browser errors: ${errors.join(' | ')}`)
  await page.screenshot({ path: join(out, 'issues-rail-no-dock.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, spec, file, issues, screenshots: [join(out, 'spec-rail-dock.png'), join(out, 'spec-file-selected.png'), join(out, 'issues-rail-no-dock.png')] }))
} finally {
  await page.close()
  await browser.close()
  await vite.close()
}
