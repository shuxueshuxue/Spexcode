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
const dashboardRoot = join(root, 'spec-dashboard')
const sharedRoot = resolve(root, '..', '..')
const modules = join(root, 'node_modules')
const tsxCli = join(sharedRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const fakeLauncher = join(root, 'spec-cli', 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/home/jeffry/spexcode-evidence/ded4-workspace-refactor')
const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close((error) => error ? reject(error) : resolvePort(port)) })
})
const waitFor = async (read, label, timeout = 90_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stop = async (child) => {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolveWait) => setTimeout(resolveWait, 3000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-source-selection-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const tmux = `spex-source-selection-${process.pid}`
let backend
let vite
let browser
try {
  mkdirSync(join(project, '.spec', 'fixture'), { recursive: true })
  mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, '.spec', 'fixture', 'spec.md'), '---\ntitle: fixture\nstatus: active\ncode:\n  - src/fixture.js\n---\n\n# fixture\n\nGoverned fixture.\n')
  writeFileSync(join(project, 'src', 'fixture.js'), 'export function first() {\n  return 1\n}\n\nexport function second() {\n  return 2\n}\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' } }, null, 2))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const apiPort = await freePort()
  const uiPort = await freePort()
  backend = spawn(process.execPath, [tsxCli, join(root, 'spec-cli', 'src', 'index.ts')], {
    cwd: project, env: { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let backendLog = ''
  backend.stdout.on('data', (chunk) => { backendLog += chunk })
  backend.stderr.on('data', (chunk) => { backendLog += chunk })
  try {
    await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((r) => r.ok).catch(() => false), 'backend')
  } catch (error) {
    throw new Error(`${error.message}\n${backendLog}`)
  }

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(join(modules, '@vitejs', 'plugin-react', 'dist', 'index.js')).href)).default
  vite = await createServer({
    root: dashboardRoot, configFile: false, plugins: [react()],
    resolve: { alias: [
      { find: '@spexcode/spec-core/review', replacement: join(modules, '@spexcode', 'spec-core', 'dist', 'review', 'index.js') },
      { find: '@spexcode/spec-core/identity', replacement: join(modules, '@spexcode', 'spec-core', 'dist', 'identity-presets.js') },
      { find: '@spexcode/spec-core', replacement: join(modules, '@spexcode', 'spec-core') },
      { find: 'react', replacement: join(modules, 'react') }, { find: 'react-dom', replacement: join(modules, 'react-dom') },
      { find: '@xyflow/react', replacement: join(modules, '@xyflow', 'react') }, { find: '@xterm/xterm', replacement: join(modules, '@xterm', 'xterm') },
      { find: '@xterm/addon-fit', replacement: join(modules, '@xterm', 'addon-fit') }, { find: 'katex', replacement: join(modules, 'katex') },
      { find: 'markdown-it', replacement: join(modules, 'markdown-it') },
    ] },
    server: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } } },
  })
  await vite.listen()
  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${uiPort}/#/graph/fixture`, { waitUntil: 'domcontentloaded' })
  const node = page.locator('.react-flow__node.selected')
  await node.waitFor({ state: 'visible', timeout: 90_000 })
  await node.click()
  await page.keyboard.press('i')   // dblclick now opens the document; `i` is the popup's door
  await page.locator('.gov-f').first().waitFor({ state: 'visible', timeout: 90_000 })
  await page.locator('.gov-f').first().click()
  await page.locator('.srcview .cm-line').nth(1).waitFor({ state: 'visible', timeout: 90_000 })
  const first = await page.locator('.srcview .cm-line').nth(1).boundingBox()
  const last = await page.locator('.srcview .cm-line').nth(4).boundingBox()
  assert.ok(first && last, 'source lines have screen bounds')
  await page.mouse.move(first.x + 4, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(last.x + Math.min(last.width - 2, 110), last.y + last.height / 2, { steps: 8 })
  await page.mouse.up()
  const action = page.locator('.srcview-select-action')
  await action.waitFor({ state: 'visible', timeout: 10_000 })
  assert.match(await action.textContent(), /selection/i)
  await page.screenshot({ path: join(out, 'm4-source-selection-action.png'), fullPage: true })
  await action.click()
  await page.locator('.si-input').waitFor({ state: 'visible', timeout: 90_000 })
  const chip = page.locator('.si-code-selection-chip')
  await chip.waitFor({ state: 'visible' })
  assert.match((await chip.textContent()) || '', /src\/fixture\.js:2-5/)
  await page.screenshot({ path: join(out, 'm4-selection-chip.png'), fullPage: true })
  const input = page.locator('.si-input')
  await input.fill('Please inspect the selected implementation.')
  assert.equal(await input.inputValue(), 'Please inspect the selected implementation.')
  await chip.locator('.si-code-selection-remove').click()
  await chip.waitFor({ state: 'detached' })
  assert.equal(await page.locator('.si-code-selection-chip').count(), 0)
  assert.doesNotMatch(await input.inputValue(), /spexcode-selection|src\/fixture\.js/)
  await page.screenshot({ path: join(out, 'm4-selection-removed.png'), fullPage: true })
  await input.press('Enter')
  const created = await waitFor(async () => {
    const rows = await fetch(`http://127.0.0.1:${apiPort}/api/sessions?all=1`).then((r) => r.json())
    return rows.find((row) => row.promptPreview?.includes('Please inspect the selected implementation.')) || null
  }, 'edited prompt dispatch')
  assert.ok(created, 'edited prompt launched through the ordinary session path')
  await context.close()
  console.log(JSON.stringify({ ok: true, out, session: created.id }))
} finally {
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}
