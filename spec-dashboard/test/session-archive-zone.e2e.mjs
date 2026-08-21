import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
const out = resolve(process.env.OUT || join(root, '.artifacts', 'session-archive-zone'))

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

const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const hashBytes = (bytes) => createHash('sha256').update(bytes).digest('hex')

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'dist', 'index.html'))) throw new Error('prebuilt spec-dashboard/dist is required; run npm run build first')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-archive-zone-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-archive-zone-${process.pid}`
const events = []
const started = Date.now()
const step = (label) => events.push({ at: Date.now() - started, step: label })
const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8' })
let backend
let ui
let browser
let context
let page
let api
let base
let closeId
let controlId
let legacyId
let failure
let backendLog = ''

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\n# fixture\n\nArchive drawer browser fixture.\n')
  writeFileSync(join(project, 'README.md'), 'archive drawer fixture\n')
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
  assert.equal(hashBytes(servedIndex), hashBytes(readFileSync(join(dashboardRoot, 'dist', 'index.html'))),
    'UI server did not serve this worktree prebuilt dist')

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

  closeId = await create('drag-close-archive-proof')
  controlId = await create('working-search-control')
  await post(`/api/sessions/${closeId}/input`, { kind: 'text', text: 'retained conversation proof' })
  step('two real sessions created against the isolated backend')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 }, locale: 'en-US',
    recordVideo: { dir: out, size: { width: 1280, height: 800 } },
  })
  page = await context.newPage()
  const pageErrors = []
  const failedResponses = []
  const dialogs = []
  const archiveRequests = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss() })
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() })
  })
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/api/sessions' && url.searchParams.has('all')) {
      archiveRequests.push({ href: url.href, params: [...url.searchParams.entries()] })
    }
  })

  await page.goto(`${base}/#/sessions`, { waitUntil: 'domcontentloaded' })
  const archiveZone = page.locator('.si-zone-archive')
  await archiveZone.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForFunction(() => document.querySelector('.si-zone-archive')?.dataset.archiveCount === '0')
  assert.equal(await page.locator('.si-pill.shelf').count(), 0, 'the retired star archive pill is still present')
  assert.equal(await page.locator('.si-toprow .si-pill').count(), 2, 'the top row does not contain exactly New and Search')
  assert.equal(await archiveZone.locator('.si-zone-count').innerText(), '0', 'the archive zone hid its zero count')
  assert.equal(await page.locator('.si-zone-archive ~ .si-tree-row .si-item').count(), 0, 'empty archive zone was not folded')
  assert.equal(archiveRequests.length, 1, 'the initial archive index was not fetched exactly once')
  assert.deepEqual(archiveRequests[0].params, [['all', '1']], 'the archive index request carried pagination parameters')
  await page.screenshot({ path: join(out, 'archive-zone-zero.png'), fullPage: true })
  step('permanent Archive 0 place visible with no star pill')

  const closeResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/sessions/${closeId}/close`
    && response.request().method() === 'POST')
  const sourceRow = page.locator(`.si-item[data-sid="${closeId}"]`)
  const sourceBox = await sourceRow.boundingBox()
  await archiveZone.scrollIntoViewIfNeeded()
  const zoneBox = await archiveZone.boundingBox()
  assert.ok(sourceBox && zoneBox, 'drag source or archive target has no layout box')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height + 12, { steps: 3 })
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 8 })
  await page.mouse.up()
  assert.equal((await closeResponse).ok(), true, 'drag-to-archive did not reach the real close endpoint')
  await page.waitForFunction((id) => !document.querySelector(`.si-item[data-sid="${id}"]`), closeId)
  await page.waitForFunction(() => document.querySelector('.si-zone-archive')?.dataset.archiveCount === '1')
  assert.equal(dialogs.length, 0, `drag-to-close opened a browser confirmation: ${dialogs.join('; ')}`)
  assert.equal(await page.locator('.sess-rename-modal').count(), 0, 'drag-to-close opened an in-app confirmation')
  const closed = await waitFor(async () => {
    const row = (await json('/api/sessions?all=1')).find((session) => session.id === closeId)
    return row?.archived && typeof row.closedAt === 'string' ? row : null
  }, 'closed row with closedAt')
  assert.ok(Number.isFinite(Date.parse(closed.closedAt)), 'new close did not publish an ISO closedAt')
  await page.screenshot({ path: join(out, 'archive-zone-folded.png'), fullPage: true })
  step('one drag closed the real row without confirmation and published closedAt')

  if (await page.locator('.si-zone-all').count() === 0) await page.locator('.si-zone-archive .si-zone-count').click()
  const previewRow = page.locator(`.si-zone-archive ~ .si-tree-row .si-item[data-sid="${closeId}"]`)
  await previewRow.waitFor({ state: 'visible' })
  const drawerMeasure = await page.locator('.si-list').evaluate((list) => {
    const scrollables = [list, ...list.querySelectorAll('*')].filter((element) => {
      const overflow = getComputedStyle(element).overflowY
      return overflow === 'auto' || overflow === 'scroll'
    }).map((element) => element.className)
    return {
      rows: list.querySelectorAll('.si-zone-archive ~ .si-tree-row .si-item').length,
      scrollables,
    }
  })
  assert.ok(drawerMeasure.rows <= 8, `archive zone exposed too many rows: ${JSON.stringify(drawerMeasure)}`)
  assert.deepEqual(drawerMeasure.scrollables, ['si-board-scroll'], 'the sidebar has more than one scroll container')
  assert.equal(await page.locator('.si-zone-all').count(), 1, 'archive zone omitted the View all row')
  await page.screenshot({ path: join(out, 'archive-zone-expanded.png'), fullPage: true })
  await page.locator('.si-zone-all').click()
  const archivePage = page.locator('[data-archive-page]')
  await archivePage.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(out, 'archive-index-overlay.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await archivePage.waitFor({ state: 'detached' })
  await page.locator('.si-zone-all').click()
  await page.locator('[data-archive-page]').waitFor({ state: 'visible' })
  await page.locator(`[data-archive-page] .si-archive-page-row[data-sid="${closeId}"]`).click()
  const archivedChat = page.locator('.tl-chat:visible')
  await archivedChat.waitFor({ state: 'visible', timeout: 30_000 })
  await archivedChat.locator('.m-empty').waitFor({ state: 'detached', timeout: 30_000 })
  assert.equal(await archivedChat.locator('.m-composer').getAttribute('data-footer-state'), 'archived')
  assert.equal(await archivedChat.locator('.m-input').isDisabled(), true, 'archive index row did not open read-only Conversation')
  assert.match(await archivedChat.innerText(), /retained conversation proof/, 'closed Conversation lost its real timeline')
  await page.screenshot({ path: join(out, 'archive-zone-conversation.png'), fullPage: true })
  step('archive zone stays in the single board scroll and index selection opens the retained read-only Conversation')

  await page.keyboard.press('Alt+/')
  const globalSearch = page.locator('.search-input')
  await globalSearch.waitFor({ state: 'visible' })
  await globalSearch.fill(closeId)
  await page.waitForTimeout(300)
  assert.equal(await page.locator(`.search-item[data-kind="session"][data-target="${closeId}"]`).count(), 0,
    'global search included a closed session')
  assert.doesNotMatch(await page.locator('.search-panel').innerText(), /archive.{0,30}match|match.{0,30}archive/i,
    'global search added an archive-match hint')
  await page.screenshot({ path: join(out, 'global-search-excludes-archive.png'), fullPage: true })
  await globalSearch.press('Escape')
  step('global Option-slash search contains neither archived rows nor an archive hint')

  const encodedProject = realpathSync(project).replaceAll('/', '-')
  const sessionsRoot = join(home, 'projects', encodedProject, 'sessions')
  const sourceStore = join(sessionsRoot, closeId)
  const sourceRecord = JSON.parse(readFileSync(join(sourceStore, 'session.json'), 'utf8'))
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(18, 0, 0, 0)
  const fixed = new Date(yesterday)
  fixed.setDate(fixed.getDate() - 45)
  for (let index = 0; index < 30; index++) {
    const id = `archive-proof-${String(index).padStart(3, '0')}`
    const record = {
      ...sourceRecord,
      session_id: id,
      worktree_path: join(fixture, 'absent', id),
      name: `Archive index row ${String(index).padStart(3, '0')}`,
      title: `archive-index-row-${index}`,
      createdAt: Date.now() - (index + 1) * 1000,
      harness_session_id: '',
      closed_at: new Date((index < 22 ? yesterday : fixed).getTime() - index * 60_000).toISOString(),
      cold_proof: `cold-v1|claude|${id}|no-resident-ref`,
    }
    const store = join(sessionsRoot, id)
    mkdirSync(store, { recursive: true })
    writeFileSync(join(store, 'session.json'), `${JSON.stringify(record, null, 2)}\n`)
    writeFileSync(join(store, 'prompt'), `${record.title}\n`)
  }
  legacyId = 'archive-proof-legacy-unknown-time'
  const legacyRecord = {
    ...sourceRecord,
    session_id: legacyId,
    worktree_path: join(fixture, 'absent', legacyId),
    name: 'Archive only legacy needle',
    title: 'archive-only-legacy-needle',
    createdAt: Date.now() - 99_000,
    harness_session_id: '',
    cold_proof: `cold-v1|claude|${legacyId}|no-resident-ref`,
  }
  delete legacyRecord.closed_at
  mkdirSync(join(sessionsRoot, legacyId), { recursive: true })
  writeFileSync(join(sessionsRoot, legacyId, 'session.json'), `${JSON.stringify(legacyRecord, null, 2)}\n`)
  writeFileSync(join(sessionsRoot, legacyId, 'prompt'), 'archive-only-legacy-needle\n')
  const seededIndex = await json('/api/sessions?all=1')
  assert.equal(seededIndex.find((session) => session.id === legacyId)?.closedAt, null,
    'pre-field archived record did not project closedAt:null')

  const beforeReloadRequests = archiveRequests.length
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('.si-zone-archive')?.dataset.archiveCount === '32')
  assert.equal(archiveRequests.length, beforeReloadRequests + 1, 'one page load issued more than one archive index request')
  assert.deepEqual(archiveRequests.at(-1).params, [['all', '1']], 'full archive read was paginated')
  if (await page.locator('.si-zone-all').count() === 0) await page.locator('.si-zone-archive .si-zone-count').click()
  await page.locator('.si-zone-all').click()
  await archivePage.waitFor({ state: 'visible' })
  const todayKey = dayKey(new Date(closed.closedAt))
  const yesterdayKey = dayKey(yesterday)
  assert.equal(await page.locator(`[data-archive-day="${todayKey}"] [data-sid="${closeId}"]`).count(), 1,
    'new close did not land in its closedAt date group')
  assert.equal(await page.locator('[data-archive-day="unknown"] [data-sid="archive-proof-legacy-unknown-time"]').count(), 1,
    'legacy closedAt:null row did not land in Time unknown')
  assert.equal((await page.locator('.si-archive-group').last().getAttribute('data-archive-day')), 'unknown',
    'Time unknown is not the final group')

  const archiveIndex = page.locator('[data-archive-index]')
  const yesterdayGroup = page.locator(`[data-archive-day="${yesterdayKey}"]`)
  await archiveIndex.evaluate((element, key) => {
    const group = element.querySelector(`[data-archive-day="${key}"]`)
    element.scrollTop = group.offsetTop + 90
  }, yesterdayKey)
  await page.waitForTimeout(100)
  const sticky = await yesterdayGroup.locator('.si-archive-date').evaluate((header) => {
    const index = header.closest('[data-archive-index]')
    const headerBox = header.getBoundingClientRect()
    const indexBox = index.getBoundingClientRect()
    return { position: getComputedStyle(header).position, delta: Math.abs(headerBox.top - indexBox.top) }
  })
  assert.equal(sticky.position, 'sticky', 'archive date heading is not sticky')
  assert.ok(sticky.delta <= 1, `archive date heading did not pin while scrolling: ${JSON.stringify(sticky)}`)
  const requestsBeforeScrollAndSearch = archiveRequests.length
  const archiveSearch = page.locator('.si-archive-search input')
  await archiveSearch.fill(legacyId)
  assert.equal(await page.locator('.si-archive-page-row').count(), 1, 'archive-local search did not filter the complete index')
  assert.equal(await page.locator(`.si-archive-page-row[data-sid="${legacyId}"]`).count(), 1,
    'archive-local search omitted the legacy row')
  assert.equal(archiveRequests.length, requestsBeforeScrollAndSearch, 'scrolling or archive-local search fetched another page')
  await page.screenshot({ path: join(out, 'archive-page-unknown.png'), fullPage: true })
  await archiveSearch.fill('')
  await page.screenshot({ path: join(out, 'archive-page.png'), fullPage: true })
  step('full archive page groups by closedAt, pins dates, searches locally, and keeps one honest index request')

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`)
  assert.ok(failedResponses.every((entry) => entry.status === 404 && new URL(entry.url).pathname === '/projects'),
    `unexpected failed browser responses: ${JSON.stringify(failedResponses)}`)
} catch (error) {
  failure = error
  step(`failure: ${String(error?.message || error)}`)
  await page?.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  const video = page?.video()
  await context?.close().catch(() => {})
  const videoPath = video ? await video.path().catch(() => null) : null
  const filedVideo = videoPath && existsSync(videoPath) ? join(out, 'session-archive-zone.webm') : null
  if (filedVideo) renameSync(videoPath, filedVideo)
  await browser?.close().catch(() => {})
  if (api && controlId) {
    await fetch(`${api}/api/sessions/${controlId}/close`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  }
  await ui?.close().catch(() => {})
  await stopChild(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* already gone */ }
  writeFileSync(join(out, 'timeline.json'), `${JSON.stringify({ v: 2, axis: 'time', events }, null, 2)}\n`)
  writeFileSync(join(out, 'result.json'), `${JSON.stringify({
    ok: !failure,
    closeId,
    controlId,
    legacyId,
    artifacts: [
      'archive-zone-zero.png',
      'archive-zone-folded.png',
      'archive-zone-expanded.png',
      'archive-index-overlay.png',
      'archive-zone-conversation.png',
      'archive-page.png',
      'archive-page-unknown.png',
      'global-search-excludes-archive.png',
      filedVideo && 'session-archive-zone.webm',
    ].filter(Boolean),
  }, null, 2)}\n`)
  rmSync(fixture, { recursive: true, force: true })
}

if (failure) {
  console.error(backendLog)
  throw failure
}
console.log(JSON.stringify({ ok: true, out, closeId, legacyId }))
