import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

    const bin = join(fixture, 'bin')
    mkdirSync(bin)
    const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim()
    assert.ok(realGit)
    writeFileSync(join(bin, 'git'), `#!/bin/sh
printf '%s\\n' "$*" >> "${argvLog}"
case " $* " in
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

    const commands = readFileSync(argvLog, 'utf8').trim().split('\n').filter(Boolean)
    const batch = commands.filter((line) => line.includes(' diff-tree ') && line.includes(' --stdin ') && line.endsWith(' -- .spec'))
    const mergeBases = commands.filter((line) => line.includes(' merge-base ') && !line.includes('--is-ancestor'))
    assert.equal(batch.length, 1, `one clean-tree batch owns both public surfaces:\n${commands.join('\n')}`)
    assert.equal(mergeBases.length, expected.size - 1, `one merge-base per non-archived worktree:\n${commands.join('\n')}`)
  } finally {
    await stopChild(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
