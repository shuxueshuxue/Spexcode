// Real CLI -> backend -> browser proof for [[remark-polish]] strand 3. The fixture owns its Git project and
// disposable issue store; the dashboard API remains unmocked so this exercises the node-level projection.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
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
const moduleCandidates = [
  process.env.SPEXCODE_E2E_MODULES,
  ...workspaceRoots.map((candidate) => join(candidate, 'node_modules')),
  ...workspaceRoots.map((candidate) => join(candidate, 'spec-dashboard', 'node_modules')),
  join(dashboardRoot, 'node_modules'),
].filter(Boolean)
const pluginPath = (candidate) => [
  join(candidate, '@vitejs', 'plugin-react', 'dist', 'index.mjs'),
  join(candidate, '@vitejs', 'plugin-react', 'dist', 'index.js'),
].find(existsSync)
const modules = moduleCandidates.find((candidate) =>
  existsSync(join(candidate, 'vite', 'dist', 'node', 'index.js')) && pluginPath(candidate),
)
if (!modules) throw new Error('dashboard node_modules is missing (set SPEXCODE_E2E_MODULES to a dependency directory)')

const tsxCli = join(tsxRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const cli = join(cliRoot, 'src', 'cli.ts')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const out = resolve(process.env.OUT || `/tmp/remark-polish-dangling-orphan-${process.pid}`)
const nodeId = 'orphan-fixture'
const orphanScenario = 'old-name'
const retainedScenario = 'keep'
const remarkBody = 'This remark must remain visible after the scenario is gone.'

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
const evalSource = (includeOrphan) => [
  '---', 'scenarios:',
  ...(includeOrphan ? [
    `  - name: ${orphanScenario}`,
    '    tags: [cli, frontend-e2e]',
    '    description: A scenario that will be removed after its remark is authored.',
    '    expected: Its remark becomes a dangling node-level track.',
  ] : []),
  `  - name: ${retainedScenario}`,
  '    tags: [cli]',
  '    description: A declared but unmeasured control scenario.',
  '    expected: It stays a blind spot, not a dangling track.',
  '---', '',
  '# fixture evals', '',
].join('\n')

if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

mkdirSync(out, { recursive: true })
const fixture = mkdtempSync(join(tmpdir(), 'spex-remark-polish-'))
const project = join(fixture, 'project')
const home = join(fixture, 'home')
const issues = join(fixture, 'issues')
const timeline = []
let startedAt = 0
let backend
let vite
let browser
let context
let videoPath = null
let watchMode = 'native'
const watcherBefore = inotifyWatchCount()

try {
  mkdirSync(join(project, '.spec', nodeId), { recursive: true })
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(project, '.spec', nodeId, 'spec.md'), [
    '---', `title: ${nodeId}`, 'status: active', 'hue: 180', 'desc: Disposable dangling remark fixture', '---',
    `# ${nodeId}`, '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n'))
  writeFileSync(join(project, '.spec', nodeId, 'eval.md'), evalSource(true))
  writeFileSync(join(project, '.spec/spexcode.json'), '{}\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'seed'], { cwd: project })

  const fixtureEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_ISSUES_DIR: issues,
    SPEXCODE_SESSION_ID: 'remark-fixture-author',
    SPEXCODE_API_URL: '',
  }
  const runCli = (args) => {
    const result = spawnSync(process.execPath, [tsxCli, cli, ...args], { cwd: project, env: fixtureEnv, encoding: 'utf8' })
    assert.equal(result.status, 0, `spex ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
    return { stdout: result.stdout, stderr: result.stderr }
  }

  const added = runCli(['remark', 'add', nodeId, '--scenario', orphanScenario, '--body', remarkBody])
  const ref = /^remark\s+(\S+)/m.exec(added.stdout)?.[1]
  assert.ok(ref, `remark add prints its normal ref:\n${added.stdout}`)
  const beforeRemoval = runCli(['eval', 'lint'])
  assert.doesNotMatch(beforeRemoval.stderr, /eval-dangling/, 'a declared but unmeasured scenario is not an orphan')

  writeFileSync(join(project, '.spec', nodeId, 'eval.md'), evalSource(false))
  const lint = runCli(['eval', 'lint'])
  assert.match(lint.stderr, new RegExp(`eval-dangling: '${nodeId}'`), 'the current CLI names the orphaned node')
  assert.match(lint.stderr, new RegExp(`'${orphanScenario}'`), 'the current CLI names the deleted scenario')
  assert.match(lint.stderr, /1 dangling/, 'the CLI summary counts the one orphaned track')

  const apiPort = await freePort()
  const uiPort = await freePort()
  const base = `http://127.0.0.1:${uiPort}`
  backend = spawn(process.execPath, [tsxCli, join(cliRoot, 'src', 'index.ts')], {
    cwd: project,
    env: { ...fixtureEnv, PORT: String(apiPort), SPEXCODE_TMUX: `spex-remark-polish-${process.pid}` },
    stdio: 'ignore',
  })
  await waitFor(() => fetch(`http://127.0.0.1:${apiPort}/health`).then((response) => response.ok).catch(() => false), 'isolated backend')

  const { createServer } = await import(pathToFileURL(join(modules, 'vite', 'dist', 'node', 'index.js')).href)
  const react = (await import(pathToFileURL(pluginPath(modules)).href)).default
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

  const graph = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/graph`)
    if (!response.ok) return null
    return (await response.json()).nodes.find((node) => node.id === nodeId) || null
  }, 'fixture node in the real graph')
  assert.equal(graph.id, nodeId)
  const response = await fetch(`http://127.0.0.1:${apiPort}/api/evals?q=${encodeURIComponent(`is:eval node:${nodeId}`)}&view=timeline`)
  assert.equal(response.ok, true, `node timeline HTTP ${response.status}`)
  const timelineModel = await response.json()
  const dangling = timelineModel.items.filter((item) => item.filterKind === 'dangling')
  assert.equal(dangling.length, 1, 'the real node timeline has exactly one dangling row')
  assert.equal(dangling[0].scenario, orphanScenario)
  assert.equal(dangling[0].remarks[0].ref, ref, 'the node timeline carries the CLI-created normal remark ref')
  assert.equal(timelineModel.items.some((item) => item.filterKind === 'result' && item.scenario === orphanScenario), false,
    'the orphan does not contaminate latest readings or the scoreboard')

  const { chromium } = await import(pathToFileURL(playwrightPath).href)
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: out, size: { width: 1280, height: 800 } } })
  const page = await context.newPage()
  startedAt = Date.now()
  const step = (name) => timeline.push({ at: Date.now() - startedAt, step: name })
  await page.goto(`${base}/#/graph/${nodeId}`, { waitUntil: 'domcontentloaded' })
  const selected = page.locator(`.react-flow__node.selected[data-id="${nodeId}"]`)
  await selected.waitFor({ state: 'visible', timeout: 15_000 })
  await selected.click()
  await page.keyboard.press('i')   // dblclick now opens the document; `i` is the popup's door
  await page.locator('.ov-panel').waitFor({ state: 'visible', timeout: 10_000 })
  const timelineRequest = page.waitForResponse((res) => {
    const url = new URL(res.url())
    return url.pathname === '/api/evals' && url.searchParams.get('view') === 'timeline' && url.searchParams.get('q')?.includes(`node:${nodeId}`)
  })
  await page.locator('.ov-tab').filter({ hasText: /eval/i }).click()
  const browserTimeline = await (await timelineRequest).json()
  assert.equal(browserTimeline.items.filter((item) => item.filterKind === 'dangling').length, 1,
    'the browser gets the same real dangling timeline model')
  const row = page.locator('.eval-dangling-row')
  await row.waitFor({ state: 'visible', timeout: 10_000 })
  assert.equal((await row.locator('.eval-dangling-name').textContent())?.trim(), orphanScenario,
    'NodeView renders the removed scenario name')
  assert.match((await row.locator('.eval-dangling-remarks').textContent()) || '', new RegExp(remarkBody),
    'NodeView renders the remark instead of dropping the orphaned track')
  const struck = await row.locator('.eval-dangling-name').evaluate((element) => getComputedStyle(element).textDecorationLine)
  assert.ok(struck.includes('line-through'), `NodeView marks the scenario gone (got ${struck})`)
  step('NodeView shows the struck-through dangling row from the real timeline')
  await page.screenshot({ path: join(out, 'dangling-orphan-nodeview.png'), fullPage: true })
  await page.waitForTimeout(300)
  const video = page.video()
  await context.close()
  videoPath = video ? await video.path() : null
  context = null
  await browser.close()
  browser = null

  const retracted = runCli(['remark', 'retract', ref])
  assert.match(retracted.stdout, new RegExp(`retracted remark ${ref}`), 'the normal CLI ref retracts the orphaned remark')
  const cleared = runCli(['eval', 'lint'])
  assert.doesNotMatch(cleared.stderr, /eval-dangling/, 'retracting the only remark clears the dangling track')

  writeFileSync(join(out, 'timeline.json'), JSON.stringify({ v: 2, axis: 'time', events: timeline }, null, 2) + '\n')
  writeFileSync(join(out, 'result.json'), JSON.stringify({
    nodeId, orphanScenario, retainedScenario, ref, watchMode, watcherBefore, video: videoPath,
    cli: { dangling: lint.stderr, cleared: cleared.stderr },
    api: { itemCount: timelineModel.items.length, danglingCount: dangling.length, resultForOrphan: false },
    browser: { scenario: orphanScenario, struckThrough: struck, remarkVisible: true },
  }, null, 2) + '\n')
  console.log(JSON.stringify({ ok: true, out, nodeId, ref, watchMode, video: videoPath }))
} finally {
  if (context) await context.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (vite) await vite.close().catch(() => {})
  await stop(backend)
  rmSync(fixture, { recursive: true, force: true })
}
