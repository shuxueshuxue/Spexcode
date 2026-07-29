import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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

test('public session create is bounded, rollback-clean, idempotent, and publishes exact Git state', { timeout: 70_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-session-create-'))
  const projectPath = join(root, 'project'); mkdirSync(projectPath)
  const project = realpathSync(projectPath)
  const home = join(root, 'home'), fakeBin = join(root, 'bin'), trace = join(root, 'trace.log')
  const configuredMain = join(root, 'configured-main')
  const stallGit = join(root, 'stall-git'), mismatchGit = join(root, 'mismatch-git')
  const killAfterGit = join(root, 'kill-after-git'), killAfterStore = join(root, 'kill-after-store')
  const blockReceiptRetire = join(root, 'block-receipt-retire')
  const materializeFailure = join(root, 'materialize-failure')
  const launcher = join(root, 'stall-launcher'), gitWrapper = join(fakeBin, 'git')
  const candidateDir = join(home, 'projects', project.replace(/[/.]/g, '-'), '.session-create-candidates')
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
  writeFileSync(join(project, '.gitignore'), 'host-ignore\n')
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
      if [ -e "$SPEX_CREATE_KILL_AFTER_GIT" ]; then kill -KILL "$PPID"; exit 137; fi
    fi ;;
  *)
    if [ -e "$SPEX_CREATE_MATERIALIZE_FAILURE" ]; then
      parent_cmd=$(tr '\\000' ' ' < "/proc/$PPID/cmdline" 2>/dev/null || true)
      case "$parent_cmd" in
        *"cli.ts materialize"*)
          printf '%s\\n' 'fatal: config command "sh -c [test -r "$0" && exec bash "$0" clean "$1"]" C:\\broken\\path' >&2
          printf '%s\\n' 'second line: non-ASCII e\u0301' >&2
          exit 17 ;;
      esac
    fi
    if [ -e "$SPEX_CREATE_KILL_AFTER_STORE" ]; then
      parent_cmd=$(tr '\\000' ' ' < "/proc/$PPID/cmdline" 2>/dev/null || true)
      case "$parent_cmd" in
        *"cli.ts materialize"*)
          backend_pid=$(ps -o ppid= -p "$PPID" | tr -d ' ')
          kill -KILL "$PPID" "$backend_pid" 2>/dev/null
          exit 137 ;;
      esac
    fi
    if [ -e "$SPEX_CREATE_BLOCK_RECEIPT_RETIRE" ]; then
      parent_cmd=$(tr '\\000' ' ' < "/proc/$PPID/cmdline" 2>/dev/null || true)
      case "$parent_cmd" in *"cli.ts materialize"*) chmod 500 "$SPEX_CREATE_CANDIDATE_DIR" ;; esac
    fi
    exec ${JSON.stringify(execFileSync('which', ['git'], { encoding: 'utf8' }).trim())} "$@" ;;
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

  let logs = ''
  const startBackend = () => {
    const backend = spawn(process.execPath, [tsx, api], {
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
        SPEX_CREATE_KILL_AFTER_GIT: killAfterGit,
        SPEX_CREATE_KILL_AFTER_STORE: killAfterStore,
        SPEX_CREATE_BLOCK_RECEIPT_RETIRE: blockReceiptRetire,
        SPEX_CREATE_MATERIALIZE_FAILURE: materializeFailure,
        SPEX_CREATE_CANDIDATE_DIR: candidateDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    backend.stdout.setEncoding('utf8').on('data', (chunk) => { logs += chunk })
    backend.stderr.setEncoding('utf8').on('data', (chunk) => { logs += chunk })
    return backend
  }
  let child = startBackend()
  const waitForHealth = () => waitFor(async () => { try { return (await fetch(`${base}/health`)).ok } catch { return false } }, 'backend health')
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
  const candidateReceipts = () => {
    return existsSync(candidateDir) ? readdirSync(candidateDir).map((name) => join(candidateDir, name)) : []
  }
  const recordPath = (id: string) => {
    const runtime = readdirSync(join(home, 'projects')).map((name) => join(home, 'projects', name, 'sessions')).find(existsSync)
    assert.ok(runtime, 'the public session store exists')
    return join(runtime, id, 'session.json')
  }
  const nodeRefs = () => git(project, 'for-each-ref', 'refs/heads/task', '--format=%(refname)')
  const worktrees = () => git(project, 'worktree', 'list', '--porcelain').match(/^worktree /gm)?.length ?? 0
  const close = (id: string) => fetch(`${base}/api/sessions/${id}/close`, { method: 'POST' })
  const noCreateArtifacts = async () => {
    assert.deepEqual(await rows(), [], 'public state has no phantom-running row')
    assert.deepEqual(sessionDirs(), [], 'global store has no candidate session')
    assert.deepEqual(candidateReceipts(), [], 'private candidate receipt is retired with rollback')
    assert.equal(nodeRefs(), '', 'candidate branch is absent')
    assert.equal(worktrees(), 2, 'candidate worktree is absent')
    const ps = execFileSync('ps', ['-eo', 'args='], { encoding: 'utf8' })
    assert.ok(!ps.includes(gitWrapper), 'stalled Git process is physically gone')
  }
  const crashBackend = async (marker: string, key: string, prompt: string, beforeRestart?: () => void) => {
    writeFileSync(marker, 'kill\n')
    const crashed = child
    await assert.rejects(post(key, prompt), 'process death closes the admitted request without a response')
    await waitFor(() => crashed.exitCode !== null || crashed.signalCode !== null, 'crashed backend exit')
    rmSync(marker, { force: true })
    beforeRestart?.()
    child = startBackend()
    await waitForHealth()
  }

  try {
    await waitForHealth()

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

    const key = 'collision-112'
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

    const colliding = await post('collision-117')
    const collidingBody = await colliding.json() as any
    assert.equal(colliding.status, 409, 'a different key with the same id4 cannot publish over the first receipt')
    assert.deepEqual({ code: collidingBody.code, phase: collidingBody.phase }, { code: 'session_create_failed', phase: 'git-worktree' })
    assert.deepEqual((await rows()).map((row) => row.id), [a.id])
    assert.deepEqual(sessionDirs(), [a.id])
    assert.equal(realpathSync(git(a.path, 'rev-parse', '--show-toplevel')), realpathSync(a.path), 'collision preserves the published worktree')
    assert.equal(git(a.path, 'symbolic-ref', '--short', 'HEAD'), a.branch, 'collision preserves the published checkout')
    assert.ok(git(project, 'show-ref', '--verify', `refs/heads/${a.branch}`), 'collision preserves the published ref')
    assert.equal(worktrees(), 3)

    await waitFor(() => existsSync(trace) && (readFileSync(trace, 'utf8').match(/ launcher /g)?.length ?? 0) === 1, 'one launcher attempt')
    const phases = logs.split('\n').filter((line) => line.startsWith('spex session-create ')).map((line) => JSON.parse(line.slice('spex session-create '.length)))
    const published = phases.findIndex((row) => row.session === a.id && row.phase === 'record-write' && row.event === 'publish')
    const queued = phases.findIndex((row) => row.session === a.id && row.phase === 'launcher-queue' && row.event === 'start')
    assert.ok(published >= 0 && queued > published, 'record publication precedes launcher queue work')

    writeFileSync(materializeFailure, 'inject quoted materialize stderr\n')
    const degradedCreate = await post('quoted-materialize-failure', '[[target]] quoted materialize failure')
    const degraded = await degradedCreate.json() as any
    rmSync(materializeFailure, { force: true })
    assert.equal(degradedCreate.status, 201, `materialize failure still publishes one recoverable session: ${JSON.stringify(degraded)}`)
    const record = JSON.parse(readFileSync(recordPath(degraded.id), 'utf8'))
    assert.match(record.note, /"\$0"/)
    assert.match(record.note, /C:\\broken\\path/)
    assert.match(record.note, /second line: non-ASCII é/)
    assert.equal(record.session_id, degraded.id)
    assert.deepEqual(Object.keys(record).filter((key) => key === 'note'), ['note'], 'the quoted stderr stays one JSON field')

    const listed = (await rows()).find((row) => row.id === degraded.id)
    assert.ok(listed, 'list retains the degraded session')
    assert.notEqual(listed.status, 'corrupt', 'list never projects the failure note as a corrupt row')
    const shown = await fetch(`${base}/api/sessions/${degraded.id}`)
    assert.equal(shown.status, 200, 'show reads the failure note through the public record')
    assert.equal((await shown.json() as any).note, record.note)
    const stopped = await fetch(`${base}/api/sessions/${degraded.id}/stop`, { method: 'POST' })
    assert.equal(stopped.status, 200, 'stop can still prove the record owner')
    assert.equal(JSON.parse(readFileSync(recordPath(degraded.id), 'utf8')).stopped, true)
    const closed = await close(degraded.id)
    assert.equal(closed.status, 200, 'close can still prove and retire the record owner')
    assert.equal((await fetch(`${base}/api/sessions/${degraded.id}`)).status, 404)

    const configLock = join(project, '.git', 'config.lock')
    writeFileSync(configLock, 'hold the shared Git config lock\n')
    const [configLockLeft, configLockRight] = await Promise.all([post('concurrent-config-lock'), post('concurrent-config-lock')])
    const [configLockA, configLockB] = await Promise.all([configLockLeft.json() as Promise<any>, configLockRight.json() as Promise<any>])
    rmSync(configLock, { force: true })
    assert.equal(configLockLeft.status, 201, `first config-lock create publishes a recoverable failure: ${JSON.stringify(configLockA)}`)
    assert.equal(configLockRight.status, 201, `same-key concurrent create joins its recoverable failure: ${JSON.stringify(configLockB)}`)
    assert.equal(configLockA.id, configLockB.id, 'concurrent callers publish at most one session record')
    const configLockRecord = JSON.parse(readFileSync(recordPath(configLockA.id), 'utf8'))
    assert.match(configLockRecord.note, /could not lock config file/)
    assert.equal((await rows()).filter((row) => row.id === configLockA.id && row.status === 'corrupt').length, 0,
      'a shared config lock never leaves a corrupt active row')
    const configLockStatus = git(configLockA.path, 'status', '--porcelain', '--untracked-files=all')
    assert.equal(configLockStatus, '', `materialize recovery restores the prepared candidate: ${JSON.stringify(configLockStatus)}`)
    const configLockClose = await close(configLockA.id)
    const configLockCloseBody = await configLockClose.json() as any
    assert.equal(configLockClose.status, 200, `the clean config-lock failure record stays closable: ${JSON.stringify(configLockCloseBody)}`)

    const crashPrompt = 'git crash recovery fixture'
    const id4 = (key: string) => createHash('sha256').update(`spexcode-session-create\0${key}`).digest('hex').slice(0, 4)
    assert.equal(id4('crash-3'), id4('crash-157'), 'different crash keys deterministically share one resource suffix')
    const beforeGitCrash = { refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs() }
    await crashBackend(killAfterGit, 'crash-3', crashPrompt)
    assert.equal(worktrees(), beforeGitCrash.worktrees + 1, 'real Git candidate survives backend process death before publication')
    assert.deepEqual(sessionDirs(), beforeGitCrash.stores, 'Git-stage death precedes candidate store creation')
    assert.equal(candidateReceipts().length, 1, 'an atomic private receipt precedes the first Git mutation')
    assert.equal(JSON.parse(readFileSync(candidateReceipts()[0], 'utf8')).stage, 'prepared', 'a kill inside Git leaves the last durable stage honest')
    const crashedGitState = { refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs() }

    const foreignRetry = await post('crash-157', crashPrompt)
    const foreignBody = await foreignRetry.json() as any
    assert.equal(foreignRetry.status, 409, 'a different key cannot consume the crashed candidate receipt')
    assert.deepEqual({ code: foreignBody.code, phase: foreignBody.phase }, { code: 'session_create_failed', phase: 'git-worktree' })
    assert.deepEqual({ refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs() }, crashedGitState, 'foreign retry preserves every crashed resource')

    const gitRetry = await post('crash-3', crashPrompt)
    const gitRetryBody = await gitRetry.json() as any
    assert.deepEqual(candidateReceipts(), [], 'matching Git-stage recovery retires its private receipt')

    const beforeStoreCrash = { worktrees: worktrees(), stores: sessionDirs().length }
    await crashBackend(killAfterStore, 'store-crash', 'store crash recovery fixture')
    assert.equal(worktrees(), beforeStoreCrash.worktrees + 1, 'store-stage death leaves its real Git candidate for receipt recovery')
    assert.equal(sessionDirs().length, beforeStoreCrash.stores + 1, 'store-stage death occurs after private session files exist')
    assert.equal(JSON.parse(readFileSync(candidateReceipts()[0], 'utf8')).stage, 'store-created', 'the receipt records the last durable store stage')
    const storeRetry = await post('store-crash', 'store crash recovery fixture')
    const storeRetryBody = await storeRetry.json() as any
    assert.deepEqual(candidateReceipts(), [], 'matching store-stage recovery retires its private receipt')

    const retirementPrompt = 'receipt retirement fixture'
    assert.equal(id4('retire-121'), id4('retire-369'), 'retirement control keys share one resource suffix')
    writeFileSync(blockReceiptRetire, 'block\n')
    const retirementCreate = await post('retire-121', retirementPrompt)
    const retirementSession = await retirementCreate.json() as any
    rmSync(blockReceiptRetire, { force: true })
    assert.equal(retirementCreate.status, 201, 'irreversible record publication remains a successful create')
    const retirementReceipt = candidateReceipts().find((path) => {
      try { return JSON.parse(readFileSync(path, 'utf8')).requestDigest === createHash('sha256').update('retire-121').digest('hex') } catch { return false }
    })
    assert.ok(retirementReceipt, 'forced unlink failure leaves the valid published candidate receipt')
    const beforeRetirementClose = { refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs(), rows: (await rows()).map((row) => row.id).sort() }
    const retirementClose = await close(retirementSession.id)
    chmodSync(candidateDir, 0o700)
    if (retirementClose.ok) {
      const replacement = await post('retire-369', retirementPrompt)
      const replacementSession = await replacement.json() as any
      assert.equal(replacement.status, 201, 'the colliding replacement publishes after a successful close')
      const replacementRows = (await rows()).map((row) => row.id).sort()
      const staleRetry = await post('retire-121', retirementPrompt)
      const staleBody = await staleRetry.json() as any
      assert.equal(staleRetry.status, 409, `a stale published receipt cannot consume the replacement session: ${JSON.stringify(staleBody)}`)
      assert.deepEqual((await rows()).map((row) => row.id).sort(), replacementRows, 'stale retry preserves replacement public state')
      assert.equal(realpathSync(git(replacementSession.path, 'rev-parse', '--show-toplevel')), realpathSync(replacementSession.path), 'stale retry preserves replacement worktree')
      assert.ok(git(project, 'show-ref', '--verify', `refs/heads/${replacementSession.branch}`), 'stale retry preserves replacement branch')
    } else {
      assert.equal(retirementClose.status, 409, 'unprovable receipt retirement refuses close as a resource conflict')
      assert.deepEqual(
        { refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs(), rows: (await rows()).map((row) => row.id).sort() },
        beforeRetirementClose,
        'close refusal preserves the public record and every owned resource',
      )
    }

    await crashBackend(killAfterGit, 'invalid-crash', 'invalid receipt fixture', () => {
      const requestDigest = createHash('sha256').update('invalid-crash').digest('hex')
      const receipt = candidateReceipts().find((path) => {
        try { return JSON.parse(readFileSync(path, 'utf8')).requestDigest === requestDigest } catch { return false }
      })
      assert.ok(receipt, 'invalid-orphan control starts from a real private receipt')
      writeFileSync(receipt, '{ invalid receipt\n')
    })
    const invalidState = { refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs() }
    const invalidRetry = await post('invalid-crash', 'invalid receipt fixture')
    const invalidBody = await invalidRetry.json() as any
    assert.equal(invalidRetry.status, 409, 'an invalid or absent receipt cannot authorize recovery cleanup')
    assert.deepEqual({ code: invalidBody.code, phase: invalidBody.phase }, { code: 'session_create_failed', phase: 'git-worktree' })
    assert.deepEqual({ refs: nodeRefs(), worktrees: worktrees(), stores: sessionDirs() }, invalidState, 'invalid-receipt retry preserves every orphan resource')

    assert.deepEqual(
      { gitDeath: gitRetry.status, storeDeath: storeRetry.status },
      { gitDeath: 201, storeDeath: 201 },
      `same-key restart must recover both process-death stages; git=${JSON.stringify(gitRetryBody)} store=${JSON.stringify(storeRetryBody)}`,
    )

  } finally {
    child.kill('SIGTERM')
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* no server */ }
    if (child.exitCode === null && child.signalCode === null) await new Promise<void>((resolve) => child.once('close', () => resolve()))
    rmSync(root, { recursive: true, force: true })
  }
})
