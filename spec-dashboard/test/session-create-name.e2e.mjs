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
const out = resolve(process.env.OUT || '/tmp/session-create-name-e2e')

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
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
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
const fixture = mkdtempSync(join(tmpdir(), 'spex-session-create-name-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-create-name-${process.pid}`
let backend
let vite
let browser

try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), [
    '---', 'title: fixture', 'status: active', 'hue: 180', 'desc: session create name fixture', '---',
    '# fixture', '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fixture: { harness: 'claude', cmd: 'true' } }, defaultLauncher: 'fixture' },
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
    env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, SPEXCODE_API_URL: '' },
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

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const base = `http://127.0.0.1:${uiPort}`
  const name = 'CLI-authored session name'
  const prompt = 'create this session through the CLI'
  const cliEnv = { ...process.env, SPEXCODE_API_URL: '' }
  for (const key of ['SPEXCODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'PI_SESSION_ID', 'OPENCODE_SESSION_ID']) delete cliEnv[key]
  const cli = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'cli.ts'), 'session', 'new', prompt, '--name', name, '--api', `http://127.0.0.1:${apiPort}`], {
    cwd: project, env: cliEnv, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  cli.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
  cli.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
  const [code] = await once(cli, 'close')
  assert.equal(code, 0, stderr)
  const created = JSON.parse(stdout)
  assert.equal(created.raw.name, name, 'CLI --name writes the existing record field')
  assert.equal(created.title, name, 'the API title derives from the CLI name')
  assert.equal(created.label, name, 'the compatible selector handle comes from the same name')
  assert.equal(created.prompt, prompt, 'the CLI name does not alter the launch prompt')

  await page.goto(`${base}/#/sessions/new`, { waitUntil: 'domcontentloaded' })
  await page.locator('.si-input').waitFor({ state: 'visible', timeout: 15_000 })
  assert.equal(await page.locator('.si-new-name').count(), 0, 'Dashboard New Session exposes no name authoring input')
  const dashboardPrompt = 'create this session through the Dashboard'
  await page.locator('.si-input').fill(dashboardPrompt)
  await page.locator('.si-input').press('Enter')

  const dashboardCreated = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/sessions?all=1`)
    if (!response.ok) return null
    // A board row carries the ask only as its one-line preview; the full text lives on the id-addressed
    // detail. This prompt is shorter than HEADLINE_PREVIEW_COLUMNS, so its preview is the ask verbatim.
    return (await response.json()).find((session) => session.promptPreview === dashboardPrompt) || null
  }, 'ordinary Dashboard-created session')
  assert.equal(dashboardCreated.raw.name, null, 'Dashboard creates without a hidden name payload')
  await page.locator(`.si-item[data-sid="${created.id}"] .sess-id`).waitFor({ state: 'visible', timeout: 15_000 })
  assert.equal((await page.locator(`.si-item[data-sid="${created.id}"] .sess-id`).textContent())?.trim(), name, 'the Dashboard renders the server-derived CLI name')
  await page.screenshot({ path: join(out, 'named-dashboard-session.png'), fullPage: true })
  await context.close()
  await browser.close()
  browser = null
  writeFileSync(join(out, 'result.json'), JSON.stringify({ id: created.id, name, title: created.title, label: created.label, prompt, dashboardId: dashboardCreated.id }, null, 2))
  console.log(JSON.stringify({ ok: true, out, id: created.id, name }))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch {}
  rmSync(fixture, { recursive: true, force: true })
}
