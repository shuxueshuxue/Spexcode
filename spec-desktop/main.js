'use strict'
// The desktop shell is a PACKAGING of `spex serve` + the dashboard, not a second product. It owns a window,
// a child process, and nothing else: no routes, no state, no feature that the browser + CLI path cannot
// reach. Everything the window shows is served by the same backend a terminal user starts by hand, over the
// same origin, so the SPA needs zero desktop-specific code and cannot grow a desktop-only branch.
//
// If a capability ever appears here that `spex serve` + a browser cannot deliver, that is the alarm.
//
// STATUS: a measured SPIKE, not a working app — [[spec-desktop]] carries the findings. Two blockers stand:
// `/` on the backend is a plain-text API index (the dashboard dist is served by `spex serve ui`'s gateway,
// which is the origin this should target), and shell death does not reap the backend's own grandchildren,
// which reparent to init still holding the port. Boot, port hand-off, and window load are proven to work.

const { app, BrowserWindow, utilityProcess, shell } = require('electron')
const { createServer } = require('node:net')
const { join, resolve } = require('node:path')
const { existsSync } = require('node:fs')

// The CLI entry this shell wraps. A packaged build points at the bundled copy; a dev run points at the
// checkout it sits in. Loud when absent — a shell with no backend must not open an empty window and let the
// user conclude the product is broken.
const SPEX_ENTRY = process.env.SPEXCODE_DESKTOP_ENTRY || resolve(__dirname, '..', 'bin', 'spex.mjs')
const NODE_ENTRY = resolve(__dirname, 'node-entry.mjs')
// Which project the backend serves: `spex serve` resolves it from its cwd (the portable-layout seam), so the
// shell chooses a directory, never a project flag.
const PROJECT_CWD = process.env.SPEXCODE_DESKTOP_CWD || process.cwd()
const BOOT_TIMEOUT_MS = 30_000
const MAX_BIND_ATTEMPTS = 5

let backend = null
let window_ = null

// Ask the OS for a free loopback port. This is a time-of-check/time-of-use guess — the port could be taken
// between the probe and the child's bind — so the caller RETRIES on a bind failure rather than pretending
// the race does not exist. On a single-user desktop binding loopback the window is microseconds; the retry
// is what actually closes it.
function freePort() {
  return new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

// Start the backend and resolve once it announces the port it is serving. `utilityProcess` rather than
// `child_process`: a Chromium Services child dies with the browser process even on SIGKILL. MEASURED LIMIT:
// that covers this child ONLY. The backend's own `child_process.spawn` grandchildren reparent to init and
// keep holding the port — after `kill -9` on the shell, and after an ordinary quit too. Reaping them needs a
// mechanism that survives reparenting (a cgroup on Linux, a job object on Windows); until one is here, the
// leak is real and is not to be described as impossible.
//
// The entry is a SHIM, never the CLI directly: ELECTRON_RUN_AS_NODE must be set inside the child rather than
// in its env — see node-entry.mjs, where the whole trap is written down.
function startBackend(port) {
  return new Promise((res, rej) => {
    // A shell launched FROM a backend inherits that backend's routing env. Passing it through would point
    // this project's serve at another project's endpoint record — the documented footgun, so it is dropped
    // rather than trusted.
    const { PORT, SPEXCODE_API_URL, SPEXCODE_INSTANCE_ID, SPEXCODE_PROJECT_ROOT, ...clean } = process.env
    const child = utilityProcess.fork(NODE_ENTRY, ['serve', '--port', String(port)], {
      cwd: PROJECT_CWD,
      stdio: 'pipe',
      env: { ...clean, SPEXCODE_DESKTOP: '1', SPEXCODE_DESKTOP_ENTRY: SPEX_ENTRY },
    })
    let settled = false
    const done = (fn, arg) => { if (!settled) { settled = true; fn(arg) } }
    const timer = setTimeout(() => done(rej, new Error(`backend did not come up within ${BOOT_TIMEOUT_MS}ms`)), BOOT_TIMEOUT_MS)

    const readLines = (stream, sink) => {
      let buf = ''
      stream?.on('data', (chunk) => {
        buf += String(chunk)
        let nl
        while ((nl = buf.indexOf('\n')) >= 0) {
          sink(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
        }
      })
    }
    readLines(child.stdout, (line) => {
      process.stdout.write(`[backend] ${line}\n`)
      // the supervisor's ready line carries the public port it bound.
      if (/serving on http:\/\/localhost:\d+/.test(line)) { clearTimeout(timer); done(res, { child, port }) }
    })
    readLines(child.stderr, (line) => process.stderr.write(`[backend] ${line}\n`))

    child.once('exit', (code) => {
      clearTimeout(timer)
      // Before the window exists this is a boot failure the caller retries; after it, the backend died under
      // a live window and there is nothing left to show.
      done(rej, Object.assign(new Error(`backend exited (${code}) before it was ready`), { exitCode: code }))
      if (window_ && backend && backend.child === child) app.quit()
    })
  })
}

async function bootBackend() {
  let last = null
  for (let attempt = 1; attempt <= MAX_BIND_ATTEMPTS; attempt++) {
    const port = await freePort()
    try {
      return await startBackend(port)
    } catch (e) {
      last = e
      console.error(`[shell] backend boot attempt ${attempt}/${MAX_BIND_ATTEMPTS} on :${port} failed — ${e.message}`)
    }
  }
  throw last
}

function openWindow(port) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#262626',        // the board's --paper: no white flash before the first paint
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const url = `http://127.0.0.1:${port}/`
  // The backend answered its ready line, but the listener and the first accepted connection are not the same
  // instant. Retry the load rather than showing Chromium's error page.
  let loads = 0
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    if (loads++ < 30) setTimeout(() => win.loadURL(url), 200)
    else console.error(`[shell] giving up loading ${url} — ${code} ${desc}`)
  })
  win.once('ready-to-show', () => win.show())
  // Anything that is not this backend belongs to the user's browser, not to an app window with no chrome.
  win.webContents.setWindowOpenHandler(({ url: target }) => { shell.openExternal(target); return { action: 'deny' } })
  win.loadURL(url)
  return win
}

app.whenReady().then(async () => {
  if (!existsSync(SPEX_ENTRY)) {
    console.error(`[shell] no CLI entry at ${SPEX_ENTRY} — set SPEXCODE_DESKTOP_ENTRY to the spex bin.`)
    app.exit(1)
    return
  }
  try {
    backend = await bootBackend()
  } catch (e) {
    console.error(`[shell] backend failed to start: ${e.message}`)
    app.exit(1)
    return
  }
  window_ = openWindow(backend.port)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) window_ = openWindow(backend.port) })
})

// Quit on EVERY platform, macOS included. The usual darwin exception keeps the app resident with no window —
// which here means a backend still holding a port, so the next launch races itself. A resident process whose
// only purpose is to host a window it no longer has is not a feature.
app.on('window-all-closed', () => app.quit())

app.on('will-quit', () => {
  try { backend?.child.kill() } catch { /* already gone */ }
  backend = null
})
