import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = process.env.SPEX_PACKAGE_ROOT || join(here, '..')
const fakeLauncher = join(packageRoot, 'test', 'fixtures', 'fake-claude')

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('node:net').AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

function capture(child: ChildProcess): () => string {
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk })
  child.stderr?.on('data', (chunk) => { output += chunk })
  return () => output
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function request(base: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: unknown; text: string }> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* capture is plain text */ }
  return { status: response.status, body, text }
}

test('a Command Box @session stays in the selected session instead of prompting the reference', { timeout: 120_000 }, async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'spex-passive-mention-home-'))
  const project = mkdtempSync(join(tmpdir(), 'spex-passive-mention-project-'))
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n\nfixture project\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture seed'], { cwd: project })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: `spex-passive-mention-${process.pid}-${Date.now()}`,
    FAKE_HARNESS_INTERVAL_MS: '80',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  const base = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = capture(backend)
  const created: string[] = []
  try {
    await waitFor(async () => {
      try { return (await request(base, '/health')).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')
    const create = async (prompt: string): Promise<string> => {
      const result = await request(base, '/api/sessions', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, launcher: 'fake' }),
      })
      assert.equal(result.status, 201, result.text)
      const id = (result.body as { id?: string }).id
      assert.ok(id, result.text)
      created.push(id)
      await waitFor(async () => (await request(base, `/api/sessions/${id}`)).body as { liveness?: string }, (session) => session.liveness === 'online', `session ${id} online`)
      return id
    }
    const source = await create('source session')
    const referenced = await create('referenced session')
    const text = `@${referenced} inspect this context`
    const result = await request(base, `/api/sessions/${source}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'command', text }),
    })
    assert.equal(result.status, 200, result.text)
    // THE OUTCOME IS A MEASUREMENT, and this route deliberately measures nothing: it answers before starting
    // the handover, so it must say `deferred` and never `queued`. Reporting `queued` here was unconditional —
    // no transport state could change it — and the console turned that into "waiting for the terminal
    // transport" on every send while the pane received the prompt milliseconds later, as the next line proves.
    assert.equal((result.body as { delivery?: string }).delivery, 'deferred', result.text)
    await waitFor(async () => (await request(base, `/api/sessions/${source}/capture`)).text, (pane) => pane.includes(text), 'source prompt')
    await new Promise((resolve) => setTimeout(resolve, 350))
    const targetPane = (await request(base, `/api/sessions/${referenced}/capture`)).text
    assert.ok(!targetPane.includes('@-mentioned you'), `@ must not prompt the referenced session:\n${targetPane}`)
  } finally {
    for (const id of created.reverse()) await request(base, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((resolve) => backend.once('close', resolve))
    }
    if (backend.exitCode && backend.exitCode !== 0) console.error(logs())
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})

test('a Command Box @new creates a child under the selected session, optionally with a named launcher', { timeout: 120_000 }, async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'spex-new-mention-home-'))
  const project = mkdtempSync(join(tmpdir(), 'spex-new-mention-project-'))
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n\nfixture project\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  execFileSync('git', ['add', '.'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture seed'], { cwd: project })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: `spex-new-mention-${process.pid}-${Date.now()}`,
    FAKE_HARNESS_INTERVAL_MS: '80',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  const base = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = capture(backend)
  const created: string[] = []
  try {
    await waitFor(async () => {
      try { return (await request(base, '/health')).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')
    const sourceResult = await request(base, '/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'source session', launcher: 'fake' }),
    })
    assert.equal(sourceResult.status, 201, sourceResult.text)
    const source = (sourceResult.body as { id?: string }).id
    assert.ok(source, sourceResult.text)
    created.push(source)
    await waitFor(async () => (await request(base, `/api/sessions/${source}`)).body as { liveness?: string }, (session) => session.liveness === 'online', `session ${source} online`)

    const dispatch = async (text: string, token: string) => {
      const result = await request(base, `/api/sessions/${source}/input`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'command', text }),
      })
      assert.equal(result.status, 200, result.text)
      const body = result.body as { outcomes?: Array<{ token?: string; result?: string; detail?: string }>; mentionSummary?: string }
      assert.equal(body.outcomes?.length, 1, result.text)
      assert.equal(body.outcomes?.[0]?.token, token, result.text)
      assert.equal(body.outcomes?.[0]?.result, 'spawned', result.text)
      const child = body.outcomes?.[0]?.detail
      assert.ok(child, result.text)
      created.push(child)
      assert.match(body.mentionSummary || '', new RegExp(`${token}->`))
      const childRecord = await waitFor(async () => (await request(base, `/api/sessions/${child}`)).body as { parent?: string; launcher?: string; liveness?: string },
        (session) => session.parent === source && session.liveness === 'online', `child ${child} under source`)
      assert.equal(childRecord.parent, source)
      await waitFor(async () => (await request(base, `/api/sessions/${source}/capture`)).text, (pane) => pane.includes(text), 'source prompt')
      return childRecord
    }

    assert.equal((await dispatch('@new inspect the selected work', 'new')).launcher, 'fake')
    assert.equal((await dispatch('@new:fake inspect the selected work', 'new:fake')).launcher, 'fake')
    // the Conversation footer is a Command Box on a terminal-free surface: the same kind, plus replyVia:note,
    // spawns the child AND delivers the prompt with the note-reply insert
    const noted = await request(base, `/api/sessions/${source}/input`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'command', text: '@new:fake from the conversation', replyVia: 'note' }),
    })
    assert.equal(noted.status, 200, noted.text)
    const notedChild = (noted.body as { outcomes?: Array<{ detail?: string }> }).outcomes?.[0]?.detail
    assert.ok(notedChild, noted.text)
    created.push(notedChild)
    const timeline = (await request(base, `/api/sessions/${source}/timeline`)).body as { events: Array<{ kind: string; text?: string; replyVia?: string }> }
    const sent = timeline.events.filter((event) => event.kind === 'sent').at(-1)
    assert.match(sent?.text || '', /from the conversation/)
    assert.equal(sent?.replyVia, 'note', 'the record keeps the terminal-free sender mark')
    await waitFor(async () => (await request(base, `/api/sessions/${source}/capture`)).text, (pane) => pane.includes('REPLY TRANSPORT'), 'the note-reply insert rides the command delivery')
  } finally {
    for (const id of created.reverse()) await request(base, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((resolve) => backend.once('close', resolve))
    }
    if (backend.exitCode && backend.exitCode !== 0) console.error(logs())
    rmSync(project, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
})
