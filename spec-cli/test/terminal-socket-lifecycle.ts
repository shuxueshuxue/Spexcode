// Product-level half-open proof. Run against a live worktree backend; this client deliberately ignores the
// application heartbeat ping, so the server must remove its real tmux client without receiving a peer close.
//
// Run: BASE=http://127.0.0.1:8787 npx tsx test/terminal-socket-lifecycle.ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)
const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const SOCK = process.env.SPEXCODE_TMUX || 'spexcode'
const SESSION = `socket-lifecycle-${process.pid}-${Date.now()}`
const DEAD_MS = 25_000
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
  const ws = new WebSocket(socketUrl)
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('terminal WebSocket did not open')), 5000)
      ws.onopen = () => { clearTimeout(timeout); resolve() }
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('terminal WebSocket errored before open')) }
    })
    // Intentionally install no message handler: server `ping` text is received but never answered `pong`.
    ws.send(JSON.stringify({ t: 'resize', cols: 117, rows: 37 }))
    const attached = await waitFor(clients, (value) => value.length === 1, 'visible native client', 5000)
    const attachedPid = attached[0]?.split('|')[0]
    const started = Date.now()
    await waitFor(clients, (value) => value.length === 0, 'server heartbeat reap', DEAD_MS + 8000)
    const elapsed = Date.now() - started
    if (elapsed < DEAD_MS - 1000) throw new Error(`client reaped before the heartbeat deadline (${elapsed}ms)`)
    if (ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
      throw new Error(`server detached tmux but left WebSocket open (${ws.readyState})`)
    }
    console.log(`PASS: no-pong WebSocket owned native client ${attachedPid}, then server reaped it after ${elapsed}ms with no peer close`)
  } finally {
    try { ws.close() } catch { /* already reaped */ }
    await tmux('kill-session', '-t', SESSION).catch(() => {})
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
