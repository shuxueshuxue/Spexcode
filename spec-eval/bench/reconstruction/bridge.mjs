// spec-reconstruction-bench sandbox bridge ([[spec-reconstruction-bench]]).
// The generation sandbox runs in an isolated netns with ONLY loopback; its single egress is a
// unix socket bound into the sandbox. Two symmetric halves:
//   host mode:  node bridge.mjs host <unix.sock> <targetHost> <targetPort>   (host netns: unix → TCP)
//   ns mode:    node bridge.mjs ns   <unix.sock> <listenPort>                (inside netns: 127.0.0.1 TCP → unix)
// TLS passes through untouched — the client still validates the real endpoint certificate.
// Each half logs one line per connection to stderr (count + direction, no payload) for the run archive.
import net from 'node:net'
import { unlinkSync, existsSync } from 'node:fs'

const [mode, sock, a, b] = process.argv.slice(2)
let n = 0
const log = (m) => process.stderr.write(`[bridge:${mode}] ${m}\n`)
const pipe = (from, to) => { from.pipe(to); to.pipe(from); const die = () => { from.destroy(); to.destroy() }; from.on('error', die); to.on('error', die); from.on('close', die); to.on('close', die) }

if (mode === 'host') {
  if (existsSync(sock)) unlinkSync(sock)
  const srv = net.createServer((c) => {
    const id = ++n
    const up = net.connect({ host: a, port: Number(b) }, () => log(`conn#${id} → ${a}:${b}`))
    up.on('error', (e) => log(`conn#${id} upstream error: ${e.code}`))
    pipe(c, up)
  })
  srv.listen(sock, () => log(`listening unix:${sock} → ${a}:${b}`))
} else if (mode === 'ns') {
  const srv = net.createServer((c) => {
    const id = ++n
    const up = net.connect(sock, () => log(`conn#${id} → unix`))
    up.on('error', (e) => log(`conn#${id} unix error: ${e.code}`))
    pipe(c, up)
  })
  srv.listen(Number(a), '127.0.0.1', () => log(`listening 127.0.0.1:${a} → unix:${sock}`))
} else {
  console.error('usage: bridge.mjs host <unix.sock> <host> <port> | ns <unix.sock> <listenPort>')
  process.exit(1)
}
