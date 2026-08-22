import type { AddressInfo, Server } from 'node:net'

// @@@ listenOrExit ([[listener-readiness]]) - the one public-listener transition: before `listening`, a bind
// failure is loud and fatal; after it, publication side effects and user-visible ready lines may run. Keeping
// both halves here prevents a private child or pre-bind caller from announcing a surface it does not own.
//
// http.Server / https.Server both extend net.Server, so this one signature covers every caller.
export function listenOrExit(
  server: Server,
  port: number,
  opts: { host?: string; label: string; cleanup?: () => void; onListen?: (port: number) => void; ready: string | string[] | ((port: number) => string | string[]) },
): void {
  server.once('error', (err: NodeJS.ErrnoException) => {
    opts.cleanup?.()
    const why = err.code === 'EADDRINUSE' ? `port ${port} is already in use`
      : err.code === 'EACCES' ? `permission denied binding port ${port}`
      : err.code ?? err.message
    console.error(`spec-cli: ${opts.label} cannot bind — ${why}. Free :${port} (e.g. lsof -i :${port}) or pick another port, then retry.`)
    process.exit(1)
  })
  const publishReady = () => {
    const actualPort = (server.address() as AddressInfo).port
    opts.onListen?.(actualPort)
    const ready = typeof opts.ready === 'function' ? opts.ready(actualPort) : opts.ready
    for (const line of Array.isArray(ready) ? ready : [ready]) console.log(line)
  }
  if (opts.host) server.listen(port, opts.host, publishReady)
  else server.listen(port, publishReady)
}
