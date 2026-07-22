// Product-level rolling-compatibility + half-open proof. Run against a live worktree backend. A browser-shaped
// old client ignores the application text ping but automatically answers protocol ping, so it must survive a
// backend upgrade. A true ghost disables protocol auto-pong and must still lose its real tmux client.
//
// Run: BASE=http://127.0.0.1:8787 npx tsx test/terminal-socket-lifecycle.ts
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

const pexec = promisify(execFile)
const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const SESSION = `socket-lifecycle-${process.pid}-${Date.now()}`
const DEAD_MS = 25_000
const WsClient: any = createRequire(import.meta.url)('ws')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', SOCK, ...args])

async function clients(): Promise<string[]> {
  try {
    const { stdout } = await tmux('list-clients', '-t', SESSION, '-F', '#{client_pid}|#{client_width}x#{client_height}')
    return stdout.trim().split('\n').filter(Boolean)
  } catch { return [] }
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeout: number): Promise<T> {
  const deadline = Date.now() + timeout
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(25)
  }
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`)
  if (!health.ok) throw new Error(`backend health ${health.status}`)
  await tmux('new-session', '-d', '-s', SESSION, '-x', '80', '-y', '24')
  const socketUrl = `${BASE.replace(/^http/, 'ws')}/api/sessions/${SESSION}/socket`
  const legacy = new WebSocket(socketUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('terminal WebSocket did not open')), 5000)
      legacy.onopen = () => { clearTimeout(timeout); resolve() }
      legacy.onerror = () => { clearTimeout(timeout); reject(new Error('terminal WebSocket errored before open')) }
    })
    // Previous frontend bundle: no message handler, so text `ping` is never answered with text `pong`.
    // The browser implementation still auto-pongs RFC 6455 protocol ping below JavaScript.
    legacy.send(JSON.stringify({ t: 'resize', cols: 117, rows: 37 }))
    const attached = await waitFor(clients, (value) => value.length === 1, 'visible native client', 5000)
    await sleep(DEAD_MS + 1500)
    const survived = await clients()
    if (survived.length !== 1 || legacy.readyState !== WebSocket.OPEN) {
      throw new Error(`previous-bundle client did not survive rolling backend upgrade (${legacy.readyState}, ${survived.join(',')})`)
    }
    legacy.close()
    await waitFor(clients, (value) => value.length === 0, 'legacy client detach', 5000)

    const ghost = new WsClient(socketUrl, { autoPong: false })
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('ghost terminal WebSocket did not open')), 5000)
      ghost.once('open', () => { clearTimeout(timeout); resolve() })
      ghost.once('error', (error: Error) => { clearTimeout(timeout); reject(error) })
    })
    // A genuine half-open peer cannot answer protocol ping. It can send the initial visible claim, then becomes
    // totally silent without a FIN/RST or close event reaching the backend.
    ghost.send(JSON.stringify({ t: 'resize', cols: 119, rows: 39 }))
    const ghostAttached = await waitFor(clients, (value) => value.length === 1, 'ghost native client', 5000)
    const attachedPid = ghostAttached[0]?.split('|')[0]
    const started = Date.now()
    await waitFor(clients, (value) => value.length === 0, 'server heartbeat reap', DEAD_MS + 8000)
    const elapsed = Date.now() - started
    if (elapsed < DEAD_MS - 1000) throw new Error(`client reaped before the heartbeat deadline (${elapsed}ms)`)
    if (ghost.readyState !== WsClient.CLOSING && ghost.readyState !== WsClient.CLOSED) {
      throw new Error(`server detached tmux but left WebSocket open (${ghost.readyState})`)
    }
    ghost.terminate()
    console.log(`PASS: previous-bundle client survived ${DEAD_MS + 1500}ms without text pong; no-protocol-pong client ${attachedPid} was reaped after ${elapsed}ms`)
  } finally {
    try { legacy.close() } catch { /* already closed */ }
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
