// spec-reconstruction-bench browser/DOM acceptance scorer for the mobile-ui leaf ([[spec-reconstruction-bench]]).
//
// The mobile-ui frozen future task (episode db80b33d) is an async board-poll RACE: several loadBoard()
// fetches can be in flight; only the LATEST-ISSUED may update the board, a superseded (older-issued)
// response must be dropped. Its honest acceptance is a REAL browser/DOM test (YATU), not a source regex.
//
// Harness (derived from the frozen pre-state behaviour, run OUTSIDE the workspace; the target future
// tests/docs are never exposed — only the sanitized request goes into the snapshot):
//   • esbuild-bundle a tiny entry that imports the PRODUCED App.jsx and STUBS every heavy import (data.js,
//     the child components, @xyflow, i18n, useIsMobile→true) so ONLY App's own reload/seq-guard logic runs
//     for real. The stubbed MobileApp renders board.sessions as queryable DOM text (#srb-sessions).
//   • data.js's loadBoard is a controllable queue (window.__srb.pending). setInterval is time-compressed
//     so the poll reload fires fast — two reloads (mount + one poll tick) go in flight.
//   • drive via CDP in headless chromium: resolve the LATER-issued fetch FIRST with a FRESH board (session
//     'keep' only), then the EARLIER-issued LAST with a STALE board (adds 'stale'). Read #srb-sessions.
//       - seq-guarded (correct):   text === 'keep'         → fresh wins, stale dropped  → PASS
//       - pre-state / no guard:    text === 'keep,stale'   → stale overwrote fresh      → REJECT
//       - broken (never updates):  no #srb-sessions         → sanity fails               → REJECT
// scoreControlsMobile proves the harness PASSES the post-episode App.jsx and REJECTS the pre-state one.
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '../../..')
const DASH = join(ROOT, 'spec-dashboard')                 // react/react-dom resolve from its node_modules
const CHROME = '/home/jeffry/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'

// stub modules — provide EXACTLY the named exports App.jsx imports, all inert except data.js/MobileApp.
const STUBS = {
  './data.js': `
    export function loadBoard(){ return new Promise((res)=>{ (window.__srb.pending ||= []).push(res) }) }
    export function layout(){ return { nodes: [], edges: [] } }
    export const X_GAP = 0, Y_GAP = 0
    export function projectTitle(){ return '' }`,
  './useIsMobile.js': `export function useIsMobile(){ return true }`,
  './MobileApp.jsx': `
    import React from 'react'
    export default function MobileApp({ sessions }){
      return React.createElement('div', { id: 'srb-sessions' }, (sessions||[]).map(s=>s.id).join(','))
    }`,
  './i18n/index.jsx': `export function useT(){ return (k)=>k }`,
  './SpecNode.jsx': `export default function(){ return null }`,
  './NodeView.jsx': `export default function(){ return null }; export function panesFor(){ return [] }`,
  './FocusPanel.jsx': `export default function(){ return null }`,
  './SessionWindow.jsx': `export default function(){ return null }`,
  './SessionInterface.jsx': `export default function(){ return null }`,
  './Legend.jsx': `export default function(){ return null }`,
  './Settings.jsx': `export default function(){ return null }`,
  './SpecSearch.jsx': `export default function(){ return null }`,
  './BoardStats.jsx': `export default function(){ return null }`,
  './scroll.js': `export function createMomentumScroll(){ return { stop(){} } }`,
  './cycle.js': `export function cycleNext(){ return null }`,
  './color.js': `export function labelColor(){ return '#000' }`,
  './session.js': `export function sessionName(s){ return s?.id ?? '' }`,
  '@xyflow/react': `
    import React from 'react'
    export function ReactFlow({ children }){ return React.createElement('div', null, children) }
    export function Background(){ return null }
    export const MarkerType = { ArrowClosed: 'arrowclosed' }
    export function useReactFlow(){ return { fitView(){}, setCenter(){}, getZoom(){ return 1 } } }`,
  '@xyflow/react/dist/style.css': `export default ''`,
}

async function buildBundle(appJsxPath, outDir) {
  const esbuild = await import('esbuild')
  const entry = join(outDir, 'entry.jsx')
  writeFileSync(entry, `
    import React from 'react'
    import { createRoot } from 'react-dom/client'
    import App from ${JSON.stringify(appJsxPath)}
    window.__srb = { pending: [] }
    const _si = window.setInterval.bind(window)
    window.setInterval = (fn, ms, ...a) => _si(fn, Math.min(ms || 0, 40), ...a)   // time-compress the poll
    createRoot(document.getElementById('root')).render(React.createElement(App))
  `)
  const stubPlugin = {
    name: 'srb-stub',
    setup(b) {
      const keys = Object.keys(STUBS)
      b.onResolve({ filter: /.*/ }, (args) => {
        if (STUBS[args.path]) return { path: args.path, namespace: 'srb-stub' }
        return null
      })
      b.onLoad({ filter: /.*/, namespace: 'srb-stub' }, (args) => ({ contents: STUBS[args.path], loader: args.path.endsWith('.jsx') ? 'jsx' : 'js', resolveDir: DASH }))
    },
  }
  const res = await esbuild.build({
    entryPoints: [entry], bundle: true, format: 'iife', write: false, logLevel: 'silent',
    jsx: 'automatic', absWorkingDir: DASH, nodePaths: [join(DASH, 'node_modules')], plugins: [stubPlugin],
    loader: { '.js': 'jsx' },
  })
  return res.outputFiles[0].text
}

// ---- minimal CDP client over the global WebSocket ----
function launchChrome() {
  const dir = mkdtempSync(join(tmpdir(), 'srb-chrome-'))
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  return new Promise((resolve, reject) => {
    let buf = ''
    const to = setTimeout(() => reject(new Error('chrome did not announce a devtools endpoint')), 15_000)
    proc.stderr.on('data', (d) => {
      buf += d.toString()
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//)
      if (m) { clearTimeout(to); resolve({ proc, dir, port: Number(m[1]) }) }
    })
    proc.on('error', (e) => { clearTimeout(to); reject(e) })
  })
}
async function cdp(pageWsUrl, driverFn, harnessUrl) {
  const ws = new WebSocket(pageWsUrl)
  let id = 0
  const pending = new Map()
  const events = []
  const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('cdp ws error')) })
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id) }
    else if (msg.method) events.push(msg)
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  const loaded = new Promise((res) => { const iv = setInterval(() => { if (events.some((e) => e.method === 'Page.loadEventFired')) { clearInterval(iv); res() } }, 30) })
  await send('Page.navigate', { url: harnessUrl })
  await loaded
  // (B) network isolation: after the self-contained (file://, no-network) bundle has loaded, block ALL
  // egress in-process so the produced App.jsx can neither phone home nor fetch during the driver phase.
  // Browser JS has no host-filesystem access, so this is a clean no-network sandbox without a container.
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await send('Network.setBlockedURLs', { urls: ['*'] })
  const r = await send('Runtime.evaluate', { expression: `(${driverFn})()`, awaitPromise: true, returnByValue: true })
  ws.close()
  if (r?.exceptionDetails) throw new Error('page eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 300))
  return r?.result?.value
}

// the async race driver, serialized into the page
const RACE_DRIVER = function () {
  return (async () => {
    const srb = window.__srb
    const t0 = Date.now()
    while ((srb.pending?.length ?? 0) < 2 && Date.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20))
    if ((srb.pending?.length ?? 0) < 2) return { error: 'fewer than 2 in-flight reloads', n: srb.pending?.length ?? 0 }
    const fresh = { nodes: [], sessions: [{ id: 'keep' }] }
    const stale = { nodes: [], sessions: [{ id: 'keep' }, { id: 'stale' }] }
    srb.pending[1](fresh)                                   // later-issued resolves FIRST
    await new Promise((r) => setTimeout(r, 40))
    srb.pending[0](stale)                                   // earlier-issued resolves LAST (stale)
    await new Promise((r) => setTimeout(r, 120))
    const el = document.getElementById('srb-sessions')
    const text = el ? el.textContent : null
    return { text, freshWins: text === 'keep', staleAppeared: !!(text && text.includes('stale')), sanityUpdated: !!text }
  })()
}

async function runRace(appJsxPath) {
  const outDir = mkdtempSync(join(tmpdir(), 'srb-bundle-'))
  let chrome = null
  try {
    const bundle = await buildBundle(appJsxPath, outDir)
    writeFileSync(join(outDir, 'bundle.js'), bundle)
    writeFileSync(join(outDir, 'harness.html'), '<!doctype html><html><body><div id="root"></div><script src="bundle.js"></script></body></html>')
    chrome = await launchChrome()
    const list = JSON.parse(execFileSync('bash', ['-c', `curl -sS --max-time 5 http://127.0.0.1:${chrome.port}/json`], { encoding: 'utf8' }))
    const page = list.find((t) => t.type === 'page') ?? list[0]
    const verdict = await cdp(page.webSocketDebuggerUrl, RACE_DRIVER, `file://${join(outDir, 'harness.html')}`)
    return verdict
  } finally {
    try { if (chrome?.proc) chrome.proc.kill('SIGKILL') } catch {}
    try { if (chrome?.dir) rmSync(chrome.dir, { recursive: true, force: true }) } catch {}
    rmSync(outDir, { recursive: true, force: true })
  }
}

export async function scoreMobileUi(workspaceDir) {
  const appPath = join(workspaceDir, 'spec-dashboard/src/App.jsx')
  const v = await runRace(appPath)
  const checks = [
    { name: 'sanity-board-updates', ok: !!v?.sanityUpdated, evidence: `#srb-sessions="${v?.text}"` },
    { name: 'latest-issued-wins', ok: !!v?.freshWins, evidence: `#srb-sessions="${v?.text}"` },
    { name: 'stale-dropped', ok: !v?.staleAppeared, evidence: `staleAppeared=${v?.staleAppeared}` },
  ]
  return { scorer: 'behavioral:browser-dom-board-poll-race', checks, passed: checks.filter((c) => c.ok).length, total: checks.length, verdict: v }
}

export async function scoreControlsMobile(repoRoot, positiveSha, negativeSha) {
  const mat = (sha) => { const d = mkdtempSync(join(tmpdir(), 'srb-app-')); mkdirSync(join(d, 'spec-dashboard/src'), { recursive: true }); writeFileSync(join(d, 'spec-dashboard/src/App.jsx'), execFileSync('git', ['-C', repoRoot, 'show', `${sha}:spec-dashboard/src/App.jsx`], { encoding: 'utf8' })); return d }
  const posDir = mat(positiveSha), negDir = mat(negativeSha)
  try {
    const pos = await scoreMobileUi(posDir)
    const neg = await scoreMobileUi(negDir)
    return { discriminates: pos.passed === pos.total && neg.passed < neg.total, positive: { sha: positiveSha, passed: pos.passed, total: pos.total, checks: pos.checks }, negative: { sha: negativeSha, passed: neg.passed, total: neg.total, checks: neg.checks } }
  } finally { rmSync(posDir, { recursive: true, force: true }); rmSync(negDir, { recursive: true, force: true }) }
}
