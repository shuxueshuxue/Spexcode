import type { AddressInfo, Server } from 'node:net'

// The two bind faces a listener can have, named once so no caller spells them as bare strings. LOOPBACK is
// the private face (this machine only); ALL_INTERFACES is the wide one a caller must ASK for.
export const LOOPBACK_HOST = '127.0.0.1'
export const ALL_INTERFACES = '0.0.0.0'

// @@@ resolveConfiguredHost ([[listener-readiness]]) - the sibling of resolveConfiguredPort: one place that
// turns a raw --host/env value into the interface a listener binds. A surface passes the face it declares as
// its own default, so "unset" resolves to that declared default and never to whatever Node would pick.
export function resolveConfiguredHost(rawHost: string | undefined, declaredDefault: string = LOOPBACK_HOST): string {
  const normalized = rawHost?.trim()
  return normalized || declaredDefault
}

export function resolveConfiguredPort(rawPort: string | undefined): number {
  const normalized = rawPort?.trim()
  if (!normalized) return 8787
  const port = Number(normalized)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be an integer from 0 to 65535, got ${JSON.stringify(rawPort)}`)
  }
  return port
}

// @@@ listenOrExit ([[listener-readiness]]) - the one public-listener transition: before `listening`, a bind
// failure is loud and fatal; after it, publication side effects and user-visible ready lines may run. Keeping
// both halves here prevents a private child or pre-bind caller from announcing a surface it does not own.
//
// `host` is REQUIRED, and that is the point: an optional bind face whose absence means "every interface" hides
// the widest possible exposure behind the shortest possible call. Every caller states the face it exposes, so
// the bind is readable at the call site instead of inferred from Node's default. Use resolveConfiguredHost to
// turn a --host/env value into it, or LOOPBACK_HOST / ALL_INTERFACES when the surface fixes its own face.
//
// http.Server / https.Server both extend net.Server, so this one signature covers every caller.
export function listenOrExit(
  server: Server,
  port: number,
  opts: { host: string; label: string; cleanup?: () => void; onListen?: (port: number) => void; ready: string | string[] | ((port: number) => string | string[]) },
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
  server.listen(port, opts.host, publishReady)
}
