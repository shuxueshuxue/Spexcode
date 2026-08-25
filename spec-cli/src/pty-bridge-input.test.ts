import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

import type { Viewer } from './pty-bridge.js'

const pexec = promisify(execFile)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function tmux(socket: string, ...args: string[]): Promise<string> {
  const { stdout } = await pexec('tmux', ['-L', socket, ...args])
  return stdout
}

async function waitFor(read: () => Promise<string>, predicate: (value: string) => boolean, label: string): Promise<string> {
  const deadline = Date.now() + 7000
  for (;;) {
    const value = await read()
    if (predicate(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await sleep(25)
  }
}

test('PTY forwarding is visible-only and does not mutate lifecycle state', async () => {
  const socket = `pty-input-${process.pid}`
  const session = `pty-input-${process.pid}`
  const home = mkdtempSync(join(tmpdir(), 'pty-input-state-'))
  const runtime = join(home, 'runtime.json')
  const lifecycle = JSON.stringify({ status: 'asking', proposal: null, note: 'operator note' })
  writeFileSync(runtime, lifecycle)
  const viewer: Viewer = { send: () => {}, commitSize: () => {} }
  process.env.SPEXCODE_TMUX = socket
  const { attachViewer, detachViewer, forwardInput, hideViewer, resizeBridge } = await import('./pty-bridge.js')

  try {
    await tmux(socket, 'new-session', '-d', '-s', session, '-x', '96', '-y', '29')
    attachViewer(session, viewer)
    resizeBridge(session, viewer, 96, 29)
    await waitFor(
      () => tmux(socket, 'list-clients', '-t', session, '-F', '#{client_pid}'),
      (value) => value.trim().length > 0,
      'native PTY client',
    )

    hideViewer(session, viewer)
    assert.equal(forwardInput(session, viewer, 'hidden-input-should-not-land\r'), false)
    resizeBridge(session, viewer, 96, 29)
    assert.equal(forwardInput(session, viewer, 'printf PTY_FORWARDING_BEHAVIOR_789\r'), true)
    await waitFor(
      () => tmux(socket, 'capture-pane', '-p', '-t', session),
      (value) => value.includes('PTY_FORWARDING_BEHAVIOR_789'),
      'visible input in the native pane',
    )
    assert.equal(readFileSync(runtime, 'utf8'), lifecycle, 'PTY input must not write lifecycle state')
  } finally {
    detachViewer(session, viewer)
    await tmux(socket, 'kill-session', '-t', session).catch(() => {})
    rmSync(home, { recursive: true, force: true })
    delete process.env.SPEXCODE_TMUX
  }
})

test('raw-key fallback has no lifecycle side effect', () => {
  const source = readFileSync(new URL('./sessions.ts', import.meta.url), 'utf8')
  assert.match(source, /export async function rawKey[\s\S]*?return sent\n}/)
  const body = source.match(/export async function rawKey[\s\S]*?\n}/)?.[0] || ''
  assert.doesNotMatch(body, /markHumanPromptActive/)
})
