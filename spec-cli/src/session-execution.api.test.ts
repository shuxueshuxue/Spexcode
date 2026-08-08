import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const index = join(here, 'index.ts')
const line = (value: unknown) => `${JSON.stringify(value)}\n`

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (!await check()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (child.pid && process.platform !== 'win32') {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  } else child.kill('SIGTERM')
  await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
}

async function nextSse(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for execution SSE')), 5_000)),
  ])
  assert.equal(result.done, false)
  return new TextDecoder().decode(result.value)
}

function executionFrame(frame: string): { revision: string; turnId: string | null; workingNote: string | null; steps: Array<{ id: string; state: string }> } {
  const line = frame.split('\n').find((value) => value.startsWith('data: '))
  assert.ok(line, `missing execution frame data: ${frame}`)
  return JSON.parse(line.slice('data: '.length))
}

test('YATU: execution REST and SSE replace a prior trace at accepted human-turn boundaries', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-execution-api-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const codexHome = join(fixture, 'codex')
  const id = 'execution-api-session'
  const thread = 'execution-api-thread'
  const port = await freePort()
  const rollout = join(codexHome, 'sessions', '2026', '08', '07', `rollout-123-${thread}.jsonl`)
  let backend: ChildProcess | null = null
  const launch = () => spawn(process.execPath, ['--import', import.meta.resolve('tsx'), index], {
    cwd: project,
    env: { ...process.env, PORT: String(port), SPEXCODE_HOME: home, CODEX_HOME: codexHome, SPEXCODE_TMUX: `execution-api-${port}` },
    stdio: 'ignore', detached: true,
  })
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['codex'] }) + '\n')
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    spawnSync('git', ['config', 'user.email', 'execution@example.test'], { cwd: project })
    spawnSync('git', ['config', 'user.name', 'Execution Fixture'], { cwd: project })
    spawnSync('git', ['add', '.'], { cwd: project }); spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: project })
    const sessionDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      session_id: id, governed: true, worktree_path: project, branch: 'main', node: '', title: 'execution API', name: '', parent: '',
      status: 'idle', proposal: '', merges: 0, note: '', sortkey: '', createdAt: 1, harness: 'codex', harness_session_id: thread,
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: 'codex', launch_owner: '',
    }) + '\n')
    mkdirSync(dirname(rollout), { recursive: true })
    writeFileSync(rollout, [
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'inspect the session trace' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'tool-1', name: 'read_file', arguments: JSON.stringify({ path: '/project/spec.md', line_start: 1, line_end: 8 }) } }),
    ].join(''))

    backend = launch()
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'backend health')

    const snapshot = await fetch(`${base}/api/sessions/${id}/execution`)
    assert.equal(snapshot.status, 200)
    const body = await snapshot.json() as { turnId: string | null; workingNote: string; steps: Array<{ kind: string; state: string }> }
    assert.equal(body.turnId, null)
    assert.equal(body.workingNote, 'inspect the session trace')
    assert.deepEqual(body.steps, [{ id: 'tool-1', kind: 'read', label: 'read_file', detail: 'path: project/spec.md · lines: 1-8', state: 'running' }])
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_OUTPUT/)

    const stream = await fetch(`${base}/api/sessions/${id}/execution/stream`)
    assert.equal(stream.status, 200)
    assert.ok(stream.body)
    const reader = stream.body.getReader()
    const first = await nextSse(reader)
    assert.match(first, /event: execution/)

    const accepted = await fetch(`${base}/api/sessions/${id}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'text', text: 'begin the next turn' }),
    })
    assert.equal(accepted.status, 200)
    assert.equal((await accepted.json() as { ok: boolean }).ok, true)
    const timeline = await fetch(`${base}/api/sessions/${id}/timeline`)
    assert.equal(timeline.status, 200)
    const events = (await timeline.json() as { events: Array<{ kind: string; from?: string | null; mid?: string }> }).events
    const turnId = events.reduce<string | undefined>((latest, event) => (
      event.kind === 'sent' && event.from == null && event.mid ? event.mid : latest
    ), undefined)
    assert.ok(turnId)

    const invalidated = executionFrame(await nextSse(reader))
    assert.deepEqual(invalidated, { revision: invalidated.revision, turnId, workingNote: null, steps: [] })
    assert.notEqual(invalidated.revision, executionFrame(first).revision)
    await reader.cancel()

    await stop(backend)
    backend = launch()
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'restarted backend health')
    const afterRestart = await fetch(`${base}/api/sessions/${id}/execution`)
    assert.equal(afterRestart.status, 200)
    assert.deepEqual(await afterRestart.json(), { revision: `${turnId}:${Buffer.byteLength(readFileSync(rollout))}`, turnId, workingNote: null, steps: [] })

    const resumed = await fetch(`${base}/api/sessions/${id}/execution/stream`)
    assert.equal(resumed.status, 200)
    assert.ok(resumed.body)
    const resumedReader = resumed.body.getReader()
    assert.deepEqual(executionFrame(await nextSse(resumedReader)), { revision: `${turnId}:${Buffer.byteLength(readFileSync(rollout))}`, turnId, workingNote: null, steps: [] })

    appendFileSync(rollout, [
      line({ type: 'event_msg', payload: { type: 'user_message', client_id: turnId } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'work for the current turn' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'tool-2', name: 'read_file', arguments: JSON.stringify({ path: '/project/current.ts' }) } }),
    ].join(''))
    const attached = executionFrame(await nextSse(resumedReader))
    assert.deepEqual({
      revision: attached.revision,
      turnId,
      workingNote: 'work for the current turn',
      steps: attached.steps.map((step) => ({ id: step.id, state: step.state })),
    }, {
      revision: attached.revision,
      turnId,
      workingNote: 'work for the current turn',
      steps: [{ id: 'tool-2', state: 'running' }],
    })
    const restAttached = await fetch(`${base}/api/sessions/${id}/execution`)
    assert.equal((await restAttached.json() as { turnId: string; workingNote: string }).turnId, turnId)
    appendFileSync(rollout, line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'tool-2', output: 'PRIVATE_OUTPUT' } }))
    const completed = executionFrame(await nextSse(resumedReader))
    assert.deepEqual(completed.steps.map((step) => ({ id: step.id, state: step.state })), [{ id: 'tool-2', state: 'done' }])
    await resumedReader.cancel()
    await reader.cancel()
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
