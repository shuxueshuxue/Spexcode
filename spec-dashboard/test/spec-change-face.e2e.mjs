// YATU proof for [[spec-view]]'s change face: a node a live worktree is changing shows that change on its own
// document. One isolated backend over a fixture repository and one real session created through the create
// route the dashboard uses (launcher `true`, so it costs nothing). Its worktree re-wraps a paragraph of
// `alpha` around three real word edits and proposes a brand-new `beta`. The browser then reads what a person
// sees:
//   1. #/spec/alpha opens on its prose, and the property row names the pending change.
//   2. That toggle opens the change face in the same tab: a redline where only the edited words are marked and
//      the re-wrapped words stay plain, where a line diff marks the whole paragraph as removed and re-added.
//   3. The tab row's git-compare action is pressed there, and leaving through it restores the prose.
//   4. #/spec/beta, a node only the worktree proposes, opens straight on its change and offers no toggle.
//   5. The graph popup's edit tab renders the same redline pane.
// Every scene screenshots before it judges, so the A side of a repair pair still leaves its picture.
// `SPEXCODE_DASHBOARD_ROOT` points Vite at another checkout of `spec-dashboard` (the A side is the old
// committed source); the backend stays current.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = resolve(process.env.SPEXCODE_DASHBOARD_ROOT || join(root, 'spec-dashboard'))
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? root : sharedRoot
const tsxCli = join(dependencyRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const modules = join(dependencyRoot, 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || join(tmpdir(), 'spec-change-face-e2e'))

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 15_000) => {
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

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const node = (title, desc, body) => ['---', `title: ${title}`, 'status: active', 'hue: 180', `desc: ${desc}`, '---', `# ${title}`, '', ...body, ''].join('\n')

// The paragraph the worktree edits. The edited version inserts two words on its first line and swaps one on
// its last, and is re-wrapped at the same column, so every line break in between moves while no word does.
const ALPHA_BEFORE = [
  'The alpha node keeps one promise: a reader who opens it sees the same words the',
  'source-of-truth branch holds, wrapped at the column its author chose, and every',
  'later line of this paragraph exists only so that a change near the top moves the',
  'line breaks under it without changing any of the words that follow the change.',
]
const ALPHA_AFTER = [
  'The alpha node keeps exactly one written promise: a reader who opens it sees the',
  'same words the source-of-truth branch holds, wrapped at the column its author',
  'chose, and every later line of this paragraph exists only so that a change near',
  'the top moves the line breaks under it without changing any of the words that',
  'trail the change.',
]
const INSERTED = ['exactly', 'written', 'trail']
const REMOVED = ['follow']
const REWRAPPED = ['reader', 'source-of-truth', 'column', 'paragraph', 'breaks']

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)
if (!existsSync(join(dashboardRoot, 'index.html'))) throw new Error(`not a dashboard root: ${dashboardRoot}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-change-face-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-change-face-${process.pid}`
let backend
let vite
let browser

try {
  mkdirSync(join(project, '.spec', 'fixture', 'alpha'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), node('fixture', 'change face fixture', ['Fixture root.']))
  writeFileSync(join(project, '.spec', 'fixture', 'alpha', 'spec.md'), node('alpha', 'the node a worktree is changing', ALPHA_BEFORE))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: 'true' } }, defaultLauncher: 'fixture' },
  }, null, 2))
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const api = `http://127.0.0.1:${apiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const created = await fetch(`${api}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': `change-face-${process.pid}` },
    body: JSON.stringify({ prompt: 'align the alpha spec', name: 'aligner' }),
  })
  assert.equal(created.ok, true, 'create the aligning session')
  const sessionId = (await created.json()).id
  const graph = () => fetch(`${api}/api/graph`).then((response) => response.json())
  const worktree = await waitFor(async () => {
    const row = (await graph()).sessions?.find((session) => session.id === sessionId)
    return row?.path && existsSync(row.path) ? row.path : null
  }, 'the session worktree', 30_000)

  // The aligning agent's work: an uncommitted re-wrapped edit of alpha, and a brand-new beta nobody committed.
  writeFileSync(join(worktree, '.spec', 'fixture', 'alpha', 'spec.md'), node('alpha', 'the node a worktree is changing', ALPHA_AFTER))
  mkdirSync(join(worktree, '.spec', 'fixture', 'beta'), { recursive: true })
  writeFileSync(join(worktree, '.spec', 'fixture', 'beta', 'spec.md'), node('beta', 'a node only the worktree proposes', ['Beta is proposed by the aligner session.']))
  await waitFor(async () => {
    const nodes = (await graph()).nodes || []
    return nodes.find((n) => n.id === 'alpha')?.overlays?.length === 1 && nodes.some((n) => n.id === 'beta' && n.ghost)
  }, 'alpha overlay and beta ghost on the board', 30_000)
  // what a line diff says about the same change, for the report's contrast
  const [lineAdded, lineRemoved] = git(worktree, 'diff', '--numstat', 'HEAD', '--', '.spec/fixture/alpha/spec.md').split(/\s+/).map(Number)

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
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: api, ws: true } } },
  })
  await vite.listen()

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error' && !/404/.test(message.text())) errors.push(`console.error: ${message.text()}`) })
  const base = `http://127.0.0.1:${uiPort}`
  const hash = () => page.evaluate(() => location.hash)
  const texts = (selector) => page.locator(`${selector}:visible`).evaluateAll((els) => els.map((el) => el.textContent))
  const present = (selector) => page.locator(`${selector}:visible`).count().then((n) => n > 0)
  const tabs = () => page.locator('[role="tab"][data-tab-key]:visible').evaluateAll((els) => els.map((el) => el.dataset.tabKey))
  const settle = (selector) => page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)
  const redline = async (scope = '') => ({
    inserted: await texts(`${scope} .wd-text ins`),
    removed: await texts(`${scope} .wd-text del`),
  })
  const marksOnly = (marks, words) => words.every((word) => ![...marks.inserted, ...marks.removed].some((text) => text.includes(word)))
  const scenes = []
  const scene = (name, pass, facts) => scenes.push({ scene: name, pass: !!pass, ...facts })

  await page.goto(`${base}/#/spec/alpha`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => localStorage.removeItem('spexcode.tabs.root'))
  await page.reload({ waitUntil: 'domcontentloaded' })

  // 1 — the prose face names the change
  await settle('.pane-doc .doc-body')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '1-prose-face.png') })
  const toggleText = await present('.stat-change') ? await page.locator('.stat-change:visible').textContent() : null
  scene('the prose face names the pending change in its property row', toggleText === '1 pending change'
    && await present('.pane-doc .doc-body')
    && await page.locator('.stat-change:visible').getAttribute('aria-pressed').catch(() => null) === 'false'
    && await present('[data-action="change-switcher"]'), { toggleText, hash: await hash() })

  // 2 — that toggle opens the redline in the same tab (the A side has no toggle, so it is given the address)
  if (await present('.stat-change')) await page.locator('.stat-change:visible').click()
  else await page.goto(`${base}/#/spec/alpha?surface=diff`, { waitUntil: 'domcontentloaded' })
  const redlined = await settle('.pane-doc .wd-text')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '2-change-face.png') })
  const marks = redlined ? await redline('.pane-doc') : { inserted: [], removed: [] }
  const sessionHref = await present('.pane-doc .edit-by-session') ? await page.locator('.pane-doc .edit-by-session:visible').getAttribute('href') : null
  scene('the change face is a redline: edited words marked, re-wrapped words plain', await hash() === '#/spec/alpha?surface=diff'
    && INSERTED.every((word) => marks.inserted.some((text) => text.includes(word)))
    && REMOVED.every((word) => marks.removed.some((text) => text.includes(word)))
    && marksOnly(marks, REWRAPPED)
    && !await present('.pane-doc .doc-body')
    && sessionHref === `#/sessions/${sessionId}`
    && JSON.stringify(await tabs()) === JSON.stringify(['#/spec/alpha']),
  { hash: await hash(), marks, sessionHref, tabs: await tabs(), lineDiff: { added: lineAdded, removed: lineRemoved } })

  // 3 — the tab row's action is the same face switch, pressed here; leaving through it restores the prose
  const action = page.locator('[data-action="change-switcher"]')
  const actionPressed = await present('[data-action="change-switcher"]') ? await action.getAttribute('aria-pressed') : null
  if (actionPressed) await action.click()
  const restored = await waitFor(async () => await hash() === '#/spec/alpha' && await present('.pane-doc .doc-body'), 'prose restored', 5_000).catch(() => false)
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '3-back-to-prose.png') })
  scene('the tab-row git-compare action is pressed on the change face and leads back to the prose', actionPressed === 'true'
    && restored && !await present('.pane-doc .wd'), { actionPressed, hash: await hash() })

  // 4 — a ghost has only its change to read
  await page.goto(`${base}/#/spec/beta`, { waitUntil: 'domcontentloaded' })
  const ghostRedlined = await settle('.pane-doc .wd-text')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '4-ghost-change.png') })
  const ghostMarks = ghostRedlined ? await redline('.pane-doc') : { inserted: [], removed: [] }
  scene('a node only the worktree proposes opens straight on its change, with no toggle to an empty page',
    ghostMarks.inserted.some((text) => text.includes('Beta is proposed by the aligner session.'))
    && !await present('[data-action="change-switcher"]')
    && await page.locator('.stat-change:visible').isDisabled().catch(() => false), { hash: await hash(), ghostMarks })

  // 5 — the popup's edit tab is the same pane
  await page.goto(`${base}/#/graph/alpha`, { waitUntil: 'domcontentloaded' })
  await settle('.react-flow__node')
  await page.waitForTimeout(800)
  await page.keyboard.press('i')
  await settle('.ov-panel')
  await page.locator('.ov-tab', { hasText: 'edit' }).click()
  const popupRedlined = await settle('.ov-body .wd-text')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, '5-popup-edit.png') })
  const popupMarks = popupRedlined ? await redline('.ov-body') : { inserted: [], removed: [] }
  scene('the popup edit tab renders the same redline pane', INSERTED.every((word) => popupMarks.inserted.some((text) => text.includes(word)))
    && marksOnly(popupMarks, REWRAPPED), { popupMarks })

  const kept = scenes.filter((s) => s.pass).length
  const report = { dashboardRoot, kept, probed: scenes.length, scenes, errors, sessionId }
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  assert.deepEqual(errors, [], 'no product errors in the browser')
  assert.equal(kept, scenes.length, `${kept} of ${scenes.length} change-face scenes held`)
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
