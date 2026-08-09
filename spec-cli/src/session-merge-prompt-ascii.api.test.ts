import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tsxBin } from './tsx-bin.js'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = process.env.SPEX_PACKAGE_ROOT || join(here, '..')
const fakeLauncher = join(packageRoot, 'test', 'fixtures', 'fake-claude')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('node:net').AddressInfo).port
      server.close(() => resolve(port))
    })
  })
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, label: string, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (accept(value)) return value
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

type Reply = { status: number; body: any; text: string }
async function request(base: string, path: string, init: RequestInit = {}): Promise<Reply> {
  const response = await fetch(`${base}${path}`, init)
  const text = await response.text()
  let body: any = null
  try { body = JSON.parse(text) } catch { /* plain-text failure */ }
  return { status: response.status, body, text }
}

function shellBlock(prompt: string, step: number): string {
  const lines = prompt.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${step}. `))
  if (start < 0) return ''
  const block: string[] = []
  for (let index = start + 1; index < lines.length; index++) {
    if (/^\d+\. /.test(lines[index])) break
    const line = lines[index].trim()
    if (/^([a-z0-9_]+=|test |git )/.test(line)) block.push(line)
  }
  return block.join('\n')
}

// The three ways a hop between the product and the executor's shell is known to lose a byte above 0x7F: it
// drops it, it substitutes U+FFFD for it, or it stops the text at it. A block that is 7-bit ASCII is a fixed
// point of all three; one that carries unicode literals is not.
const highBytes = (text: string) => Buffer.from(text, 'utf8').filter((byte) => byte >= 0x80).length
const dropHigh = (text: string) => Buffer.from([...Buffer.from(text, 'utf8')].filter((byte) => byte < 0x80)).toString('latin1')
const replaceHigh = (text: string) => text.replace(/[^\x00-\x7f]/g, '�')
const truncateAtHigh = (text: string) => {
  const bytes = Buffer.from(text, 'utf8')
  const first = bytes.findIndex((byte) => byte >= 0x80)
  return (first < 0 ? bytes : bytes.subarray(0, first)).toString('latin1')
}

type Run = { stdout: string; stderr: string; status: number | null }
const runBlock = (block: string, cwd: string): Run => {
  const result = spawnSync('sh', ['-c', block], { cwd, encoding: 'utf8' })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}
const saysOk = (run: Run) => /(^|\n)REVIEWED_GENERATION_OK\b/.test(run.stdout)
const gateItem = (run: Run) => run.stdout.match(/REVIEWED_GENERATION_FAIL\s+(\S+):/)?.[1] ?? null

test('the dispatched merge prompt gates a unicode branch in pure ASCII', { timeout: 180_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-merge-prompt-ascii-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const tmux = `spex-merge-ascii-${process.pid}-${Date.now()}`
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['opencode'],
    sessions: { launchers: { fake: { harness: 'opencode', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  writeFileSync(join(project, 'value.txt'), 'base\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'ascii@example.test')
  git(project, 'config', 'user.name', 'Ascii Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture seed')

  const env: NodeJS.ProcessEnv = { ...process.env, SPEXCODE_HOME: home, SPEXCODE_TMUX: tmux, FAKE_HARNESS_INTERVAL_MS: '100000' }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]

  const base = `http://127.0.0.1:${port}`
  let backend: ChildProcess | null = spawn(process.execPath, ['--import', import.meta.resolve('tsx'), join(packageRoot, 'src', 'index.ts')], {
    cwd: project, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  let backendLog = ''
  backend.stdout?.on('data', (chunk) => { backendLog += chunk })
  backend.stderr?.on('data', (chunk) => { backendLog += chunk })
  const stopBackend = async () => {
    if (!backend) return
    const child = backend
    backend = null
    if (child.exitCode === null) {
      try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill('SIGTERM') }
      await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (child.exitCode === null) { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
  }
  let id = ''
  try {
    await waitFor(async () => {
      try { return (await request(base, '/health')).status } catch { return 0 }
    }, (status) => status === 200, 'backend health')

    // A CJK ask, which is the fleet's ordinary case: the slug keeps unicode letters, so both the branch ref
    // and the worktree path carry bytes above 0x7F.
    const created = await request(base, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'merge-prompt-ascii-session' },
      body: JSON.stringify({ prompt: '编码健壮性 merge gate fixture', launcher: 'fake' }),
    })
    assert.equal(created.status, 201, created.text)
    id = created.body.id
    const detail = await waitFor(
      () => request(base, `/api/sessions/${id}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'fixture session online',
    )
    const worktree = detail.path as string
    const branch = git(worktree, 'branch', '--show-current')
    assert.ok(highBytes(branch) > 0, `fixture branch is not unicode: ${branch}`)

    writeFileSync(join(worktree, 'value.txt'), 'lane work\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: lane work')
    writeFileSync(join(project, 'base.txt'), 'base moved\n')
    git(project, 'add', 'base.txt')
    git(project, 'commit', '-qm', 'base moves under the lane')
    execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', 'merge', '--note', 'ascii fixture',
    ], { cwd: worktree, env: { ...env, SPEXCODE_SESSION_ID: id }, encoding: 'utf8' })

    const review = await request(base, `/api/sessions/${id}/review`)
    assert.equal(review.status, 200, review.text)
    const reviewedHead = review.body.branchHead as string
    const reviewedBase = review.body.baseHead as string

    const dispatched = await request(base, `/api/sessions/${id}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'merge-prompt-ascii-1' },
      body: JSON.stringify({ expectedBranchHead: reviewedHead, expectedBaseHead: reviewedBase, expectedReviewEpoch: review.body.reviewEpoch }),
    })
    assert.equal(dispatched.status, 200, dispatched.text)

    const timeline = await request(base, `/api/sessions/${id}/timeline`)
    const prompt: string = timeline.body.events
      .filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))
      .map((event: any) => event.text as string)
      .find((text: string) => text.includes(reviewedHead) && text.includes(reviewedBase)) ?? ''
    assert.ok(prompt, 'no merge prompt on the session timeline')
    await stopBackend()

    const gate = shellBlock(prompt, 0)
    const landing = shellBlock(prompt, 2)
    assert.ok(gate && landing, 'the merge prompt carries no shell blocks')

    const intact = runBlock(gate, fixture)
    const carried = { drop: dropHigh(gate), replace: replaceHigh(gate), truncate: truncateAtHigh(gate) }
    // `sameVerdict` is deliberately token-free: it asks only whether the carried block still decides what the
    // intact one decided, so this scenario measures the carriage and not the separate question of whether the
    // gate announces itself.
    const survives = (text: string) => {
      const run = runBlock(text, fixture)
      return { changed: text !== gate, sameVerdict: run.status === intact.status, saysOk: saysOk(run) }
    }
    // Every carriage is measured against the SAME reviewed generation as the intact run, before anything
    // below moves the worktree — otherwise a later checkout, not the carriage, is what changed the verdict.
    const dropped = survives(carried.drop), replaced = survives(carried.replace), truncated = survives(carried.truncate)

    git(worktree, 'checkout', '-q', '--detach')
    const detached = runBlock(gate, fixture)
    git(worktree, 'checkout', '-q', branch)

    git(worktree, 'merge', '-q', '--no-edit', 'main')
    const syncedHead = git(worktree, 'rev-parse', 'HEAD')
    const landed = runBlock(landing, fixture)

    const observed = {
      branchHasNonAscii: highBytes(branch) > 0,
      gateBlockHighBytes: highBytes(gate),
      landingBlockHighBytes: highBytes(landing),
      usesPrintfEscapes: gate.includes(`printf '%b'`) && landing.includes(`printf '%b'`),
      intact: { saysOk: saysOk(intact) },
      dropped, replaced, truncated,
      detached: { saysOk: saysOk(detached), item: gateItem(detached) },
      landed: { merged: landed.stdout.includes(`LANDING_MERGED ${syncedHead}`) },
    }
    console.log(`merge-prompt-ascii-branch ${JSON.stringify({ branch, worktree, gate, landing, intactStdout: intact.stdout, detachedStdout: detached.stdout, landedStdout: landed.stdout })}`)
    console.log(`merge-prompt-ascii-proof ${JSON.stringify(observed)}`)
    assert.deepEqual(observed, {
      branchHasNonAscii: true,
      gateBlockHighBytes: 0,
      landingBlockHighBytes: 0,
      usesPrintfEscapes: true,
      intact: { saysOk: true },
      dropped: { changed: false, sameVerdict: true, saysOk: true },
      replaced: { changed: false, sameVerdict: true, saysOk: true },
      truncated: { changed: false, sameVerdict: true, saysOk: true },
      detached: { saysOk: false, item: '2/symbolic' },
      landed: { merged: true },
    })
  } finally {
    if (id && backend) await request(base, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    const exited = backend
    await stopBackend()
    if (exited && exited.exitCode && exited.exitCode !== 0 && exited.signalCode !== 'SIGTERM') console.error(backendLog)
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* the close may already stop the private server */ }
    rmSync(fixture, { recursive: true, force: true })
  }
})
