import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dashboardRoot } from './dashboard-assets.js'

// The daemon's third-party runtime (the HTTP server, its WebSocket upgrade, the terminal PTY) ships with the
// dashboard package: whoever serves the dashboard installs it, and a CLI-only install stays without a server or
// a native addon. The dashboard re-exports it from daemon.mjs (and node-pty from daemon-pty.mjs, loaded only by
// the terminal helper), so each dependency resolves from the dashboard's own tree in every install layout.
export type DaemonRuntime = {
  Hono: typeof import('hono').Hono
  cors: typeof import('hono/cors').cors
  etag: typeof import('hono/etag').etag
  streamSSE: typeof import('hono/streaming').streamSSE
  serve: typeof import('@hono/node-server').serve
  createNodeWebSocket: typeof import('@hono/node-ws').createNodeWebSocket
}

let runtime: Promise<DaemonRuntime> | undefined

export function daemonRuntime(): Promise<DaemonRuntime> {
  return (runtime ??= load())
}

async function load(): Promise<DaemonRuntime> {
  const root = dashboardRoot()
  const entry = join(root, 'daemon.mjs')
  if (!existsSync(entry)) {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }
    throw new Error(`the installed @spexcode/spec-dashboard ${version ?? ''} predates the server runtime it now carries (no daemon.mjs at ${root})`)
  }
  return import(pathToFileURL(entry).href) as Promise<DaemonRuntime>
}
