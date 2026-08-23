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
const dependencyRoot = existsSync(join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? root : resolve(root, '..', '..')
const tsxCli = join(dependencyRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const viteEntry = join(dependencyRoot, 'node_modules', 'vite', 'dist', 'node', 'index.js')
const fakeLauncher = join(cliRoot, 'test', 'fixtures', 'fake-claude')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || '/tmp/rail-tab-grammar-e2e')
const freePort = () => new Promise((done, fail) => { const s = net.createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)) }) })
const waitFor = async (fn, label, timeout = 30_000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await new Promise((done) => setTimeout(done, 100)) }; throw new Error(`${label} did not settle`) }
const stop = async (child) => { if (!child || child.exitCode != null) return; child.kill('SIGTERM'); await Promise.race([once(child, 'exit'), new Promise((done) => setTimeout(done, 3000))]); if (child.exitCode == null) child.kill('SIGKILL') }

rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-rail-tab-')); const project = join(fixture, 'project'); const home = join(fixture, 'home')
mkdirSync(project, { recursive: true }); mkdirSync(home, { recursive: true })
writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' } }))
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project }); execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project }); execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project }); execFileSync('git', ['add', '.'], { cwd: project }); execFileSync('git', ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'seed'], { cwd: project })
const apiPort = await freePort(); const uiPort = await freePort(); const api = `http://127.0.0.1:${apiPort}`; const base = `http://127.0.0.1:${uiPort}`
const env = { ...process.env, PORT: String(apiPort), SPEXCODE_HOME: home, SPEXCODE_TMUX: `spex-rail-${process.pid}`, SPEXCODE_API_URL: '', FAKE_HARNESS_INTERVAL_MS: '80' }
let backend; let ui; let browser
try {
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], { cwd: project, env, stdio: 'ignore' })
  await waitFor(() => fetch(`${api}/health`).then((r) => r.ok).catch(() => false), 'backend')
  const json = async (path, init) => { const response = await fetch(`${api}${path}`, init); assert.equal(response.ok, true, `${path} ${response.status}`); return response.json() }
  const create = async (prompt) => { const row = await json('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, launcher: 'fake' }) }); await waitFor(() => json(`/api/sessions/${row.id}`).then((s) => s.liveness === 'online')); return row.id }
  const first = await create('rail first'); const second = await create('rail second')
  ui = await (await import(pathToFileURL(viteEntry).href)).preview({ root: dashboardRoot, configFile: false, preview: { host: '127.0.0.1', port: uiPort, strictPort: true, proxy: { '/api': { target: api, ws: true } } } })
  await waitFor(() => fetch(base).then((r) => r.ok).catch(() => false), 'dashboard')
  browser = await (await import(pathToFileURL(playwrightPath).href)).chromium.launch({ executablePath: chromiumPath, headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.addInitScript(() => { localStorage.setItem('spexcode.dock', '1'); localStorage.setItem('spexcode.dockMode', 'sessions'); localStorage.removeItem('spexcode.tabs') })
  await page.goto(`${base}/#/sessions/${first}`, { waitUntil: 'domcontentloaded' }); await page.locator('.side-rail').waitFor(); await page.locator(`[data-sid="${first}"]`).waitFor()
  await page.locator(`[data-sid="${second}"]`).click(); await page.waitForFunction((id) => location.hash.includes(`/sessions/${id}`), second)
  const held = await page.locator('[role="tab"]').count()
  await page.goto(`${base}/#/evals`, { waitUntil: 'domcontentloaded' }); await page.locator('.side-rail').waitFor(); await page.locator('.side-rail a[href="#/sessions"]').click()
  await page.waitForFunction((id) => location.hash.includes(`/sessions/${id}`), second)
  const focused = await page.evaluate(() => ({ hash: location.hash, activeRail: document.querySelectorAll('.side-rail a.rail-btn.on').length, sessionsCurrent: document.querySelector('.side-rail a[href="#/sessions"]')?.getAttribute('aria-current'), graphRail: document.querySelector('.side-rail a[href="#/graph"]')?.getAttribute('href') || null, tabs: document.querySelectorAll('[role="tab"]').length }))
  assert.equal(focused.activeRail, 1); assert.equal(focused.sessionsCurrent, 'page'); assert.equal(focused.graphRail, null); assert.ok(focused.tabs >= held)
  await page.close()
  const cold = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await cold.addInitScript(() => localStorage.setItem('spexcode.tabs', '[]'))
  await cold.goto(`${base}/#/evals`, { waitUntil: 'domcontentloaded' }); await cold.locator('.side-rail a[href="#/sessions"]').click(); await cold.waitForFunction(() => location.hash === '#/sessions'); await cold.locator('.side-rail a[href="#/sessions"][aria-current="page"]').waitFor()
  const empty = await cold.evaluate(() => ({ hash: location.hash, tabs: document.querySelectorAll('[role="tab"]').length, activeRail: document.querySelectorAll('.side-rail a.rail-btn.on').length }))
  assert.deepEqual(empty, { hash: '#/sessions', tabs: 0, activeRail: 1 })
  await cold.screenshot({ path: join(out, 'rail-tab-grammar-final.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, first, second, held, focused, empty, screenshot: join(out, 'rail-tab-grammar-final.png') }))
} finally { await stop(backend); if (ui) await ui.close(); if (browser) await browser.close(); rmSync(fixture, { recursive: true, force: true }) }
