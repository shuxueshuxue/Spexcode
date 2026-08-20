import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? root : sharedRoot
const tsxCli = join(dependencyRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const backendEntry = join(cliRoot, 'src', 'index.ts')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH
  || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-surface-cold-readable-e2e')

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
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

const stopChild = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((done) => setTimeout(() => done(false), 3_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'dist', 'index.html'))) throw new Error('prebuilt spec-dashboard/dist is required; run npm run build first')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-cold-readable-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-cold-readable-${process.pid}`
const events = []
const started = Date.now()
const step = (label) => events.push({ at: Date.now() - started, step: label })
let backend
let ui
let browser
let context
let page
let api
let base
let archivedId
let offlineId
let failure
let backendLog = ''

const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' })

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\n# fixture\n\nCold readable browser fixture.\n')
  writeFileSync(join(project, 'README.md'), 'cold readable fixture\n')
  writeFileSync(join(project, 'spexcode.json'), `${JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2)}\n`)
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'fixture@example.test')
  git('config', 'user.name', 'fixture')
  git('add', '.')
  git('commit', '-qm', 'seed')

  const apiPort = await freePort()
  const uiPort = await freePort()
  api = `http://127.0.0.1:${apiPort}`
  base = `http://127.0.0.1:${uiPort}`
  const env = {
    ...process.env,
    PORT: String(apiPort),
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: tmux,
    SPEXCODE_API_URL: '',
    FAKE_HARNESS_INTERVAL_MS: '80',
  }
  backend = spawn(process.execPath, [tsxCli, backendEntry], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
  backend.stdout.on('data', (chunk) => { backendLog += String(chunk) })
  backend.stderr.on('data', (chunk) => { backendLog += String(chunk) })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const { preview } = await import(pathToFileURL(viteEntry).href)
  ui = await preview({
    root: dashboardRoot,
    configFile: false,
    preview: {
      host: '127.0.0.1', port: uiPort, strictPort: true,
      proxy: { '/api': { target: api, ws: true } },
    },
  })
  await waitFor(() => fetch(base).then((response) => response.ok).catch(() => false), 'prebuilt dashboard server')
  const servedIndex = Buffer.from(await (await fetch(base)).arrayBuffer())
  assert.equal(hashBytes(servedIndex), hashBytes(readFileSync(join(dashboardRoot, 'dist', 'index.html'))), 'UI server did not serve this worktree prebuilt dist')

  const json = async (url, init) => {
    const response = await fetch(`${api}${url}`, init)
    const text = await response.text()
    let body = null
    try { body = JSON.parse(text) } catch { /* fail below with the response bytes */ }
    assert.equal(response.ok, true, `${url} failed: ${response.status} ${text}`)
    return body
  }
  const post = (url, body = {}) => json(url, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const create = async (prompt) => {
    const result = await post('/api/sessions', { prompt, launcher: 'fake' })
    assert.ok(result.id, `session creation returned no id: ${JSON.stringify(result)}`)
    await waitFor(async () => {
      const row = await json(`/api/sessions/${result.id}`)
      return row.liveness === 'online' ? row : null
    }, `${result.id} online`)
    return result.id
  }

  archivedId = await create('archived session timeline marker')
  offlineId = await create('offline session timeline marker')
  await post(`/api/sessions/${archivedId}/input`, { kind: 'text', text: 'archived authored history entry' })
  await post(`/api/sessions/${offlineId}/input`, { kind: 'text', text: 'offline authored history entry' })
  await post(`/api/sessions/${archivedId}/archive`)
  await post(`/api/sessions/${offlineId}/stop`)
  await waitFor(async () => {
    const rows = await json('/api/sessions?all=1')
    const archived = rows.find((row) => row.id === archivedId)
    const offline = rows.find((row) => row.id === offlineId)
    return archived?.archived && archived.liveness === 'offline'
      && !offline?.archived && offline?.liveness === 'offline' ? { archived, offline } : null
  }, 'real archived and offline records')
  step('real sessions prepared through create, input, archive, and stop APIs')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, locale: 'zh-CN',
    recordVideo: { dir: out, size: { width: 1280, height: 800 } },
  })
  page = await context.newPage()
  const timelineRequests = new Map()
  const pageErrors = []
  const consoleErrors = []
  const failedResponses = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() })
  })
  page.on('request', (request) => {
    if (request.method() !== 'GET') return
    const match = new URL(request.url()).pathname.match(/^\/api\/sessions\/([^/]+)\/timeline$/)
    if (!match) return
    const id = decodeURIComponent(match[1])
    timelineRequests.set(id, (timelineRequests.get(id) || 0) + 1)
  })

  const directShape = (locator) => locator.evaluate((element) => [...element.children].map((child) => ({
    tag: child.tagName,
    classes: [...child.classList].filter((name) => !/^is-(?:live|offline|archived)$/.test(name)).sort(),
  })))
  const assertSurface = async (id, state, expectedLine, expectedAction) => {
    const apiTimeline = await json(`/api/sessions/${id}/timeline`)
    assert.ok(apiTimeline.events.length > 0, `${state} control needs real timeline history`)
    const chat = page.locator('.tl-chat:visible')
    await chat.waitFor({ state: 'visible', timeout: 30_000 })
    await chat.locator('.m-empty').waitFor({ state: 'detached', timeout: 30_000 })
    assert.equal(await chat.locator('.m-ev:not(.m-ev-prompt)').count(), apiTimeline.events.length, `${state} timeline event count differs from API`)
    const renderedText = await chat.locator('.m-timeline').innerText()
    for (const entry of apiTimeline.events) {
      const text = entry.kind === 'sent' ? entry.text : entry.note
      if (text) assert.ok(renderedText.includes(text), `${state} timeline omitted ${JSON.stringify(text)}`)
    }

    const footer = chat.locator(`.m-composer[data-footer-state="${state}"]`)
    await footer.waitFor({ state: 'visible' })
    const input = footer.locator('.m-input')
    assert.equal(await input.isDisabled(), true, `${state} composer is enabled`)
    assert.equal(await input.getAttribute('data-focus-sink'), null, `${state} composer still advertises a focus sink`)
    assert.equal(await input.evaluate((element) => { element.focus(); return document.activeElement === element }), false, `${state} composer accepted focus`)
    assert.ok((await footer.locator('.m-coldline').innerText()).includes(expectedLine), `${state} coldline copy differs`)
    const restore = footer.locator('.m-coldline-action', { hasText: expectedAction })
    assert.equal(await restore.isEnabled(), true, `${state} restore action is disabled`)

    const terminal = page.locator('[data-surface-switch="terminal"]:visible')
    await terminal.waitFor({ state: 'visible' })
    assert.equal(await terminal.isDisabled(), true, `${state} terminal control is not disabled`)
    const baseLabel = page.locator('.si-base-tabs [role="tab"]:visible .si-tab-label')
    const before = await baseLabel.innerText()
    await terminal.click({ force: true })
    assert.equal(await baseLabel.innerText(), before, `${state} terminal activation changed the surface`)
    assert.equal(await chat.isVisible(), true, `${state} terminal activation hid Conversation`)
    return { chat, restore, shape: await directShape(chat), eventCount: apiTimeline.events.length }
  }

  await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
  const shelf = page.locator('.si-pill.shelf')
  await shelf.waitFor({ state: 'visible', timeout: 30_000 })
  await shelf.click()
  const archivedRow = page.locator(`.si-item[data-sid="${archivedId}"]`)
  await archivedRow.waitFor({ state: 'visible', timeout: 30_000 })
  timelineRequests.set(archivedId, 0)
  await archivedRow.click()
  const archivedSurface = await assertSurface(archivedId, 'archived', '▤ 已归档 · 内容只读', '取回')
  assert.equal(await page.locator('.si-shelf-card').count(), 0, 'archive card still replaces Conversation')
  await page.screenshot({ path: join(out, 'archived-readable.png'), fullPage: true })
  step('archived timeline readable with disabled composer and terminal control')
  await page.waitForTimeout(8_750)
  assert.equal(timelineRequests.get(archivedId), 1, 'archived selection polled immutable timeline history')
  step('archived timeline remained at one request beyond a polling interval')
  const archivedResume = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${archivedId}/resume`
    && response.request().method() === 'POST')
  await archivedSurface.restore.click()
  assert.equal((await archivedResume).ok(), true, 'archived restore did not use /resume')

  await page.goto(`${base}/#/sessions/${encodeURIComponent(offlineId)}`, { waitUntil: 'domcontentloaded' })
  const offlineSurface = await assertSurface(offlineId, 'offline', '⏻ agent 已离线 · 内容只读', '重新启动')
  assert.deepEqual(offlineSurface.shape, archivedSurface.shape, 'offline and archived do not share one Conversation/footer shell')
  await page.screenshot({ path: join(out, 'offline-readable.png'), fullPage: true })
  step('offline session uses the same shell with relaunch copy')
  const offlineResume = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${offlineId}/resume`
    && response.request().method() === 'POST')
  await offlineSurface.restore.click()
  assert.equal((await offlineResume).ok(), true, 'offline relaunch did not use /resume')
  step('both footer actions reached the real resume endpoint')

  assert.deepEqual(pageErrors, [], 'page errors')
  assert.ok(failedResponses.every((failure) => failure.status === 404 && new URL(failure.url).pathname === '/projects'),
    `unexpected failed browser responses: ${JSON.stringify(failedResponses)}`)
  assert.equal(consoleErrors.length, failedResponses.length, `console errors did not match the known absent /projects probes: ${consoleErrors.join('\n')}`)
  assert.ok(consoleErrors.every((message) => /404 \(Not Found\)/.test(message)), `unexpected browser console errors: ${consoleErrors.join('\n')}`)
} catch (error) {
  failure = error
  step(`failure: ${String(error?.message || error)}`)
  await page?.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  const video = page?.video()
  await context?.close().catch(() => {})
  const videoPath = video ? await video.path().catch(() => null) : null
  await browser?.close().catch(() => {})
  if (api) {
    for (const id of [archivedId, offlineId].filter(Boolean)) {
      await fetch(`${api}/api/sessions/${id}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
    }
  }
  await ui?.close().catch(() => {})
  await stopChild(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* already gone */ }
  writeFileSync(join(out, 'timeline.json'), `${JSON.stringify({ v: 2, axis: 'time', events }, null, 2)}\n`)
  writeFileSync(join(out, 'result.json'), `${JSON.stringify({ ok: !failure, error: failure ? String(failure.stack || failure) : null, archivedId, offlineId, video: videoPath, backendLog }, null, 2)}\n`)
  rmSync(fixture, { recursive: true, force: true })
}

if (failure) throw failure
console.log(JSON.stringify({ ok: true, out, archivedId, offlineId }))
