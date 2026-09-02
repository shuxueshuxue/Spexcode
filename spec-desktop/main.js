'use strict'

// The desktop shell is a window over `spex dashboard`. It owns the gateway child when it has to start one,
// and adds only operating-system integration around the same dashboard a browser loads.
const { app, BrowserWindow, Menu, utilityProcess, shell, dialog } = require('electron')
const { createServer } = require('node:net')
const { resolve } = require('node:path')
const { existsSync } = require('node:fs')
const { createDesktopIntegration } = require('./desktop-integration.js')
const { findRunningGateway } = require('./gateway-discovery.js')

const SPEX_ENTRY = process.env.SPEXCODE_DESKTOP_ENTRY || resolve(__dirname, '..', 'bin', 'spex.mjs')
const NODE_ENTRY = resolve(__dirname, 'node-entry.mjs')
const PROJECT_CWD = process.env.SPEXCODE_DESKTOP_CWD || process.cwd()
const BOOT_TIMEOUT_MS = 30_000
const MAX_BIND_ATTEMPTS = 5

let gateway = null
let mainWindow = null
let desktopIntegration = null

// Electron's second-instance event is delivered to the first process. Acquire the lock before registering any
// ready handlers so a losing launch exits without starting a gateway or creating a window.
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  desktopIntegration = createDesktopIntegration({ app, dialog, getGateway: () => gateway, getMainWindow: () => mainWindow })
  app.on('second-instance', (_event, argv) => desktopIntegration.handleSecondInstance(argv))
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolvePort(port))
    })
  })
}

function startGateway(port) {
  return new Promise((resolveGateway, rejectGateway) => {
    const { PORT, SPEXCODE_API_URL, SPEXCODE_INSTANCE_ID, SPEXCODE_PROJECT_ROOT, ...clean } = process.env
    const child = utilityProcess.fork(NODE_ENTRY, ['dashboard', '--port', String(port)], {
      cwd: PROJECT_CWD,
      stdio: 'pipe',
      env: { ...clean, SPEXCODE_DESKTOP: '1', SPEXCODE_DESKTOP_ENTRY: SPEX_ENTRY },
    })
    let settled = false
    const settle = (fn, value) => {
      if (settled) return
      settled = true
      fn(value)
    }
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      settle(rejectGateway, new Error(`gateway did not come up within ${BOOT_TIMEOUT_MS}ms`))
    }, BOOT_TIMEOUT_MS)
    const consumeLines = (stream, sink) => {
      let buffer = ''
      stream?.on('data', (chunk) => {
        buffer += String(chunk)
        let newline
        while ((newline = buffer.indexOf('\n')) >= 0) {
          sink(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
        }
      })
    }
    consumeLines(child.stdout, (line) => {
      process.stdout.write(`[gateway] ${line}\n`)
      if (/\[hub\] multi-project gateway on /.test(line)) {
        clearTimeout(timer)
        settle(resolveGateway, { child, url: `http://127.0.0.1:${port}`, owned: true })
      }
    })
    consumeLines(child.stderr, (line) => process.stderr.write(`[gateway] ${line}\n`))
    child.once('exit', (code) => {
      clearTimeout(timer)
      settle(rejectGateway, Object.assign(new Error(`gateway exited (${code}) before it was ready`), { exitCode: code }))
      if (mainWindow && gateway?.child === child) app.quit()
    })
  })
}

async function attachOrStartGateway() {
  const running = await findRunningGateway()
  if (running) return { url: running, owned: false, child: null }

  let lastError = null
  for (let attempt = 1; attempt <= MAX_BIND_ATTEMPTS; attempt++) {
    const port = await freePort()
    try {
      return await startGateway(port)
    } catch (error) {
      lastError = error
      console.error(`[shell] gateway boot attempt ${attempt}/${MAX_BIND_ATTEMPTS} failed - ${error.message}`)
    }
  }
  throw lastError
}

function installApplicationMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ id: 'add-project', label: 'Add Project…', click: () => void desktopIntegration.addProject() }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
  ]))
}

function openWindow(gatewayUrl, target = `${gatewayUrl}/`, isMain = false) {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 560,
    backgroundColor: '#262626',
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  let loads = 0
  const load = () => win.loadURL(target)
  win.webContents.on('did-fail-load', (_event, code, description) => {
    if (loads++ < 30) setTimeout(load, 200)
    else console.error(`[shell] giving up loading ${target} - ${code} ${description}`)
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    let sameOrigin = false
    try { sameOrigin = new URL(url).origin === new URL(gatewayUrl).origin } catch { /* off-origin or malformed */ }
    if (sameOrigin) {
      openWindow(gatewayUrl, url)
    } else {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  if (isMain) mainWindow = win
  load()
  return win
}

if (hasSingleInstanceLock) {
  app.whenReady().then(async () => {
    installApplicationMenu()
    if (!existsSync(SPEX_ENTRY)) {
      console.error(`[shell] no CLI entry at ${SPEX_ENTRY} - set SPEXCODE_DESKTOP_ENTRY to the spex bin.`)
      app.exit(1)
      return
    }
    try {
      gateway = await attachOrStartGateway()
      openWindow(gateway.url, `${gateway.url}/`, true)
      await desktopIntegration.ready()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) openWindow(gateway.url, `${gateway.url}/`, true)
      })
    } catch (error) {
      console.error(`[shell] gateway failed to start: ${error.message}`)
      app.exit(1)
    }
  })
}

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  if (gateway?.owned) {
    try { gateway.child.kill() } catch { /* already gone */ }
  }
  gateway = null
})
