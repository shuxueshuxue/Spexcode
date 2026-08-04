import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { once } from 'node:events'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PRODUCT_SOURCE = process.env.SPEX_EVAL_PRODUCT_SOURCE || SOURCE
const NODE = process.execPath
const REAL_GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
const SESSION_ID = 'freshness-content-batch-0001'
const ANCHORS = 40

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

function scenarioHash(description: string, expected: string): string {
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()
  return createHash('sha256').update(`${normalize(description)}\n${normalize(expected)}`).digest('hex')
}

function scenarioSource(): string {
  const rows = ['---', 'scenarios:']
  for (let index = 0; index < ANCHORS; index++) rows.push(
    `  - name: anchor-${String(index).padStart(2, '0')}`,
    '    tags: [backend-api]',
    '    code: [src/tracked.ts]',
    `    description: off-history content ${index}`,
    '    expected: unchanged governed content stays fresh',
  )
  rows.push('---', 'off-history content fixture', '')
  return rows.join('\n')
}

type GitTrace = { args: string[]; input: string[] }

function traceRows(path: string): GitTrace[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as GitTrace)
}

function contentCensus(path: string) {
  const rows = traceRows(path)
  const old = rows.filter((row) => row.args.includes('diff') && row.args.includes('--name-only') && row.args.includes('--no-renames'))
  const chunks = rows.filter((row) => row.args.includes('diff-tree') && row.args.includes('--stdin')
    && row.args.includes('--always') && row.args.includes('--no-renames'))
  const anchorChecks = rows.filter((row) => row.args.includes('cat-file')
    && row.args.some((arg) => arg.startsWith('--batch-check'))
    && row.input.length === ANCHORS + 1
    && row.input.every((line) => /^[0-9a-f]{40}$/.test(line)))
  return { old: old.length, chunks: chunks.length, anchorChecks: anchorChecks.length }
}

async function startBackend(project: string, home: string, shimDir: string, log: string): Promise<{
  child: ChildProcess; origin: string; stderr: () => string
}> {
  const port = await freePort()
  const env = { ...process.env }
  for (const key of [
    'SPEXCODE_ROOT', 'SPEXCODE_API_URL', 'SPEXCODE_SESSION_ID', 'SPEXCODE_INSTANCE_ID',
    'SPEXCODE_PASSWORD', 'SPEXCODE_HOME', 'SPEXCODE_TMUX', 'PORT',
  ]) delete env[key]
  Object.assign(env, {
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: 'freshness-content-batch-none',
    SPEX_TEST_GIT_LOG: log,
    SPEX_TEST_REAL_GIT: REAL_GIT,
    PATH: `${shimDir}:${env.PATH}`,
    PORT: String(port),
  })
  let captured = ''
  const child = spawn(NODE, ['--import', 'tsx', join(PRODUCT_SOURCE, 'spec-cli/src/index.ts')], {
    cwd: project,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.stderr!.on('data', (chunk) => { captured += chunk.toString() })
  const origin = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 200; attempt++) {
    try { if ((await fetch(`${origin}/health`)).ok) return { child, origin, stderr: () => captured } } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  await stop(child)
  throw new Error(`backend failed to start: ${captured.slice(-1200)}`)
}

async function readPage(origin: string, scope: boolean): Promise<any> {
  const q = scope ? `is:eval scope:${SESSION_ID}` : 'is:eval'
  const response = await fetch(`${origin}/api/evals?q=${encodeURIComponent(q)}`)
  const body = await response.json() as any
  assert.equal(response.status, 200, JSON.stringify(body).slice(0, 1200))
  return body
}

function assertPopulation(body: any, scoped: boolean): void {
  assert.equal(body.items.length, 25)
  assert.equal(body.total, ANCHORS)
  assert.equal(body.sourceTotal, ANCHORS)
  assert.deepEqual(body.counts.pass, { fresh: ANCHORS, stale: 0 })
  assert.deepEqual(body.counts.fail, { fresh: 0, stale: 0 })
  assert.equal(body.counts.unmeasured, 0)
  assert.ok(body.items.every((item: any) => item.fresh === true && item.verdict?.status === 'pass'))
  if (scoped) assert.deepEqual(body.summary, {
    measured: ANCHORS, total: ANCHORS, pass: ANCHORS, fail: 0, review: 0, blind: 0, unknown: 0,
  })
}

test('cold public eval populations batch off-history content probes across anchors', { timeout: 180_000 }, async () => {
  assert.match(process.version, /^v22\./, `content batch API rig must run on Node 22, got ${process.version}`)
  const fixture = mkdtempSync(join(tmpdir(), 'spex-freshness-content-batch-'))
  const project = join(fixture, 'project')
  const worktree = join(fixture, 'worktree')
  const home = join(fixture, 'home')
  const shimDir = join(fixture, 'shim')
  const unscopedLog = join(fixture, 'unscoped.ndjson')
  const scopedLog = join(fixture, 'scoped.ndjson')
  let backend: ChildProcess | null = null
  try {
    mkdirSync(project, { recursive: true })
    const common = git(PRODUCT_SOURCE, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    const main = dirname(common)
    const deps = [join(PRODUCT_SOURCE, 'node_modules'), join(main, 'node_modules')].find(existsSync)
    if (!deps) throw new Error('content batch API rig requires installed dependencies')
    symlinkSync(deps, join(project, 'node_modules'), 'dir')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'eval@example.test')
    git(project, 'config', 'user.name', 'Eval Test')
    mkdirSync(join(project, '.spec/project/batch'), { recursive: true })
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n')
    writeFileSync(join(project, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(project, '.spec/project/batch/spec.md'), [
      '---', 'title: batch', 'code:', '  - src/tracked.ts', '---', '# batch', '',
    ].join('\n'))
    writeFileSync(join(project, '.spec/project/batch/eval.md'), scenarioSource())
    writeFileSync(join(project, 'src/tracked.ts'), 'export const tracked = 1\n')
    git(project, 'add', '-A')
    git(project, 'commit', '-qm', 'fixture base')

    git(project, 'checkout', '-qb', 'measurement-anchors')
    const anchors: string[] = []
    for (let index = 0; index < ANCHORS; index++) {
      mkdirSync(join(project, 'anchors'), { recursive: true })
      writeFileSync(join(project, 'anchors', `${index}.txt`), `${index}\n`)
      git(project, 'add', 'anchors')
      git(project, 'commit', '-qm', `measurement ${index}`)
      anchors.push(git(project, 'rev-parse', 'HEAD'))
    }
    git(project, 'checkout', '-q', 'main')
    const sidecar = anchors.map((codeSha, index) => {
      const description = `off-history content ${index}`
      const expected = 'unchanged governed content stays fresh'
      return JSON.stringify({
        scenario: `anchor-${String(index).padStart(2, '0')}`,
        expected,
        scenarioHash: scenarioHash(description, expected),
        codeSha,
        blob: null,
        by: SESSION_ID,
        verdict: { status: 'pass' },
        ts: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      })
    }).join('\n') + '\n'
    writeFileSync(join(project, '.spec/project/batch/evals.ndjson'), sidecar)
    git(project, 'add', '.spec/project/batch/evals.ndjson')
    git(project, 'commit', '-qm', 'file off-history readings')
    git(project, 'worktree', 'add', '-q', '-b', 'node/freshness-content-batch', worktree, 'main')
    symlinkSync(deps, join(worktree, 'node_modules'), 'dir')

    const recordDir = join(home, 'projects', project.replace(/[/.]/g, '-'), 'sessions', SESSION_ID)
    mkdirSync(recordDir, { recursive: true })
    writeFileSync(join(recordDir, 'session.json'), JSON.stringify({
      session_id: SESSION_ID,
      governed: true,
      worktree_path: worktree,
      branch: 'node/freshness-content-batch',
      node: 'batch',
      title: 'batch',
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
    writeFileSync(join(shimDir, 'git'), `#!/usr/bin/env node\n` +
      `const fs=require('node:fs'),cp=require('node:child_process');\n` +
      `const args=process.argv.slice(2),input=fs.readFileSync(0);\n` +
      `const watched=(args.includes('diff')&&args.includes('--name-only')&&args.includes('--no-renames'))||(args.includes('diff-tree')&&args.includes('--stdin')&&args.includes('--always'))||(args.includes('cat-file')&&args.some(x=>x.startsWith('--batch-check')));\n` +
      `if(watched)fs.appendFileSync(process.env.SPEX_TEST_GIT_LOG,JSON.stringify({args,input:input.toString('utf8').split('\\n').filter(Boolean)})+'\\n');\n` +
      `const r=cp.spawnSync(process.env.SPEX_TEST_REAL_GIT,args,{input,maxBuffer:64*1024*1024});\n` +
      `if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);process.exit(r.status??1);\n`)
    chmodSync(join(shimDir, 'git'), 0o755)

    const observations: Record<string, any> = {}
    for (const [name, scope, log] of [
      ['unscoped', false, unscopedLog],
      ['scoped', true, scopedLog],
    ] as const) {
      writeFileSync(log, '')
      const running = await startBackend(project, home, shimDir, log)
      backend = running.child
      const first = await readPage(running.origin, scope)
      assertPopulation(first, scope)
      const cold = contentCensus(log)
      const repeat = await readPage(running.origin, scope)
      assertPopulation(repeat, scope)
      const afterRepeat = contentCensus(log)
      await stop(backend)
      backend = null
      observations[name] = { cold, repeatDelta: {
        old: afterRepeat.old - cold.old,
        chunks: afterRepeat.chunks - cold.chunks,
        anchorChecks: afterRepeat.anchorChecks - cold.anchorChecks,
      }, stderr: running.stderr().slice(-500) }
    }

    console.log(JSON.stringify({ phase: 'off-history-content-public-batch', anchors: ANCHORS, observations }))
    for (const [surface, result] of Object.entries(observations)) {
      const cold = result.cold as ReturnType<typeof contentCensus>
      assert.ok(cold.old + cold.chunks <= 1,
        `${surface} cold content transport forked per anchor: ${JSON.stringify(cold)}`)
      assert.equal(cold.anchorChecks, 1, `${surface} must prove the complete anchor set in one object batch`)
      assert.deepEqual(result.repeatDelta, { old: 0, chunks: 0, anchorChecks: 0 }, `${surface} repeat must reuse settled verdicts`)
    }
  } finally {
    await stop(backend)
    rmSync(fixture, { recursive: true, force: true })
  }
})
