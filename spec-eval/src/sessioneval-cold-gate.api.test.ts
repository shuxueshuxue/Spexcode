import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PRODUCT_SOURCE = process.env.SPEX_EVAL_PRODUCT_SOURCE || SOURCE
const SESSION_ID = 'eval-cold-gate-0001'
const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const git = (cwd: string, ...args: string[]): string =>
  execFileSync(REAL_GIT, args, { cwd, encoding: 'utf8' }).trim()

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function stop(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  if (await Promise.race([
    once(child, 'exit').then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 3_000)),
  ])) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}

test('a cold scoped list does not inherit an unrelated full review lint gate', { timeout: 90_000 }, async () => {
  assert.match(process.version, /^v22\./, `cold gate API rig must run on Node 22, got ${process.version}`)
  const fixture = mkdtempSync(join(tmpdir(), 'spex-eval-cold-gate-'))
  const project = join(fixture, 'project')
  const worktree = join(fixture, 'worktree')
  const home = join(fixture, 'home')
  const shimDir = join(fixture, 'shim')
  const gitLog = join(fixture, 'git.ndjson')
  const lintHeld = join(fixture, 'lint-held')
  const lintRelease = join(fixture, 'lint-release')
  let backend: ChildProcess | null = null
  let backendStderr = ''
  try {
    mkdirSync(project, { recursive: true })
    const common = git(PRODUCT_SOURCE, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    const main = dirname(common)
    const deps = [join(PRODUCT_SOURCE, 'node_modules'), join(main, 'node_modules')].find(existsSync)
    if (!deps) throw new Error('cold gate API rig requires installed dependencies')
    symlinkSync(deps, join(project, 'node_modules'), 'dir')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'eval@example.test')
    git(project, 'config', 'user.name', 'Eval Test')
    mkdirSync(join(project, '.spec/project/selected'), { recursive: true })
    mkdirSync(join(project, '.spec/project/unrelated'), { recursive: true })
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')
    writeFileSync(join(project, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(project, '.spec/project/selected/spec.md'), [
      '---', 'title: selected', 'code:', '  - src/selected.ts', '---', '# selected', '',
    ].join('\n'))
    writeFileSync(join(project, '.spec/project/selected/eval.md'), [
      '---', 'scenarios:', '  - name: selected-moves', '    tags: [backend-api]',
      '    code: [src/selected.ts]', '    description: selected change', '    expected: selected row is visible',
      '---', 'selected', '',
    ].join('\n'))
    writeFileSync(join(project, '.spec/project/unrelated/spec.md'), [
      '---', 'title: unrelated', 'code:', '  - src/unrelated.ts#unrelatedUnit', '---', '# unrelated', '',
    ].join('\n'))
    writeFileSync(join(project, 'src/selected.ts'), 'export const selected = 1\n')
    writeFileSync(join(project, 'src/unrelated.ts'), 'export function unrelatedUnit() { return 1 }\n')
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'fixture base')
    writeFileSync(join(project, 'src/unrelated.ts'), 'export function unrelatedUnit() { return 2 }\n')
    git(project, 'add', 'src/unrelated.ts')
    git(project, 'commit', '-qm', 'unrelated drift')
    git(project, 'worktree', 'add', '-q', '-b', 'node/eval-cold-gate', worktree, 'main')
    symlinkSync(deps, join(worktree, 'node_modules'), 'dir')
    writeFileSync(join(worktree, 'src/selected.ts'), 'export const selected = 2\n')
    git(worktree, 'add', 'src/selected.ts')
    git(worktree, 'commit', '-qm', 'selected change')

    const recordDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', SESSION_ID)
    mkdirSync(recordDir, { recursive: true })
    writeFileSync(join(recordDir, 'session.json'), JSON.stringify({
      session_id: SESSION_ID,
      governed: true,
      worktree_path: worktree,
      branch: 'node/eval-cold-gate',
      title: 'selected',
      name: '',
      parent: null,
      status: 'active',
      proposal: '',
      merges: 0,
      note: '',
      sortkey: '',
      createdAt: Date.now(),
      harness: 'claude',
      harness_session_id: '',
      launcher: 'fixture',
      launch_cmd: 'true',
    }, null, 2) + '\n')

    mkdirSync(shimDir)
    const shim = join(shimDir, 'git')
    writeFileSync(shim, `#!/usr/bin/env node\n` +
      `const fs=require('node:fs'), cp=require('node:child_process');\n` +
      `const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(gitLog)}, JSON.stringify({pid:process.pid,args:a})+'\\n');\n` +
      `if(a.includes('log') && a.some(x=>x.includes('src/unrelated.ts'))){fs.writeFileSync(${JSON.stringify(lintHeld)},'ready\\n'); while(!fs.existsSync(${JSON.stringify(lintRelease)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}\n` +
      `const r=cp.spawnSync(${JSON.stringify(REAL_GIT)},a,{stdio:'inherit'}); process.exit(r.status??1);\n`)
    chmodSync(shim, 0o755)

    const childEnv = { ...process.env }
    for (const key of [
      'SPEXCODE_ROOT', 'SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'SPEXCODE_INSTANCE_ID',
      'SPEXCODE_PASSWORD', 'SPEXCODE_HOME', 'SPEXCODE_TMUX', 'PORT',
    ]) delete childEnv[key]
    Object.assign(childEnv, {
      SPEXCODE_HOME: home,
      SPEXCODE_TMUX: 'eval-cold-gate-none',
      PATH: `${shimDir}:${childEnv.PATH}`,
    })
    const port = await freePort()
    backend = spawn(process.execPath, ['--import', 'tsx', join(PRODUCT_SOURCE, 'spec-cli/src/index.ts')], {
      cwd: project,
      env: { ...childEnv, PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    backend.stderr!.on('data', (chunk) => { backendStderr += chunk.toString() })
    const origin = `http://127.0.0.1:${port}`
    let healthy = false
    for (let attempt = 0; attempt < 150; attempt++) {
      try { if ((await fetch(`${origin}/health`)).ok) { healthy = true; break } } catch { /* starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(healthy, true, `backend failed to start: ${backendStderr.slice(-1200)}`)

    let reviewSettled = false
    const reviewPromise = fetch(`${origin}/api/sessions/${SESSION_ID}/review`)
      .then(async (response) => ({ status: response.status, body: await response.json() as any }))
      .finally(() => { reviewSettled = true })
    for (let attempt = 0; attempt < 200 && !existsSync(lintHeld); attempt++)
      await new Promise((resolve) => setTimeout(resolve, 25))
    assert.equal(existsSync(lintHeld), true, `cold lint did not reach the unrelated anchor query: ${backendStderr.slice(-1200)}`)

    const evalStarted = Date.now()
    const evalPromise = fetch(`${origin}/api/evals?q=${encodeURIComponent(`is:eval scope:${SESSION_ID}`)}`)
      .then(async (response) => ({ status: response.status, body: await response.json() as any, elapsedMs: Date.now() - evalStarted }))
    const evalResult = await Promise.race([
      evalPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
    ])
    assert.ok(evalResult, 'the scoped list inherited an unrelated full review lint wait')
    assert.equal(evalResult.status, 200, JSON.stringify(evalResult.body).slice(0, 1200))
    assert.ok(evalResult.body.items.some((item: any) => item.scenario === 'selected-moves'))
    assert.deepEqual(evalResult.body.gates, [], 'paged Eval rows defer all manager review gates to the explicit review/export surfaces')
    assert.equal(reviewSettled, false, 'the control lint must still be held when the list publishes')
    assert.equal(existsSync(lintRelease), false, 'the list may not release or mutate the manager review gate')

    const controlStarted = Date.now()
    const [health, session] = await Promise.all([
      fetch(`${origin}/health`),
      fetch(`${origin}/api/sessions/${SESSION_ID}`),
    ])
    const controlsElapsedMs = Date.now() - controlStarted
    assert.equal(health.status, 200)
    assert.equal(session.status, 200)
    assert.ok(controlsElapsedMs < 5_000, `health/session reads stalled ${controlsElapsedMs}ms behind cold work`)

    writeFileSync(lintRelease, 'release\n')
    const review = await reviewPromise
    assert.equal(review.status, 200)
    assert.equal(typeof review.body.gates?.lint?.errorCount, 'number', 'explicit manager review still owns the full lint gate')
    const childCount = readFileSync(gitLog, 'utf8').trim().split('\n').filter(Boolean).length
    console.log(JSON.stringify({
      phase: 'cold-list-independent-of-manager-lint',
      runtime: process.version,
      listStatus: evalResult.status,
      listElapsedMs: evalResult.elapsedMs,
      listRows: evalResult.body.items.length,
      listGates: evalResult.body.gates,
      managerLintHeldAtPublication: true,
      healthStatus: health.status,
      sessionStatus: session.status,
      controlsElapsedMs,
      gitChildren: childCount,
    }))
  } finally {
    if (!existsSync(lintRelease)) writeFileSync(lintRelease, 'release\n')
    await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
