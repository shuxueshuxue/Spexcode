import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startHostDashboard } from '../../spec-cli/src/host.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..', '..')
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/home/jeffry/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'

const freePort = () => new Promise((resolvePort, reject) => {
  const server = net.createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address()
    server.close((error) => error ? reject(error) : resolvePort(port))
  })
})

test('Projects creates a cataloged Git project from an absent folder path', async () => {
  if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
  if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

  const home = mkdtempSync(join(tmpdir(), 'spex-projects-new-home-'))
  const parent = mkdtempSync(join(tmpdir(), 'spex-projects-new-root-'))
  const project = join(parent, 'new-project')
  const port = await freePort()
  const savedHome = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  const gateway = startHostDashboard({ port, host: '127.0.0.1', distDir: join(root, 'spec-dashboard', 'dist') })
  await once(gateway.server, 'listening')

  let browser
  try {
    const { chromium } = await import(pathToFileURL(playwrightPath).href)
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    await page.goto(`http://127.0.0.1:${port}/projects`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'add project' }).click()

    const modal = page.locator('.proj-add-modal')
    const path = modal.locator('input.proj-add-path')
    await path.waitFor({ state: 'visible' })
    await path.fill(project)
    await path.press('Enter')

    const create = modal.getByRole('button', { name: 'new project' })
    await create.waitFor({ state: 'visible' })
    assert.equal(await modal.getByText('folder does not exist').count(), 1)
    await create.click()
    await modal.waitFor({ state: 'detached' })

    await page.locator('.proj-row .proj-name', { hasText: 'new-project' }).waitFor({ state: 'visible' })
    assert.equal(existsSync(project), true)
    assert.equal(existsSync(join(project, '.git')), true)
    assert.equal(execFileSync('git', ['-C', project, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), 'main')
    assert.match(execFileSync('git', ['-C', project, 'rev-parse', '--verify', 'HEAD^{commit}'], { encoding: 'utf8' }).trim(), /^[0-9a-f]{40,64}$/)
    const config = JSON.parse(readFileSync(join(project, '.spec/spexcode.json'), 'utf8'))
    assert.equal(config.mainBranch, 'main')
    assert.deepEqual(config.harnesses, [])
    const catalog = await page.evaluate(() => fetch('/projects', { headers: { Accept: 'application/json' } }).then((r) => r.json()))
    assert.equal(catalog.projects.some((entry) => entry.root === realpathSync(project)), true)

    // Removal opens one concise warning. The confirm button submits the server's canonical title phrase;
    // the checkout remains.
    const row = page.locator('.proj-row', { hasText: 'new-project' })
    await row.getByRole('button', { name: 'remove project registration' }).first().click()
    const remove = page.locator('.proj-remove-modal')
    await remove.getByText('Its local directory, Git history, and source files stay in place.', { exact: false }).waitFor()
    const confirm = remove.getByRole('button', { name: 'confirm registration removal' })
    assert.equal(await remove.getByRole('checkbox').count(), 0)
    assert.equal(await remove.locator('input').count(), 0)
    assert.equal(await confirm.isEnabled(), true)
    await confirm.click()
    await remove.waitFor({ state: 'detached' })
    assert.equal(existsSync(project), true)
    const afterRemove = await page.evaluate(() => fetch('/projects', { headers: { Accept: 'application/json' } }).then((r) => r.json()))
    assert.equal(afterRemove.projects.some((entry) => entry.root === realpathSync(project)), false)
  } finally {
    await browser?.close()
    await gateway.close()
    if (savedHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = savedHome
    rmSync(home, { recursive: true, force: true })
    rmSync(parent, { recursive: true, force: true })
  }
})
