// [[page-scroll]] YATU: the ONE document scrollport, measured in a real Chromium against a live stack.
// Graph and Sessions keep pane-local geometry; the Issues list, a queried Issues list, an Issues detail,
// Settings and the Projects hub share one inset, gutter-stable, one-axis owner whose sticky children pin
// against IT (not the document) and whose position comes back exactly on browser Back, per address.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ISSUE_QUERY_DEFAULT, setToken } from '@spexcode/spec-core/review'

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

// the bare list's own request text and the one query state this driver walks beside it — the text the
// Closed tab pushes — serialized the way the app prints a list address (`%20`, never `+`).
const ISSUE_DEFAULT = ISSUE_QUERY_DEFAULT
const QUERIED_TEXT = setToken(ISSUE_QUERY_DEFAULT, 'state', 'closed')
const queriedHash = `#/issues?${new URLSearchParams({ q: QUERIED_TEXT }).toString().replace(/\+/g, '%20')}`

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
    writeFileSync(join(dir, '.spec/spexcode.json'), `${JSON.stringify({ harnesses: ['codex'], dashboard: { title } }, null, 2)}\n`)
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

async function findLongDetail(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.goto(`${base}/#/${route}`)
    await page.locator('.lp-row-link[href]').first().waitFor({ state: 'visible', timeout: 30_000 })
    const hrefs = await page.locator('.lp-row-link[href]').evaluateAll((rows) => rows.map((row) => row.getAttribute('href')))
    let best = { href: null, scrollHeight: 0, clientHeight: 0 }
    for (const href of hrefs.slice(0, 150)) {
      // the workspace keeps documents mounted while hidden ([[workspace-shell]]): mark the detail on screen
      // before moving, so the next measurement waits for the NEW pane, never the one still showing.
      await page.evaluate((next) => {
        for (const shown of document.querySelectorAll('.ds-page')) shown.dataset.pageScrollSeen = '1'
        location.hash = next
      }, href)
      await page.waitForFunction((next) => location.hash === next, href)
      await page.locator('.ds-page:visible:not([data-page-scroll-seen])').waitFor({ state: 'visible' })
      await page.waitForTimeout(40)
      const size = await page.locator('.page-scroll:visible').evaluate((element) => ({
        scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
      }))
      if (size.scrollHeight > best.scrollHeight) best = { href, ...size }
      if (size.scrollHeight > size.clientHeight + 400) break
    }
    assert.ok(best.href && best.scrollHeight > best.clientHeight + 400,
      `${route}: real data must provide a desktop detail long enough to exercise sticky scrolling`)
    return best
  } finally {
    await context.close()
  }
}

async function runScenario(browser, projectsBase, { name, title, viewport, mobile, longDetail }) {
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
  // pooled documents stay mounted while hidden, so every selector below means the one on SCREEN.
  const settle = async (selector) => {
    await page.locator(`${selector}:visible`).first().waitFor({ state: 'visible', timeout: 30_000 })
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
    const owners = [...document.querySelectorAll('.page-scroll')].filter((element) => element.getClientRects().length)
    const owner = owners[0]
    // the pane whose available viewport the primitive fills: a workspace view host on desktop, the phone's
    // review plane, the projects hub's own page.
    const shell = owner?.closest('.viewhost,.m-review,.m-main') || document.querySelector('.page-projects')
    const box = (element) => {
      if (!element) return null
      const bounds = element.getBoundingClientRect()
      return { x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height }
    }
    const style = owner ? getComputedStyle(owner) : null
    return {
      count: owners.length,
      owner: box(owner), shell: box(shell),
      scrollTop: owner?.scrollTop ?? null, clientHeight: owner?.clientHeight ?? null,
      scrollHeight: owner?.scrollHeight ?? null,
      overflowX: style?.overflowX ?? null, overflowY: style?.overflowY ?? null,
      gutter: style?.scrollbarGutter ?? null,
      sticky: [...document.querySelectorAll('.rl-query,.lp-head,.ds-side')].filter((element) => element.getClientRects().length).map((element) => ({
        className: element.className,
        position: getComputedStyle(element).position,
        top: getComputedStyle(element).top,
        zIndex: getComputedStyle(element).zIndex,
        ...box(element),
      })),
    }
  })
  const stickyOf = (geometry, name) => geometry.sticky.find((item) => String(item.className).split(/\s+/).includes(name))
  const assertGeometry = async (label, { sidePosition = null } = {}) => {
    const geometry = await readScroll()
    assert.equal(geometry.count, 1, `${label}: exactly one page-scroll owner on screen`)
    assert.equal(geometry.owner.y - geometry.shell.y, 10, `${label}: track begins 10px below shell top`)
    assert.equal(geometry.shell.bottom - geometry.owner.bottom, 10, `${label}: track ends 10px above shell bottom`)
    assert.equal(geometry.overflowX, 'hidden', `${label}: one-axis page scroll`)
    assert.equal(geometry.overflowY, 'auto', `${label}: vertical owner`)
    assert.equal(geometry.gutter, mobile ? 'auto' : 'stable', `${label}: responsive gutter contract`)
    assert.deepEqual(await horizontalOverflow(), { document: 0, body: 0, scrollers: [] }, `${label}: no horizontal overflow`)
    if (sidePosition) {
      assert.equal(stickyOf(geometry, 'ds-side')?.position, sidePosition, `${label}: detail rail position`)
    }
    return geometry
  }
  const assertPageScroll = async (label, { scroll = true, sidePosition = null } = {}) => {
    const top = await assertGeometry(label, { sidePosition })
    await frame(`${label}-top`)
    if (scroll && top.scrollHeight > top.clientHeight + 1) {
      await page.locator('.page-scroll:visible').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2 })
      await page.waitForTimeout(180)
      const middle = await readScroll()
      const head = stickyOf(middle, 'lp-head')
      if (head) {
        // the list's two sticky bands measure their offsets from the inset scrollport: the query row
        // at its top edge, the section/facet header at its own sticky offset below that pinned query.
        // Against the document those offsets would land 10px higher.
        const query = stickyOf(middle, 'rl-query')
        assert.equal(query?.position, 'sticky', `${label}: list query row is sticky`)
        assert.ok(Math.abs(query.y - (middle.owner.y + parseFloat(query.top))) <= 1, `${label}: sticky query row pins at the PageScroll inset`)
        assert.equal(head.position, 'sticky', `${label}: list header is sticky`)
        assert.ok(Math.abs(head.y - (middle.owner.y + parseFloat(head.top))) <= 1, `${label}: sticky header offsets from the inset PageScroll`)
        assert.ok(head.y >= query.bottom - 1, `${label}: sticky header pins below the pinned query row`)
      }
      const side = stickyOf(middle, 'ds-side')
      const topSide = stickyOf(top, 'ds-side')
      if (sidePosition === 'sticky') {
        assert.ok(side.y < topSide.y, `${label}: detail rail moves into its sticky position`)
        assert.ok(side.y >= middle.owner.y && side.bottom <= middle.owner.bottom, `${label}: sticky detail rail stays inside page-scroll`)
      }
      await frame(`${label}-middle`)
      await page.locator('.page-scroll:visible').evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.waitForTimeout(180)
      if (sidePosition === 'sticky') {
        const bottom = await readScroll()
        const bottomSide = stickyOf(bottom, 'ds-side')
        assert.ok(Math.abs(bottomSide.y - side.y) <= 1, `${label}: detail rail stays pinned through bottom`)
        assert.ok(bottomSide.bottom <= bottom.owner.bottom, `${label}: pinned detail rail never escapes page-scroll`)
      }
      await frame(`${label}-bottom`)
    }
    readings[label] = top
    return top
  }
  // run `action`, then wait for the list page it produces: the /api/issues answer for `text` (page 1)
  // and the rows that answer paints — never the clock.
  const listUpdate = async (text, action) => {
    const waiting = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname.endsWith('/api/issues') && url.searchParams.get('q') === text && url.searchParams.get('page') === '1'
    }, { timeout: 30_000 })
    await action()
    const data = await (await waiting).json()
    await page.waitForFunction((expected) => document.querySelectorAll('.lp-row').length === expected, data.items.length)
    await page.waitForTimeout(450)
    return data
  }
  const scrollTop = () => page.locator('.page-scroll:visible').evaluate((element) => element.scrollTop)
  const openRowAt = async (fraction) => {
    const rows = page.locator('.lp-row-link[href]')
    const row = rows.nth(Math.floor((await rows.count()) * fraction))
    await row.scrollIntoViewIfNeeded()
    await page.waitForTimeout(100)
    const before = await scrollTop()
    await row.click()
    await settle('.ds-page')
    return before
  }

  await page.goto(`${base}/#/graph`)
  await settle(mobile ? '.m-specs' : '.graph')
  assert.equal(await page.locator('.page-scroll:visible').count(), 0, 'Graph keeps canvas/mobile-plane geometry')
  await frame('graph')

  if (mobile) {
    await page.locator('.m-tabbar-btn').nth(1).click()
    await settle('.m-sesslist')
  } else {
    await page.goto(`${base}/#/sessions`)
    await settle('.si-page')
  }
  assert.equal(await page.locator('.page-scroll:visible').count(), 0, 'Sessions keeps pane-local geometry')
  await frame('sessions')

  const listPage = await listUpdate(ISSUE_DEFAULT, () => page.goto(`${base}/#/issues`))
  const total = await page.locator('.lp-row').count()
  assert.ok(total > 0, 'real data supplies an Issues list')
  assert.equal(await page.locator('.lp-page:visible > :first-child').evaluate((element) => element.className), 'rl-content',
    'Issues contributes no route-leading sticky geometry')
  const tabs = page.locator('.rl-sections:visible [role="tab"]')
  assert.equal(await page.locator('.rl-sections:visible').getAttribute('role'), 'tablist')
  assert.equal(await tabs.count(), 2)
  assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true', 'the bare Issues address opens on the Open tab')
  await assertPageScroll('issues-list')
  const issueBefore = await openRowAt(.45)
  await listUpdate(ISSUE_DEFAULT, () => page.goBack())
  assert.equal(await scrollTop(), issueBefore, 'Issues Back restores exact list scrollTop')
  await frame('issues-back-restored')

  // a query state is its own address: it restores its own position on Back, and the bare list keeps
  // the position it had, untouched by the queried one.
  const queriedPage = await listUpdate(QUERIED_TEXT, () => page.goto(`${base}/${queriedHash}`))
  assert.ok(listPage.counts.closed > 0 && queriedPage.total === listPage.counts.closed, 'real data supplies a closed Issues population')
  assert.equal(await page.evaluate(() => location.hash), queriedHash, 'the queried address is kept byte for byte')
  assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true', 'the query state selects the Closed tab')
  await assertPageScroll('issues-queried-list')
  const queriedBefore = await openRowAt(.7)
  assert.notEqual(queriedBefore, issueBefore, 'fixture: the two list addresses must leave from different positions')
  await listUpdate(QUERIED_TEXT, () => page.goBack())
  assert.equal(await scrollTop(), queriedBefore, 'queried Issues Back restores exact list scrollTop')
  await frame('issues-queried-back-restored')
  await listUpdate(ISSUE_DEFAULT, () => page.evaluate(() => { location.hash = '#/issues' }))
  assert.equal(await scrollTop(), issueBefore, 'the bare Issues address keeps its own position apart from the queried one')

  await page.goto(`${base}/${longDetail.href}`)
  await settle('.ds-page')
  const issueDetail = await assertPageScroll('issues-detail', { sidePosition: mobile ? 'static' : 'sticky' })
  assert.ok(issueDetail.scrollHeight > issueDetail.clientHeight + 400, 'Issues detail uses real long content')

  if (!mobile) {
    const themes = [
      ['Minimal', 'minimal'], ['Things', 'things'], ['Tokyo Night', 'tokyonight'], ['Catppuccin', 'catppuccin'],
      ['Everforest', 'everforest'], ['Gruvbox', 'gruvbox'], ['Rosé Pine Dawn', 'rosepine'], ['Dracula', 'dracula'],
    ]
    const themeReadings = {}
    const surfaces = [
      ['issues-list', `${base}/#/issues`, '.lp-page'],
      ['issues-detail', `${base}/${longDetail.href}`, '.ds-page'],
      ['settings', `${base}/#/settings`, '.page-settings-scroll'],
    ]
    for (const [label, code] of themes) {
      await page.goto(`${base}/#/settings`)
      await settle('.page-settings-scroll')
      await page.getByRole('button', { name: label, exact: true }).click()
      assert.equal(await page.locator('html').getAttribute('data-theme'), code)
      themeReadings[code] = {}
      for (const [surface, href, selector] of surfaces) {
        await page.goto(href)
        await page.locator(`${selector}:visible`).first().waitFor({ state: 'visible' })
        await page.waitForTimeout(80)
        const geometry = await assertGeometry(`${code}-${surface}`)
        themeReadings[code][surface] = { owner: geometry.owner, shell: geometry.shell, gutter: geometry.gutter }
      }
      await page.goto(`${projectsBase}/projects`)
      await settle('.page-projects-scroll')
      await page.evaluate((theme) => {
        localStorage.setItem('spexcode.theme', theme)
        document.documentElement.setAttribute('data-theme', theme)
      }, code)
      assert.equal(await page.locator('html').getAttribute('data-theme'), code)
      const projectsGeometry = await assertGeometry(`${code}-projects`)
      themeReadings[code].projects = { owner: projectsGeometry.owner, shell: projectsGeometry.shell, gutter: projectsGeometry.gutter }
    }
    readings.themes = themeReadings
    await page.goto(`${base}/#/settings`)
    await settle('.page-settings-scroll')
    await assertPageScroll('settings')
  } else {
    await page.goto(`${base}/#/settings`)
    await settle('.page-settings-scroll')
    await assertPageScroll('settings')
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
  return { name, viewport, total, queriedTotal: queriedPage.total, readings, events }
}

let browser
let projects
const results = []
try {
  projects = await startProjectsHost()
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const longDetail = await findLongDetail(browser, 'issues')
  results.push(await runScenario(browser, projects.base, {
    name: 'shared-page-scroll-desktop', title: '1440 page scroll, sticky bands, themes, and Back',
    viewport: { width: 1440, height: 900 }, mobile: false, longDetail,
  }))
  results.push(await runScenario(browser, projects.base, {
    name: 'shared-page-scroll-mobile', title: '390 page scroll, one-axis overflow, and Back',
    viewport: { width: 390, height: 844 }, mobile: true, longDetail,
  }))
  writeFileSync(join(out, 'result.json'), `${JSON.stringify({ base, projectsBase: projects.base, longDetail, results }, null, 2)}\n`)
  console.log(`PASS page-scroll e2e — evidence: ${out}`)
} finally {
  if (browser) await browser.close()
  if (projects) await projects.close()
  await Promise.all([...services].map(stop))
}
