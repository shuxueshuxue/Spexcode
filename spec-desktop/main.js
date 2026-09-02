'use strict'

// The desktop shell is a window over `spex dashboard`. It owns the gateway child when it has to start one,
// and adds only operating-system integration around the same dashboard a browser loads.
const { app, BrowserWindow, Menu, utilityProcess, shell, ipcMain, dialog } = require('electron')
const { createServer } = require('node:net')
const { resolve } = require('node:path')
const { existsSync } = require('node:fs')
const wsl = require('./wsl.js')
const { createDesktopIntegration } = require('./desktop-integration.js')
const { findRunningGateway: findHostGateway } = require('./gateway-discovery.js')

const PACKAGED_BUNDLE = app.isPackaged ? resolve(process.resourcesPath, 'spexcode') : null
const SPEX_ENTRY = process.env.SPEXCODE_DESKTOP_ENTRY || (PACKAGED_BUNDLE
  ? resolve(PACKAGED_BUNDLE, 'bin', 'spex.mjs')
  : resolve(__dirname, '..', 'bin', 'spex.mjs'))
const BUNDLE_DIR = process.env.SPEXCODE_DESKTOP_BUNDLE_DIR || (PACKAGED_BUNDLE ? resolve(PACKAGED_BUNDLE, 'tarballs') : '')
const BOOTSTRAP_SCRIPT = PACKAGED_BUNDLE ? resolve(process.resourcesPath, 'wsl-bootstrap.sh') : undefined
const NODE_ENTRY = resolve(__dirname, 'node-entry.mjs')
const PROJECT_CWD = process.env.SPEXCODE_DESKTOP_CWD || process.cwd()
const BOOT_TIMEOUT_MS = 30_000
const PROBE_TIMEOUT_MS = 1_000
const MAX_BIND_ATTEMPTS = 5

let gateway = null
let mainWindow = null
let bootstrapChild = null
let firstRunWindow = null
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

function validLoopbackUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) return null
    if (url.port && (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535)) return null
    return url.origin
  } catch {
    return null
  }
}

async function probeGateway(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    // `/` is intentionally outside the admin gate, so this identifies a password-locked gateway too.
    const response = await fetch(`${url}/`, {
      redirect: 'manual',
      signal: controller.signal,
    })
    return response.status === 302 && response.headers.get('location') === '/projects' ? url : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function findRunningGateway(distro = null) {
  if (process.platform === 'win32' && distro) {
    const wslRecord = await wsl.readWslHostRecord(distro)
    if (wslRecord) {
      const found = await probeGateway(validLoopbackUrl(wslRecord.url) || '')
      if (found) return found
    }
  }
  return findHostGateway()
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

function waitForHealth(url, timeoutMs = BOOT_TIMEOUT_MS) {
  const started = Date.now()
  return new Promise((resolveHealth, rejectHealth) => {
    const check = async () => {
      try {
        const response = await fetch(`${url}/health`)
        if (response.ok) return resolveHealth(url)
      } catch { /* the child may still be binding */ }
      if (Date.now() - started >= timeoutMs) return rejectHealth(new Error(`gateway health check timed out after ${timeoutMs}ms`))
      setTimeout(check, 200)
    }
    check()
  })
}

function appendTranscript(win, chunk) {
  if (!win || win.isDestroyed()) return
  const text = String(chunk)
  if (!win._firstRunLoaded) {
    win._firstRunTranscript = (win._firstRunTranscript || '') + text
    return
  }
  win.webContents.executeJavaScript(`window.desktopBootstrap?.append(${JSON.stringify(text)})`).catch(() => {})
}

function showFirstRunPage(message = '') {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    backgroundColor: '#1f211f',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: resolve(__dirname, 'first-run-preload.js') },
  })
  firstRunWindow = win
  win.webContents.once('did-finish-load', () => {
    win._firstRunLoaded = true
    if (win._firstRunTranscript) {
      const transcript = win._firstRunTranscript
      win._firstRunTranscript = ''
      appendTranscript(win, transcript)
    }
  })
  win.loadFile(resolve(__dirname, 'first-run.html')).then(() => {
    if (message) appendTranscript(win, `${message}\n`)
  })
  win.on('closed', () => { if (firstRunWindow === win) firstRunWindow = null })
  return win
}

function runBootstrap(distro, win) {
  const command = wsl.bootstrapCommand(distro, BOOTSTRAP_SCRIPT, BUNDLE_DIR, process.env.SPEXCODE_WSL_PROJECT_ROOT || '')
  const child = wsl.runWsl(distro, command.args.slice(3), {
    probe: command.file,
    env: { ...process.env, SPEXCODE_PROJECT_ROOT: process.env.SPEXCODE_WSL_PROJECT_ROOT || '' },
  })
  bootstrapChild = child
  const onChunk = (chunk) => {
    const text = String(chunk)
    process.stdout.write(text)
    appendTranscript(win, text)
    if (/sudo .*password|password for .*:/i.test(text)) win.webContents.executeJavaScript('window.desktopBootstrap?.promptPassword()').catch(() => {})
  }
  child.stdout?.on('data', onChunk)
  child.stderr?.on('data', onChunk)
  child.on('close', () => { bootstrapChild = null })
  return child
}

function startWslGateway(distro, port) {
  return new Promise((resolveGateway, rejectGateway) => {
    const entry = resolve(__dirname, 'wsl-entry.cjs')
    const probe = process.env.SPEXCODE_DESKTOP_WSL_PROBE || 'wsl.exe'
    const child = utilityProcess.fork(entry, [probe, distro, String(port), process.env.SPEXCODE_BUNDLE_TARBALL || ''], {
      cwd: PROJECT_CWD,
      stdio: 'pipe',
      env: { ...process.env, SPEXCODE_DESKTOP: '1' },
    })
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* already gone */ }
      if (!settled) { settled = true; rejectGateway(new Error(`WSL gateway did not come up within ${BOOT_TIMEOUT_MS}ms`)) }
    }, BOOT_TIMEOUT_MS)
    const consume = (stream, sink) => stream?.on('data', (chunk) => {
      const text = String(chunk)
      output += text
      sink(text)
      if (!settled && /\[hub\] multi-project gateway on /.test(output)) {
        settled = true
        clearTimeout(timer)
        resolveGateway({ child, url: `http://localhost:${port}`, owned: true, distro })
      }
    })
    consume(child.stdout, (text) => process.stdout.write(`[wsl] ${text}`))
    consume(child.stderr, (text) => process.stderr.write(`[wsl] ${text}`))
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (!settled) { settled = true; rejectGateway(new Error(`WSL gateway exited (${code}) before it was ready`)) }
    })
  })
}

async function attachOrStartGateway() {
  if (process.platform === 'win32') {
    const wslHost = await wsl.detectWsl()
    const running = await findRunningGateway(wslHost.name)
    if (running) return { url: running, owned: false, child: null, distro: wslHost.name }
    const port = await freePort()
    return startWslGateway(wslHost.name, port)
  }
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
  const dispatchPageShortcut = (key, code) => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    if (!win || win.isDestroyed()) return
    const event = JSON.stringify({ key, code })
    win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { ...${event}, metaKey: true, bubbles: true, cancelable: true }))`).catch(() => {})
  }
  const macTabShortcuts = process.platform === 'darwin'
    ? [
        { label: 'Close Tab', accelerator: 'Command+W', click: () => dispatchPageShortcut('w', 'KeyW') },
        ...Array.from({ length: 9 }, (_, index) => {
          const ordinal = index + 1
          return { label: `Focus Tab ${ordinal}`, accelerator: `Command+${ordinal}`, click: () => dispatchPageShortcut(String(ordinal), `Digit${ordinal}`) }
        }),
      ]
    : []
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ id: 'add-project', label: 'Add Project…', click: () => void (process.platform === 'win32' ? pickProject(gateway?.url, gateway?.distro) : desktopIntegration.addProject()) }, { type: 'separator' }, { role: 'quit' }] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }, ...macTabShortcuts] },
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

async function pickProject(gatewayUrl, distro) {
  const testPath = process.env.SPEXCODE_DESKTOP_TEST_PICK_DIRECTORY?.trim() || ''
  let selectedPath = testPath
  if (!selectedPath) {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    selectedPath = result.filePaths[0]
  }
  const root = wsl.projectRootForPost(selectedPath, distro)
  const response = await fetch(`${gatewayUrl}/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root }),
  })
  if (!response.ok) throw new Error(`project registration failed (${response.status}): ${await response.text()}`)
  return response.json()
}

async function bootstrapWindowsAndStart() {
  let host
  try { host = await wsl.detectWsl() } catch (error) {
    const action = error.code === 'ENOENT' || error.code === 'WSL_UNAVAILABLE'
      ? (error.message.includes('version 1')
        ? `\n\nAction: in PowerShell run wsl --update if needed, then wsl --set-version ${error.distro || '<distro>'} 2, and reopen SpexCode.`
        : '\n\nAction: open an administrator PowerShell, run wsl --install, reboot, then reopen SpexCode.')
      : '\n\nDetection failed. Fix the WSL probe and reopen SpexCode.'
    const win = showFirstRunPage(`${error.message}${action}`)
    return new Promise(() => { win.on('closed', () => {}) })
  }
  const running = await findRunningGateway(host.name)
  if (running) return { url: running, owned: false, child: null, distro: host.name }
  const config = wsl.wslConfigStatus()
  const win = showFirstRunPage(`Detected WSL2 distro: ${host.name}\nRecommended WSL memory cap: 8GB (${config.present ? `${config.path} is present` : `${config.path} is not present`}).\n`)
  const child = runBootstrap(host.name, win)
  await new Promise((resolveBootstrap, rejectBootstrap) => {
    child.once('close', (code) => code === 0 ? resolveBootstrap() : rejectBootstrap(new Error(`WSL bootstrap exited (${code})`)))
    child.once('error', rejectBootstrap)
  })
  const port = await freePort()
  const started = await startWslGateway(host.name, port)
  await waitForHealth(started.url)
  if (firstRunWindow && !firstRunWindow.isDestroyed()) firstRunWindow.close()
  return started
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
      if (process.platform === 'win32') {
        ipcMain.on('spexcode-sudo-password', (_event, password) => {
          if (!bootstrapChild?.stdin?.writable) return
          bootstrapChild.stdin.write(`${String(password)}\n`)
        })
        gateway = await bootstrapWindowsAndStart()
        ipcMain.handle('spexcode-pick-project', () => pickProject(gateway.url, gateway.distro))
      } else {
        gateway = await attachOrStartGateway()
      }
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
