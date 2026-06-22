import { createRequire } from 'node:module'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, delimiter, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import type { Driver } from './drivers.js'
import type { Scenario } from './yatsu.js'

// @@@ playwright web driver - the FIRST real producer behind the [[drivers]] seam: where the manual driver
// records a human's observation, this one launches a real browser, opens the scenario's target, replays its
// steps, and captures a settle-aware screenshot — the bytes [[cli]]'s eval stores in the [[cache]] and the
// [[sidecar]] records. It slots in by registering in drivers.ts with NO change to eval; the engine still
// never names it. Scope is WEB apps (http/https); Electron is a separate driver node (see resolveTargetUrl).
//
// @@@ reuse, never bundle - this package adds NO playwright dependency and downloads NO browser. The box's
// MACHINE-GLOBAL Playwright (the CLI on PATH, its chromium already cached) is THE install; we resolve it at
// capture time (resolveGlobalPlaywright) and drive it. A per-package playwright would duplicate ~hundreds of
// MB and a browser download for no gain. Because resolution is lazy (inside capture, never at import), a
// manual-only run that merely imports the registry never touches playwright at all.

const GOTO_TIMEOUT = 30_000    // navigation budget — a cold page + assets
const SETTLE_TIMEOUT = 5_000   // how long we wait for the network to go idle before capturing anyway
const STEP_TIMEOUT = 10_000    // per interaction (click/fill/waitfor)
const DEFAULT_BASE_URL = 'http://localhost:5173'   // a bare-path target resolves against this (override: YATSU_BASE_URL)

// ---- target resolution (the WEB-only contract) ----

// @@@ resolveTargetUrl - a scenario's `target` is the URL to open. A full http(s) URL is used as-is; a bare
// path/route (`/login`) resolves against YATSU_BASE_URL (the app under test). ANY other scheme is rejected
// loudly: this driver is web-only, so `electron://`/`file://`/an app path belongs to a different driver node
// (Electron is the explicit follow-up). An empty target is an authoring error, not a silent no-op.
export function resolveTargetUrl(target: string): string {
  const t = (target ?? '').trim()
  if (!t) throw new Error('playwright driver: scenario has no `target` URL to open')
  if (/^https?:\/\//i.test(t)) return t
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t))
    throw new Error(`playwright driver is WEB-only (http/https) — got '${t}'. Electron / other surfaces are a separate driver node.`)
  const base = (process.env.YATSU_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return base + (t.startsWith('/') ? t : '/' + t)
}

// ---- the inline-step mini-language ----

// @@@ step DSL - inline `steps:` are free text. A step in the compact `verb: arg` form (a known verb) is
// EXECUTED against the page; anything else (prose like "click the logout button") is narration — recorded
// intent a human or a future computer-use driver acts on, never silently mis-parsed as a selector. So a
// scenario stays honest whether it's written as replayable steps or as prose, and a prose-only scenario
// still produces a reading: the target's settled landing state. A malformed executable step fails loud.
export type Step =
  | { verb: 'goto' | 'click' | 'waitfor' | 'press'; arg: string }
  | { verb: 'fill'; selector: string; value: string }
  | { verb: 'wait'; ms: number }

const STEP_VERBS = new Set(['goto', 'click', 'fill', 'press', 'wait', 'waitfor'])
const unquote = (s: string) => s.replace(/^(["'])(.*)\1$/, '$2').trim()

export function parseStep(raw: string): Step | null {
  const m = raw.trim().match(/^([a-zA-Z]+)\s*:\s*(.*)$/)
  if (!m) return null                               // no `verb:` head → prose narration
  const verb = m[1].toLowerCase()
  if (!STEP_VERBS.has(verb)) return null            // an unknown head (e.g. `note:`) is narration too
  const arg = unquote(m[2].trim())
  if (verb === 'fill') {
    const eq = arg.indexOf('=')
    if (eq < 0) throw new Error(`playwright step 'fill' needs '<selector> = <value>': ${raw}`)
    return { verb, selector: arg.slice(0, eq).trim(), value: arg.slice(eq + 1).trim() }
  }
  if (verb === 'wait') {
    const ms = Number(arg)
    if (!Number.isFinite(ms)) throw new Error(`playwright step 'wait' needs a millisecond number: ${raw}`)
    return { verb, ms }
  }
  return { verb: verb as 'goto' | 'click' | 'waitfor' | 'press', arg }
}

// ---- the browser seam (overridable so tests stub the browser) ----

// the slice of Playwright's Page this driver uses — narrow, so a test can supply a fake without a browser.
export interface PageLike {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>
  screenshot(opts?: { fullPage?: boolean; type?: string }): Promise<Buffer>
  click(selector: string, opts?: { timeout?: number }): Promise<unknown>
  fill(selector: string, value: string, opts?: { timeout?: number }): Promise<unknown>
  press(selector: string, key: string): Promise<unknown>
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>
  waitForTimeout(ms: number): Promise<unknown>
  waitForLoadState(state?: string, opts?: { timeout?: number }): Promise<unknown>
}
export type LaunchOpts = { headless?: boolean; viewport?: { width: number; height: number } }
export type BrowserSession = { page: PageLike; close(): Promise<unknown> }
export type Launcher = (opts: LaunchOpts) => Promise<BrowserSession>
// a `run` scenario is a native test file the global runner executes; the runner returns the shot it produced.
export type NativeRunner = (testFile: string, scenario: Scenario) => Promise<Buffer | null>

// @@@ resolveGlobalPlaywright - find the machine-global install and return its `chromium` plus the package
// dir (the native runner needs cli.js next to it). Searched, in order: `npm root -g`, every NODE_PATH entry,
// then the conventional global module dirs. Cached after the first hit. Browsers resolve from the same
// install's default cache (~/.cache/ms-playwright) automatically — it's the install that downloaded them, so
// the revision always matches. Absent everywhere → fail loud with the one-line repair, never a quiet skip.
type GlobalPlaywright = { chromium: any; pkgDir: string }
let cachedGlobal: GlobalPlaywright | null = null
function globalModuleRoots(): string[] {
  const roots: string[] = []
  try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()) } catch { /* npm not on PATH */ }
  for (const p of (process.env.NODE_PATH ?? '').split(delimiter)) if (p) roots.push(p)
  roots.push('/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules')
  return [...new Set(roots.filter(Boolean))]
}
function resolveGlobalPlaywright(): GlobalPlaywright {
  if (cachedGlobal) return cachedGlobal
  const req = createRequire(import.meta.url)
  const roots = globalModuleRoots()
  for (const root of roots) {
    try {
      const pkgDir = dirname(req.resolve('playwright/package.json', { paths: [root] }))
      const mod = req(req.resolve('playwright', { paths: [root] }))
      if (mod?.chromium) return (cachedGlobal = { chromium: mod.chromium, pkgDir })
    } catch { /* not under this root — try the next */ }
  }
  throw new Error(
    'yatsu playwright driver: no machine-global Playwright found. This driver REUSES a global install ' +
    '(it never bundles playwright or downloads a browser). Install once: `npm i -g playwright && playwright install chromium`. ' +
    `Searched: ${roots.join(', ')}`,
  )
}

// the default producer: launch the global chromium, drive a real page.
const globalChromiumLauncher: Launcher = async (opts) => {
  const { chromium } = resolveGlobalPlaywright()
  const browser = await chromium.launch({ headless: opts.headless ?? true })
  const context = await browser.newContext({ viewport: opts.viewport ?? { width: 1280, height: 800 } })
  const page: PageLike = await context.newPage()
  return { page, close: () => browser.close() }
}

// @@@ globalNativeRunner - a `run` scenario IS a native @playwright/test file, which owns its own browser, so
// we delegate to the global test runner (cli.js next to the resolved package) rather than drive it ourselves.
// A generated config turns on `screenshot: 'on'` into a temp outputDir; we run the file and harvest the newest
// PNG it wrote as the reading's blob (null if it produced none — a pixel-less pass). NODE_PATH points the
// child at the global modules so the test's `@playwright/test` import resolves with no per-repo install. A
// non-zero exit is a real eval failure: throw so the loss surfaces, never a green reading over a red run.
const globalNativeRunner: NativeRunner = async (testFile) => {
  const { pkgDir } = resolveGlobalPlaywright()
  const work = mkdtempSync(join(tmpdir(), 'yatsu-pw-'))
  const outDir = join(work, 'out')
  const cfg = join(work, 'yatsu.pw.config.mjs')
  writeFileSync(cfg, `export default { testDir: ${JSON.stringify(dirname(testFile))}, outputDir: ${JSON.stringify(outDir)}, use: { screenshot: 'on' }, reporter: 'line' }\n`)
  const res = spawnSync(process.execPath, [join(pkgDir, 'cli.js'), 'test', testFile, '--config', cfg], {
    encoding: 'utf8', stdio: 'pipe', env: { ...process.env, NODE_PATH: dirname(pkgDir) },
  })
  if (res.status !== 0)
    throw new Error(`playwright native test failed (${testFile}): exit ${res.status}\n${(res.stderr || res.stdout || '').trim()}`)
  const png = newestPng(outDir)
  return png ? readFileSync(png) : null
}
function newestPng(dir: string): string | null {
  if (!existsSync(dir)) return null
  const pngs: { path: string; mtime: number }[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.png')) pngs.push({ path: p, mtime: statSync(p).mtimeMs })
    }
  }
  walk(dir)
  return pngs.sort((a, b) => b.mtime - a.mtime)[0]?.path ?? null
}

// the two producers are module state so a test can replace them with stubs and restore the real ones.
let launcher: Launcher = globalChromiumLauncher
let nativeRunner: NativeRunner = globalNativeRunner
export function setLauncher(l: Launcher): void { launcher = l }
export function setNativeRunner(r: NativeRunner): void { nativeRunner = r }
export function resetDriverSeams(): void { launcher = globalChromiumLauncher; nativeRunner = globalNativeRunner }

// ---- replay + settle ----

async function replaySteps(page: PageLike, steps: string[]): Promise<void> {
  for (const raw of steps) {
    const step = parseStep(raw)
    if (!step) continue   // prose narration — not executable here (recorded intent for a human / computer-use driver)
    switch (step.verb) {
      case 'goto': await page.goto(resolveTargetUrl(step.arg), { waitUntil: 'load', timeout: GOTO_TIMEOUT }); break
      case 'click': await page.click(step.arg, { timeout: STEP_TIMEOUT }); break
      case 'fill': await page.fill(step.selector, step.value, { timeout: STEP_TIMEOUT }); break
      case 'press': await page.press('body', step.arg); break
      case 'wait': await page.waitForTimeout(step.ms); break
      case 'waitfor': await page.waitForSelector(step.arg, { timeout: STEP_TIMEOUT }); break
    }
  }
}

// @@@ settle - the screenshot is "settle-aware": after navigation + steps we wait for the network to go idle
// (bounded) so the capture reflects a quiesced page, not a mid-load frame. A streaming / long-poll page may
// never reach networkidle, so the wait is bounded and we capture anyway rather than hang or fail.
async function settle(page: PageLike): Promise<void> {
  try { await page.waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT }) }
  catch { /* never went idle within budget — capture the current state */ }
}

// run is resolved relative to the repo root (the cwd spex runs in) unless already absolute.
function resolveRunPath(run: string): string {
  return isAbsolute(run) ? run : join(process.cwd(), run)
}

// @@@ playwrightDriver - the registered `playwright` producer. `version` is the evaluator freshness axis:
// bump it when what a capture ATTESTS changes (a settle/viewport policy change), marking prior readings stale.
export const playwrightDriver: Driver = {
  name: 'playwright',
  version: 1,
  async capture(scenario, _opts) {
    if (scenario.run) return nativeRunner(resolveRunPath(scenario.run), scenario)
    const url = resolveTargetUrl(scenario.target)
    const session = await launcher({ headless: true })
    try {
      await session.page.goto(url, { waitUntil: 'load', timeout: GOTO_TIMEOUT })
      await replaySteps(session.page, scenario.steps ?? [])
      await settle(session.page)
      return await session.page.screenshot({ fullPage: true, type: 'png' })
    } finally {
      await session.close()
    }
  },
}
