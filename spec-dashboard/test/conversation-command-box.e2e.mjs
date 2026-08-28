// The Conversation footer is a REAL Command Box ([[conversation]] / [[command-box]] / [[file-attach]]): this
// run boots an isolated backend over a fresh temporary project with one live fake-harness session, opens that
// session's Conversation in a real browser, and works every door — `/` (board rows run, others insert), `@`
// (`@new` → launcher rows), `[[` (spec rows, expanded to a live spec pointer when sent), paste and the
// paperclip (uploaded through the resumable stream, the path spliced into the draft) — reading the DOM, the
// session's own timeline, and the fake harness's pane (its `FAKE-HARNESS REPLY` echo) for what actually arrived.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
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
// tsx is hoisted to the repo root's node_modules (a worktree symlinks it there); older layouts kept it under
// spec-cli or beside a shared checkout, so every place it has lived is tried in turn.
const tsxCli = [join(root, 'node_modules'), join(root, 'spec-cli', 'node_modules'), join(sharedRoot, 'node_modules')]
  .map((dir) => join(dir, 'tsx', 'dist', 'cli.mjs')).find((path) => existsSync(path))
if (!tsxCli) throw new Error('tsx is missing: no node_modules/tsx beside the repo, spec-cli, or the shared checkout')
// the dashboard's dependencies are hoisted to the repo root's node_modules (a worktree symlinks it there);
// the package-local and shared-checkout dirs are the older layouts. Pick the first that actually holds vite.
const modules = [join(root, 'spec-dashboard', 'node_modules'), join(root, 'node_modules'), join(sharedRoot, 'spec-dashboard', 'node_modules'), join(sharedRoot, 'node_modules')]
  .find((dir) => existsSync(join(dir, 'vite', 'package.json')))
if (!modules) throw new Error('vite is missing: no node_modules holding vite beside the dashboard, the repo, or the shared checkout')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/conversation-command-box-e2e')
const events = []
let recordingStartedAt = null
const step = (name) => { events.push({ at: Date.now() - recordingStartedAt, step: name }) }

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stop = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    once(child, 'exit').then(() => true),
    new Promise((resolveWait) => setTimeout(() => resolveWait(false), 3_000)),
  ])
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-conversation-command-box-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-conversation-command-box-${process.pid}`
let backend
let vite
let browser
let page = null
let backendLog = ''
const pageErrors = []
const consoleLog = []
const facts = { steps: {} }

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\n---\n\n# fixture\n\nfixture\n')
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const apiPort = await freePort()
  const uiPort = await freePort()
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    // a slow tick keeps the harness's REPLY echo on its screen long enough for the pane read below
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')
  } catch (error) {
    throw new Error(`${error.message}\n${backendLog}`)
  }

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

  const api = `http://127.0.0.1:${apiPort}`
  const create = await fetch(`${api}/api/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'conversation source session', launcher: 'fake' }),
  })
  const created = await create.json()
  assert.equal(create.status, 201, JSON.stringify(created))
  const { id: source } = created
  await waitFor(async () => {
    const session = await fetch(`${api}/api/sessions/${source}`).then((response) => response.json())
    return session.liveness === 'online'
  }, 'source session online')
  const graph = await fetch(`${api}/api/graph`).then((response) => response.json())
  const fixtureNode = graph.nodes.find((node) => node.id === 'fixture')
  assert.ok(fixtureNode?.path, 'the fixture spec node is on the graph')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  page = await context.newPage()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') consoleLog.push(`${message.type()}: ${message.text()}`) })
  recordingStartedAt = Date.now()
  await page.goto(`http://127.0.0.1:${uiPort}/#/sessions/${source}?surface=conversation`, { waitUntil: 'domcontentloaded' })
  await page.locator('.tl-chat:visible').waitFor({ state: 'visible', timeout: 30_000 })
  const input = page.locator('.m-composer:visible .m-input')
  await input.waitFor({ state: 'visible', timeout: 30_000 })
  await page.waitForTimeout(400)
  step('open the Conversation of a live fake-harness session')
  const menu = page.locator('.m-composer:visible .mention-menu')
  const rowsOf = async () => menu.locator('.mention-item').evaluateAll((nodes) => nodes.map((node) => ({
    text: node.textContent || '', ui: /\bsc-/.test(node.className), isNew: node.classList.contains('new'),
  })))

  // ---- `/`: board rows lead and RUN; preset/harness rows insert their token -------------------------------
  await input.click()
  await input.fill('/')
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  const slashRows = await rowsOf()
  facts.steps.slash = { rows: slashRows.length, ui: slashRows.filter((row) => row.ui).map((row) => row.text.trim()), other: slashRows.filter((row) => !row.ui).length }
  assert.ok(slashRows.some((row) => row.ui && row.text.includes('/eval')), `the board's /eval leads the palette: ${JSON.stringify(slashRows)}`)
  assert.ok(slashRows.some((row) => row.ui && row.text.includes('/stop')), 'the board /stop row is offered on a working session')
  assert.ok(slashRows.some((row) => !row.ui), 'harness/preset rows follow the board rows')
  assert.ok(slashRows.findIndex((row) => row.ui) < slashRows.findIndex((row) => !row.ui), 'board rows come first')
  await page.screenshot({ path: join(out, '1-slash-menu.png') })
  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden', timeout: 5_000 })
  assert.equal(await input.inputValue(), '/', 'Escape closes the menu and keeps the draft')
  step('open the / palette, read board-first order, Escape closes it')
  // a dismissed menu stays shut for that exact draft+caret; a changed draft re-arms it
  await input.fill('')
  await input.fill('/')
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  const insertRow = menu.locator('.mention-item:not([class*="sc-"])').first()
  const insertName = (await insertRow.locator('.slash-name').textContent() || '').trim()
  await insertRow.click()
  await menu.waitFor({ state: 'hidden', timeout: 5_000 })
  assert.equal(await input.inputValue(), `${insertName} `, 'a harness/preset row inserts its token')
  facts.steps.slashInsert = insertName
  step('pick a harness row: its token lands in the draft')

  // ---- `@`: sessions, then the `@new` door and the launcher rows ----------------------------------------
  await input.fill('@')
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  const newRow = menu.locator('.mention-item.new', { hasText: '@new' }).first()
  await newRow.waitFor({ state: 'visible' })
  await newRow.click()
  await page.waitForFunction(() => document.querySelector('.m-composer .m-input')?.value === '@new:')
  const fakeRow = menu.locator('.mention-item.new', { hasText: '@new:fake' }).first()
  await fakeRow.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(out, '2-at-new-launchers.png') })
  await fakeRow.click()
  await page.waitForFunction(() => document.querySelector('.m-composer .m-input')?.value === '@new:fake ')
  facts.steps.at = await input.inputValue()
  step('@ → @new → @new:fake through the shared menu')

  // ---- `[[`: spec rows; the sent text carries the live spec pointer ------------------------------------
  await input.fill('[[')
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  const specRow = menu.locator('.mention-item', { hasText: 'fixture' }).first()
  await specRow.waitFor({ state: 'visible' })
  await specRow.click()
  await page.waitForFunction(() => document.querySelector('.m-composer .m-input')?.value === '[[fixture]] ')
  const token = `CONVERSATION-CMD-${Date.now()}`
  await input.fill(`[[fixture]] hello ${token}`)
  await page.screenshot({ path: join(out, '3-mention-draft.png') })
  await input.press('Enter')
  const sent = await waitFor(async () => {
    const timeline = await fetch(`${api}/api/sessions/${source}/timeline`).then((response) => response.json())
    return (timeline.events || []).find((event) => event.kind === 'sent' && event.text.includes(token)) || null
  }, 'the sent event on the session timeline')
  facts.steps.mention = { sentText: sent.text, replyVia: sent.replyVia ?? null }
  assert.match(sent.text, /^\[\[fixture\]\] \(\S*fixture\/spec\.md\) hello /, `[[fixture]] expanded to its spec pointer at send: ${sent.text}`)
  assert.equal(sent.replyVia, 'note', 'the Conversation still asks for a note reply')
  await page.waitForFunction((expected) => [...document.querySelectorAll('.m-ev-text')].some((node) => node.textContent?.includes(expected)), token, { timeout: 20_000 })
  // the durable append shows on the timeline's poll before the native handoff answers the POST; the draft
  // clears when that answer lands, so it is awaited rather than read at the first sighting
  await page.waitForFunction(() => document.querySelector('.m-composer .m-input')?.value === '', null, { timeout: 20_000 })
    .catch(async () => { throw new Error(`a delivered send clears the draft (still: ${JSON.stringify(await input.inputValue())})`) })
  // the harness echoes what came over its rendezvous socket onto its pane: the expanded pointer arrived
  const echoed = await waitFor(async () => {
    const pane = await fetch(`${api}/api/sessions/${source}/capture`).then((response) => response.text())
    const line = pane.split('\n').find((row) => row.includes('FAKE-HARNESS REPLY') && row.includes(token))
    return line || null
  }, 'the fake harness echoing the delivered message')
  assert.match(echoed, /\[\[fixture\]\] \(\S*fixture\/spec\.md\) hello /, `the harness received the expanded pointer: ${echoed}`)
  facts.steps.mention.echoed = echoed.trim()
  step('[[fixture]] picked, sent with Enter, expanded pointer reaches the timeline and the harness')

  // ---- paste: a file, not text; the upload's path lands in the draft ----------------------------------
  await input.fill('see')
  const pasted = await page.evaluate(() => {
    const target = document.querySelector('.m-composer .m-input')
    const file = new File(['conversation paste proof'], 'conversation-paste.txt', { type: 'text/plain' })
    const clipboard = new DataTransfer()
    clipboard.items.add(file)
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  assert.equal(pasted, true, 'a file paste is claimed by the attachment path')
  const pasteRow = page.locator('.m-composer:visible .si-attach-row.complete')
  await pasteRow.waitFor({ state: 'visible', timeout: 30_000 })
  await page.screenshot({ path: join(out, '4-paste-attached.png') })
  const afterPaste = await input.inputValue()
  assert.match(afterPaste, /^see \S*spexcode-uploads\/\S*conversation-paste\S* $/, `the pasted file's path is spliced after the word: ${afterPaste}`)
  facts.steps.paste = afterPaste
  step('paste a file: uploaded, its path spliced into the draft')

  // ---- the paperclip: a real file chooser, the second path beside the first ----------------------------
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.m-composer:visible .si-command-tool').click(),
  ])
  await chooser.setFiles({ name: 'conversation-pick.txt', mimeType: 'text/plain', buffer: Buffer.from('conversation pick proof') })
  await waitFor(async () => (await input.inputValue()).includes('conversation-pick'), 'the picked file path in the draft')
  const afterPick = await input.inputValue()
  facts.steps.pick = afterPick
  const paths = afterPick.match(/\S*spexcode-uploads\/\S+/g) || []
  assert.equal(paths.length, 2, `two uploaded paths in the draft: ${afterPick}`)
  for (const path of paths) assert.equal(readFileSync(path, 'utf8').length > 0, true, `${path} landed on the backend machine`)
  await page.screenshot({ path: join(out, '5-pick-attached.png') })
  step('paperclip: the chooser opens, the picked file lands on the machine and in the draft')

  // ---- drop: the composer rings while a file hovers and attaches it on release ------------------------
  const dropped = await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const surface = document.querySelector('.m-composer')
    const file = new File(['conversation drop proof'], 'conversation-drop.txt', { type: 'text/plain' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    // dragover is a continuous event, so its state lands on the next paint rather than inside the dispatch
    surface.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    await frame()
    const ringed = surface.classList.contains('dragover')
    surface.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    await frame()
    return { ringed, released: !surface.classList.contains('dragover') }
  })
  await waitFor(async () => (await input.inputValue()).includes('conversation-drop'), 'the dropped file path in the draft')
  const afterDrop = await input.inputValue()
  facts.steps.drop = { ...dropped, draft: afterDrop }
  assert.equal(dropped.ringed, true, 'the composer rings while a file hovers')
  assert.equal((afterDrop.match(/\S*spexcode-uploads\/\S+/g) || []).length, 3, `three uploaded paths in the draft: ${afterDrop}`)
  await page.screenshot({ path: join(out, '6-drop-attached.png') })
  step('drop a file on the composer: ringed on hover, attached on release')

  // ---- a bare board line RUNS here: `/eval` opens the session's Evals door instead of sending ---------
  await input.fill('/eval')
  await menu.waitFor({ state: 'visible', timeout: 10_000 })
  await page.keyboard.press('Escape')
  const hashBefore = await page.evaluate(() => location.hash)
  const sentBefore = await fetch(`${api}/api/sessions/${source}/timeline`).then((response) => response.json()).then((timeline) => (timeline.events || []).filter((event) => event.kind === 'sent').length)
  await input.press('Enter')
  await page.waitForFunction((before) => location.hash !== before, hashBefore, { timeout: 10_000 })
  const hashAfter = await page.evaluate(() => location.hash)
  const sentAfter = await fetch(`${api}/api/sessions/${source}/timeline`).then((response) => response.json()).then((timeline) => (timeline.events || []).filter((event) => event.kind === 'sent').length)
  assert.match(hashAfter, /evals/, `the board /eval navigated to the evals door: ${hashAfter}`)
  assert.equal(sentAfter, sentBefore, 'a board line is never sent to the agent')
  facts.steps.board = { hashBefore, hashAfter }
  step('/eval typed as a bare line runs on the board, sends nothing')

  assert.deepEqual(pageErrors, [], `no page errors: ${pageErrors.join('\n')}`)
  const video = page.video()
  await context.close()
  await video.saveAs(join(out, 'conversation-command-box.webm'))
  await browser.close()
  browser = null
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: true, source, ...facts }, null, 2))
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events }, null, 2))
  console.log(JSON.stringify({ ok: true, out, source, facts }, null, 2))
} catch (error) {
  // a failure keeps its evidence: the page as it was, the browser's own errors, and the backend's tail
  if (page && !page.isClosed()) await page.screenshot({ path: join(out, 'failure.png') }).catch(() => {})
  writeFileSync(join(out, 'result.json'), JSON.stringify({ ok: false, error: error.stack, facts, pageErrors, consoleLog, backendLog: backendLog.slice(-4000) }, null, 2))
  throw error
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
