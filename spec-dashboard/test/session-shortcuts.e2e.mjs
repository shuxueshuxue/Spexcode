import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(new URL('../..', import.meta.url).pathname)
const cliRoot = join(root, 'spec-cli')
const dashboardRoot = join(root, 'spec-dashboard')
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const viteEntry = join(root, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const backendEntry = join(cliRoot, 'src', 'index.ts')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/session-shortcuts-e2e')

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})
const waitFor = async (read, label, timeout = 30_000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`timed out waiting for ${label}`)
}
const stop = async (child) => {
  if (!child || child.exitCode != null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((done) => setTimeout(done, 3_000))])
  if (child.exitCode == null) child.kill('SIGKILL')
}

if (!process.env.CI) {
  if (!existsSync(playwrightPath)) throw new Error(`Playwright missing: ${playwrightPath}`)
  if (!existsSync(chromiumPath)) throw new Error(`Chromium missing: ${chromiumPath}`)
}

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-session-shortcuts-'))
const project = join(fixture, 'project'); const home = join(fixture, 'home')
mkdirSync(project, { recursive: true }); mkdirSync(home, { recursive: true })
const write = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text) }
write(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' } }))
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
execFileSync('git', ['add', '.'], { cwd: project })
execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'seed'], { cwd: project })
const apiPort = await freePort(); const uiPort = await freePort()
const api = `http://127.0.0.1:${apiPort}`; const base = `http://127.0.0.1:${uiPort}`
const env = { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-shortcuts-${process.pid}`, SPEXCODE_API_URL: '', FAKE_HARNESS_INTERVAL_MS: '80' }
let backend; let ui; let browser; let context
try {
  backend = spawn(process.execPath, [tsxCli, backendEntry], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'] })
  
  let backendLog = ''; backend.stdout.on('data', (chunk) => { backendLog += String(chunk) }); backend.stderr.on('data', (chunk) => { backendLog += String(chunk) })
  await waitFor(() => fetch(`${api}/health`).then((response) => response.ok).catch(() => false), 'backend')
  const json = async (path, init) => {
    const response = await fetch(`${api}${path}`, init); const body = await response.json().catch(() => null)
    assert.equal(response.ok, true, `${path} refused: ${response.status} ${JSON.stringify(body)}`); return body
  }
  const create = async (prompt) => {
    const body = await json('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, launcher: 'fake' }) })
    await waitFor(async () => { const row = await json(`/api/sessions/${body.id}`); return row.liveness === 'online' ? row : null }, `${body.id} online`)
    return body.id
  }
  const parent = await create('shortcut parent')
  const child = await create('shortcut child')
  const leaf = await create('shortcut leaf')
  await json('/api/sessions/reparent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ children: [child], parent }) })
  const { preview } = await import(pathToFileURL(viteEntry).href)
  ui = await preview({ root: dashboardRoot, configFile: false, preview: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: api, ws: true } } } })
  await waitFor(() => fetch(base).then((response) => response.ok).catch(() => false), 'dashboard')
  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  const page = await context.newPage()
  await page.addInitScript(() => { localStorage.setItem('spexcode.dock', '1'); localStorage.setItem('spexcode.dockMode', 'sessions') })
  await page.goto(`${base}/#/sessions/${parent}`, { waitUntil: 'domcontentloaded' })
  const row = (id) => page.locator(`.si-item[data-sid="${id}"]`)
  const dockRow = (id) => page.locator(`.dock-session-list [data-sid="${id}"]`)
  await dockRow(parent).waitFor({ state: 'visible' })
  await dockRow(child).waitFor({ state: 'hidden' })
  const fold = page.locator(`[data-session-drop-id="${parent}"] > .sess-fold-control`)
  assert.equal(await fold.getAttribute('aria-expanded'), 'false')
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await page.waitForFunction((id) => document.querySelector(`[data-session-drop-id="${id}"] > .sess-fold-control`)?.getAttribute('aria-expanded') === 'true', parent)
  assert.equal(await dockRow(child).count(), 1, 'Alt+Shift+ArrowDown reveals the child in the real dock')
  await page.keyboard.press('Alt+Shift+ArrowUp')
  await page.waitForFunction((id) => document.querySelector(`[data-session-drop-id="${id}"] > .sess-fold-control`)?.getAttribute('aria-expanded') === 'false', parent)
  assert.equal(await dockRow(child).count(), 0, 'Alt+Shift+ArrowUp folds the child again')
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction((id) => location.hash.includes(`/sessions/${id}`), child)
  assert.equal(await page.locator('.dock-session-list .si-item.on').getAttribute('data-sid'), child)
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction((id) => location.hash.includes(`/sessions/${id}`), leaf)
  assert.equal(await page.locator('.dock-session-list .si-item.on').getAttribute('data-sid'), leaf)
  await page.keyboard.press('Alt+Shift+ArrowDown')
  assert.equal(await page.locator('.dock-session-list .si-item.on').getAttribute('data-sid'), leaf, 'leaf disclosure is a consumed no-op')
  await page.screenshot({ path: join(out, 'session-shortcuts-final.png'), fullPage: true })
  const video = page.video(); await context.close(); const videoPath = await video.path()
  console.log(JSON.stringify({ ok: true, parent, child, leaf, video: videoPath, screenshot: join(out, 'session-shortcuts-final.png') }))
} catch (error) {
  console.error(error); process.exitCode = 1
} finally {
  await stop(backend); if (ui) await ui.close(); if (browser) await browser.close(); rmSync(fixture, { recursive: true, force: true })
}
