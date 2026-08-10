import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const sharedRoot = resolve(root, '..', '..')
const workspaceRoots = [root, sharedRoot]
const tsxRoot = workspaceRoots.find((candidate) => existsSync(join(candidate, 'node_modules', 'tsx', 'dist', 'cli.mjs')))
if (!tsxRoot) throw new Error('workspace node_modules with tsx is missing')
const moduleCandidates = [process.env.SPEXCODE_E2E_MODULES, ...workspaceRoots.map((candidate) => join(candidate, 'node_modules'))].filter(Boolean)
const modules = moduleCandidates.find((candidate) =>
  existsSync(join(candidate, 'vite', 'dist', 'node', 'index.js')) && existsSync(join(candidate, '@vitejs', 'plugin-react', 'dist', 'index.js')),
)
if (!modules) throw new Error('dashboard node_modules is missing (set SPEXCODE_E2E_MODULES to a dependency directory)')
const tsxCli = join(tsxRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-label-one-name-everywhere-e2e')

const rawUrl = 'https://fixture.invalid/session-label/raw-launch-title'
const renamed = { id: 'session-label-renamed', name: 'Human rename wins everywhere', prompt: `${rawUrl}\nignored because the human supplied a name` }
const prose = { id: 'session-label-prompt-prose', name: '', prompt: `${rawUrl}\nDerived prose replaces the bare launch URL` }
const fixtureSessions = [renamed, prose]

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 25))
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

const inotifyWatchCount = () => {
  let total = 0
  for (const pid of readdirSync('/proc')) {
    if (!/^\d+$/.test(pid)) continue
    try {
      total += readdirSync(`/proc/${pid}/fd`).filter((fd) => {
        try { return String(readlinkSync(`/proc/${pid}/fd/${fd}`)) === 'anon_inode:inotify' } catch { return false }
      }).length
    } catch { /* process exited or is not visible */ }
  }
  return total
}

const isEnospc = (error) => error && typeof error === 'object' && error.code === 'ENOSPC'

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-session-label-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const timelineStart = Date.now()
const timeline = []
const step = (name) => timeline.push({ at: Date.now() - timelineStart, step: name })
let backend
let vite
let browser
let context
let videoPath = null
let watchMode = 'native'
const watcherBefore = inotifyWatchCount()

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: session label browser fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const recordRoot = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
  for (const session of fixtureSessions) {
    const dir = join(recordRoot, session.id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify({
      session_id: session.id, governed: true, worktree_path: project, branch: 'main', node: '', title: rawUrl, name: session.name, parent: '',
      status: 'active', proposal: '', merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'claude',
      harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture',
      launch_cmd: 'true', launch_owner: 'http://fixture.invalid', create_request_id: '', create_payload_hash: '', launch_readiness_pending: null,
    }, null, 2) + '\n')
    writeFileSync(join(dir, 'prompt'), session.prompt)
  }

  const apiPort = await freePort()
  const uiPort = await freePort()
  const base = `http://127.0.0.1:${uiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-session-label-${process.pid}`, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  const startVite = async (usePolling) => {
    const server = await createServer({
      root: dashboardRoot,
      configFile: false,
      plugins: [react()],
      resolve: { alias: {
        react: join(modules, 'react'), 'react-dom': join(modules, 'react-dom'), '@xyflow/react': join(modules, '@xyflow', 'react'),
        katex: join(modules, 'katex'), 'markdown-it': join(modules, 'markdown-it'), '@xterm/xterm': join(modules, '@xterm', 'xterm'),
        '@xterm/addon-fit': join(modules, '@xterm', 'addon-fit'),
      } },
      server: {
        host: '127.0.0.1', port: uiPort, strictPort: true,
        proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } },
        watch: usePolling ? { usePolling: true } : undefined,
      },
    })
    try {
      await server.listen()
      return server
    } catch (error) {
      await server.close().catch(() => {})
      throw error
    }
  }
  try {
    vite = await startVite(false)
  } catch (error) {
    if (!isEnospc(error)) throw error
    watchMode = 'polling after native fs.watch ENOSPC (environment mitigation)'
    await vite?.close().catch(() => {})
    vite = await startVite(true)
  }
  step('isolated backend and dashboard ready')

  const graph = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/graph`)
    if (!response.ok) return null
    const sessions = (await response.json()).sessions.filter((session) => fixtureSessions.some((fixtureSession) => fixtureSession.id === session.id))
    return sessions.length === fixtureSessions.length ? sessions : null
  }, 'fixture session projection')
  const titles = new Map(graph.map((session) => [session.id, session.title]))
  assert.equal(titles.size, fixtureSessions.length, 'the real API defines the non-empty population')
  assert.equal(titles.get(renamed.id), renamed.name, 'a raw override is the visible derived title')
  assert.equal(titles.get(prose.id), 'Derived prose replaces the bare launch URL', 'prompt prose replaces a bare URL on the wire')
  assert.ok([...titles.values()].every((title) => !title.includes(rawUrl)), 'the API title population contains no raw URL')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  const page = await context.newPage()
  await page.goto(`${base}/#/sessions/${renamed.id}`, { waitUntil: 'domcontentloaded' })
  await page.locator(`.si-item[data-sid="${renamed.id}"]`).waitFor({ state: 'visible', timeout: 15_000 })

  const offlineCount = page.locator('.si-zone-offline > .si-zone-count')
  if (await offlineCount.count() && await offlineCount.getAttribute('aria-expanded') === 'false') await offlineCount.click()
  await page.locator(`.si-item[data-sid="${prose.id}"]`).waitFor({ state: 'visible', timeout: 15_000 })
  const rowTitles = new Map(await page.locator('.si-item[data-sid]').evaluateAll((rows) => rows.map((row) => [
    row.dataset.sid,
    row.querySelector('.sess-id')?.textContent?.trim() || '',
  ])))
  assert.equal(rowTitles.size, titles.size, 'the list renders the whole API population')
  for (const [id, title] of titles) assert.equal(rowTitles.get(id), title, `list row ${id} reads the API-derived title`)
  assert.ok([...rowTitles.values()].every((title) => !title.includes(rawUrl)), 'no session list row renders the raw URL')
  step('session list matches real API titles')

  await page.locator('.si-tool.command').click()
  const commandInput = page.locator('.si-command-input')
  await commandInput.waitFor({ state: 'visible', timeout: 10_000 })
  await commandInput.fill('@')
  const mentionRows = page.locator('.mention-menu.up .mention-item')
  await mentionRows.first().waitFor({ state: 'visible', timeout: 10_000 })
  const mentionTitles = await mentionRows.locator('.mention-id').evaluateAll((labels) => labels.map((label) => label.textContent?.trim().replace(/^@/, '') || ''))
  assert.equal(mentionTitles.length, titles.size, 'the dropdown renders one row for every API session')
  assert.deepEqual(new Set(mentionTitles), new Set(titles.values()), 'each dropdown label is one visible list title')
  assert.ok(mentionTitles.every((title) => !title.includes(rawUrl)), 'no dropdown label renders the raw URL')
  step('@ mention dropdown matches list titles')

  await page.locator(`.si-item[data-sid="${renamed.id}"]`).click({ button: 'right' })
  const renameItem = page.getByText('rename', { exact: true })
  await renameItem.waitFor({ state: 'visible', timeout: 10_000 })
  await renameItem.click()
  const renameInput = page.locator('.sess-rename-input')
  await renameInput.waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal(await renameInput.inputValue(), renamed.name, 'Rename alone reads the raw override prefill')
  assert.equal(rowTitles.get(renamed.id), titles.get(renamed.id), 'the visible row retains the derived name')
  step('Rename prefill reads raw override')

  await page.screenshot({ path: join(out, 'session-label-one-name-everywhere.png'), fullPage: true })
  const video = page.video()
  await context.close()
  videoPath = video ? await video.path() : null
  context = null
  await browser.close()
  browser = null
  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events: timeline }, null, 2) + '\n')
  writeFileSync(join(out, 'result.json'), JSON.stringify({
    fixtureSessions: fixtureSessions.map(({ id }) => ({ id, title: titles.get(id) })),
    rowCount: rowTitles.size,
    dropdownCount: mentionTitles.length,
    renamePrefill: renamed.name,
    watcherBefore,
    watchMode,
    video: videoPath,
  }, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, out, rowCount: rowTitles.size, dropdownCount: mentionTitles.length, watcherBefore, watchMode, video: videoPath }))
} finally {
  if (context) await context.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}
