// YATU for the FAILED-TURN CHAIN, end to end through the shipped artifacts.
//
// Every existing test of this path enters at `spex internal session-fail` or runs `fail.sh` against a fake
// `spex`. That leaves the part that actually broke in the field untested: the materialized shim, the
// dispatcher, the manifest, the real CLI, the compare-and-set, and the board projection, in one line. A
// session whose turn dies does NOT exit — its rendezvous listener keeps answering, so liveness stays online
// and the board paints `working` on an agent that is doing nothing. Only this chain corrects that, and the
// only honest way to know it still runs is to drive a real StopFailure into a real session's own worktree
// and read the board back over HTTP.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(packageRoot, '..')
const fakeLauncher = join(packageRoot, 'test', 'fixtures', 'fake-claude')
const tsxBin = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')

const freePort = async (): Promise<number> => await new Promise((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const port = (server.address() as { port: number }).port
    server.close(() => resolve(port))
  })
})

const waitFor = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value)}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

const json = async (base: string, path: string, init: RequestInit = {}): Promise<any> => {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  try { return { status: response.status, body: JSON.parse(text) } } catch { return { status: response.status, body: null, text } }
}

test('a real StopFailure drives a live session to error through the shipped shim', { timeout: 180_000 }, async () => {
  const port = await freePort()
  const home = mkdtempSync(join(tmpdir(), 'spex-failchain-home-'))
  const project = mkdtempSync(join(tmpdir(), 'spex-failchain-project-'))
  writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({
    harnesses: ['claude'],
    sessions: { launchers: { fake: { harness: 'claude', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: project })
  execFileSync('git', ['config', 'user.email', 'fixture@example.test'], { cwd: project })
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: project })
  // a REAL `spex init`, not a hand-written spec.md: the core plugin nodes it seeds are what materialize
  // renders into each tree's hook manifest, and this chain is exactly the thing a hand-built fixture
  // cannot stand in for. A tree whose manifest carries no StopFailure line dispatches nothing and exits 0.
  execFileSync(process.execPath, [tsxBin, join(packageRoot, 'src', 'cli.ts'), 'init', '.', '--harness', 'claude'], {
    cwd: project, encoding: 'utf8', env: { ...process.env, SPEXCODE_HOME: home },
  })
  execFileSync('git', ['add', '-A'], { cwd: project })
  execFileSync('git', ['commit', '-qm', 'fixture seed', '--no-verify'], { cwd: project })

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: `spex-failchain-${process.pid}-${Date.now()}`,
    FAKE_HARNESS_INTERVAL_MS: '80',
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  const base = `http://127.0.0.1:${port}`
  const backend = spawn(process.execPath, [tsxBin, join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
    cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  backend.stdout.on('data', (chunk) => { log += chunk })
  backend.stderr.on('data', (chunk) => { log += chunk })
  let id = ''
  try {
    await waitFor(async () => {
      try { return (await fetch(`${base}/health`)).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')

    const created = await json(base, '/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'failed turn chain', launcher: 'fake' }),
    })
    assert.equal(created.status, 201, JSON.stringify(created))
    id = created.body.id as string
    const online = await waitFor(async () => (await json(base, `/api/sessions/${id}`)).body,
      (session: any) => session?.liveness === 'online', 'session online')
    // `lifecycle` is the RECORD's status; `status` is the reconciled board projection. A live agent whose
    // turn has died keeps its listener, so liveness stays online and the projection reads `working` — which
    // is precisely the "stopped but still shows running" the human sees when this chain does not fire.
    assert.equal(online.lifecycle, 'active', JSON.stringify(online))
    assert.equal(online.status, 'working', JSON.stringify(online))

    // THE SHIPPED SHIM, not a hand-built command. If materialize stopped writing the tree's own settings —
    // the exact regression that silently disabled every nested Claude session's lifecycle hooks — there is
    // no command here to run and this fails before any payload is decoded.
    const worktree = online.path
    assert.ok(worktree && existsSync(worktree), `session worktree exists: ${worktree}`)
    const shimFile = join(worktree, '.claude', 'settings.json')
    assert.ok(existsSync(shimFile), 'the session worktree carries its own Claude shim')
    const shim = JSON.parse(readFileSync(shimFile, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> }
    const command = shim.hooks.StopFailure?.flatMap((entry) => entry.hooks.map((hook) => hook.command))
      .find((candidate) => candidate.includes('StopFailure'))
    assert.ok(command, `the shim binds StopFailure: ${JSON.stringify(shim.hooks && Object.keys(shim.hooks))}`)

    // A SUBAGENT's dead turn first: same event, same session id, plus the payload's own agent_id stamp.
    // It must change nothing — a helper the session spawned may not mark the session that spawned it dead.
    const fire = (payload: unknown) => spawnSync('bash', ['-c', command!], {
      cwd: worktree, input: JSON.stringify(payload), encoding: 'utf8',
      env: { ...env, CLAUDE_PROJECT_DIR: worktree, SPEXCODE_SESSION_ID: id },
    })
    const sub = fire({ session_id: id, agent_id: 'agent_01', hook_event_name: 'StopFailure', error: 'api_error' })
    assert.equal(sub.status, 0, sub.stderr)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const afterSub = (await json(base, `/api/sessions/${id}`)).body
    assert.equal(afterSub.lifecycle, 'active', `a subagent's failure must not mark the parent: ${JSON.stringify(afterSub)}`)

    // now the session's OWN failed turn
    const own = fire({ session_id: id, hook_event_name: 'StopFailure', error: 'api_error', error_details: 'Invalid bearer token' })
    const trace = `rc=${own.status} stdout=${JSON.stringify(own.stdout)} stderr=${JSON.stringify(own.stderr)}`
    assert.equal(own.status, 0, trace)
    assert.doesNotMatch(own.stderr || '', /handler .* exited/, `the dispatcher reported a handler failure: ${trace}`)
    const errored = await waitFor(async () => (await json(base, `/api/sessions/${id}`)).body,
      (session: any) => session?.lifecycle === 'error', `session reaches error (${trace})`, 20_000)
    assert.equal(errored.lifecycle, 'error', JSON.stringify(errored))
    assert.equal(errored.status, 'error', `the projection stops painting a dead turn as working: ${JSON.stringify(errored)}`)

    // and the BOARD says so — the projection the human actually reads, not only the record.
    const board = (await json(base, '/api/graph')).body
    const row = (board.sessions as Array<{ id: string; status: string }>).find((candidate) => candidate.id === id)
    assert.equal(row?.status, 'error', `the board row carries the failure: ${JSON.stringify(row)}`)
  } finally {
    if (id) await fetch(`${base}/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((resolve) => backend.once('close', resolve))
    }
    if (backend.exitCode && backend.exitCode !== 0) console.error(log)
  }
})
