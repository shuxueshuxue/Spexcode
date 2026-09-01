import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { encodeProject } from '@spexcode/spec-core'
import { addKnownProjectWithSetup, startBackend, startHostDashboard } from '../../spec-cli/src/host.ts'

const here = new URL('.', import.meta.url)
const root = new URL('../..', here).pathname
const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.SPEXCODE_CHROMIUM_PATH || '/home/jeffry/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'

const stopBackend = async (entry) => {
  if (!entry?.pid) return
  try { process.kill(-entry.pid, 'SIGTERM') } catch {
    try { process.kill(entry.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

test('scoped Settings adds a built-in harness target', async () => {
  if (!existsSync(playwrightPath)) throw new Error(`Playwright is missing: ${playwrightPath}`)
  if (!existsSync(chromiumPath)) throw new Error(`Chromium is missing: ${chromiumPath}`)

  const savedHome = process.env.SPEXCODE_HOME
  const home = mkdtempSync(join(tmpdir(), 'spex-scoped-harness-home-'))
  const parent = mkdtempSync(join(tmpdir(), 'spex-scoped-harness-root-'))
  const project = join(parent, 'project')
  process.env.SPEXCODE_HOME = home
  mkdirSync(project)
  execFileSync('git', ['init', '-q'], { cwd: project })
  const setup = await addKnownProjectWithSetup(project, { init: { harness: 'claude' } })
  const gateway = startHostDashboard({ port: 0, host: '127.0.0.1', distDir: join(root, 'spec-dashboard', 'dist') })
  await new Promise((resolve) => gateway.server.once('listening', resolve))

  let backend
  let browser
  try {
    backend = await startBackend(setup.root)
    const { chromium } = await import(pathToFileURL(playwrightPath).href)
    browser = await chromium.launch({ executablePath: chromiumPath, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-US' })
    await page.goto(`http://127.0.0.1:${gateway.server.address().port}/p/${encodeProject(setup.root)}/#/sessions`, { waitUntil: 'domcontentloaded' })
    await page.goto(`http://127.0.0.1:${gateway.server.address().port}/p/${encodeProject(setup.root)}/#/settings`, { waitUntil: 'domcontentloaded' })
    const settings = page.locator('[data-settings-harnesses]')
    await settings.waitFor({ state: 'visible' })
    const native = page.locator('.set-add-target select')
    await native.waitFor({ state: 'visible' })
    assert.equal((await native.locator('option').allTextContents()).includes('zcode'), false)
    await native.selectOption('codex')
    await page.getByRole('button', { name: 'Add harness' }).click()
    await page.waitForFunction(() => document.querySelector('[data-settings-harnesses]')?.textContent?.match(/Codex/i))
    assert.deepEqual(JSON.parse(readFileSync(join(setup.root, 'spexcode.json'), 'utf8')).harnesses, ['claude', 'codex'])

    // A concurrent source edit invalidates the modal's revision. The modal refreshes the current revision
    // for a retry, but keeps the conflict reason visible instead of turning it into a silent reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    const conflictSelect = page.locator('.set-add-target select')
    await conflictSelect.waitFor({ state: 'visible' })
    const changed = JSON.parse(readFileSync(join(setup.root, 'spexcode.json'), 'utf8'))
    changed.dashboard = { ...(changed.dashboard || {}), title: 'concurrent edit' }
    writeFileSync(join(setup.root, 'spexcode.json'), `${JSON.stringify(changed, null, 2)}\n`)
    await conflictSelect.selectOption('opencode')
    await page.getByRole('button', { name: 'Add harness' }).click()
    await page.waitForFunction(() => document.body.textContent?.match(/changed on disk/i))
  } finally {
    await browser?.close()
    await stopBackend(backend)
    await gateway.close()
    if (savedHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = savedHome
    rmSync(home, { recursive: true, force: true })
    rmSync(parent, { recursive: true, force: true })
  }
  assert.equal(existsSync(project), false)
})
