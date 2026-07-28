import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'

const src = dirname(fileURLToPath(import.meta.url))
const pkg = join(src, '..')
const tsx = join(dirname(createRequire(import.meta.url).resolve('tsx/package.json')), 'dist', 'cli.mjs')
const api = join(src, 'index.ts')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close(() => typeof address === 'object' && address ? resolve(address.port) : reject(new Error('no test port')))
  })
})
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(25)
  }
  throw new Error(`timed out waiting for ${label}`)
}
const git = (project: string, ...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim()

test('public session create is bounded, rollback-clean, idempotent, and publishes exact Git state', { timeout: 45_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-session-create-'))
  const projectPath = join(root, 'project'); mkdirSync(projectPath)
  const project = realpathSync(projectPath)
  const home = join(root, 'home'), fakeBin = join(root, 'bin'), trace = join(root, 'trace.log')
  const configuredMain = join(root, 'configured-main')
  const stallGit = join(root, 'stall-git'), mismatchGit = join(root, 'mismatch-git'), launcher = join(root, 'stall-launcher'), gitWrapper = join(fakeBin, 'git')
  const tmux = `spex-create-${process.pid}-${Date.now()}`, port = await freePort(), base = `http://127.0.0.1:${port}`
  mkdirSync(fakeBin)
  mkdirSync(join(project, '.spec', 'target'), { recursive: true })
  writeFileSync(join(project, '.spec', 'target', 'spec.md'), '---\ntitle: target\nstatus: active\nhue: 200\ndesc: fixture\n---\n# target\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    main: configuredMain,
    mainBranch: 'staging',
    branchPrefix: 'task/',
    harnesses: ['claude'],
    sessions: { maxActive: 1, launchers: { stall: { harness: 'claude', cmd: launcher } }, defaultLauncher: 'stall' },
  }, null, 2))
  writeFileSync(join(project, 'README.md'), 'fixture\n')
  writeFileSync(launcher, '#!/bin/sh\nprintf "%s launcher pid=%s\\n" "$(date -Iseconds)" "$$" >> "$SPEX_CREATE_TRACE"\nsleep 30\n')
  writeFileSync(gitWrapper, `#!/bin/sh
case " $* " in
  *" worktree add "*)
    printf '%s git-start pid=%s args=%s\\n' "$(date -Iseconds)" "$$" "$*" >> "$SPEX_CREATE_TRACE"
    if [ -e "$SPEX_CREATE_STALL_GIT" ]; then sleep 30; else
      ${JSON.stringify(execFileSync('which', ['git'], { encoding: 'utf8' }).trim())} "$@" || exit $?
      if [ -e "$SPEX_CREATE_MISMATCH_GIT" ]; then
        previous=; last=; for arg in "$@"; do previous="$last"; last="$arg"; done
        ${JSON.stringify(execFileSync('which', ['git'], { encoding: 'utf8' }).trim())} -C "$previous" checkout -q --detach
      fi
    fi ;;
  *) exec ${JSON.stringify(execFileSync('which', ['git'], { encoding: 'utf8' }).trim())} "$@" ;;
esac
`)
  chmodSync(launcher, 0o755); chmodSync(gitWrapper, 0o755)
  execFileSync('git', ['init', '-q', '-b', 'staging'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=create-fixture', '-c', 'user.email=create@example.test', 'add', '.'], { cwd: project })
  execFileSync('git', ['-c', 'user.name=create-fixture', '-c', 'user.email=create@example.test', 'commit', '-qm', 'fixture'], { cwd: project })
  execFileSync('git', ['branch', 'backend-host'], { cwd: project })
  execFileSync('git', ['switch', '-q', 'backend-host'], { cwd: project })
  execFileSync('git', ['worktree', 'add', '-q', configuredMain, 'staging'], { cwd: project })
  writeFileSync(stallGit, 'stall\n')

  const child = spawn(process.execPath, [tsx, api], {
    cwd: project,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      PORT: String(port),
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: tmux,
      SPEXCODE_GIT_TIMEOUT_MS: '10000',
      SPEXCODE_SESSION_CREATE_TIMEOUT_MS: '5000',
      SPEX_CREATE_TRACE: trace,
      SPEX_CREATE_STALL_GIT: stallGit,
      SPEX_CREATE_MISMATCH_GIT: mismatchGit,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let logs = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => { logs += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk) => { logs += chunk })
  const post = (key: string, prompt = '[[target]] transaction fixture', signal?: AbortSignal) => fetch(`${base}/api/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ prompt, parent: null, launcher: 'stall' }),
    signal,
  })
  const rows = () => fetch(`${base}/api/sessions?all=1`).then((response) => response.json()) as Promise<any[]>
  const sessionDirs = () => {
    const projects = join(home, 'projects')
    if (!existsSync(projects)) return []
    const runtime = readdirSync(projects).map((name) => join(projects, name, 'sessions')).find(existsSync)
    return runtime ? readdirSync(runtime) : []
  }
  const nodeRefs = () => git(project, 'for-each-ref', 'refs/heads/task', '--format=%(refname)')
  const worktrees = () => git(project, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length ?? 0
  const noCreateArtifacts = async () => {
    assert.deepEqual(await rows(), [], 'public state has no phantom-running row')
    assert.deepEqual(sessionDirs(), [], 'global store has no candidate session')
    assert.equal(nodeRefs(), '', 'candidate branch is absent')
    assert.equal(worktrees(), 2, 'candidate worktree is absent')
    const ps = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' })
    assert.ok(!ps.includes(gitWrapper), 'stalled Git process is physically gone')
  }

  try {
    await waitFor(async () => { try { return (await fetch(`${base}/health`)).ok } catch { return false } }, 'backend health')

    const timeoutStarted = Date.now()
    const timedOut = await post('timeout-key')
    const timeoutBody = await timedOut.json() as any
    assert.equal(timedOut.status, 504)
    assert.deepEqual({ code: timeoutBody.code, phase: timeoutBody.phase }, { code: 'session_create_timeout', phase: 'git-worktree' })
    assert.ok(Date.now() - timeoutStarted < 7_000, 'server owns a wall shorter than the stalled Git command')
    await noCreateArtifacts()
    await sleep(1_700)
    await noCreateArtifacts()

    const disconnect = new AbortController()
    const abandoned = post('disconnect-key', '[[target]] disconnected fixture', disconnect.signal)
    await waitFor(() => (existsSync(trace) ? readFileSync(trace, 'utf8').match(/git-start/g)?.length ?? 0 : 0) >= 2, 'disconnect Git phase')
    disconnect.abort()
    await assert.rejects(abandoned)
    await sleep(200)
    await noCreateArtifacts()
    await sleep(1_700)
    await noCreateArtifacts()

    unlinkSync(stallGit)
    writeFileSync(mismatchGit, 'detach\n')
    const mismatched = await post('mismatch-key')
    const mismatchBody = await mismatched.json() as any
    assert.equal(mismatched.status, 500)
    assert.deepEqual({ code: mismatchBody.code, phase: mismatchBody.phase }, { code: 'session_create_failed', phase: 'record-write' })
    await noCreateArtifacts()
    unlinkSync(mismatchGit)

    const key = 'one-concurrent-create'
    const started = Date.now()
    const [left, right] = await Promise.all([post(key), post(key)])
    const [a, b] = await Promise.all([left.json() as Promise<any>, right.json() as Promise<any>])
    assert.equal(left.status, 201); assert.equal(right.status, 201)
    assert.equal(a.id, b.id, 'same-key callers recover one receipt')
    assert.match(a.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    assert.ok(Date.now() - started < 7_000, 'stalled headed launcher does not hold the receipt')
    assert.equal(dirname(a.path), join(configuredMain, '.worktrees'), 'publication consumes the resolved non-default layout.main')
    assert.match(a.branch, /^task\//, 'publication consumes the layout-owned branchPrefix')
    assert.equal(realpathSync(git(a.path, 'rev-parse', '--show-toplevel')), realpathSync(a.path))
    assert.equal(git(a.path, 'symbolic-ref', '--short', 'HEAD'), a.branch)
    assert.ok(git(project, 'show-ref', '--verify', `refs/heads/${a.branch}`))
    assert.deepEqual((await rows()).map((row) => row.id), [a.id])
    assert.deepEqual(sessionDirs(), [a.id])
    assert.equal(worktrees(), 3)

    const conflict = await post(key, 'different payload')
    const conflictBody = await conflict.json() as any
    assert.equal(conflict.status, 409)
    assert.equal(conflictBody.code, 'session_create_key_reused')
    assert.deepEqual((await rows()).map((row) => row.id), [a.id])

    await waitFor(() => existsSync(trace) && (readFileSync(trace, 'utf8').match(/ launcher /g)?.length ?? 0) === 1, 'one launcher attempt')
    const phases = logs.split('\n').filter((line) => line.startsWith('spex session-create ')).map((line) => JSON.parse(line.slice('spex session-create '.length)))
    const published = phases.findIndex((row) => row.session === a.id && row.phase === 'record-write' && row.event === 'publish')
    const queued = phases.findIndex((row) => row.session === a.id && row.phase === 'launcher-queue' && row.event === 'start')
    assert.ok(published >= 0 && queued > published, 'record publication precedes launcher queue work')
  } finally {
    child.kill('SIGTERM')
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* no server */ }
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once('close', () => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
