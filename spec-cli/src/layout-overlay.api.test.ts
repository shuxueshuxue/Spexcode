import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return address.port
}

async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() >= deadline) assert.fail(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const timedOut = await Promise.race([
    once(child, 'exit').then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])
  if (timedOut && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

function writeRecord(home: string, project: string, id: string, path: string, branch: string, archived = false): void {
  const dir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), JSON.stringify({
    session_id: id,
    governed: true,
    worktree_path: path,
    branch,
    node: null,
    title: id,
    name: id,
    parent: null,
    status: 'awaiting',
    proposal: '',
    merges: 0,
    note: '',
    sortkey: null,
    createdAt: Date.now(),
    harness: 'claude',
    harness_session_id: '',
    stopped: true,
    archived,
    cold_proof: archived ? 'fixture-cold' : '',
    adapter_recovery: '',
    launcher: 'fixture',
    launch_cmd: 'true',
    launch_readiness_pending: '',
  }, null, 2) + '\n')
}

function specBody(title: string): string {
  return [
    '---', `title: ${title}`, 'status: active', 'hue: 160', `desc: ${title} fixture`, '---',
    `# ${title}`, '', '## raw source', '', 'Fixture.', '', '## expanded spec', '', 'Fixture.', '',
  ].join('\n')
}

test('cold governed overlays are one public generation, not one Git fanout per surface', { timeout: 60_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-layout-overlay-api-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const argvLog = join(fixture, 'git-argv.log')
  const failBatch = join(fixture, 'fail-batch')
  const holdBatch = join(fixture, 'hold-batch')
  const batchEntered = join(fixture, 'batch-entered.log')
  let backend: ChildProcess | null = null
  try {
    mkdirSync(join(project, '.spec', 'project'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'spec.md'), specBody('project'))
    writeFileSync(join(project, 'spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'layout@example.test')
    git(project, 'config', 'user.name', 'Layout Fixture')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'fixture')

    const expected = new Map<string, { nodeId: string; op: string; committed: boolean; dirty: boolean }[]>()
    const addWorktree = (id: string): { path: string; branch: string } => {
      const branch = `node/${id}`
      const path = join(fixture, 'worktrees', id)
      git(project, 'worktree', 'add', '-q', '-b', branch, path, 'main')
      return { path, branch }
    }

    for (let i = 0; i < 4; i++) {
      const id = `clean-${i}`
      const { path, branch } = addWorktree(id)
      writeFileSync(join(path, '.spec', 'project', 'spec.md'), specBody(`project-${i}`))
      git(path, 'add', '.spec')
      git(path, 'commit', '-qm', `edit project ${i}`)
      writeRecord(home, project, id, path, branch)
      expected.set(id, [{ nodeId: 'project', op: 'edited', committed: true, dirty: false }])
    }

    const rename = addWorktree('renamed')
    git(rename.path, 'mv', '.spec/project', '.spec/renamed')
    writeFileSync(join(rename.path, '.spec', 'renamed', 'spec.md'), specBody('renamed'))
    git(rename.path, 'add', '.spec')
    git(rename.path, 'commit', '-qm', 'rename project node')
    writeRecord(home, project, 'renamed', rename.path, rename.branch)
    expected.set('renamed', [{ nodeId: 'renamed', op: 'moved', committed: true, dirty: false }])

    const dirty = addWorktree('dirty')
    writeFileSync(join(dirty.path, '.spec', 'project', 'spec.md'), specBody('dirty-project'))
    writeRecord(home, project, 'dirty', dirty.path, dirty.branch)
    expected.set('dirty', [{ nodeId: 'project', op: 'edited', committed: false, dirty: true }])

    const untracked = addWorktree('untracked')
    mkdirSync(join(untracked.path, '.spec', 'project', 'new-node'), { recursive: true })
    writeFileSync(join(untracked.path, '.spec', 'project', 'new-node', 'spec.md'), specBody('new-node'))
    writeRecord(home, project, 'untracked', untracked.path, untracked.branch)
    expected.set('untracked', [{ nodeId: 'new-node', op: 'added', committed: false, dirty: true }])

    const archived = addWorktree('archived')
    writeFileSync(join(archived.path, '.spec', 'project', 'spec.md'), specBody('archived-project'))
    git(archived.path, 'add', '.spec')
    git(archived.path, 'commit', '-qm', 'archived edit')
    writeRecord(home, project, 'archived', archived.path, archived.branch, true)
    expected.set('archived', [])
    writeRecord(home, project, 'missing', join(fixture, 'worktrees', 'missing'), 'node/missing')

    const bin = join(fixture, 'bin')
    mkdirSync(bin)
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
    assert.ok(realGit)
    writeFileSync(join(bin, 'git'), `#!/bin/sh
printf '%s\\n' "$*" >> "${argvLog}"
case " $* " in
  *" diff-tree --stdin "*)
    if [ -e "${failBatch}" ]; then exit 23; fi
    if [ -e "${holdBatch}" ]; then
      printf 'entered\\n' >> "${batchEntered}"
      while [ -e "${holdBatch}" ]; do sleep 0.01; done
    fi
    sleep 0.04
    ;;
  *" -- .spec "*) sleep 0.04 ;;
esac
exec "${realGit}" "$@"
`)
    chmodSync(join(bin, 'git'), 0o755)
    writeFileSync(join(bin, 'tmux'), '#!/bin/sh\nexit 1\n')
    chmodSync(join(bin, 'tmux'), 0o755)

    const port = await freePort()
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PORT: String(port),
      PATH: `${bin}:${process.env.PATH || ''}`,
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: `spex-layout-overlay-${port}`,
      SPEXCODE_BOARD_BUDGET_MS: '0',
    }
    delete env.SPEXCODE_API_URL
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
      cwd: project,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok).catch(() => false), `backend health\n${log}`)

    writeFileSync(argvLog, '')
    const [settingsResponse, graphResponse] = await Promise.all([
      fetch(`${base}/api/settings`),
      fetch(`${base}/api/graph`),
    ])
    if (!settingsResponse.ok) assert.fail(`/api/settings ${settingsResponse.status}: ${await settingsResponse.text()}\n${log}`)
    if (!graphResponse.ok) assert.fail(`/api/graph ${graphResponse.status}: ${await graphResponse.text()}\n${log}`)
    const settings = await settingsResponse.json() as { layout: { worktrees: Array<{ session: string | null; ops: any[] }> } }
    const graph = await graphResponse.json() as { sessions: Array<{ id: string; ops: any[] }> }
    const shape = (ops: any[]) => ops.map(({ nodeId, op, committed, dirty }) => ({ nodeId, op, committed, dirty }))
    for (const [id, want] of expected) {
      const layoutRow = settings.layout.worktrees.find((row) => row.session === id)
      const graphRow = graph.sessions.find((row) => row.id === id)
      assert.ok(layoutRow, `/api/settings keeps ${id}`)
      assert.ok(graphRow, `/api/graph keeps ${id}`)
      assert.deepEqual(shape(layoutRow.ops), want, `/api/settings exact ${id} ops`)
      assert.deepEqual(shape(graphRow.ops), want, `/api/graph exact ${id} ops`)
    }
    assert.equal(settings.layout.worktrees.some((row) => row.session === 'missing'), false, '/api/settings omits a missing worktree')

    const commands = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean)
    const batch = commands.filter((line) => line.includes(' diff-tree ') && line.includes(' --stdin ') && line.endsWith(' -- .spec'))
    const mergeBases = commands.filter((line) => line.includes(' merge-base ') && !line.includes('--is-ancestor'))
    assert.equal(batch.length, 1, `one clean-tree batch owns both public surfaces:\n${commands.join('\n')}`)
    assert.equal(mergeBases.length, expected.size - 1, `one merge-base per non-archived worktree:\n${commands.join('\n')}`)

    mkdirSync(join(project, '.spec', 'project', 'main-only'), { recursive: true })
    writeFileSync(join(project, '.spec', 'project', 'main-only', 'spec.md'), specBody('main-only'))
    git(project, 'add', '.spec')
    git(project, 'commit', '-qm', 'main advances outside every branch footprint')
    writeFileSync(failBatch, 'fail next clean batch\n')
    const degradedResponse = await fetch(`${base}/api/settings`)
    assert.equal(degradedResponse.status, 200, 'a batch failure serves per-row degraded state rather than a false empty generation')
    const degraded = await degradedResponse.json() as typeof settings
    for (const [id, want] of expected) {
      const row = degraded.layout.worktrees.find((candidate) => candidate.session === id)
      assert.ok(row)
      assert.deepEqual(shape(row.ops), want, `failed flight retains prior ${id} ops`)
    }

    rmSync(failBatch)
    writeFileSync(argvLog, '')
    const repairedResponse = await fetch(`${base}/api/settings`)
    assert.equal(repairedResponse.status, 200)
    const repaired = await repairedResponse.json() as typeof settings
    for (const [id, want] of expected) {
      const row = repaired.layout.worktrees.find((candidate) => candidate.session === id)
      assert.ok(row)
      assert.deepEqual(shape(row.ops), want, `repair recomputes exact ${id} ops after main advance`)
    }
    const repairCommands = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean)
    assert.equal(repairCommands.filter((line) => line.includes(' diff-tree ') && line.includes(' --stdin ')).length, 1,
      `failed flight did not poison the next exact generation:\n${repairCommands.join('\n')}`)

    const rawMain = git(project, 'rev-parse', 'main')
    const replacementTree = git(join(fixture, 'worktrees', 'clean-0'), 'rev-parse', 'HEAD^{tree}')
    const replacement = git(project, 'commit-tree', replacementTree, '-p', `${rawMain}^`, '-m', 'alternate main interpretation')
    git(project, 'replace', rawMain, replacement)
    assert.equal(git(project, 'rev-parse', 'main'), rawMain, 'replace changes interpretation without changing the raw main key')
    writeFileSync(argvLog, '')
    const replacedResponse = await fetch(`${base}/api/settings`)
    assert.equal(replacedResponse.status, 200)
    const replacedCommands = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean)
    assert.equal(replacedCommands.filter((line) => line.includes(' diff-tree ') && line.includes(' --stdin ')).length, 1,
      `refs/replace must invalidate the raw-SHA overlay cache:\n${replacedCommands.join('\n')}`)

    git(project, 'replace', '-d', rawMain)
    writeFileSync(argvLog, '')
    const restoredResponse = await fetch(`${base}/api/settings`)
    assert.equal(restoredResponse.status, 200)
    const restoredCommands = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean)
    assert.equal(restoredCommands.filter((line) => line.includes(' diff-tree ') && line.includes(' --stdin ')).length, 1,
      `removing refs/replace must invalidate the alternate interpretation:\n${restoredCommands.join('\n')}`)

    const flightProbe = join(fixture, 'flight-probe.mts')
    writeFileSync(flightProbe, `
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolveLayout } from ${JSON.stringify(pathToFileURL(join(here, 'layout.ts')).href)}
import { withGitAbortSignal } from ${JSON.stringify(pathToFileURL(join(here, 'git.ts')).href)}
const hold = ${JSON.stringify(holdBatch)}, entered = ${JSON.stringify(batchEntered)}
const waitEntered = async (count) => {
  const deadline = Date.now() + 5000
  while ((existsSync(entered) ? readFileSync(entered, 'utf8').trim().split('\\n').filter(Boolean).length : 0) < count) {
    if (Date.now() >= deadline) throw new Error('batch never entered controlled hold')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
const phase = async (graphFirst, count) => {
  writeFileSync(hold, 'hold\\n')
  const controller = new AbortController()
  let graph, settings
  if (graphFirst) {
    graph = withGitAbortSignal(controller.signal, () => resolveLayout()).then(() => 'resolved', (error) => error?.name)
    await waitEntered(count)
    settings = resolveLayout()
  } else {
    settings = resolveLayout()
    await waitEntered(count)
    graph = withGitAbortSignal(controller.signal, () => resolveLayout()).then(() => 'resolved', (error) => error?.name)
  }
  await new Promise((resolve) => setTimeout(resolve, 30))
  controller.abort()
  rmSync(hold, { force: true })
  const [graphResult, settingsResult] = await Promise.all([graph, settings])
  assert.equal(graphResult, 'AbortError')
  assert.ok(settingsResult.worktrees.length > 1)
  return { graphResult, rows: settingsResult.worktrees.length }
}
const graphFirst = await phase(true, 1)
appendFileSync('.spec/project/spec.md', '\\nphase two main advance\\n')
execFileSync('git', ['add', '.spec'])
execFileSync('git', ['commit', '-qm', 'flight phase two'])
const settingsFirst = await phase(false, 2)
console.log(JSON.stringify({ graphFirst, settingsFirst }))
`)
    rmSync(batchEntered, { force: true })
    const flightResult = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), flightProbe], {
      cwd: project,
      env,
      encoding: 'utf8',
      timeout: 20_000,
    })
    assert.equal(flightResult.status, 0, `generation-owned cancellation probe failed:\n${flightResult.stdout}\n${flightResult.stderr}`)
    assert.deepEqual(JSON.parse(flightResult.stdout.trim()), {
      graphFirst: { graphResult: 'AbortError', rows: expected.size + 1 },
      settingsFirst: { graphResult: 'AbortError', rows: expected.size + 1 },
    })

    await stopChild(backend)
    backend = null
    writeFileSync(failBatch, 'fail a new process first cold batch\n')
    const coldPort = await freePort()
    const coldEnv = { ...env, PORT: String(coldPort), SPEXCODE_TMUX: `spex-layout-cold-failure-${coldPort}` }
    backend = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(here, 'index.ts')], {
      cwd: project,
      env: coldEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let coldLog = ''
    backend.stdout?.on('data', (chunk) => { coldLog += String(chunk) })
    backend.stderr?.on('data', (chunk) => { coldLog += String(chunk) })
    const coldBase = `http://127.0.0.1:${coldPort}`
    await waitFor(() => fetch(`${coldBase}/health`).then((response) => response.ok).catch(() => false), `cold backend health\n${coldLog}`)
    const coldFailure = await fetch(`${coldBase}/api/settings`)
    assert.equal(coldFailure.status, 500, `a first cold batch failure cannot publish false empty ops\n${coldLog}`)
    rmSync(failBatch)
  } finally {
    await stopChild(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
