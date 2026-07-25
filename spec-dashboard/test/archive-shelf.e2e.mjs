import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playwrightPath = process.env.SPEXCODE_PLAYWRIGHT_PATH
  || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const chromiumPath = process.env.CHROMIUM || '/snap/bin/chromium'
const base = process.env.BASE || 'http://127.0.0.1:5175'
const sessionId = process.env.SESSION
const out = resolve(process.env.OUT || '/tmp/archive-shelf-e2e')
if (!sessionId) throw new Error('SESSION=<live-session-id> is required')
mkdirSync(out, { recursive: true })

const { chromium } = await import(pathToFileURL(playwrightPath).href)
const getSessions = async () => {
  const response = await fetch(`${base}/api/sessions`)
  assert.equal(response.ok, true, `sessions endpoint failed: ${response.status}`)
  return response.json()
}
const setArchived = async (on) => {
  const response = await fetch(`${base}/api/sessions/${sessionId}/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ on }),
  })
  assert.equal(response.ok, true, `archive cleanup failed: ${response.status}`)
}
const waitForArchived = async (expected) => {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const session = (await getSessions()).find((candidate) => candidate.id === sessionId)
    if (session?.archived === expected) return session
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  throw new Error(`session archived state did not become ${expected}`)
}

const initialSessions = await getSessions()
const initial = initialSessions.find((candidate) => candidate.id === sessionId)
assert.ok(initial, `unknown session: ${sessionId}`)
assert.equal(initial.archived, false, 'the scenario target must begin in the working list')
assert.notEqual(initial.liveness, 'offline', 'the Command Box requires a live session')

const browser = await chromium.launch({ executablePath: chromiumPath, headless: true })
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: out, size: { width: 1280, height: 800 } },
})
const page = await context.newPage()
const started = Date.now()
const events = []
const narrate = (label) => events.push({ atMs: Date.now() - started, kind: 'narrate', label: `▶ shelve-and-restore-round-trip · ${label}` })
const frame = (label) => events.push({ atMs: Date.now() - started, kind: 'frame', label: `📷 ${label}` })
const shelf = page.locator('.si-pill.shelf')
const row = page.locator(`.si-item[data-sid="${sessionId}"]`)
const assertIconOnlyShelf = async () => {
  assert.equal(await shelf.locator('.si-pill-count').count(), 0)
  assert.equal((await shelf.textContent())?.trim(), '')
  assert.equal(await shelf.locator('.si-pill-glyph svg').count(), 1)
}

let failure
try {
  narrate('archive star stays icon-only through a real archive and restore round trip')
  await page.goto(`${base}/#/sessions/${sessionId}`, { waitUntil: 'domcontentloaded' })
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  await shelf.waitFor({ state: 'visible' })
  assert.equal(await page.locator('.si-toprow > .si-pill').count(), 3)
  const pillWidths = await page.locator('.si-toprow > .si-pill').evaluateAll((pills) => pills.map((pill) => pill.getBoundingClientRect().width))
  assert.ok(Math.max(...pillWidths) - Math.min(...pillWidths) <= 1, `top pills are not equal: ${pillWidths.join(', ')}`)
  await assertIconOnlyShelf()
  frame('existing archive content does not add a number to the star')

  await page.keyboard.press('Alt+i')
  const commandInput = page.locator('.si-command-input')
  await commandInput.waitFor({ state: 'visible' })
  await commandInput.fill('/archive')
  const archiveCommand = page.locator('.mention-menu.up .mention-item').filter({ hasText: '/archive' }).first()
  await archiveCommand.waitFor({ state: 'visible' })
  const archivedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === `/api/sessions/${sessionId}/archive` && response.request().method() === 'POST'
  })
  await archiveCommand.click()
  assert.equal((await archivedResponse).ok(), true)
  await waitForArchived(true)
  assert.ok((await getSessions()).some((candidate) => candidate.archived), 'archive must contain at least the target session')
  await row.waitFor({ state: 'detached' })
  await assertIconOnlyShelf()
  frame('archiving adds a row to the shelf but no numeric badge')

  await shelf.click()
  await page.waitForFunction(() => document.querySelector('.si-pill.shelf')?.getAttribute('aria-pressed') === 'true')
  await row.waitFor({ state: 'visible' })
  await row.click()
  await page.locator('.si-shelf-card').waitFor({ state: 'visible' })
  await assertIconOnlyShelf()
  frame('archive door reveals the shelved row and restore card')

  const restoredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === `/api/sessions/${sessionId}/archive` && response.request().method() === 'POST'
  })
  await page.locator('.si-shelf-card .si-act.go').click()
  assert.equal((await restoredResponse).ok(), true)
  const restored = await waitForArchived(false)
  await page.waitForFunction(() => document.querySelector('.si-pill.shelf')?.getAttribute('aria-pressed') === 'false')
  await row.waitFor({ state: 'visible' })
  await assertIconOnlyShelf()
  assert.equal(restored.lifecycle, initial.lifecycle)
  assert.equal(restored.liveness, initial.liveness)
  assert.equal(restored.path, initial.path)
  assert.equal(restored.branch, initial.branch)
  frame('restore returns the unchanged live session to the working list')

  await page.screenshot({ path: join(out, 'restored-icon-only.png'), fullPage: true })
} catch (error) {
  failure = error
} finally {
  const current = (await getSessions()).find((candidate) => candidate.id === sessionId)
  if (current?.archived) await setArchived(false)
}

const video = page.video()
await context.close()
const videoPath = await video.path()
await browser.close()
writeFileSync(join(out, 'archive-shelf.timeline.json'), `${JSON.stringify({ events }, null, 2)}\n`)
writeFileSync(join(out, 'result.json'), `${JSON.stringify({ ok: !failure, sessionId, video: videoPath }, null, 2)}\n`)
if (failure) throw failure
console.log(JSON.stringify({ ok: true, video: videoPath, timeline: join(out, 'archive-shelf.timeline.json') }))
