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
const dashboardRoot = join(root, 'spec-dashboard')
const sharedRoot = resolve(root, '..', '..')
const dependencyRoot = existsSync(join(cliRoot, 'node_modules')) ? root : sharedRoot
const tsxCli = join(dependencyRoot, 'spec-cli', 'node_modules', 'tsx', 'dist', 'cli.mjs')
const modules = join(dependencyRoot, 'spec-dashboard', 'node_modules')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-note-title-e2e')
const id = 'session-note-title-target'
const title = 'Session title must survive lifecycle notes'
const note = 'This is a lifecycle note. It belongs in the timeline and must not rename this session.'
const derivedTitle = `${note.slice(0, 59)}…`

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

const waitFor = async (read, label, timeout = 10_000) => {
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

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-session-note-title-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const recordDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
const recordPath = join(recordDir, 'session.json')
let backend
let vite
let browser
let context
let page
let videoPath = null

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: session title fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'spexcode.json'), '{}\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'fixture@example.test')
  git(project, 'config', 'user.name', 'fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'seed')
  mkdirSync(recordDir, { recursive: true })
  writeFileSync(recordPath, JSON.stringify({
    session_id: id, governed: true, worktree_path: project, branch: 'main', title, name: '', parent: '',
    status: 'active', proposal: '', merges: 0, note, sortkey: '', createdAt: Date.now(), harness: 'claude',
    harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture',
    launch_cmd: 'true', launch_owner: 'http://fixture.invalid', create_request_id: '', create_payload_hash: '', launch_readiness_pending: null,
  }, null, 2) + '\n')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const base = `http://127.0.0.1:${uiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-note-title-${process.pid}`, SPEXCODE_API_URL: '' },
    stdio: 'ignore',
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

  const graph = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/graph`)
    if (!response.ok) return null
    return (await response.json()).sessions.find((session) => session.id === id) || null
  }, 'fixture session projection')
  assert.equal(graph.title, derivedTitle, 'the API title falls through to the note when no live summary exists')
  assert.equal(graph.note, note, 'the note remains separately available on the wire')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  page = await context.newPage()
  await page.goto(`${base}/#/sessions/${id}`, { waitUntil: 'domcontentloaded' })
  const rowTitle = page.locator(`.si-item[data-sid="${id}"] .sess-id`)
  await rowTitle.waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal((await rowTitle.textContent())?.trim(), derivedTitle, 'the dashboard row uses the note fallback')
  await page.screenshot({ path: join(out, 'note-does-not-replace-title.png'), fullPage: true })

  const video = page.video()
  await context.close()
  videoPath = video ? await video.path() : null
  await browser.close()
  browser = null
  context = null
  writeFileSync(join(out, 'result.json'), JSON.stringify({ id, title, note, derivedTitle: graph.title, video: videoPath }, null, 2))
  console.log(JSON.stringify({ ok: true, out, video: videoPath }))
} finally {
  if (context) await context.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}
