// [[dock-modes]] THE HANDOVER IS ONE SWAP: moving between a document route and Sessions replaces which
// component draws the left band — shell dock ⇄ the Sessions forest — and NOTHING ELSE may show in between.
// The defect this probe exists to catch: the shell dock flipping to its SESSIONS projection on the
// DEPARTING document for the frames between the rail click and the route landing (the click wrote
// `dockMode` synchronously while the hashchange is a later task), and the mirror image on arrival — a
// document route first painting the dock's sessions projection out of stale persisted `dockMode` and only
// then being corrected by a post-paint effect.
//
// The probe watches COMMITS, not paints: a MutationObserver on the app records every appearance of the
// dock's session body. Paint timing is a vsync race; the mount is deterministic — and the mount is also
// the waste (a full SessionDock built and thrown away one route tick later).
//
//   BASE=http://127.0.0.1:5199 OUT=/tmp/handover node spec-dashboard/test/projection-handover.e2e.mjs
//
// Env: BASE (dev server), OUT (artifact dir), SPEXCODE_PLAYWRIGHT_PATH.
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://127.0.0.1:5199'
const OUT = process.env.OUT || '/tmp/projection-handover'
mkdirSync(OUT, { recursive: true })

const { chromium } = await import(pathToFileURL(PW).href)
const fetchJson = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}
const board = await fetchJson('/api/graph')
const specs = board.specs || board.nodes || []
const node = specs.find((n) => (n.code || []).length)
if (!node) throw new Error('need a spec node with a governed file')
const encode = (v) => String(v).split('/').map(encodeURIComponent).join('/')
const specHash = `#/spec/${encode(node.id)}`

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT } })
const page = await context.newPage()

// The witness: from document start, record every element carrying the dock's session-projection body that
// ever enters the DOM, with the hash it entered under. Painted frames are sampled too (rAF) as a bonus
// record, but the assertion rides the mutations.
await page.addInitScript(() => {
  window.__handover = { mounts: [], frames: [] }
  const saw = (why) => {
    window.__handover.mounts.push({ why, hash: location.hash, t: performance.now() })
  }
  const scan = (root, why) => {
    if (!(root instanceof Element)) return
    if (root.matches?.('.dock .dock-session-body, .dock-session-body') || root.querySelector?.('.dock-session-body')) {
      if (root.closest?.('.dock') || root.querySelector?.('.dock-session-body')) saw(why)
    }
  }
  const mo = new MutationObserver((records) => {
    for (const record of records) for (const added of record.addedNodes) scan(added, 'mutation')
  })
  const arm = () => {
    if (!document.documentElement) return requestAnimationFrame(arm)
    mo.observe(document.documentElement, { childList: true, subtree: true })
    const tick = () => {
      window.__handover.frames.push({
        t: performance.now(), hash: location.hash,
        dockSessions: !!document.querySelector('.dock .dock-session-body'),
        dockExplorer: !!document.querySelector('.dock .filetree'),
        forest: !!document.querySelector('.si-list'),
      })
      requestAnimationFrame(tick)
    }
    tick()
  }
  arm()
})

// ONE: seed a clean workspace, land on a spec document with the explorer dock open.
await page.goto(`${BASE}/#/empty`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => {
  const set = (k, v) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
  set('spexcode.lang', 'en'); set('spexcode.theme', 'minimal')
  set('spexcode.tabs', '[]'); set('spexcode.dock', '1'); set('spexcode.dockMode', 'explorer')
  try { localStorage.removeItem('spexcode.split') } catch { /* private mode */ }
})
await page.goto(`${BASE}/${specHash}`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.dock .filetree', { timeout: 45_000 })
await page.waitForTimeout(400)
await page.evaluate(() => { window.__handover.mounts = [] })

// FORWARD: click the rail's Sessions anchor from the spec document. The band must hand over dock→forest
// with no sessions-projection dock committed on the way.
await page.click('.side-rail a[href="#/sessions"]')
await page.waitForSelector('.si-list', { timeout: 45_000 })
await page.waitForTimeout(600)
const forward = await page.evaluate(() => window.__handover)
await page.screenshot({ path: join(OUT, 'forward-sessions.png') })

// REVERSE, twice. First the same-document arrival: back to the spec route by address with whatever
// `dockMode` the forward leg left in force. Then a FRESH LOAD of the spec route with stale persisted
// `dockMode='sessions'` (what every rail sessions click used to leave behind). In both, the first
// committed dock must already be the explorer.
await page.evaluate(() => { window.__handover.mounts = [] })
await page.evaluate((h) => { location.hash = h }, specHash)
await page.waitForSelector('.dock .filetree', { timeout: 45_000 })
await page.waitForTimeout(400)
const sameDocMounts = await page.evaluate(() => window.__handover.mounts)
await page.evaluate(() => { try { localStorage.setItem('spexcode.dockMode', 'sessions') } catch { /* private mode */ } })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForSelector('.dock .filetree', { timeout: 45_000 })
await page.waitForTimeout(400)
const reverse = await page.evaluate(() => window.__handover)
await page.screenshot({ path: join(OUT, 'reverse-spec.png') })

const videoPath = await page.video()?.path()
await context.close()
await browser.close()

const forwardFlash = forward.mounts
const reverseFlash = [...sameDocMounts, ...reverse.mounts]
const paintedForward = forward.frames.filter((f) => f.dockSessions).length
const paintedReverse = reverse.frames.filter((f) => f.dockSessions).length
const report = {
  spec: specHash,
  forward: { flashMounts: forwardFlash, paintedFlashFrames: paintedForward, forestSettled: forward.frames.at(-1)?.forest === true },
  reverse: {
    sameDocumentMounts: sameDocMounts, freshLoadMounts: reverse.mounts, paintedFlashFrames: paintedReverse,
    explorerSettled: reverse.frames.at(-1)?.dockExplorer === true,
  },
  video: videoPath || null,
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))

const failures = []
if (forwardFlash.length > 0) failures.push(`forward: shell dock committed its sessions projection ${forwardFlash.length}× during the spec→sessions handover`)
if (!report.forward.forestSettled) failures.push('forward: the Sessions forest never settled')
if (reverseFlash.length > 0) failures.push(`reverse: a document route committed the dock's sessions projection ${reverseFlash.length}× out of stale dockMode`)
if (!report.reverse.explorerSettled) failures.push('reverse: the explorer dock never settled')
if (failures.length) {
  console.error('FAIL\n' + failures.map((f) => `  - ${f}`).join('\n'))
  process.exit(1)
}
console.log('PASS — the handover commits no intermediate projection in either direction')
