import type { Server } from 'node:net'

// @@@ listenOrExit - the shared "I own this port; if I cannot bind it, I have failed" contract for the two
// public-port listeners: the supervisor's raw-TCP proxy (supervise.ts) and the dashboard/public gateway
// (gateway.ts). A bind failure is the ONE thing neither may survive — it is the opposite of the keep-serving
// process guard, which rides out transient throws once the port is already held. So instead of leaving the
// listen error unhandled (under `serve` the supervisor's uncaughtException guard would SWALLOW it into a
// portless zombie on a random child port; under `dashboard`, with no guard, it would crash with a raw stack),
// we attach one handler that fails loudly the same way on both surfaces: name the busy port and the repair,
// reap any child booted for this bind so none is orphaned, and exit non-zero.
//
// http.Server / https.Server both extend net.Server, so this one signature covers every caller.
export function listenOrExit(
  server: Server,
  port: number,
  opts: { host?: string; label: string; cleanup?: () => void; onListen: () => void },
): void {
  server.once('error', (err: NodeJS.ErrnoException) => {
    opts.cleanup?.()
    const why = err.code === 'EADDRINUSE' ? `port ${port} is already in use`
      : err.code === 'EACCES' ? `permission denied binding port ${port}`
      : err.code ?? err.message
    console.error(`spec-cli: ${opts.label} cannot bind — ${why}. Free :${port} (e.g. lsof -i :${port}) or pick another port, then retry.`)
    process.exit(1)
  })
  if (opts.host) server.listen(port, opts.host, opts.onListen)
  else server.listen(port, opts.onListen)
}
