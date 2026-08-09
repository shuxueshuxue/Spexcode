import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const modules = join(dashboardRoot, 'node_modules')
const tsxCli = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-multi-select-e2e')
const parentId = 'select-mode-parent'
const childId = 'select-mode-child'

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label) => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await read()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 3_000))])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
const record = (id, parent = '') => ({
  session_id: id, governed: true, worktree_path: project, branch: 'main', node: 'fixture', title: id,
  name: '', parent, status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(),
  harness: 'claude', harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '',
  launcher: 'fixture', launch_cmd: 'true', launch_owner: '', create_request_id: '', create_payload_hash: '', launch_readiness_pending: null,
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-session-select-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const projectKey = project.replace(/[/.]/g, '-')
let backend
let vite
let browser
let context

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: select-mode browser fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  for (const [id, parent] of [[parentId, ''], [childId, parentId]]) {
    const dir = join(home, 'projects', projectKey, 'sessions', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify(record(id, parent), null, 2) + '\n')
  }

  const apiPort = await freePort()
  const uiPort = await freePort()
  const base = `http://127.0.0.1:${uiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_API_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot,
    configFile: false,
    plugins: [react()],
    resolve: { alias: {
      react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
      katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
      '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
    } },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } } },
  })
  await vite.listen()
  await waitFor(() => fetch(base).then((response) => response.ok).catch(() => false), 'isolated dashboard')

  const graph = await fetch(`${base}/api/graph`).then((response) => response.json())
  for (const session of graph.sessions || []) {
    session.status = 'working'
    session.lifecycle = 'active'
    session.liveness = 'online'
  }
  assert.deepEqual(graph.sessions.map((session) => session.id).sort(), [childId, parentId])

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 900, height: 720 } })
  await context.addInitScript(() => {
    window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
  })
  const page = await context.newPage()
  let archiveRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/sessions\/[^/]+\/archive$/.test(new URL(request.url()).pathname)) archiveRequests++
  })
  await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) }))
  await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })

  const treeRow = page.locator(`.si-tree-row:has(> .si-item[data-sid="${parentId}"])`)
  const row = treeRow.locator('> .si-item')
  const count = treeRow.locator('> .sess-fold-control')
  const headline = row.locator('.sess-id')
  await row.waitFor({ state: 'visible' })
  await count.waitFor({ state: 'visible' })
  const before = { count: await count.boundingBox(), headline: await headline.boundingBox() }

  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /select/i }).click()
  const dragHandle = treeRow.locator('> .si-drag-handle')
  const archiveButton = page.getByRole('button', { name: /^archive$/i })
  const closeButton = page.getByRole('button', { name: /^close$/i })
  await dragHandle.waitFor({ state: 'visible' })
  assert.equal(await dragHandle.getAttribute('draggable'), 'true')
  assert.equal(await archiveButton.textContent(), '')
  assert.equal(await closeButton.textContent(), '')
  const after = { checkbox: await row.locator('.si-check').boundingBox(), count: await count.boundingBox(), headline: await headline.boundingBox() }
  assert.ok(before.count && before.headline && after.checkbox && after.count && after.headline)
  const countShift = after.count.x - before.count.x
  const headlineShift = after.headline.x - before.headline.x
  assert.ok(headlineShift > 0, 'checkbox and drag slot shift the row face right')
  assert.ok(Math.abs(countShift - headlineShift) < 0.5, 'nested count stays aligned with the shifted row face')
  assert.ok(after.checkbox.x + after.checkbox.width <= after.count.x, 'checkbox and nested-session count do not overlap')

  await count.click()
  const childRow = page.locator(`.si-item[data-sid="${childId}"]`)
  await childRow.waitFor({ state: 'visible' })
  await page.route('**/api/sessions/reparent', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ children: [parentId], parent: childId, notified: [parentId] }),
  }))
  const reparentRequest = page.waitForRequest((request) => request.url().endsWith('/api/sessions/reparent') && request.method() === 'POST')
  await dragHandle.dragTo(childRow)
  assert.deepEqual((await reparentRequest).postDataJSON(), { children: [parentId], parent: childId })

  await page.getByRole('button', { name: /cancel/i }).click()
  await row.click({ button: 'right' })
  const archiveItem = page.getByRole('menuitem', { name: /^archive$/i })
  assert.ok(await archiveItem.evaluate((item) => item.classList.contains('danger')))
  await archiveItem.click()
  await page.getByRole('dialog', { name: /archive/i }).waitFor({ state: 'visible' })
  assert.equal(archiveRequests, 0, 'archive waits for confirmation')
  await page.screenshot({ path: `${out}/select-mode-reparent.png` })
} finally {
  await context?.close()
  await browser?.close()
  await vite?.close()
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}

if (!existsSync(join(out, 'select-mode-reparent.png'))) throw new Error('browser proof did not render a screenshot')
console.log(`session multi-select proof: ${out}`)
