// spec-reconstruction-bench in-container mobile driver ([[spec-reconstruction-bench]]).
//
// Runs ENTIRELY inside `docker --network none` (fix B/1): esbuild-bundles the produced App.jsx (esbuild
// transforms, never executes it) and runs it in headless chromium, driving the board-poll race via CDP.
// The produced code executes ONLY here — a container with no network, the produced source + node_modules
// read-only, and only a tmpfs profile/out writable (no HOME/checkout mount). Writes the verdict JSON to
// stdout as `SRBVERDICT:{...}`.
//
// Mounts the outer runner provides:
//   /opt/app/App.jsx     produced App.jsx (ro)     /opt/node    node dist (ro)
//   /work/node_modules   esbuild (ro)              /opt/chromium chrome-linux64 (ro)
//   /work/out            writable tmpfs (bundle + chrome profile)
import { writeFileSync } from 'node:fs'
import { spawn, execFileSync } from 'node:child_process'

const APP = process.argv[2] || '/opt/app/App.jsx'
const OUT = '/work/out'
const CHROME = '/opt/chromium/chrome-linux64/chrome'

const STUBS = {
  './data.js': `export function loadBoard(){return new Promise((res)=>{(window.__srb.pending||=[]).push(res)})}
export function layout(){return {nodes:[],edges:[]}}
export const X_GAP=0,Y_GAP=0
export function projectTitle(){return ''}`,
  './useIsMobile.js': `export function useIsMobile(){return true}`,
  './MobileApp.jsx': `import React from 'react'
export default function MobileApp({sessions}){return React.createElement('div',{id:'srb-sessions'},(sessions||[]).map(s=>s.id).join(','))}`,
  './i18n/index.jsx': `export function useT(){return (k)=>k}`,
  './SpecNode.jsx': `export default function(){return null}`,
  './NodeView.jsx': `export default function(){return null}
export function panesFor(){return []}`,
  './FocusPanel.jsx': `export default function(){return null}`,
  './SessionWindow.jsx': `export default function(){return null}`,
  './SessionInterface.jsx': `export default function(){return null}`,
  './Legend.jsx': `export default function(){return null}`,
  './Settings.jsx': `export default function(){return null}`,
  './SpecSearch.jsx': `export default function(){return null}`,
  './BoardStats.jsx': `export default function(){return null}`,
  './scroll.js': `export function createMomentumScroll(){return {stop(){}}}`,
  './cycle.js': `export function cycleNext(){return null}`,
  './color.js': `export function labelColor(){return '#000'}`,
  './session.js': `export function sessionName(s){return s?.id??''}`,
  '@xyflow/react': `import React from 'react'
export function ReactFlow({children}){return React.createElement('div',null,children)}
export function Background(){return null}
export const MarkerType={ArrowClosed:'arrowclosed'}
export function useReactFlow(){return {fitView(){},setCenter(){},getZoom(){return 1}}}`,
  '@xyflow/react/dist/style.css': `export default ''`,
}
const RACE_DRIVER = `(async()=>{const s=window.__srb;const t=Date.now();while((s.pending?.length??0)<2&&Date.now()-t<4000)await new Promise(r=>setTimeout(r,20));if((s.pending?.length??0)<2)return{error:'lt2',n:s.pending?.length??0};s.pending[1]({nodes:[],sessions:[{id:'keep'}]});await new Promise(r=>setTimeout(r,40));s.pending[0]({nodes:[],sessions:[{id:'keep'},{id:'stale'}]});await new Promise(r=>setTimeout(r,120));const e=document.getElementById('srb-sessions');const x=e?e.textContent:null;return{text:x,freshWins:x==='keep',staleAppeared:!!(x&&x.includes('stale'))}})()`
const SINGLE_DRIVER = `(async()=>{const s=window.__srb;const t=Date.now();while((s.pending?.length??0)<1&&Date.now()-t<4000)await new Promise(r=>setTimeout(r,20));if((s.pending?.length??0)<1)return{error:'lt1'};s.pending[0]({nodes:[],sessions:[{id:'solo'}]});await new Promise(r=>setTimeout(r,120));const e=document.getElementById('srb-sessions');const x=e?e.textContent:null;return{text:x,updated:x==='solo'}})()`

async function bundle() {
  const esbuild = await import('esbuild')
  writeFileSync(`${OUT}/entry.jsx`, `import React from 'react'
import {createRoot} from 'react-dom/client'
import App from ${JSON.stringify(APP)}
window.__srb={pending:[]}
const _si=window.setInterval.bind(window); window.setInterval=(fn,ms,...a)=>_si(fn,Math.min(ms||0,40),...a)
createRoot(document.getElementById('root')).render(React.createElement(App))`)
  const stub = { name: 'stub', setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => STUBS[a.path] ? { path: a.path, namespace: 'stub' } : null)
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: a.path.endsWith('.jsx') ? 'jsx' : 'js', resolveDir: '/work' }))
  } }
  const r = await esbuild.build({ entryPoints: [`${OUT}/entry.jsx`], bundle: true, format: 'iife', write: false, logLevel: 'silent', jsx: 'automatic', absWorkingDir: '/work', nodePaths: ['/work/node_modules'], plugins: [stub], loader: { '.js': 'jsx' } })
  writeFileSync(`${OUT}/bundle.js`, r.outputFiles[0].text)
  writeFileSync(`${OUT}/harness.html`, '<!doctype html><html><body><div id="root"></div><script src="bundle.js"></script></body></html>')
}

function launchChrome() {
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${OUT}/profile`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] })
  return new Promise((res, rej) => {
    let buf = ''; const to = setTimeout(() => rej(new Error('no devtools endpoint')), 15000)
    proc.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) { clearTimeout(to); res({ proc, port: +m[1] }) } })
    proc.on('error', (e) => { clearTimeout(to); rej(e) })
  })
}
async function cdp(wsUrl, driver, harnessUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const events = []
  const send = (m, p) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })) })
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws err')) })
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id) } else if (m.method) events.push(m) }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  const loaded = new Promise((r) => { const iv = setInterval(() => { if (events.some((e) => e.method === 'Page.loadEventFired')) { clearInterval(iv); r() } }, 30) })
  await send('Page.navigate', { url: harnessUrl }); await loaded
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await send('Network.setBlockedURLs', { urls: ['*'] })
  const r = await send('Runtime.evaluate', { expression: driver, awaitPromise: true, returnByValue: true })
  ws.close()
  if (r?.exceptionDetails) throw new Error('eval threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 200))
  return r?.result?.value
}

const main = async () => {
  await bundle()
  const chrome = await launchChrome()
  try {
    const list = await (await fetch(`http://127.0.0.1:${chrome.port}/json`)).json()   // loopback (lo up under --network none)
    const page = list.find((t) => t.type === 'page') ?? list[0]
    const single = await cdp(page.webSocketDebuggerUrl, SINGLE_DRIVER, `file://${OUT}/harness.html`)
    const race = await cdp(page.webSocketDebuggerUrl, RACE_DRIVER, `file://${OUT}/harness.html`)
    process.stdout.write('SRBVERDICT:' + JSON.stringify({ single, race }))
  } finally {
    try { chrome.proc.kill('SIGKILL') } catch {}
  }
}
main().then(() => process.exit(0)).catch((e) => { process.stderr.write(String(e?.message ?? e)); process.exit(1) })
