import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
}
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}
async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (!await check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

test('YATU: real session input rotates timeline files and API returns the cross-segment tail', { timeout: 30_000 }, async (t) => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-timeline-api-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const id = 'timeline-api-session'
  const port = await freePort()
  let backend: ChildProcess | null = null
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    git(project, 'init', '-q', '-b', 'main'); git(project, 'config', 'user.email', 'timeline@example.test'); git(project, 'config', 'user.name', 'Timeline Fixture')
    git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture')
    const sessions = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    const dir = join(sessions, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ session_id: id, governed: true, worktree_path: project, branch: 'main', node: '', title: 'API timeline', name: '', parent: '', status: 'idle', proposal: '', merges: 0, note: '', sortkey: '', createdAt: 1, harness: 'claude', harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: 'true', launch_owner: '' }, null, 2) + '\n')
    const bin = join(fixture, 'bin'); mkdirSync(bin); writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n'); chmodSync(join(bin, 'tmux'), 0o755)
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], { cwd: project, env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}`, PORT: String(port), SPEXCODE_HOME: home, SPEXCODE_TIMELINE_SEGMENT_BYTES: '1024', SPEXCODE_TMUX: `timeline-api-${port}` }, stdio: 'ignore' })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((r) => r.ok).catch(() => false), 'backend health')
    for (const mark of ['a', 'b', 'c']) {
      const r = await fetch(`${base}/api/sessions/${id}/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: `${mark}:${'x'.repeat(900)}` }) })
      assert.equal(r.status, 200, await r.text())
    }
    const timeline = await fetch(`${base}/api/sessions/${id}/timeline?limit=2`)
    assert.equal(timeline.status, 200)
    const body = await timeline.json() as { events: Array<{ kind: string; text?: string }> }
    assert.deepEqual(body.events.map((event) => event.text?.slice(0, 1)), ['b', 'c'])
    assert.deepEqual(readdirSync(join(dir, 'timeline')).sort(), ['000000000001.ndjson', '000000000002.ndjson', '000000000003.ndjson'])
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
