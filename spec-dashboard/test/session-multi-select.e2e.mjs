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
const targetId = 'select-mode-target'
const events = []
let videoStartedAt = 0
const step = (label) => events.push({ at: Date.now() - videoStartedAt, step: label })

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
let page
let videoPath = null

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

  for (const [id, parent] of [[parentId, ''], [childId, parentId], [targetId, '']]) {
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
  assert.deepEqual(graph.sessions.map((session) => session.id).sort(), [childId, parentId, targetId])

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 900, height: 720 }, recordVideo: { dir: out, size: { width: 900, height: 720 } } })
  videoStartedAt = Date.now()
  await context.addInitScript(() => {
    window.EventSource = class DisabledEventSource { constructor() { throw new Error('fixture disables SSE') } }
  })
  page = await context.newPage()
  let archiveRequests = 0
  let closeRequests = 0
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/sessions\/[^/]+\/archive$/.test(new URL(request.url()).pathname)) archiveRequests++
    if (request.method() === 'POST' && /\/api\/sessions\/[^/]+\/close$/.test(new URL(request.url()).pathname)) closeRequests++
  })
  await page.route('**/api/graph*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(graph) }))
  await page.route('**/api/sessions/*/archive', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
  await page.route('**/api/sessions/*/close', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
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
  step('enter multi-select')
  const archiveButton = page.getByRole('button', { name: /^archive$/i })
  const closeButton = page.getByRole('button', { name: /^close$/i })
  assert.equal(await treeRow.locator('> .si-drag-handle').count(), 0, 'the whole row, not a grip, is draggable')
  assert.equal(await archiveButton.textContent(), '')
  assert.equal(await closeButton.textContent(), '')
  const after = { checkbox: await row.locator('.si-check').boundingBox(), count: await count.boundingBox(), headline: await headline.boundingBox() }
  assert.ok(before.count && before.headline && after.checkbox && after.count && after.headline)
  const countShift = after.count.x - before.count.x
  const headlineShift = after.headline.x - before.headline.x
  assert.ok(headlineShift > 0, 'checkbox shifts the row face right')
  assert.ok(Math.abs(countShift - headlineShift) < 0.5, 'nested count stays aligned with the shifted row face')
  assert.ok(after.checkbox.x + after.checkbox.width <= after.count.x, 'checkbox and nested-session count do not overlap')
  await page.screenshot({ path: `${out}/select-mode-entered.png` })

  await count.click()
  const targetRow = page.locator(`.si-item[data-sid="${targetId}"]`)
  await targetRow.waitFor({ state: 'visible' })
  await page.route('**/api/sessions/reparent', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ children: [parentId], parent: targetId, notified: [parentId] }),
  }))
  const reparentRequest = page.waitForRequest((request) => request.url().endsWith('/api/sessions/reparent') && request.method() === 'POST')
  const sourceBox = await row.boundingBox()
  const targetBox = await targetRow.boundingBox()
  assert.ok(sourceBox && targetBox, 'source and target rows are rendered')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + sourceBox.height / 2)
  const ghost = page.locator('.si-session-drag-ghost')
  await ghost.waitFor({ state: 'visible' })
  assert.ok(await row.evaluate((element) => element.parentElement.classList.contains('dragging')), 'the whole source row dims while it is dragged')
  assert.equal(await ghost.locator('.sess-id').textContent(), await row.locator('.sess-id').textContent(), 'the ghost retains the source row title')
  assert.equal(await ghost.locator('.si-check').count(), 1, 'the ghost retains the source row checkbox')
  assert.equal(await ghost.locator('.sess-fold-control').count(), 1, 'the ghost retains the source row fold pod')
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
  await page.waitForFunction((id) => document.querySelector(`[data-sid="${id}"]`)?.parentElement?.classList.contains('drop-target'), targetId)
  await page.screenshot({ path: `${out}/select-mode-whole-row-drag.png` })
  await page.mouse.up()
  assert.deepEqual((await reparentRequest).postDataJSON(), { children: [parentId], parent: targetId })
  step('whole-row reparent request sent')

  await archiveButton.click()
  const bulkArchiveConfirm = page.getByRole('dialog', { name: /archive/i })
  await bulkArchiveConfirm.waitFor({ state: 'visible' })
  const bulkArchiveCommit = bulkArchiveConfirm.locator('button.sess-rename-btn.danger')
  assert.equal(await bulkArchiveCommit.evaluate((button) => document.activeElement === button), true, 'bulk archive confirm focuses its commit button')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  assert.equal(await bulkArchiveConfirm.count(), 0, 'Enter dismisses the bulk archive confirm')
  await bulkArchiveConfirm.waitFor({ state: 'detached' })
  await archiveButton.waitFor({ state: 'detached' })
  assert.equal(archiveRequests, 1, 'Enter confirms bulk archive')
  step('Enter confirmed bulk archive')

  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: /select/i }).click()
  const bulkCloseButton = page.getByRole('button', { name: /^close$/i })
  await bulkCloseButton.click()
  const bulkCloseConfirm = page.getByRole('dialog', { name: /close/i })
  await bulkCloseConfirm.waitFor({ state: 'visible' })
  const bulkCloseCommit = bulkCloseConfirm.locator('button.sess-rename-btn.danger')
  assert.equal(await bulkCloseCommit.evaluate((button) => document.activeElement === button), true, 'bulk close confirm focuses its commit button')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  assert.equal(await bulkCloseConfirm.count(), 0, 'Enter dismisses the bulk close confirm')
  await bulkCloseConfirm.waitFor({ state: 'detached' })
  await bulkCloseButton.waitFor({ state: 'detached' })
  assert.equal(closeRequests, 1, 'Enter confirms bulk close')
  step('Enter confirmed bulk close')

  await row.click({ button: 'right' })
  const archiveItem = page.getByRole('menuitem', { name: /^archive$/i })
  assert.ok(await archiveItem.evaluate((item) => item.classList.contains('danger')))
  await archiveItem.click()
  const archiveConfirm = page.getByRole('dialog', { name: /archive/i })
  await archiveConfirm.waitFor({ state: 'visible' })
  assert.equal(archiveRequests, 1, 'row archive waits for confirmation')
  const archiveCommit = archiveConfirm.locator('button.sess-rename-btn.danger')
  assert.equal(await archiveCommit.evaluate((button) => document.activeElement === button), true, 'row archive confirm focuses its commit button')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(100)
  assert.equal(await archiveConfirm.count(), 0, 'Enter dismisses the row archive confirm')
  await archiveConfirm.waitFor({ state: 'detached' })
  assert.equal(archiveRequests, 2, 'Enter confirms archive')
  step('Enter confirmed row archive')
  await page.screenshot({ path: `${out}/select-mode-reparent.png` })
} finally {
  const video = page?.video()
  await context?.close()
  videoPath = video ? await video.path().catch(() => null) : null
  await browser?.close()
  await vite?.close()
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
  writeFileSync(`${out}/timeline.json`, JSON.stringify({ v: 2, axis: 'time', events }, null, 2) + '\n')
}

if (!existsSync(join(out, 'select-mode-reparent.png'))) throw new Error('browser proof did not render a screenshot')
if (!existsSync(join(out, 'select-mode-entered.png'))) throw new Error('browser proof did not capture multi-select mode')
if (!existsSync(join(out, 'select-mode-whole-row-drag.png'))) throw new Error('browser proof did not capture the whole-row drag state')
if (!videoPath) throw new Error('browser proof did not record a video')
console.log(JSON.stringify({ ok: true, out, video: videoPath, timeline: join(out, 'timeline.json') }))
