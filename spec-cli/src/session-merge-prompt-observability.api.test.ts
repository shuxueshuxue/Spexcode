import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

// The executor's own reading of the dispatched prompt: inside one numbered step, the shell lines are the
// ones that open with a variable assignment or a command — the surrounding prose never does. Deliberately
// shape-agnostic, so the SAME extraction reads the pre-repair chain and the repaired block.
function shellBlock(prompt: string, step: number): string[] {
  const lines = prompt.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${step}. `))
  if (start < 0) return []
  const block: string[] = []
  for (let index = start + 1; index < lines.length; index++) {
    if (/^\d+\. /.test(lines[index])) break
    const line = lines[index].trim()
    if (/^([a-z0-9_]+=|test |git )/.test(line)) block.push(line)
  }
  return block
}

type Run = { stdout: string; stderr: string; status: number | null }
function runBlock(block: string[], cwd: string): Run {
  const result = spawnSync('sh', ['-c', block.join('\n')], { cwd, encoding: 'utf8' })
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status }
}

const gateItem = (run: Run) => run.stdout.match(/REVIEWED_GENERATION_FAIL\s+(\S+):/)?.[1] ?? null
const landItem = (run: Run) => run.stdout.match(/LANDING_FAIL\s+(\S+):/)?.[1] ?? null
const saysOk = (run: Run) => /(^|\n)REVIEWED_GENERATION_OK\b/.test(run.stdout)

test('the dispatched merge prompt reports a distinguishable gate verdict', { timeout: 180_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-merge-prompt-observability-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const port = await freePort()
  const tmux = `spex-merge-prompt-${process.pid}-${Date.now()}`
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['opencode'],
    sessions: { launchers: { fake: { harness: 'opencode', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  writeFileSync(join(project, 'value.txt'), 'base\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'observability@example.test')
  git(project, 'config', 'user.name', 'Observability Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture seed')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: tmux,
    FAKE_HARNESS_INTERVAL_MS: '100000',
  }
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

    const created = await request(base, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'merge-prompt-observability-session' },
      body: JSON.stringify({ prompt: 'merge prompt observability fixture', launcher: 'fake' }),
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
    assert.ok(worktree && branch)

    // The reviewed generation: the branch carries its own work and the base has since moved, which is the
    // ordinary shape of a lane waiting to land — its branch does NOT yet contain the base.
    writeFileSync(join(worktree, 'value.txt'), 'lane work\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: lane work')
    writeFileSync(join(project, 'base.txt'), 'base moved\n')
    git(project, 'add', 'base.txt')
    git(project, 'commit', '-qm', 'base moves under the lane')
    execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', 'merge', '--note', 'observability fixture',
    ], { cwd: worktree, env: { ...env, SPEXCODE_SESSION_ID: id }, encoding: 'utf8' })

    const review = await request(base, `/api/sessions/${id}/review`)
    assert.equal(review.status, 200, review.text)
    const reviewedHead = review.body.branchHead as string
    const reviewedBase = review.body.baseHead as string

    const dispatched = await request(base, `/api/sessions/${id}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'merge-prompt-observability-1' },
      body: JSON.stringify({ expectedBranchHead: reviewedHead, expectedBaseHead: reviewedBase, expectedReviewEpoch: review.body.reviewEpoch }),
    })
    assert.equal(dispatched.status, 200, dispatched.text)

    const timeline = await request(base, `/api/sessions/${id}/timeline`)
    const prompt: string = timeline.body.events
      .filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))
      .map((event: any) => event.text as string)
      .find((text: string) => text.includes(reviewedHead) && text.includes(reviewedBase)) ?? ''
    assert.ok(prompt, 'no merge prompt on the session timeline')
    assert.match(prompt, /task is settled with no need to retain its worktree or await a human decision\/follow-up, run `spex session done --propose close` as your FINAL action/)
    assert.match(prompt, /Otherwise declare the state that is true/)

    // Nothing below asks the backend anything: the agent's shell is the executor from here on.
    await stopBackend()

    const gate = shellBlock(prompt, 0)
    const landing = shellBlock(prompt, 2)
    assert.ok(gate.length, 'step 0 carries no shell block')
    assert.ok(landing.length, 'step 2 carries no shell block')

    const reviewedRun = runBlock(gate, fixture)

    git(project, 'commit', '-q', '--allow-empty', '-m', 'base moves again')
    const staleBaseRun = runBlock(gate, fixture)
    git(project, 'reset', '--hard', '-q', reviewedBase)

    git(worktree, 'checkout', '-q', '--detach')
    const detachedRun = runBlock(gate, fixture)
    git(worktree, 'checkout', '-q', branch)

    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'lane moves past its review')
    const movedHeadRun = runBlock(gate, fixture)
    git(worktree, 'reset', '--hard', '-q', reviewedHead)

    renameSync(worktree, `${worktree}-moved`)
    const missingWorktreeRun = runBlock(gate, fixture)
    renameSync(`${worktree}-moved`, worktree)

    const failureRuns = [staleBaseRun, detachedRun, movedHeadRun, missingWorktreeRun]

    // Landing while the branch still lacks the base is the guard's whole point: it must refuse, say so, and
    // leave the base exactly where it was.
    const baseBeforeLanding = git(project, 'rev-parse', 'main')
    const landingBeforeSync = runBlock(landing, fixture)
    const baseAfterRefusal = git(project, 'rev-parse', 'main')

    git(worktree, 'merge', '-q', '--no-edit', 'main')
    const syncedHead = git(worktree, 'rev-parse', 'HEAD')
    const landingAfterSync = runBlock(landing, fixture)
    const baseAfterLanding = git(project, 'rev-parse', 'main')

    const observed = {
      reviewedRun: { saysOk: saysOk(reviewedRun), item: gateItem(reviewedRun) },
      staleBaseRun: { saysOk: saysOk(staleBaseRun), item: gateItem(staleBaseRun) },
      detachedRun: { saysOk: saysOk(detachedRun), item: gateItem(detachedRun) },
      movedHeadRun: { saysOk: saysOk(movedHeadRun), item: gateItem(movedHeadRun) },
      missingWorktreeRun: { saysOk: saysOk(missingWorktreeRun), item: gateItem(missingWorktreeRun) },
      failuresUnlikeThePass: `${failureRuns.filter((run) => run.stdout !== reviewedRun.stdout).length} of ${failureRuns.length}`,
      gateItemsNamed: [...new Set(gate.join('\n').match(/REVIEWED_GENERATION_FAIL\s+\S+:/g) ?? [])]
        .map((hit) => hit.split(/\s+/)[1].replace(/:$/, '')).sort(),
      gateVerdictChecks: (gate[gate.length - 1]?.match(/\btest /g) ?? []).length,
      landingBeforeSync: {
        merged: landingBeforeSync.stdout.includes('LANDING_MERGED'),
        item: landItem(landingBeforeSync),
        baseUnmoved: baseAfterRefusal === baseBeforeLanding,
      },
      landingAfterSync: {
        merged: landingAfterSync.stdout.includes(`LANDING_MERGED ${syncedHead}`),
        item: landItem(landingAfterSync),
        baseAdvancedToMerge: baseAfterLanding !== baseBeforeLanding
          && git(project, 'rev-list', '--count', `${syncedHead}..${baseAfterLanding}`) === '1',
      },
    }
    console.log(`merge-prompt-observability-gate ${JSON.stringify({
      step0: gate, step2: landing,
      stdout: {
        reviewed: reviewedRun.stdout, staleBase: staleBaseRun.stdout, detached: detachedRun.stdout,
        movedHead: movedHeadRun.stdout, missingWorktree: missingWorktreeRun.stdout,
        landingBeforeSync: landingBeforeSync.stdout, landingAfterSync: landingAfterSync.stdout,
      },
    })}`)
    console.log(`merge-prompt-observability-proof ${JSON.stringify(observed)}`)
    assert.deepEqual(observed, {
      reviewedRun: { saysOk: true, item: null },
      staleBaseRun: { saysOk: false, item: '5/baseref' },
      detachedRun: { saysOk: false, item: '2/symbolic' },
      movedHeadRun: { saysOk: false, item: '3/wtHEAD' },
      missingWorktreeRun: { saysOk: false, item: '1/toplevel' },
      failuresUnlikeThePass: '4 of 4',
      gateItemsNamed: ['1/toplevel', '2/symbolic', '3/wtHEAD', '4/mainref', '5/baseref'],
      gateVerdictChecks: 5,
      landingBeforeSync: { merged: false, item: '3/ancestor', baseUnmoved: true },
      landingAfterSync: { merged: true, item: null, baseAdvancedToMerge: true },
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
