import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const spexBin = join(root, 'spec-cli', 'bin', 'spex.mjs')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/snap/bin/chromium'
const base = process.env.BASE || 'http://127.0.0.1:5198'
const out = resolve(process.env.OUT || join(tmpdir(), `page-scroll-e2e-${Date.now()}`))
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const { chromium } = await import(pathToFileURL(playwrightPath).href)

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port
    server.close(() => resolvePort(port))
  })
})

const waitFor = async (fn, label, timeout = 45_000) => {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try { if (await fn()) return } catch (error) { last = error }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`${label} did not settle${last ? `: ${last.message}` : ''}`)
}

const services = new Set()
const service = (args, cwd, home) => {
  const env = { ...process.env, SPEXCODE_HOME: home }
  delete env.PORT
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  delete env.SPEXCODE_INSTANCE_ID
  const child = spawn(process.execPath, [spexBin, ...args], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  })
  services.add(child)
  return child
}

const stop = async (child) => {
  if (!child || child.exitCode !== null) return
  try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
  ])
  if (child.exitCode === null) {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
  }
  services.delete(child)
}

async function startProjectsHost() {
  const home = mkdtempSync(join(tmpdir(), 'page-scroll-home-'))
  const repos = mkdtempSync(join(tmpdir(), 'page-scroll-projects-'))
  const backends = []
  for (const [folder, title] of [['atlas', 'Atlas Lab'], ['rocket', 'Rocket Yard']]) {
    const dir = join(repos, folder)
    mkdirSync(join(dir, '.spec', 'project'), { recursive: true })
    writeFileSync(join(dir, '.spec', 'project', 'spec.md'), `---\ntitle: ${title}\ndesc: page scroll fixture\n---\n# project\n\n${title} fixture.\n`)
    writeFileSync(join(dir, 'spexcode.json'), `${JSON.stringify({ harnesses: ['codex'], dashboard: { title } }, null, 2)}\n`)
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
    execFileSync('git', ['config', 'user.email', 'page-scroll@test'], { cwd: dir })
    execFileSync('git', ['config', 'user.name', 'page-scroll'], { cwd: dir })
    execFileSync('git', ['add', '.'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'seed'], { cwd: dir })
    const port = await freePort()
    backends.push(service(['serve', '--port', String(port)], dir, home))
    await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/health`)).ok, `${title} backend`)
  }
  const port = await freePort()
  const gateway = service(['dashboard', '--port', String(port)], root, home)
  const projectsBase = `http://127.0.0.1:${port}`
  await waitFor(async () => {
    const response = await fetch(`${projectsBase}/projects`, { headers: { Accept: 'application/json' } })
    if (!response.ok) return false
    const data = await response.json()
    return data.projects?.filter((project) => project.online).length === 2
  }, 'Projects host')
  return { base: projectsBase, close: async () => {
    await stop(gateway)
    await Promise.all(backends.map(stop))
    rmSync(home, { recursive: true, force: true })
    rmSync(repos, { recursive: true, force: true })
  } }
}

async function runScenario(browser, projectsBase, { name, title, viewport, mobile }) {
  // e2e-review's splitter pairs the lone WebM and timeline beside each other. Keep each recorded
  // scenario in its own directory so concurrent viewport recordings cannot be cross-paired.
  const scenarioDir = join(out, name)
  const rawDir = join(scenarioDir, 'raw')
  mkdirSync(rawDir, { recursive: true })
  const context = await browser.newContext({ viewport, recordVideo: { dir: rawDir, size: viewport } })
  const page = await context.newPage()
  const video = page.video()
  const started = Date.now()
  const events = [{ atMs: 0, kind: 'narrate', label: `▶ ${name} · ${title}` }]
  const readings = {}
  const frame = async (label, screenshot = true) => {
    events.push({ atMs: Date.now() - started, kind: 'frame', label: `📷 ${label}` })
    if (screenshot) await page.screenshot({ path: join(out, `${name}-${label}.png`) })
  }
  const settle = async (selector) => {
    await page.locator(selector).first().waitFor({ state: 'visible', timeout: 30_000 })
    await page.waitForTimeout(450)
  }
  const horizontalOverflow = () => page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
    scrollers: [...document.querySelectorAll('body *')].filter((element) => {
      if (!element.getClientRects().length) return false
      const overflow = getComputedStyle(element).overflowX
      return /auto|scroll/.test(overflow) && element.scrollWidth > element.clientWidth + 1
    }).map((element) => ({ className: String(element.className), extra: element.scrollWidth - element.clientWidth })),
  }))
  const readScroll = () => page.evaluate(() => {
    const owner = document.querySelector('.page-scroll')
    const shell = owner?.closest('.page-pane,.m-review,.m-main') || document.querySelector('.page-projects')
    const box = (element) => {
      if (!element) return null
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height }
    }
    const style = owner ? getComputedStyle(owner) : null
    return {
      count: document.querySelectorAll('.page-scroll').length,
      owner: box(owner), shell: box(shell),
      scrollTop: owner?.scrollTop ?? null, clientHeight: owner?.clientHeight ?? null,
      scrollHeight: owner?.scrollHeight ?? null,
      overflowX: style?.overflowX ?? null, overflowY: style?.overflowY ?? null,
      gutter: style?.scrollbarGutter ?? null,
      sticky: [...document.querySelectorAll('.lp-head,.ds-side')].filter((element) => element.getClientRects().length).map((element) => ({
        className: element.className, position: getComputedStyle(element).position, ...box(element),
      })),
    }
  })
  const assertPageScroll = async (label, { scroll = true, sidePosition = null } = {}) => {
    const top = await readScroll()
    assert.equal(top.count, 1, `${label}: exactly one page-scroll owner`)
    assert.equal(top.owner.y, 10, `${label}: track begins at 10px`)
    assert.equal(top.shell.bottom - top.owner.bottom, 10, `${label}: track ends 10px above shell bottom`)
    assert.equal(top.overflowX, 'hidden', `${label}: one-axis page scroll`)
    assert.equal(top.overflowY, 'auto', `${label}: vertical owner`)
    assert.equal(top.gutter, mobile ? 'auto' : 'stable', `${label}: responsive gutter contract`)
    assert.deepEqual(await horizontalOverflow(), { document: 0, body: 0, scrollers: [] }, `${label}: no horizontal overflow`)
    if (sidePosition) {
      const side = top.sticky.find((item) => String(item.className).includes('ds-side'))
      assert.equal(side?.position, sidePosition, `${label}: detail rail position`)
    }
    await frame(`${label}-top`)
    if (scroll && top.scrollHeight > top.clientHeight + 1) {
      await page.locator('.page-scroll').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2 })
      await page.waitForTimeout(180)
      const middle = await readScroll()
      const head = middle.sticky.find((item) => String(item.className).includes('lp-head'))
      if (head) assert.ok(Math.abs(head.y - middle.owner.y) <= 1, `${label}: sticky header pins to page-scroll top`)
      await frame(`${label}-middle`)
      await page.locator('.page-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.waitForTimeout(180)
      await frame(`${label}-bottom`)
    }
    readings[label] = top
    return top
  }
  const openMiddleRow = async () => {
    const rows = page.locator('.lp-row[href]')
    const row = rows.nth(Math.floor((await rows.count()) * .45))
    await row.scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    const before = await page.locator('.page-scroll').evaluate((element) => element.scrollTop)
    await row.click()
    await settle('.ds-page')
    return before
  }

  await page.goto(`${base}/#/graph`)
  await settle(mobile ? '.m-specs' : '.graph')
  assert.equal(await page.locator('.page-scroll').count(), 0, 'Graph keeps canvas/mobile-plane geometry')
  await frame('graph')

  if (mobile) {
    await page.locator('.m-tabbar-btn').nth(1).click()
    await settle('.m-sesslist')
  } else {
    await page.goto(`${base}/#/sessions`)
    await settle('.si-page')
  }
  assert.equal(await page.locator('.page-scroll').count(), 0, 'Sessions keeps pane-local geometry')
  await frame('sessions')

  await page.goto(`${base}/#/evals`)
  await settle('.lp-page')
  const total = await page.locator('.lp-row').count()
  const buttons = page.locator('.rl-section')
  assert.equal(await buttons.count(), 2)
  assert.match(await buttons.nth(0).innerText(), /^Fail\n\d+$/)
  assert.match(await buttons.nth(1).innerText(), /^Pass\n\d+$/)
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'false')
  assert.equal(await buttons.nth(1).getAttribute('aria-pressed'), 'false')
  assert.match(await page.locator('.rl-sections').ariaSnapshot(), /group "Evals"[\s\S]*button "Fail \d+"[\s\S]*button "Pass \d+"/)
  await assertPageScroll('evals-list')

  await buttons.nth(0).click()
  await page.waitForTimeout(180)
  const failRows = await page.locator('.lp-row').count()
  assert.match(await page.evaluate(() => location.hash), /verdict%3Afail/)
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'true')
  await frame('evals-fail')
  await buttons.nth(0).click()
  await page.waitForTimeout(180)
  assert.equal(await page.evaluate(() => location.hash), '#/evals')
  assert.equal(await page.locator('.lp-row').count(), total)
  await buttons.nth(1).click()
  await page.waitForTimeout(180)
  const passRows = await page.locator('.lp-row').count()
  assert.ok(failRows + passRows <= total, 'Fail/Pass stays non-exhaustive')
  await page.goBack()
  await settle('.lp-page')
  assert.equal(await page.evaluate(() => location.hash), '#/evals')
  assert.equal(await page.locator('.rl-section').nth(1).getAttribute('aria-pressed'), 'false')

  await page.locator('.rl-overflow-btn').click()
  const reviewGroup = page.getByRole('group', { name: mobile ? /Human review|人工复核/ : 'Human review' })
  await reviewGroup.waitFor({ state: 'visible' })
  assert.match(await reviewGroup.ariaSnapshot(), /radio "Needs review"/)
  await reviewGroup.getByRole('menuitemradio', { name: 'Needs review' }).click()
  await page.waitForTimeout(180)
  assert.match(await page.evaluate(() => location.hash), /state%3Acurrent/)
  await page.goBack()
  await settle('.lp-page')

  const evalBefore = await openMiddleRow()
  await assertPageScroll('evals-detail', { sidePosition: mobile ? 'static' : 'sticky' })
  await page.goBack()
  await settle('.lp-page')
  assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), evalBefore, 'Evals Back restores exact list scrollTop')
  await frame('evals-back-restored')

  await page.goto(`${base}/#/issues`)
  await settle('.lp-page')
  assert.equal(await page.locator('.rl-sections').getAttribute('role'), 'tablist')
  await assertPageScroll('issues-list')
  const issueBefore = await openMiddleRow()
  await assertPageScroll('issues-detail', { sidePosition: mobile ? 'static' : 'sticky' })
  await page.goBack()
  await settle('.lp-page')
  assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), issueBefore, 'Issues Back restores exact list scrollTop')
  await frame('issues-back-restored')

  if (!mobile) {
    await page.goto(`${base}/#/settings`)
    await settle('.page-settings-scroll')
    const themes = [
      ['Minimal', 'minimal'], ['Things', 'things'], ['Tokyo Night', 'tokyonight'], ['Catppuccin', 'catppuccin'],
      ['Everforest', 'everforest'], ['Gruvbox', 'gruvbox'], ['Rosé Pine Dawn', 'rosepine'], ['Dracula', 'dracula'],
    ]
    for (const [label, code] of themes) {
      await page.getByRole('button', { name: label, exact: true }).click()
      assert.equal(await page.locator('html').getAttribute('data-theme'), code)
      const geometry = await readScroll()
      assert.equal(geometry.owner.y, 10)
      assert.equal(geometry.shell.bottom - geometry.owner.bottom, 10)
    }
    await assertPageScroll('settings', { scroll: false })
  }

  await page.goto(`${projectsBase}/projects`)
  await settle('.page-projects-scroll')
  assert.equal(await page.locator('.proj-row').count(), 2, 'real Projects host renders both fixture projects')
  await assertPageScroll('projects')

  await context.close()
  const videoPath = join(scenarioDir, `${name}.webm`)
  renameSync(await video.path(), videoPath)
  rmSync(rawDir, { recursive: true, force: true })
  writeFileSync(join(scenarioDir, `${name}.timeline.json`), `${JSON.stringify({ events }, null, 2)}\n`)
  return { name, viewport, failRows, passRows, total, readings, events }
}

let browser
let projects
const results = []
try {
  projects = await startProjectsHost()
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  results.push(await runScenario(browser, projects.base, {
    name: 'shared-page-scroll-desktop', title: '1440 page scroll, verdict hierarchy, themes, and Back',
    viewport: { width: 1440, height: 900 }, mobile: false,
  }))
  results.push(await runScenario(browser, projects.base, {
    name: 'shared-page-scroll-mobile', title: '390 page scroll, one-axis overflow, and Back',
    viewport: { width: 390, height: 844 }, mobile: true,
  }))
  writeFileSync(join(out, 'result.json'), `${JSON.stringify({ base, projectsBase: projects.base, results }, null, 2)}\n`)
  console.log(`PASS page-scroll e2e — evidence: ${out}`)
} finally {
  if (browser) await browser.close()
  if (projects) await projects.close()
  await Promise.all([...services].map(stop))
}
