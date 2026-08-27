import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { readFileSync } from 'node:fs'

// [[dispatch]]: `POST /api/sessions/:id/interrupt` is ONE verb whose transport branch is decided in the
// backend. A pane-backed TUI without a native interrupt receives the operator's own key — C-c into its own
// pane — but only while its lifecycle is active; a headless adapter without a native primitive refuses.
// Measured against a real backend, a real tmux server on a throwaway socket, and a real pane whose shell
// reports the SIGINT it received.
const here = dirname(fileURLToPath(import.meta.url))
const index = join(here, 'index.ts')

async function freePort(): Promise<number> {
  const server = net.createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as net.AddressInfo).port
  server.close()
  await once(server, 'close')
  return port
}
async function waitFor(check: () => Promise<boolean>, label: string, ms = 30_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`timed out waiting for ${label}`)
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill('SIGTERM') }
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 5_000))])
}
const tmux = (socket: string, ...args: string[]) => spawnSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' })

// The live proof below cannot force a declaration between the lifecycle read and the send; this pins the
// shape that makes such a window impossible: one record lock holds both, and no send happens outside it.
test('interrupt reads the lifecycle and sends the pane key under one record lock', () => {
  const source = readFileSync(join(here, 'sessions.ts'), 'utf8')
  const body = source.match(/export async function interruptSession[\s\S]*?\n\}\n/)?.[0] || ''
  assert.match(body, /return withRecordLock\(id, async \(\) => \{[\s\S]*rec\.status !== 'active'[\s\S]*sendRawKeysLocked\(id, \['C-c'\]\)[\s\S]*\}\)\n\}/)
  assert.doesNotMatch(body, /await rawKey\(/)
})

test('YATU: interrupt reaches a pane-backed TUI as its own key, and refuses where no keyboard or turn exists', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-interrupt-api-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const socket = `interrupt-api-${port}`
  const idle = 'interrupt-api-idle'
  const pane = 'interrupt-api-pane'
  const headless = 'interrupt-api-headless'
  let backend: ChildProcess | null = null
  const record = (id: string, harness: string, status: string) => {
    const sessionDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      session_id: id, governed: true, worktree_path: project, branch: 'main', node: '', title: 'interrupt API', name: '', parent: '',
      status, proposal: '', merges: 0, note: '', sortkey: '', createdAt: 1, harness, harness_session_id: '',
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: harness, launch_owner: '',
    }) + '\n')
  }
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude', 'pi-headless'] }) + '\n')
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    spawnSync('git', ['config', 'user.email', 'interrupt@example.test'], { cwd: project })
    spawnSync('git', ['config', 'user.name', 'Interrupt Fixture'], { cwd: project })
    spawnSync('git', ['add', '.'], { cwd: project }); spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: project })
    record(idle, 'claude', 'asking')
    record(pane, 'claude', 'active')
    record(headless, 'pi-headless', 'active')

    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), index], {
      cwd: project, env: { ...process.env, PORT: String(port), SPEXCODE_HOME: home, SPEXCODE_TMUX: socket }, stdio: 'ignore', detached: true,
    })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'backend health')
    const interrupt = async (id: string) => {
      const response = await fetch(`${base}/api/sessions/${id}/interrupt`, { method: 'POST' })
      return { status: response.status, body: await response.json() as { ok: boolean; error?: string } }
    }

    // a headless adapter with no native primitive refuses — there is no keyboard to press
    const refusedHeadless = await interrupt(headless)
    assert.equal(refusedHeadless.status, 502)
    assert.match(refusedHeadless.body.error || '', /no native hard-interrupt control/)

    // a pane-backed TUI that is not working refuses too: the same key on an idle TUI is a step toward quitting it
    const refusedIdle = await interrupt(idle)
    assert.equal(refusedIdle.status, 502)
    assert.match(refusedIdle.body.error || '', /not working/)

    // a working pane-backed TUI gets C-c in its own pane: the shell in the pane reports the SIGINT it received
    assert.equal(tmux(socket, 'new-session', '-d', '-s', pane, '-x', '80', '-y', '24',
      'sh', '-c', 'trap "echo GOT_INT" INT; while :; do sleep 1; done').status, 0)
    const delivered = await interrupt(pane)
    assert.deepEqual(delivered, { status: 200, body: { ok: true } })
    await waitFor(async () => tmux(socket, 'capture-pane', '-p', '-t', pane).stdout.includes('GOT_INT'), 'SIGINT observed in the pane', 10_000)
  } finally {
    if (backend) await stop(backend)
    tmux(socket, 'kill-server')
    rmSync(fixture, { recursive: true, force: true })
  }
})
