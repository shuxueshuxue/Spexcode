import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spex = join(here, '..', 'bin', 'spex.mjs')
const fakeLauncher = join(here, '..', 'test', 'fixtures', 'fake-claude')

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
async function waitFor(check: () => Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const signal = (name: NodeJS.Signals) => {
    // `spex serve` is a supervisor plus its Hono child. The fixture owns a separate process group, so its
    // cleanup has to reach both; killing only the supervisor leaves a listening child keeping node --test alive.
    if (child.pid && process.platform !== 'win32') {
      try { process.kill(-child.pid, name); return } catch { /* parent may have already reaped the group */ }
    }
    child.kill(name)
  }
  signal('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null && child.signalCode === null) signal('SIGKILL')
}

test('YATU: 128 real session inputs rotate timeline files and API returns the cross-segment tail', { timeout: 60_000 }, async (t) => {
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
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], { cwd: project, env: { ...process.env, PATH: `${bin}:${process.env.PATH || ''}`, PORT: String(port), SPEXCODE_HOME: home, SPEXCODE_TIMELINE_SEGMENT_BYTES: '1024', SPEXCODE_TMUX: `timeline-api-${port}` }, stdio: 'ignore', detached: true })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((r) => r.ok).catch(() => false), 'backend health')
    const total = 128
    for (let index = 0; index < total; index++) {
      const mark = String(index).padStart(3, '0')
      const r = await fetch(`${base}/api/sessions/${id}/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: `${mark}:${'x'.repeat(900)}` }) })
      assert.equal(r.status, 200, await r.text())
    }
    const timeline = await fetch(`${base}/api/sessions/${id}/timeline?limit=50`)
    assert.equal(timeline.status, 200)
    const body = await timeline.json() as { events: Array<{ kind: string; text?: string }> }
    assert.deepEqual(body.events.map((event) => event.text?.slice(0, 3)), Array.from({ length: 50 }, (_, index) => String(index + 78).padStart(3, '0')))
    assert.deepEqual(readdirSync(join(dir, 'timeline')).sort(), Array.from({ length: total }, (_, index) => `${String(index + 1).padStart(12, '0')}.ndjson`))
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('YATU: five real backends observe 24 CLI lifecycle writes without duplicate segmented events', { timeout: 120_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-timeline-writers-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const id = 'timeline-many-backends'
  const ports: number[] = []
  for (let index = 0; index < 5; index++) ports.push(await freePort())
  const backends: ChildProcess[] = []
  const logs = new Map<number, string>()
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    git(project, 'init', '-q', '-b', 'main'); git(project, 'config', 'user.email', 'timeline@example.test'); git(project, 'config', 'user.name', 'Timeline Fixture')
    git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture')

    const sessions = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions')
    const dir = join(sessions, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ session_id: id, governed: true, worktree_path: project, branch: 'main', node: '', title: 'many backend timeline', name: '', parent: '', status: 'idle', proposal: '', merges: 0, note: '', sortkey: '', createdAt: 1, harness: 'claude', harness_session_id: '', stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: 'true', launch_owner: '' }, null, 2) + '\n')
    const bin = join(fixture, 'bin'); mkdirSync(bin); writeFileSync(join(bin, 'tmux'), '#!/bin/sh\n[ "$1" = "-V" ] && { echo "tmux 3.4"; exit 0; }\nexit 1\n'); chmodSync(join(bin, 'tmux'), 0o755)
    const env: NodeJS.ProcessEnv = {
      ...process.env, PATH: `${bin}:${process.env.PATH || ''}`, SPEXCODE_HOME: home,
      SPEXCODE_TIMELINE_SEGMENT_BYTES: '1024', SPEXCODE_TMUX: `timeline-writers-${process.pid}-${Date.now()}`,
    }
    delete env.SPEXCODE_API_URL
    delete env.SPEXCODE_SESSION_ID
    for (const port of ports) {
      const backend = spawn(process.execPath, [spex, 'serve', '--port', String(port)], { cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      logs.set(port, '')
      const appendLog = (chunk: Buffer) => logs.set(port, `${logs.get(port)}${chunk}`)
      backend.stdout?.on('data', appendLog)
      backend.stderr?.on('data', appendLog)
      backends.push(backend)
    }
    for (const port of ports) {
      await waitFor(() => fetch(`http://127.0.0.1:${port}/health`).then((r) => r.ok).catch(() => false), `backend ${port} health\n${logs.get(port)}`, 30_000)
    }

    const moves = Array.from({ length: 24 }, (_, index): readonly [string, string | undefined] => {
      switch (index % 6) {
        case 1: return ['awaiting', 'merge']
        case 3: return ['asking', undefined]
        case 4: return ['parked', undefined]
        case 5: return ['error', undefined]
        default: return ['active', undefined]
      }
    })
    const notes = moves.map((_, index) => `move-${index + 1}:${'x'.repeat(1200)}`)
    for (const [index, [status, proposal]] of moves.entries()) {
      const args = ['internal', 'session-state', status, '--session', id, '--note', notes[index]]
      if (proposal) args.push('--propose', proposal)
      const result = spawnSync(process.execPath, [spex, ...args], { cwd: project, env, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, new RegExp(`state -> ${status}`))
    }

    const response = await fetch(`http://127.0.0.1:${ports[0]}/api/sessions/${id}/timeline`)
    assert.equal(response.status, 200)
    const body = await response.json() as { events: Array<{ kind: string; status?: string; proposal?: string | null; note?: string | null }> }
    const events = body.events.filter((event) => event.kind === 'status')
    assert.deepEqual(events.map((event) => [event.status, event.proposal, event.note]), moves.map(([status, proposal], index) => [status, proposal ?? null, notes[index]]))
    assert.deepEqual(readdirSync(join(dir, 'timeline')).sort(), Array.from({ length: moves.length }, (_, index) => `${String(index + 1).padStart(12, '0')}.ndjson`))
  } finally {
    await Promise.all(backends.map((backend) => stop(backend)))
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('YATU: a dispatched probe worker receives the note-to-terminal counter-insert exactly once', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-timeline-delivery-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const tmux = `timeline-delivery-${process.pid}-${Date.now()}`
  let backend: ChildProcess | null = null
  const base = `http://127.0.0.1:${port}`
  let id = ''
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
      harnesses: ['claude'], sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
    }) + '\n')
    git(project, 'init', '-q', '-b', 'main'); git(project, 'config', 'user.email', 'timeline@example.test'); git(project, 'config', 'user.name', 'Timeline Fixture')
    git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture')
    const env: NodeJS.ProcessEnv = {
      ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '50',
    }
    delete env.SPEXCODE_API_URL
    delete env.SPEXCODE_SESSION_ID
    for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'cli.ts'), 'serve', '--port', String(port)], {
      cwd: project, env, stdio: 'ignore', detached: true,
    })

    await waitFor(() => fetch(`${base}/health`).then((r) => r.ok).catch(() => false), 'backend health', 30_000)
    const created = await fetch(`${base}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'delivery probe', launcher: 'fake' }),
    })
    const createdText = await created.text()
    assert.equal(created.status, 201, createdText)
    id = (JSON.parse(createdText) as { id: string }).id
    assert.ok(id)
    await waitFor(() => fetch(`${base}/api/sessions/${id}`).then(async (r) => r.ok && (await r.json() as { liveness?: string }).liveness === 'online').catch(() => false), 'probe worker online', 30_000)

    const input = async (text: string, replyVia?: 'note') => {
      const response = await fetch(`${base}/api/sessions/${id}/input`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text, ...(replyVia ? { replyVia } : {}) }),
      })
      assert.equal(response.status, 200, await response.text())
    }
    const capture = () => fetch(`${base}/api/sessions/${id}/capture`).then((r) => r.text())
    await input('phone-message', 'note')
    await waitFor(() => capture().then((pane) => pane.includes('FAKE-HARNESS REPLY phone-message')), 'note message in probe pane')
    const afterNote = await capture()
    assert.match(afterNote, /REQUIRED REPLY TRANSPORT/, afterNote)

    await input('back-at-terminal')
    await waitFor(() => capture().then((pane) => pane.includes('FAKE-HARNESS REPLY back-at-terminal')), 'counter-insert in probe pane')
    const afterTransition = await capture()
    assert.match(afterTransition, /terminal-attached client/, afterTransition)
    assert.match(afterTransition, /declaration --notes/, afterTransition)

    await input('ordinary-terminal-message')
    await waitFor(() => capture().then((pane) => pane.includes('FAKE-HARNESS REPLY ordinary-terminal-message')), 'bare terminal message in probe pane')
    const replies = (await capture()).split('\n').filter((line) => line.includes('FAKE-HARNESS REPLY'))
    assert.equal(replies.at(-1), 'FAKE-HARNESS REPLY ordinary-terminal-message')

    const timeline = await fetch(`${base}/api/sessions/${id}/timeline`)
    assert.equal(timeline.status, 200)
    const body = await timeline.json() as { events: Array<{ kind: string; text?: string; replyVia?: string }> }
    const sent = body.events.filter((event) => event.kind === 'sent')
    assert.deepEqual(sent.map((event) => [event.text, event.replyVia]), [
      ['phone-message', 'note'], ['back-at-terminal', undefined], ['ordinary-terminal-message', undefined],
    ])
  } finally {
    if (id) await fetch(`${base}/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend) await stop(backend)
    spawnSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' })
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('YATU: pi-headless defaults launch and CLI send replies to durable notes', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-timeline-headless-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const turns = join(fixture, 'turns.ndjson')
  const fakePi = join(fixture, 'fake-pi.mjs')
  const port = await freePort()
  const tmux = `timeline-headless-${process.pid}-${Date.now()}`
  let backend: ChildProcess | null = null
  const base = `http://127.0.0.1:${port}`
  let id = ''
  try {
    writeFileSync(fakePi, `
import { appendFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
const prompt = process.argv.at(-1) || ''
const session = process.env.SPEXCODE_SESSION_ID || ''
const note = prompt.includes('HEADLESS_CLI_QUESTION') ? 'HEADLESS_CLI_ANSWER' : 'HEADLESS_LAUNCH_ANSWER'
appendFileSync(process.env.SPEX_FIXTURE_TURNS, JSON.stringify({ argv: process.argv.slice(2), prompt, session, note }) + '\\n')
const result = spawnSync(process.env.SPEX_FIXTURE_NODE, [process.env.SPEX_FIXTURE_SPEX, 'session', 'ask', '--session', session, '--note', note], { cwd: process.cwd(), env: process.env, stdio: 'inherit' })
process.exit(result.status === null ? 1 : result.status)
`)
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    const piCommand = `${JSON.stringify(process.execPath)} ${JSON.stringify(fakePi)}`
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
      harnesses: ['pi-headless'], sessions: { launchers: { probe: { harness: 'pi-headless', cmd: piCommand } }, defaultLauncher: 'probe' },
    }) + '\n')
    git(project, 'init', '-q', '-b', 'main'); git(project, 'config', 'user.email', 'timeline@example.test'); git(project, 'config', 'user.name', 'Timeline Fixture')
    git(project, 'add', '.'); git(project, 'commit', '-qm', 'fixture')
    const env: NodeJS.ProcessEnv = {
      ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux,
      SPEX_FIXTURE_TURNS: turns, SPEX_FIXTURE_NODE: process.execPath, SPEX_FIXTURE_SPEX: spex,
    }
    delete env.SPEXCODE_API_URL
    delete env.SPEXCODE_SESSION_ID
    for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'cli.ts'), 'serve', '--port', String(port)], {
      cwd: project, env, stdio: 'ignore', detached: true,
    })
    await waitFor(() => fetch(`${base}/health`).then((r) => r.ok).catch(() => false), 'backend health', 30_000)
    const created = await fetch(`${base}/api/sessions`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'HEADLESS_LAUNCH_QUESTION', launcher: 'probe' }),
    })
    const createdText = await created.text()
    assert.equal(created.status, 201, createdText)
    id = (JSON.parse(createdText) as { id: string }).id
    await waitFor(async () => {
      const timeline = await fetch(`${base}/api/sessions/${id}/timeline`)
      if (!timeline.ok) return false
      const body = await timeline.json() as { events: Array<{ kind: string; note?: string }> }
      return body.events.some((event) => event.kind === 'status' && event.note === 'HEADLESS_LAUNCH_ANSWER')
    }, 'launch declaration note', 30_000)

    const sent = spawnSync(process.execPath, [spex, 'session', 'send', id, 'HEADLESS_CLI_QUESTION'], {
      cwd: project, env: { ...env, SPEXCODE_API_URL: base }, encoding: 'utf8',
    })
    assert.equal(sent.status, 0, sent.stderr)
    await waitFor(async () => {
      const timeline = await fetch(`${base}/api/sessions/${id}/timeline`)
      if (!timeline.ok) return false
      const body = await timeline.json() as { events: Array<{ kind: string; note?: string }> }
      return body.events.some((event) => event.kind === 'status' && event.note === 'HEADLESS_CLI_ANSWER')
    }, 'CLI-send declaration note', 30_000)

    const invocations = readFileSync(turns, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { argv: string[]; prompt: string; session: string; note: string })
    assert.equal(invocations.length, 2)
    assert.deepEqual(invocations.map((turn) => turn.note), ['HEADLESS_LAUNCH_ANSWER', 'HEADLESS_CLI_ANSWER'])
    assert.ok(invocations.every((turn) => turn.session === id && turn.prompt.includes('REQUIRED REPLY TRANSPORT')))
    assert.deepEqual(invocations.map((turn) => turn.argv.slice(0, 3)), [['-p', '--session-id', id], ['-p', '--session', id]])

    const timeline = await fetch(`${base}/api/sessions/${id}/timeline`)
    const body = await timeline.json() as { events: Array<{ kind: string; text?: string; replyVia?: string }> }
    assert.deepEqual(body.events.filter((event) => event.kind === 'sent').map((event) => [event.text, event.replyVia]), [['HEADLESS_CLI_QUESTION', 'note']])
    const session = await fetch(`${base}/api/sessions/${id}`).then((r) => r.json() as Promise<{ note?: string }>)
    assert.equal(session.note, 'HEADLESS_CLI_ANSWER')
  } finally {
    if (id) await fetch(`${base}/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend) await stop(backend)
    spawnSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' })
    rmSync(fixture, { recursive: true, force: true })
  }
})
