import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

type Frame = { revision: string; from: number; to: number; kind?: 'full' | 'delta'; removed?: string[]; turns?: Array<{ id: string; role: string; text?: string; tools?: Array<{ id: string; output?: string | null; outputBytes?: number }> }>; error?: string; reason?: string }

// reads SSE chunks until one `transcript` event arrives (pings are skipped)
async function nextFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Frame> {
  const deadline = Date.now() + 5_000
  let buffer = ''
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out waiting for transcript SSE')), 5_000)),
    ])
    assert.equal(result.done, false)
    buffer += new TextDecoder().decode(result.value)
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      if (!frame.includes('event: transcript')) continue
      const data = frame.split('\n').find((value) => value.startsWith('data: '))
      assert.ok(data, `missing transcript frame data: ${frame}`)
      return JSON.parse(data.slice('data: '.length))
    }
  }
  assert.fail('no transcript frame arrived')
}

test('YATU: the transcript GET and stream read one native thread through the adapter, and the stream follows appends', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-transcript-api-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const codexHome = join(fixture, 'codex')
  const id = 'transcript-api-session'
  const thread = 'transcript-api-thread'
  const port = await freePort()
  const rollout = join(codexHome, 'sessions', '2026', '08', '07', `rollout-123-${thread}.jsonl`)
  let backend: ChildProcess | null = null
  const launch = () => spawn(process.execPath, ['--import', import.meta.resolve('tsx'), index], {
    cwd: project,
    env: { ...process.env, PORT: String(port), SPEXCODE_HOME: home, CODEX_HOME: codexHome, SPEXCODE_TMUX: `transcript-api-${port}` },
    stdio: 'ignore', detached: true,
  })
  const clock = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString()
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({ harnesses: ['codex'] }) + '\n')
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    spawnSync('git', ['config', 'user.email', 'transcript@example.test'], { cwd: project })
    spawnSync('git', ['config', 'user.name', 'Transcript Fixture'], { cwd: project })
    spawnSync('git', ['add', '.'], { cwd: project }); spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: project })
    const sessionDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      session_id: id, governed: true, worktree_path: project, branch: 'main', title: 'transcript API', name: '', parent: '',
      status: 'idle', proposal: '', merges: 0, note: '', sortkey: '', createdAt: 1, harness: 'codex', harness_session_id: thread,
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'fixture', launch_cmd: 'codex', launch_owner: '',
    }) + '\n')
    const base = `http://127.0.0.1:${port}`
    backend = launch()
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'backend health')

    // the stream opens BEFORE the harness has written anything: an absent source is an empty payload, not an error
    const from = Date.now() - 10_000
    const stream = await fetch(`${base}/api/sessions/${id}/transcript/stream?from=${from}`)
    assert.equal(stream.status, 200)
    assert.ok(stream.body)
    const reader = stream.body.getReader()
    const absent = await nextFrame(reader)
    assert.deepEqual({ revision: absent.revision, from: absent.from, turns: absent.turns, kind: absent.kind }, { revision: 'absent', from, turns: [], kind: 'full' })

    // the thread starts: an older stretch, then the current human boundary, prose, and a running tool
    mkdirSync(dirname(rollout), { recursive: true })
    writeFileSync(rollout, [
      line({ timestamp: clock(-3600), type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'OLD_COMMENTARY' } }),
      line({ timestamp: clock(-5), type: 'event_msg', payload: { type: 'user_message', message: 'begin the next turn' } }),
      line({ timestamp: clock(-4), type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'work for the current turn' } }),
      line({ timestamp: clock(-3), type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'tool-2', name: 'read_file', arguments: JSON.stringify({ path: '/project/current.ts' }) } }),
    ].join(''))
    const started = await nextFrame(reader)
    assert.notEqual(started.revision, 'absent')
    assert.equal(started.kind, 'full', 'the first read of a thread is the whole interval')
    assert.deepEqual(started.turns?.map((turn) => [turn.role, turn.text ?? null]), [['user', 'begin the next turn'], ['assistant', 'work for the current turn'], ['assistant', null]])
    assert.ok(started.turns?.every((turn) => typeof turn.id === 'string' && turn.id), 'every turn is keyed')
    assert.equal(started.turns?.[2]?.tools?.[0]?.output, undefined, 'the call has no result yet')
    assert.doesNotMatch(JSON.stringify(started), /OLD_COMMENTARY/, 'the interval excludes the older stretch')

    // the tool completes: a DELTA carrying only the turn that changed, its result recorded but its body withheld
    appendFileSync(rollout, line({ timestamp: clock(-2), type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'tool-2', output: 'current body' } }))
    const completed = await nextFrame(reader)
    assert.equal(completed.kind, 'delta')
    assert.deepEqual(completed.turns?.map((turn) => turn.id), [started.turns?.[2]?.id], 'only the turn whose call completed is in the frame')
    assert.equal(completed.turns?.[0]?.tools?.[0]?.output, null, 'the live frame withholds the output body')
    assert.equal(completed.turns?.[0]?.tools?.[0]?.outputBytes, Buffer.byteLength('current body'), 'but tells its size')
    assert.deepEqual(completed.removed, [])
    assert.doesNotMatch(JSON.stringify(completed), /current body|work for the current turn/, 'neither the body nor the unchanged turns travel')
    assert.ok(completed.to >= started.to, 'the open interval end moves with the server clock')
    await reader.cancel()

    // the body is fetched on demand, for exactly one call of the same interval
    const tool = await fetch(`${base}/api/sessions/${id}/transcript/tool/tool-2?from=${from}`)
    assert.equal(tool.status, 200)
    assert.deepEqual(await tool.json(), { id: 'tool-2', output: 'current body', outputLines: 1, outputBytes: Buffer.byteLength('current body') })
    assert.equal((await fetch(`${base}/api/sessions/${id}/transcript/tool/no-such-call?from=${from}`)).status, 404)
    assert.equal((await fetch(`${base}/api/sessions/${id}/transcript/tool/tool-2`)).status, 400)

    // the closed-interval GET reads the same thread through the same adapter, outputs inline
    const closed = await fetch(`${base}/api/sessions/${id}/transcript?from=${from}&to=${Date.now() + 5_000}`)
    assert.equal(closed.status, 200)
    const body = await closed.json() as Frame
    assert.equal(body.turns?.length, 3)
    assert.equal(body.turns?.[2]?.tools?.[0]?.output, 'current body')
    assert.equal((await fetch(`${base}/api/sessions/${id}/transcript?from=${from}`)).status, 400)
    assert.equal((await fetch(`${base}/api/sessions/${id}/transcript/stream`)).status, 400)
    assert.equal((await fetch(`${base}/api/sessions/no-such-session/transcript/stream?from=${from}`)).status, 404)
    assert.equal((await fetch(`${base}/api/sessions/${id}/execution`)).status, 404, 'the compact execution projection is gone')

    // a restart keeps nothing: reconnecting simply reads the thread again
    await stop(backend)
    backend = launch()
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'restarted backend health')
    const resumed = await fetch(`${base}/api/sessions/${id}/transcript/stream?from=${from}`)
    assert.ok(resumed.body)
    const resumedReader = resumed.body.getReader()
    const again = await nextFrame(resumedReader)
    assert.equal(again.kind, 'full', 'a new subscription starts from the whole interval')
    assert.equal(again.turns?.length, 3)
    await resumedReader.cancel()
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('YATU: a launcher-declared config dir routes the transcript read — pinned dir first, launcher name as the fleet-heal fallback, default root otherwise', { timeout: 90_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-transcript-configdir-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const defaultClaudeDir = join(fixture, 'claude-default')   // where the backend's own CLAUDE_CONFIG_DIR points — and where NONE of the threads live
  const pinnedDir = join(fixture, 'claude-glm-pinned')
  const declaredDir = join(fixture, 'claude-glm-declared')
  const port = await freePort()
  let backend: ChildProcess | null = null
  const launch = () => spawn(process.execPath, ['--import', import.meta.resolve('tsx'), index], {
    cwd: project,
    env: { ...process.env, PORT: String(port), SPEXCODE_HOME: home, CLAUDE_CONFIG_DIR: defaultClaudeDir, SPEXCODE_TMUX: `transcript-configdir-${port}` },
    stdio: 'ignore', detached: true,
  })
  const record = (id: string, extra: Record<string, unknown>) => {
    const sessionDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({
      session_id: id, governed: true, worktree_path: project, branch: 'main', title: 'configdir', name: '', parent: '',
      status: 'idle', proposal: '', merges: 0, note: '', sortkey: '', createdAt: 1, harness: 'claude', harness_session_id: '',
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launch_cmd: 'claude', launch_owner: '', ...extra,
    }) + '\n')
  }
  const thread = (configDir: string, id: string) => {
    const path = join(configDir, 'projects', project.replace(/[/.]/g, '-'), `${id}.jsonl`)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, line({ type: 'assistant', timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: `hello from ${id}` }] } }))
  }
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n# project\n')
    // the launcher registry declares WHERE claude-glm keeps its config dir; 'plain' declares nothing
    writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({ harnesses: ['claude'], sessions: { defaultLauncher: 'plain', launchers: {
      plain: { harness: 'claude', cmd: 'claude' },
      'claude-glm': { harness: 'claude', cmd: 'claude-glm-wrapper', configDir: declaredDir },
    } } }) + '\n')
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
    spawnSync('git', ['config', 'user.email', 'transcript@example.test'], { cwd: project })
    spawnSync('git', ['config', 'user.name', 'Transcript Fixture'], { cwd: project })
    spawnSync('git', ['add', '.'], { cwd: project }); spawnSync('git', ['commit', '-qm', 'fixture'], { cwd: project })
    mkdirSync(join(defaultClaudeDir, 'projects'), { recursive: true })

    // pinned: the record carries launch_config_dir (creation pinned it) — the read follows the pin
    record('configdir-pinned', { launcher: 'claude-glm', launch_config_dir: pinnedDir })
    thread(pinnedDir, 'configdir-pinned')
    // unpinned old record: only the launcher NAME — the read resolves it against live config (fleet self-heal)
    record('configdir-by-name', { launcher: 'claude-glm' })
    thread(declaredDir, 'configdir-by-name')
    // no pin, launcher declares nothing: the default root — and the thread is NOT there, so the read fails loud
    record('configdir-default', { launcher: 'plain' })
    thread(pinnedDir, 'configdir-default')   // present on disk, but under a dir nothing declared

    const base = `http://127.0.0.1:${port}`
    backend = launch()
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), 'backend health')
    const from = Date.now() - 60_000
    const to = Date.now() + 60_000

    const pinned = await fetch(`${base}/api/sessions/configdir-pinned/transcript?from=${from}&to=${to}`)
    assert.equal(pinned.status, 200)
    assert.deepEqual(((await pinned.json()) as Frame).turns?.map((turn) => turn.text), ['hello from configdir-pinned'])

    const byName = await fetch(`${base}/api/sessions/configdir-by-name/transcript?from=${from}&to=${to}`)
    assert.equal(byName.status, 200)
    assert.deepEqual(((await byName.json()) as Frame).turns?.map((turn) => turn.text), ['hello from configdir-by-name'])

    const fallback = await fetch(`${base}/api/sessions/configdir-default/transcript?from=${from}&to=${to}`)
    assert.equal(fallback.status, 409, 'an undeclared dir is the default root, and a thread not there stays a loud missing — never a silent read of another dir')
    assert.match((((await fallback.json()) as Frame).error) ?? '', /was not found/)
  } finally {
    if (backend) await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
