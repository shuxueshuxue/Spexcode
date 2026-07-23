// No-model product fixture for the complete managed-session terminal path.
// Run against a backend whose claude launcher resolves to spec-cli/test/fixtures/fake-claude:
//   BASE=http://127.0.0.1:8787 npx tsx test/session-terminal-fixture.ts
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { createConnection } from 'node:net'
import { promisify } from 'node:util'
import { rendezvousListening, rvSock } from '../src/harness.js'

const pexec = promisify(execFile)
const BASE = process.env.BASE || 'http://127.0.0.1:8787'
const LAUNCHER = process.env.LAUNCHER || 'claude'
const TMUX = process.env.SPEXCODE_TMUX || 'spexcode'
const WsClient: any = createRequire(import.meta.url)('ws')
const SESSION_PROMPT = `fake terminal fixture ${process.pid}-${Date.now()}`
const CONTROL_MARKER = `FAKE-CONTROL-${process.pid}-${Date.now()}`

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const tmux = (...args: string[]) => pexec('tmux', ['-L', TMUX, ...args])

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(100)
  }
}

async function jsonRequest(path: string, init: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
  const response = await fetch(`${BASE}${path}`, init)
  const text = await response.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* text response */ }
  return { status: response.status, body, text }
}

async function postSession(): Promise<{ id: string; path: string; branch: string | null }> {
  const payload = { prompt: SESSION_PROMPT, launcher: LAUNCHER }
  let response = await jsonRequest('/api/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
  // Older backends pre-dating the named-launcher field still accept the same lifecycle request. Retry only
  // when the server explicitly rejects that field; never turn an arbitrary launch error into a second create.
  if (response.status === 400 && /unknown session-create field.*launcher/.test(response.body?.error || response.text)) {
    response = await jsonRequest('/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: SESSION_PROMPT }),
    })
  }
  assert.equal(response.status, 201, `POST /api/sessions failed: ${response.text}`)
  assert.ok(response.body?.id, 'created session has an id')
  return { id: response.body.id, path: response.body.path, branch: response.body.branch ?? null }
}

async function paneDescendants(id: string): Promise<number[]> {
  const pane = await tmux('list-panes', '-t', id, '-F', '#{pane_pid}')
  const panePid = Number(pane.stdout.trim().split('\n')[0])
  if (!panePid) return []
  const { stdout } = await pexec('ps', ['-eo', 'pid=,ppid='])
  const children = new Map<number, number[]>()
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)/.exec(line)
    if (!match) continue
    const pid = Number(match[1]), ppid = Number(match[2])
    children.set(ppid, [...(children.get(ppid) || []), pid])
  }
  const result: number[] = [], stack = [panePid]
  while (stack.length) {
    for (const child of children.get(stack.pop()!) || []) { result.push(child); stack.push(child) }
  }
  return result
}

async function noProcesses(pids: number[]): Promise<boolean> {
  for (const pid of pids) {
    try { process.kill(pid, 0); return false } catch { /* dead */ }
  }
  return true
}

async function rendezvousPing(id: string): Promise<void> {
  const connection = createConnection({ path: rvSock(id) })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('fake rendezvous ping timed out')), 2_000)
    let buffer = ''
    connection.once('error', (error) => { clearTimeout(timeout); reject(error) })
    connection.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      for (const line of buffer.split('\n').slice(0, -1)) {
        try {
          if (JSON.parse(line).type === 'pong') { clearTimeout(timeout); connection.end(); resolve(); return }
        } catch { /* ignore malformed probe output */ }
      }
      buffer = buffer.slice(buffer.lastIndexOf('\n') + 1)
    })
    connection.once('connect', () => connection.write(JSON.stringify({ type: 'ping' }) + '\n'))
  })
}

async function terminalSocket(id: string): Promise<{ ws: any; output: () => string; sawPing: () => boolean }> {
  const socketUrl = `${BASE.replace(/^http/, 'ws')}/api/sessions/${id}/socket`
  const ws = new WsClient(socketUrl)
  let output = ''
  let sawPing = false
  let upgradeStatus: number | undefined
  ws.on('upgrade', (response: { statusCode?: number }) => { upgradeStatus = response.statusCode })
  ws.on('message', (data: any, binary: boolean) => {
    if (binary) output += Buffer.from(data).toString('utf8')
    else if (String(data) === 'ping') { sawPing = true; ws.send('pong') }
  })
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('terminal WebSocket did not open')), 10_000)
    ws.once('open', () => { clearTimeout(timeout); resolve() })
    ws.once('error', (error: Error) => { clearTimeout(timeout); reject(error) })
  })
  assert.equal(upgradeStatus, 101, 'terminal socket completed an HTTP 101 upgrade')
  ws.send(JSON.stringify({ t: 'resize', cols: 100, rows: 24 }))
  return { ws, output: () => output, sawPing: () => sawPing }
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/health`)
  assert.equal(health.status, 200, `backend health ${health.status}`)
  const created = await postSession()
  const id = created.id
  let ws: any = null
  let descendants: number[] = []
  try {
    await waitFor(async () => (await jsonRequest(`/api/sessions/${id}`)).body, (session) => session?.liveness === 'online' || session?.status === 'online', 'derived online')
    assert.equal(await rendezvousListening(id), 'live', 'derived online is backed by a live rendezvous listener')
    await rendezvousPing(id)
    descendants = await paneDescendants(id)

    const terminal = await terminalSocket(id)
    ws = terminal.ws
    const output = terminal.output
    await waitFor(async () => output(), (value) => value.includes('FAKE-HARNESS READY'), 'real PTY ready output')

    const control = await jsonRequest(`/api/sessions/${id}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'text', text: CONTROL_MARKER }),
    })
    assert.equal(control.status, 200, `rendezvous control handshake failed: ${control.text}`)
    await waitFor(async () => output(), (value) => value.includes(`FAKE-HARNESS REPLY ${CONTROL_MARKER}`), 'rendezvous reply in PTY output')
    assert.match(output(), /FAKE-HARNESS TICK \d+/, 'fixed-rate fake output reached the PTY bridge')
    await waitFor(async () => terminal.sawPing(), Boolean, 'terminal application ping/pong', 12_000)
    ws.close()
    await new Promise<void>((resolve) => ws.once('close', () => resolve()))
    ws = null

    const closed = await jsonRequest(`/api/sessions/${id}/close`, { method: 'POST' })
    assert.equal(closed.status, 200, `close cleanup failed: ${closed.text}`)
    await waitFor(async () => {
      try { await tmux('has-session', '-t', id); return false } catch { return true }
    }, Boolean, 'tmux session removal', 10_000)
    await waitFor(async () => !(await existsSync(rvSock(id))) && (await rendezvousListening(id)) === 'dead', Boolean, 'rendezvous socket cleanup', 10_000)
    await waitFor(() => noProcesses(descendants), Boolean, 'fake harness process cleanup', 10_000)
    if (created.path) assert.equal(existsSync(created.path), false, 'close removed the worker worktree')
    if (created.branch) {
      const branches = await pexec('git', ['branch', '--list', created.branch])
      assert.equal(branches.stdout.trim(), '', 'close removed the worker branch')
    }
    console.log(`PASS: POST /api/sessions -> online -> 101 -> PTY output -> close; no tmux/socket/process residue (${id})`)
  } finally {
    try { ws?.close() } catch { /* already closed */ }
    if (created?.id) {
      const probe = await jsonRequest(`/api/sessions/${created.id}/close`, { method: 'POST' }).catch(() => null)
      if (probe && probe.status >= 500) console.error(`cleanup retry failed: ${probe.text}`)
    }
  }
}

main().catch((error) => { console.error('FAIL:', error); process.exit(1) })
