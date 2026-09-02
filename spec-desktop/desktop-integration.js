'use strict'

const path = require('node:path')
const { hubNoticeUrl, mapDeepLink } = require('./deep-link.js')

const PROTOCOL = 'spexcode'
const PICK_DIRECTORY_ENV = 'SPEXCODE_DESKTOP_TEST_PICK_DIRECTORY'

function deepLinkFromArgv(argv) {
  return argv.find((value) => typeof value === 'string' && value.startsWith(`${PROTOCOL}://`)) || null
}

function focusWindow(win) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

async function projectIds(gatewayUrl) {
  const response = await fetch(`${gatewayUrl}/projects`, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`project catalog refused the link (HTTP ${response.status})`)
  const body = await response.json()
  if (!Array.isArray(body?.projects)) throw new Error('project catalog returned an unexpected answer')
  return new Set(body.projects.map((project) => project?.id ?? project?.projectId).filter((id) => typeof id === 'string'))
}

function createDesktopIntegration({ app, dialog, getGateway, getMainWindow }) {
  const pendingLinks = []
  let ready = false

  const registered = app.isPackaged
    ? app.setAsDefaultProtocolClient(PROTOCOL)
    : app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  if (!registered) {
    console.error(`[shell] could not register ${PROTOCOL}:// as the default protocol handler`)
  }

  const navigateMain = async (target) => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) throw new Error('main window is unavailable')
    await win.loadURL(target)
    focusWindow(win)
  }

  const showHubReason = async (reason) => {
    const gateway = getGateway()
    if (!gateway?.url) {
      console.error(`[shell] ${reason}`)
      return
    }
    try { await navigateMain(hubNoticeUrl(gateway.url, reason)) }
    catch (error) { console.error(`[shell] ${reason}; could not load the projects hub - ${error.message}`) }
  }

  const openDeepLink = async (value) => {
    if (!ready) { pendingLinks.push(value); return }
    const gateway = getGateway()
    if (!gateway?.url) { pendingLinks.push(value); return }
    try {
      const known = await projectIds(gateway.url)
      const mapped = mapDeepLink(value, gateway.url, known)
      if (!mapped.ok) { await showHubReason(mapped.reason); return }
      await navigateMain(mapped.url)
    } catch (error) {
      await showHubReason(`Could not open SpexCode link: ${error.message}`)
    }
  }

  const acceptArgv = (argv) => {
    const value = deepLinkFromArgv(argv)
    if (value) { void openDeepLink(value); return true }
    focusWindow(getMainWindow())
    return false
  }

  app.on('open-url', (event, value) => {
    event.preventDefault()
    void openDeepLink(value)
  })

  const initial = deepLinkFromArgv(process.argv)
  if (initial) pendingLinks.push(initial)

  return {
    handleSecondInstance(argv) { acceptArgv(argv) },
    async ready() {
      ready = true
      while (pendingLinks.length) await openDeepLink(pendingLinks.shift())
    },
    async addProject() {
      try {
        const gateway = getGateway()
        if (!gateway?.url) { await showHubReason('The gateway is not running.'); return }
        let root = process.env[PICK_DIRECTORY_ENV]?.trim() || ''
        if (!root) {
          const result = await dialog.showOpenDialog(getMainWindow(), { properties: ['openDirectory'] })
          if (result.canceled || result.filePaths.length === 0) return
          root = result.filePaths[0]
        }
        const response = await fetch(`${gateway.url}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ root }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body?.error || `project registration failed (HTTP ${response.status})`)
        const projectId = body?.id ?? body?.projectId
        if (typeof projectId !== 'string' || !projectId) throw new Error('project registration returned no project id')
        await navigateMain(`${gateway.url}/p/${encodeURIComponent(projectId)}/#/graph`)
      } catch (error) {
        await showHubReason(`Could not add project: ${error.message}`)
      }
    },
  }
}

module.exports = { PICK_DIRECTORY_ENV, createDesktopIntegration, deepLinkFromArgv }
