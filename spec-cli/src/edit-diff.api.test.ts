import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  await new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done()))
  return address.port
}

const spec = (title: string, body: string[]) => ['---', `title: ${title}`, 'status: active', `desc: ${title}`, '---', `# ${title}`, '', ...body, ''].join('\n')

// A spec body is hard-wrapped prose. The pending change is served as git's porcelain WORD diff, so a paragraph
// re-wrapped around a few edited words reports those words and nothing else, and a brand-new untracked node
// still arrives as an all-additions diff.
test('/api/edit serves a node change as a word diff: re-wrapping is invisible, an untracked node is all additions', { timeout: 30_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-edit-diff-'))
  const project = join(fixture, 'project')
  const worktree = join(fixture, 'wt')
  const alpha = '.spec/fixture/alpha/spec.md'
  const beta = '.spec/fixture/beta/spec.md'
  let backend: ChildProcess | null = null
  try {
    mkdirSync(join(project, '.spec/fixture/alpha'), { recursive: true })
    writeFileSync(join(project, '.spec/spexcode.json'), JSON.stringify({ harnesses: ['claude'] }) + '\n')
    writeFileSync(join(project, '.spec/fixture/spec.md'), spec('fixture', ['Root.']))
    writeFileSync(join(project, alpha), spec('alpha', [
      'The alpha node keeps one promise: a reader who opens it sees the same words the',
      'source-of-truth branch holds, and the words that follow the change stay put.',
    ]))
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'config', 'user.email', 'edit@example.test')
    git(project, 'config', 'user.name', 'edit')
    git(project, 'add', '.')
    git(project, 'commit', '-qm', 'seed')
    git(project, 'worktree', 'add', '-q', '-b', 'node/edit', worktree)
    writeFileSync(join(worktree, alpha), spec('alpha', [
      'The alpha node keeps exactly one promise: a reader who opens it sees the same',
      'words the source-of-truth branch holds, and the words that trail the change',
      'stay put.',
    ]))
    mkdirSync(join(worktree, '.spec/fixture/beta'), { recursive: true })
    writeFileSync(join(worktree, beta), spec('beta', ['Beta is proposed.']))

    const port = await freePort()
    // A dispatched-worker shell carries live-session identity; the fixture backend serves only the fixture.
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const key of Object.keys(env)) if (key.startsWith('SPEXCODE_') || key.startsWith('SPEX_SESSION_')) delete env[key]
    Object.assign(env, { SPEXCODE_HOME: join(fixture, 'home'), PORT: String(port) })
    let log = ''
    backend = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'index.ts')], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    backend.stdout?.on('data', (chunk) => { log += String(chunk) })
    backend.stderr?.on('data', (chunk) => { log += String(chunk) })
    const base = `http://127.0.0.1:${port}`
    const deadline = Date.now() + 15_000
    while (!(await fetch(`${base}/health`).catch(() => null))?.ok) {
      if (backend.exitCode !== null || Date.now() > deadline) throw new Error(`backend never became healthy: ${log}`)
      await new Promise((done) => setTimeout(done, 50))
    }
    const edit = (path: string) => fetch(`${base}/api/edit?source=${encodeURIComponent(worktree)}&path=${encodeURIComponent(path)}`)
      .then((response) => response.json()) as Promise<{ wordDiff: string }>
    const runs = (wordDiff: string, mark: string) => wordDiff.split('\n').slice(wordDiff.split('\n').findIndex((line) => line.startsWith('@@')))
      .filter((line) => line.startsWith(mark)).map((line) => line.slice(1))

    const edited = await edit(alpha)
    assert.deepEqual(runs(edited.wordDiff, '+'), ['exactly', 'trail'], edited.wordDiff)
    assert.deepEqual(runs(edited.wordDiff, '-'), ['follow'], edited.wordDiff)
    assert.ok(runs(edited.wordDiff, ' ').some((run) => run.includes('words the source-of-truth branch holds')),
      're-wrapped words are shared context, not a removal and an addition')

    const proposed = await edit(beta)
    assert.ok(runs(proposed.wordDiff, '+').includes('Beta is proposed.'), proposed.wordDiff)
    assert.deepEqual(runs(proposed.wordDiff, '-'), [])

    assert.deepEqual(await edit('.spec/fixture/spec.md'), { wordDiff: '' }, 'an untouched node has no change')
  } finally {
    if (backend?.pid) {
      try { process.kill(-backend.pid, 'SIGTERM') } catch { /* group already gone */ }
      await new Promise((done) => setTimeout(done, 500))
      try { process.kill(-backend.pid, 'SIGKILL') } catch { /* group already gone */ }
    }
    rmSync(fixture, { recursive: true, force: true })
  }
})
