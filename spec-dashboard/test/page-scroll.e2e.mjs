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

async function findScopedSession() {
  const sessions = await (await fetch(`${base}/api/sessions`)).json()
  for (const session of sessions) {
    const params = new URLSearchParams({ q: `is:eval scope:${session.id}`, page: '1' })
    const response = await fetch(`${base}/api/evals?${params}`)
    if (!response.ok) continue
    const page = await response.json()
    if (page.items?.some((item) => item.filterKind === 'blind')) return session.id
  }
  return null
}

async function findLongDetail(browser, route) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  try {
    await page.goto(`${base}/#/${route}`)
    await page.locator('.lp-row[href]').first().waitFor({ state: 'visible', timeout: 30_000 })
    const hrefs = await page.locator('.lp-row[href]').evaluateAll((rows) => rows.map((row) => row.getAttribute('href')))
    let best = { href: null, scrollHeight: 0, clientHeight: 0 }
    for (const href of hrefs.slice(0, 150)) {
      await page.evaluate((next) => { location.hash = next }, href)
      await page.waitForFunction((next) => location.hash === next, href)
      await page.locator('.ds-page').waitFor({ state: 'visible' })
      await page.waitForTimeout(40)
      const size = await page.locator('.page-scroll').evaluate((element) => ({
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

async function runScenario(browser, projectsBase, { name, title, viewport, mobile, longDetails, scopedSession }) {
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
      sticky: [...document.querySelectorAll('.se-gates,.lp-head,.ds-side')].filter((element) => element.getClientRects().length).map((element) => ({
        className: element.className,
        position: getComputedStyle(element).position,
        top: getComputedStyle(element).top,
        zIndex: getComputedStyle(element).zIndex,
        background: getComputedStyle(element).backgroundColor,
        borderBottom: getComputedStyle(element).borderBottomColor,
        childLines: element.matches('.se-gates')
          ? (() => {
              const lines = []
              for (const child of element.children) {
                const bounds = child.getBoundingClientRect()
                const center = (bounds.top + bounds.bottom) / 2
                if (!lines.some((line) => Math.abs(line - center) < 4)) lines.push(center)
              }
              return lines.length
            })()
          : null,
        opaqueAtCenter: element.matches('.se-gates')
          ? (() => {
              const bounds = element.getBoundingClientRect()
              const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 2)
              return hit === element || element.contains(hit)
            })()
          : null,
        ...box(element),
      })),
    }
  })
  const assertGeometry = async (label, { sidePosition = null } = {}) => {
    const geometry = await readScroll()
    assert.equal(geometry.count, 1, `${label}: exactly one page-scroll owner`)
    assert.equal(geometry.owner.y, 10, `${label}: track begins at 10px`)
    assert.equal(geometry.shell.bottom - geometry.owner.bottom, 10, `${label}: track ends 10px above shell bottom`)
    assert.equal(geometry.overflowX, 'hidden', `${label}: one-axis page scroll`)
    assert.equal(geometry.overflowY, 'auto', `${label}: vertical owner`)
    assert.equal(geometry.gutter, mobile ? 'auto' : 'stable', `${label}: responsive gutter contract`)
    assert.deepEqual(await horizontalOverflow(), { document: 0, body: 0, scrollers: [] }, `${label}: no horizontal overflow`)
    if (sidePosition) {
      const side = geometry.sticky.find((item) => String(item.className).includes('ds-side'))
      assert.equal(side?.position, sidePosition, `${label}: detail rail position`)
    }
    return geometry
  }
  const assertPageScroll = async (label, { scroll = true, sidePosition = null } = {}) => {
    const top = await assertGeometry(label, { sidePosition })
    await frame(`${label}-top`)
    if (scroll && top.scrollHeight > top.clientHeight + 1) {
      await page.locator('.page-scroll').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2 })
      await page.waitForTimeout(180)
      const middle = await readScroll()
      const head = middle.sticky.find((item) => String(item.className).includes('lp-head'))
      if (head) {
        const leading = middle.sticky.find((item) => String(item.className).includes('se-gates'))
        const expectedHeadY = middle.owner.y + (leading?.height || 0)
        assert.ok(Math.abs(head.y - expectedHeadY) <= 1, `${label}: sticky header pins below route-leading status`)
      }
      const side = middle.sticky.find((item) => String(item.className).includes('ds-side'))
      const topSide = top.sticky.find((item) => String(item.className).includes('ds-side'))
      if (sidePosition === 'sticky') {
        assert.ok(side.y < topSide.y, `${label}: detail rail moves into its sticky position`)
        assert.ok(side.y >= middle.owner.y && side.bottom <= middle.owner.bottom, `${label}: sticky detail rail stays inside page-scroll`)
      }
      await frame(`${label}-middle`)
      await page.locator('.page-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight })
      await page.waitForTimeout(180)
      if (sidePosition === 'sticky') {
        const bottom = await readScroll()
        const bottomSide = bottom.sticky.find((item) => String(item.className).includes('ds-side'))
        assert.ok(Math.abs(bottomSide.y - side.y) <= 1, `${label}: detail rail stays pinned through bottom`)
        assert.ok(bottomSide.bottom <= bottom.owner.bottom, `${label}: pinned detail rail never escapes page-scroll`)
      }
      await frame(`${label}-bottom`)
    }
    readings[label] = top
    return top
  }
  const statusPositions = async (label, capture = false) => {
    const snapshots = []
    for (const [position, fraction] of [['top', 0], ['middle', .5], ['bottom', 1]]) {
      await page.locator('.page-scroll').evaluate((element, amount) => {
        element.scrollTop = (element.scrollHeight - element.clientHeight) * amount
      }, fraction)
      await page.waitForTimeout(180)
      const geometry = await readScroll()
      const status = geometry.sticky.find((item) => String(item.className).includes('se-gates'))
      assert.equal(status?.position, 'sticky', `${label} ${position}: scoped status uses sticky positioning`)
      assert.equal(status?.top, '0px', `${label} ${position}: sticky offset is relative to the inset PageScroll`)
      assert.ok(Math.abs(status.y - geometry.owner.y) <= 1,
        `${label} ${position}: scoped status stays pinned at the PageScroll inset`)
      assert.equal(status.height, mobile ? 80 : 40, `${label} ${position}: status height is stable`)
      assert.equal(status.childLines, mobile ? 2 : 1, `${label} ${position}: status has the expected line count`)
      assert.ok(status.background !== 'rgba(0, 0, 0, 0)' && status.background !== 'transparent',
        `${label} ${position}: status paint is opaque`)
      assert.ok(status.borderBottom !== 'rgba(0, 0, 0, 0)' && status.borderBottom !== 'transparent',
        `${label} ${position}: status boundary is painted`)
      assert.equal(status.opaqueAtCenter, true, `${label} ${position}: rows cannot read through the status paint`)
      snapshots.push({ position, geometry, status })
      if (capture) await frame(`${label}-${position}`)
    }
    return snapshots
  }
  async function assertScopedStatus(label, { capture = true } = {}) {
    await page.locator('.page-scroll').evaluate((element) => { element.scrollTop = 0 })
    await page.waitForTimeout(180)
    const initial = await readScroll()
    const initialStatus = initial.sticky.find((item) => String(item.className).includes('se-gates'))
    const content = await page.locator('.rl-content').boundingBox()
    assert.ok(content.y >= initialStatus.bottom, `${label}: status reserves normal-flow room before sticking`)
    assert.deepEqual(await horizontalOverflow(), { document: 0, body: 0, scrollers: [] }, `${label}: status never widens the page`)
    const anchors = await page.locator('.se-gates').evaluate((status) => {
      const door = status.querySelector(':scope > .se-door')
      const exported = status.querySelector(':scope > .se-acts > .se-export')
      return {
        door: { tag: door?.tagName, href: door?.getAttribute('href'), label: door?.getAttribute('aria-label'), tip: door?.dataset.tip },
        exported: { tag: exported?.tagName, href: exported?.getAttribute('href'), target: exported?.target, label: exported?.getAttribute('aria-label'), tip: exported?.dataset.tip },
      }
    })
    assert.equal(anchors.door.tag, 'A', `${label}: terminal remains a real anchor`)
    assert.match(anchors.door.href, /^#\/sessions\//)
    assert.equal(anchors.exported.tag, 'A', `${label}: export remains a real anchor`)
    assert.match(anchors.exported.href, /\/api\/sessions\/.+\/evals\?format=html$/)
    assert.equal(anchors.exported.target, '_blank')
    for (const selector of ['.se-door', '.se-export']) {
      await page.locator(selector).focus()
      assert.equal(await page.locator(selector).evaluate((element) => element === document.activeElement), true,
        `${label}: ${selector} keeps keyboard focus`)
      if (!mobile) {
        await page.locator('.ui-tip.show').waitFor({ state: 'visible' })
        assert.equal(await page.locator('.ui-tip.show').textContent(), selector === '.se-door' ? anchors.door.tip : anchors.exported.tip,
          `${label}: ${selector} keeps the shared tooltip`)
      }
    }
    const positions = await statusPositions(label, capture)
    await page.locator('.page-scroll').evaluate((element) => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2 })
    await page.waitForTimeout(180)
    await page.locator('.rl-secondary-filters-trigger').last().click()
    await page.locator('.rl-secondary-filters-menu').waitFor({ state: 'visible' })
    const layers = await page.evaluate(() => ({
      status: Number(getComputedStyle(document.querySelector('.se-gates')).zIndex),
      header: Number(getComputedStyle(document.querySelector('.lp-head')).zIndex),
      menu: Number(getComputedStyle(document.querySelector('.rl-secondary-filters-menu')).zIndex),
    }))
    assert.ok(layers.header > layers.status && layers.menu > layers.status,
      `${label}: secondary Filters menu stays above the scoped status strip`)
    if (capture) await frame(`${label}-filters-open`)
    await page.keyboard.press('Escape')
    readings[label] = { initial, positions, layers, anchors }
    return readings[label]
  }
  const sectionCounts = () => page.locator('.rl-section').evaluateAll((buttons) => buttons.map((button) => Number(button.innerText.trim().split(/\s+/).at(-1))))
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
  assert.equal(await page.locator('.se-gates').count(), 0, 'trunk Evals creates no empty scoped status strip')
  const total = await page.locator('.lp-row').count()
  const buttons = page.locator('.rl-section')
  assert.equal(await buttons.count(), 2)
  assert.match(await buttons.nth(0).innerText(), /^Fail\n\d+$/)
  assert.match(await buttons.nth(1).innerText(), /^Pass\n\d+$/)
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'false')
  assert.equal(await buttons.nth(1).getAttribute('aria-pressed'), 'false')
  assert.match(await page.locator('.rl-sections').ariaSnapshot(), /group "Evals"[\s\S]*button "Fail \d+"[\s\S]*button "Pass \d+"/)
  await assertPageScroll('evals-list')

  assert.ok(scopedSession, 'real session data supplies a scoped Evals model')
  const scopedText = `is:eval scope:${scopedSession}`
  const scopedHash = `#/evals?q=${encodeURIComponent(scopedText)}`
  const scopedPageWaiting = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith('/api/evals') && url.searchParams.get('q') === scopedText
      && url.searchParams.get('page') === '1'
  }, { timeout: 30_000 })
  await page.goto(`${base}/${scopedHash}`)
  const scopedPage = await (await scopedPageWaiting).json()
  await settle('.se-gates')
  await page.locator('.se-blind').first().waitFor({ state: 'visible', timeout: 30_000 })
  const scopedGeometry = await assertGeometry('evals-scoped-list')
  assert.equal(scopedGeometry.owner.y, 10, 'scoped gates live inside, not above, the shared scrollport')
  await assertScopedStatus('evals-scoped-list')
  const scopedTotal = await page.locator('.lp-row').count()
  const blindRows = await page.locator('.se-blind').count()
  assert.ok(blindRows > 0, 'real scoped blind scenarios reach the paged UI')
  const defaultCounts = await sectionCounts()
  assert.ok(defaultCounts[0] + defaultCounts[1] < scopedPage.total, 'Fail/Pass is honestly non-exhaustive over the full server set')
  const scopedUpdate = async (action) => {
    const waiting = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.pathname.endsWith('/api/evals') && url.searchParams.get('q')?.includes(`scope:${scopedSession}`)
        && url.searchParams.get('page') === '1'
    }, { timeout: 30_000 })
    await action()
    const data = await (await waiting).json()
    await page.waitForFunction((expected) => document.querySelectorAll('.lp-row').length === expected, data.items.length)
    return data
  }

  await scopedUpdate(() => buttons.nth(0).click())
  const failRows = await page.locator('.lp-row').count()
  assert.match(await page.evaluate(() => location.hash), /verdict%3Afail/)
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'true')
  await frame('evals-fail')
  await scopedUpdate(() => buttons.nth(0).click())
  assert.equal(await page.evaluate(() => location.hash), scopedHash)
  assert.equal(await page.locator('.lp-row').count(), scopedTotal)
  await scopedUpdate(() => buttons.nth(1).click())
  const passRows = await page.locator('.lp-row').count()
  assert.equal(await buttons.nth(1).getAttribute('aria-pressed'), 'true')
  await scopedUpdate(() => page.goBack())
  assert.equal(await page.evaluate(() => location.hash), scopedHash)
  assert.equal(await page.locator('.rl-section').nth(1).getAttribute('aria-pressed'), 'false')

  await page.locator('.rl-secondary-filters-trigger').last().click()
  const reviewGroup = page.getByRole('group', { name: mobile ? /Human review|人工复核/ : 'Human review' })
  await reviewGroup.waitFor({ state: 'visible' })
  assert.match(await reviewGroup.ariaSnapshot(), /radio "Needs review"/)
  await scopedUpdate(() => reviewGroup.getByRole('menuitemradio', { name: 'Needs review' }).click())
  assert.match(await page.evaluate(() => location.hash), /state%3Acurrent/)
  const reviewHash = await page.evaluate(() => location.hash)
  const reviewCounts = await sectionCounts()
  await scopedUpdate(() => buttons.nth(0).click())
  assert.deepEqual(await sectionCounts(), reviewCounts, 'verdict counts stay stable under the rest of the query')
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'true')
  await scopedUpdate(() => buttons.nth(0).click())
  assert.equal(await page.evaluate(() => location.hash), reviewHash, 'second Fail click clears only verdict:')
  await scopedUpdate(() => page.goBack())
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'true', 'Back replays the prior Fail state')
  await scopedUpdate(() => page.goBack())
  assert.equal(await page.evaluate(() => location.hash), reviewHash)
  assert.equal(await buttons.nth(0).getAttribute('aria-pressed'), 'false')
  await scopedUpdate(() => page.goBack())
  assert.equal(await page.evaluate(() => location.hash), scopedHash)

  const scopedBefore = await openMiddleRow()
  await scopedUpdate(() => page.goBack())
  assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), scopedBefore,
    'scoped Evals Back restores exact list scrollTop')
  const restoredScoped = await readScroll()
  const restoredStatus = restoredScoped.sticky.find((item) => String(item.className).includes('se-gates'))
  assert.ok(Math.abs(restoredStatus.y - restoredScoped.owner.y) <= 1,
    'scoped Evals Back restores the status at the inset')
  await frame('evals-scoped-back-restored')

  await page.goto(`${base}/#/evals`)
  await settle('.lp-page')
  const evalBefore = await openMiddleRow()
  await page.goBack()
  await settle('.lp-page')
  assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), evalBefore, 'Evals Back restores exact list scrollTop')
  await frame('evals-back-restored')
  await page.goto(`${base}/${longDetails.evals.href}`)
  await settle('.ds-page')
  const evalDetail = await assertPageScroll('evals-detail', { sidePosition: mobile ? 'static' : 'sticky' })
  assert.ok(evalDetail.scrollHeight > evalDetail.clientHeight + 400, 'Evals detail uses real long content')

  await page.goto(`${base}/#/issues`)
  await settle('.lp-page')
  assert.equal(await page.locator('.se-gates').count(), 0, 'Issues creates no scoped Evals status strip')
  assert.equal(await page.locator('.rl-sections').getAttribute('role'), 'tablist')
  await assertPageScroll('issues-list')
  const issueBefore = await openMiddleRow()
  await page.goBack()
  await settle('.lp-page')
  assert.equal(await page.locator('.page-scroll').evaluate((element) => element.scrollTop), issueBefore, 'Issues Back restores exact list scrollTop')
  await frame('issues-back-restored')
  await page.goto(`${base}/${longDetails.issues.href}`)
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
      ['evals-list', `${base}/#/evals`, '.lp-page'],
      ['evals-scoped-list', `${base}/${scopedHash}`, '.se-gates'],
      ['evals-detail', `${base}/${longDetails.evals.href}`, '.ds-page'],
      ['issues-list', `${base}/#/issues`, '.lp-page'],
      ['issues-detail', `${base}/${longDetails.issues.href}`, '.ds-page'],
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
        await page.locator(selector).first().waitFor({ state: 'visible' })
        await page.waitForTimeout(80)
        const geometry = await assertGeometry(`${code}-${surface}`)
        if (surface === 'evals-scoped-list') {
          await statusPositions(`${code}-${surface}`)
        }
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
  return { name, viewport, failRows, passRows, total, scopedTotal, blindRows, readings, events }
}

let browser
let projects
const results = []
try {
  projects = await startProjectsHost()
  browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
  const scopedSession = await findScopedSession()
  assert.ok(scopedSession, 'real session data supplies a scoped Evals model')
  const scopedRoute = `evals?${new URLSearchParams({ q: `is:eval scope:${scopedSession}` })}`
  const longDetails = {
    evals: await findLongDetail(browser, scopedRoute),
    issues: await findLongDetail(browser, 'issues'),
  }
  results.push(await runScenario(browser, projects.base, {
    name: 'shared-page-scroll-desktop', title: '1440 page scroll, verdict hierarchy, themes, and Back',
    viewport: { width: 1440, height: 900 }, mobile: false, longDetails, scopedSession,
  }))
  results.push(await runScenario(browser, projects.base, {
    name: 'shared-page-scroll-mobile', title: '390 page scroll, one-axis overflow, and Back',
    viewport: { width: 390, height: 844 }, mobile: true, longDetails, scopedSession,
  }))
  writeFileSync(join(out, 'result.json'), `${JSON.stringify({ base, projectsBase: projects.base, longDetails, results }, null, 2)}\n`)
  console.log(`PASS page-scroll e2e — evidence: ${out}`)
} finally {
  if (browser) await browser.close()
  if (projects) await projects.close()
  await Promise.all([...services].map(stop))
}
