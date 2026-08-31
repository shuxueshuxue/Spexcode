import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexHarness } from './codex-harness.js'
import { processStartToken } from '@spexcode/spec-core'
import { closeSession } from './sessions.js'
import { repoRoot, runtimeRoot, sessionArtifactPath, sessionRecordPath, sessionStoreDir } from '@spexcode/spec-core'
import { initializeFreshSessionApplication } from './session-application.js'

let closeProbeTail = Promise.resolve()
async function enterCloseProbe(): Promise<() => void> {
  const previous = closeProbeTail
  let release!: () => void
  closeProbeTail = new Promise<void>((resolve) => { release = resolve })
  await previous
  return release
}

test('close uses a target tmux probe when the global listing is busy', { concurrency: false }, async () => {
  const leave = await enterCloseProbe()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const previousDatabasePath = process.env.SPEX_SESSION_DATABASE_PATH
  const previousCwd = process.cwd()
  const originalShared = codexHarness.sharedRuntimes
  const originalColdPreflight = codexHarness.coldPreflight
  const originalColdRuntime = codexHarness.coldRuntime
  const originalCleanup = codexHarness.cleanupRuntime
  const home = mkdtempSync(join(tmpdir(), `spex-close-target-probe-${process.pid}-`))
  const project = join(home, 'project')
  const bin = join(home, 'bin')
  const id = `close-target-probe-${process.pid}`
  const thread = `close-target-thread-${process.pid}`
  const worktree = join(home, 'worktree')
  const branch = `node/${id}`
  const tmuxState = join(home, 'tmux-killed')
  let leaf: ReturnType<typeof spawn> | null = null

  mkdirSync(project, { recursive: true })
  execFileSync('git', ['-C', project, 'init', '-q', '-b', 'main'])
  execFileSync('git', ['-C', project, 'config', 'user.email', 'close-probe@example.test'])
  execFileSync('git', ['-C', project, 'config', 'user.name', 'Close Probe'])
  writeFileSync(join(project, 'seed.txt'), 'fixture\n')
  execFileSync('git', ['-C', project, 'add', 'seed.txt'])
  execFileSync('git', ['-C', project, 'commit', '-qm', 'fixture'])
  execFileSync('git', ['-C', project, 'worktree', 'add', '-q', '-b', branch, worktree, 'main'])
  process.chdir(project)
  process.env.SPEXCODE_HOME = home
  process.env.SPEX_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  process.env.PATH = `${bin}:${previousPath || ''}`
  try {
    mkdirSync(bin, { recursive: true })
    const tmux = join(bin, 'tmux')
    writeFileSync(tmux, `#!/bin/sh
args="$*"
case "$args" in
  *" list-panes -t ${id} "*)
    if [ -f "${tmuxState}" ]; then exit 1; fi
    printf '${id}\\t${process.pid}\\tbash\\n'
    ;;
  *" list-panes "*) sleep 5; exit 1 ;;
  *" kill-session "*) touch "${tmuxState}" ;;
  *) exit 1 ;;
esac
`)
    chmodSync(tmux, 0o755)
    const application = initializeFreshSessionApplication()
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: worktree, branch,
      title: '', name: '', parent: '', status: 'awaiting', proposal: 'close',
      merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: thread,
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
    }, null, 2)}\n`)
    application.createSession({ sessionId: id, status: 'awaiting', proposal: 'close' })
    leaf = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', thread], { stdio: 'ignore' })
    for (let attempt = 0; attempt < 50 && !processStartToken(leaf.pid!); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.ok(processStartToken(leaf.pid!), 'target probe fixture acquires a stable leaf start identity')
    writeFileSync(sessionArtifactPath(id, 'agent.pid'), `${leaf.pid}\n`)
    codexHarness.sharedRuntimes = () => []
    codexHarness.coldPreflight = async () => ({ ok: true, receipt: Object.freeze({ fixture: 'target-probe' }) })
    codexHarness.coldRuntime = async () => ({ ok: true })
    codexHarness.cleanupRuntime = async () => {}
    assert.equal(await closeSession(id), true)
    assert.equal(existsSync(sessionRecordPath(id)), true, 'the target close retains the record after the cold proof')
    const retained = JSON.parse(readFileSync(sessionRecordPath(id), 'utf8'))
    assert.equal(retained.archived, true, 'the retained row projects closed')
    assert.equal(retained.proposal, undefined, 'the runtime envelope no longer carries a pre-close proposal')
    assert.equal(application.readState(id)?.status, 'archived', 'close settles the canonical lifecycle at its terminal marker')
    assert.equal(application.readState(id)?.proposal, null, 'close clears the canonical proposal')
    assert.equal(Number.isFinite(Date.parse(retained.closed_at)), true, 'the retained close publication carries an ISO closed_at')
    assert.equal(existsSync(worktree), false, 'the target close removes only the worktree')
    assert.notEqual(execFileSync('git', ['-C', project, 'branch', '--list', branch], { encoding: 'utf8' }).trim(), '', 'the target close retains the branch')
    assert.notEqual(execFileSync('git', ['-C', project, 'rev-parse', '--verify', `refs/spex-archive/${id}^{commit}`], { encoding: 'utf8' }).trim(), '', 'the target close publishes the archive ref')
    assert.equal(runtimeRoot(), join(home, 'projects', project.replace(/[/.]/g, '-')))
  } finally {
    codexHarness.sharedRuntimes = originalShared
    codexHarness.coldPreflight = originalColdPreflight
    codexHarness.coldRuntime = originalColdRuntime
    codexHarness.cleanupRuntime = originalCleanup
    if (leaf?.pid && processStartToken(leaf.pid)) {
      try { process.kill(leaf.pid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousDatabasePath === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabasePath
    process.chdir(previousCwd)
    rmSync(home, { recursive: true, force: true })
    leave()
  }
})

test('close reports detached residue by PID and stays quiet when no residue remains', { concurrency: false, timeout: 30_000 }, async () => {
  const leave = await enterCloseProbe()
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
  const previousDatabasePath = process.env.SPEX_SESSION_DATABASE_PATH
  const previousCwd = process.cwd()
  const home = mkdtempSync(join(tmpdir(), `spex-close-residue-${process.pid}-`))
  const project = join(home, 'project')
  const bin = join(home, 'bin')
  const cleanId = `close-no-residue-${process.pid}`
  const residueId = `close-with-residue-${process.pid}`
  const residueWorktree = join(home, 'residue-worktree')
  const residuePidFile = join(home, 'residue.pid')
  let residuePid = 0

  mkdirSync(project, { recursive: true })
  execFileSync('git', ['-C', project, 'init', '-q', '-b', 'main'])
  execFileSync('git', ['-C', project, 'config', 'user.email', 'close-residue@example.test'])
  execFileSync('git', ['-C', project, 'config', 'user.name', 'Close Residue'])
  writeFileSync(join(project, 'seed.txt'), 'fixture\n')
  execFileSync('git', ['-C', project, 'add', 'seed.txt'])
  execFileSync('git', ['-C', project, 'commit', '-qm', 'fixture'])
  process.chdir(project)
  process.env.SPEXCODE_HOME = home
  process.env.SPEXCODE_SESSION_DATABASE_PATH = join(home, 'sessions.sqlite')
  process.env.PATH = `${bin}:${previousPath || ''}`

  try {
    mkdirSync(bin, { recursive: true })
    const tmux = join(bin, 'tmux')
    writeFileSync(tmux, `#!/bin/sh
args="$*"
case "$args" in
  *" kill-session "*) exit 0 ;;
  *" list-panes "*) exit 1 ;;
  *) exit 1 ;;
esac
`)
    chmodSync(tmux, 0o755)
    const application = initializeFreshSessionApplication()
    const writeRecord = (id: string, worktree: string) => {
      const branch = `node/${id}`
      execFileSync('git', ['worktree', 'add', '-q', '-b', branch, worktree, 'main'])
      mkdirSync(sessionStoreDir(id), { recursive: true })
      writeFileSync(sessionRecordPath(id), `${JSON.stringify({
        session_id: id, governed: true, worktree_path: worktree, branch,
        title: '', name: '', parent: '', status: 'awaiting', proposal: 'close',
        merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: '',
        stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
      }, null, 2)}\n`)
      application.createSession({ sessionId: id, status: 'awaiting', proposal: 'close' })
    }
    writeRecord(cleanId, join(home, 'clean-worktree'))
    writeRecord(residueId, residueWorktree)
    const residueParent = join(home, 'residue-parent.cjs')
    writeFileSync(residueParent, `const fs = require('node:fs')
const { spawn } = require('node:child_process')
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' })
fs.writeFileSync(process.argv[2], String(child.pid))
child.unref()
setTimeout(() => process.exit(0), 50)
`)
    spawn(process.execPath, [residueParent, residuePidFile], {
      cwd: residueWorktree,
      stdio: 'ignore',
      env: { ...process.env, SPEXCODE_PROJECT_ROOT: repoRoot(), SPEXCODE_SESSION_ID: residueId },
    })
    for (let attempt = 0; attempt < 50 && !existsSync(residuePidFile); attempt++) await new Promise((resolve) => setTimeout(resolve, 20))
    residuePid = Number(readFileSync(residuePidFile, 'utf8').trim())
    assert.ok(processStartToken(residuePid), 'reparented residue fixture acquires a stable process identity')

    const cleanWarnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => cleanWarnings.push(args.join(' '))
    try { assert.equal(await closeSession(cleanId), true) } finally { console.warn = originalWarn }
    assert.equal(cleanWarnings.some((line) => line.includes('detached process residue')), false, 'a clean close emits no residue warning')

    const residueWarnings: string[] = []
    console.warn = (...args: unknown[]) => residueWarnings.push(args.join(' '))
    try { assert.equal(await closeSession(residueId), true) } finally { console.warn = originalWarn }
    const warning = residueWarnings.find((line) => line.includes(`pid=${residuePid}`))
    assert.ok(warning, `close reports the detached PID: ${residueWarnings.join('\n')}`)
    assert.match(warning!, /command=.*worktree=.*residue-worktree/)
    assert.ok(residueWarnings.some((line) => /handle them through their owning harness\/runtime/.test(line)), 'close gives an operator action')
  } finally {
    if (residuePid && processStartToken(residuePid)) {
      try { process.kill(residuePid, 'SIGKILL') } catch { /* already exited */ }
    }
    if (previousHome === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previousHome
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousDatabasePath === undefined) delete process.env.SPEX_SESSION_DATABASE_PATH
    else process.env.SPEX_SESSION_DATABASE_PATH = previousDatabasePath
    process.chdir(previousCwd)
    rmSync(home, { recursive: true, force: true })
    leave()
  }
})
