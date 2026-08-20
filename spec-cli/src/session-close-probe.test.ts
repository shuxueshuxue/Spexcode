import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexHarness } from './harness.js'
import { processStartToken } from '@spexcode/spec-core'
import { closeSession } from './sessions.js'
import { runtimeRoot, sessionArtifactPath, sessionRecordPath, sessionStoreDir } from '@spexcode/spec-core'

test('close uses a target tmux probe when the global listing is busy', { concurrency: false }, async () => {
  const previousHome = process.env.SPEXCODE_HOME
  const previousPath = process.env.PATH
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
    mkdirSync(sessionStoreDir(id), { recursive: true })
    writeFileSync(sessionRecordPath(id), `${JSON.stringify({
      session_id: id, governed: true, worktree_path: worktree, branch,
      node: 'archive', title: '', name: '', parent: '', status: 'awaiting', proposal: 'close',
      merges: 0, note: '', sortkey: '', createdAt: Date.now(), harness: 'codex', harness_session_id: thread,
      stopped: false, archived: false, cold_proof: '', adapter_recovery: '', launcher: 'codex', launch_cmd: 'codex', launch_owner: '',
    }, null, 2)}\n`)
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
    assert.equal(JSON.parse(readFileSync(sessionRecordPath(id), 'utf8')).archived, true, 'the retained row projects closed')
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
    process.chdir(previousCwd)
    rmSync(home, { recursive: true, force: true })
  }
})
