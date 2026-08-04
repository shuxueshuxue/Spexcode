import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeProject } from './project-store.js'
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

function capture(child: ChildProcess): () => string {
  let output = ''
  child.stdout?.on('data', (chunk) => { output += chunk })
  child.stderr?.on('data', (chunk) => { output += chunk })
  return () => output
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

type Backend = { child: ChildProcess; readLog: () => string }

test('public review and merge authority bind exact head and one durable dispatch', { timeout: 180_000 }, async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'spex-manager-authority-'))
  const project = join(fixture, 'project')
  const home = join(fixture, 'home')
  const [portA, portB] = await Promise.all([freePort(), freePort()])
  const tmux = `spex-manager-authority-${process.pid}-${Date.now()}`
  const gitBin = join(fixture, 'bin')
  const gitTrace = join(fixture, 'git-argv.log')
  const refMoveArm = join(fixture, 'move-ref.arm')
  const refMoveClaim = join(fixture, 'move-ref.claim')
  const crashArm = join(fixture, 'crash-after-receipt.arm')
  const crashClaim = join(fixture, 'crash-after-receipt.claim')
  const crashPreload = join(fixture, 'crash-after-receipt.cjs')
  const realGit = execFileSync('bash', ['-lc', 'command -v git'], { encoding: 'utf8' }).trim()
  mkdirSync(gitBin, { recursive: true })
  writeFileSync(join(gitBin, 'git'), [
    '#!/bin/sh',
    'printf \'%s\\n\' "$*" >> "$SPEX_MANAGER_GIT_TRACE"',
    'case " $* " in',
    '  *" rev-list --count "*)',
    '    if [ -f "$SPEX_MANAGER_MOVE_REF_ARM" ] && mkdir "$SPEX_MANAGER_MOVE_REF_CLAIM" 2>/dev/null; then',
    '      "$SPEX_MANAGER_REAL_GIT" "$@"',
    '      rc=$?',
    '      if [ "$rc" -eq 0 ]; then',
    '        old=$("$SPEX_MANAGER_REAL_GIT" -C "$SPEX_MANAGER_PROJECT" rev-parse refs/heads/main) || exit $?',
    '        tree=$("$SPEX_MANAGER_REAL_GIT" -C "$SPEX_MANAGER_PROJECT" rev-parse "$old^{tree}") || exit $?',
    '        next=$(printf \'mid-review ref move\\n\' | "$SPEX_MANAGER_REAL_GIT" -C "$SPEX_MANAGER_PROJECT" commit-tree "$tree" -p "$old") || exit $?',
    '        "$SPEX_MANAGER_REAL_GIT" -C "$SPEX_MANAGER_PROJECT" update-ref refs/heads/main "$next" "$old" || exit $?',
    '      fi',
    '      exit "$rc"',
    '    fi',
    '    ;;',
    'esac',
    'exec "$SPEX_MANAGER_REAL_GIT" "$@"',
    '',
  ].join('\n'))
  writeFileSync(crashPreload, [
    "const fs = require('node:fs')",
    "const { syncBuiltinESMExports } = require('node:module')",
    'const rename = fs.renameSync',
    'fs.renameSync = (from, to) => {',
    '  const arm = process.env.SPEX_MANAGER_CRASH_ARM',
    "  if (arm && fs.existsSync(arm) && String(to).endsWith('/pending.json')) {",
    '    try { fs.unlinkSync(arm) } catch {}',
    "    fs.writeFileSync(process.env.SPEX_MANAGER_CRASH_CLAIM, JSON.stringify({ pid: process.pid, from, to }) + '\\n')",
    "    process.kill(process.pid, 'SIGKILL')",
    '    return',
    '  }',
    '  return rename(from, to)',
    '}',
    'syncBuiltinESMExports()',
    '',
  ].join('\n'))
  chmodSync(join(gitBin, 'git'), 0o755)
  mkdirSync(join(project, '.spec', 'project'), { recursive: true })
  writeFileSync(join(project, '.spec', 'project', 'spec.md'), '---\ntitle: project\nstatus: active\n---\n\n# project\n')
  writeFileSync(join(project, 'spexcode.json'), JSON.stringify({
    harnesses: ['opencode'],
    sessions: { launchers: { fake: { harness: 'opencode', cmd: fakeLauncher } }, defaultLauncher: 'fake' },
  }, null, 2) + '\n')
  writeFileSync(join(project, 'value.txt'), 'base\n')
  git(project, 'init', '-q', '-b', 'main')
  git(project, 'config', 'user.email', 'authority@example.test')
  git(project, 'config', 'user.name', 'Authority Fixture')
  git(project, 'add', '.')
  git(project, 'commit', '-qm', 'fixture seed')

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SPEXCODE_HOME: home,
    SPEXCODE_TMUX: tmux,
    FAKE_HARNESS_INTERVAL_MS: '100000',
    PATH: `${gitBin}:${process.env.PATH ?? ''}`,
    SPEX_MANAGER_GIT_TRACE: gitTrace,
    SPEX_MANAGER_REAL_GIT: realGit,
    SPEX_MANAGER_MOVE_REF_ARM: refMoveArm,
    SPEX_MANAGER_MOVE_REF_CLAIM: refMoveClaim,
    SPEX_MANAGER_PROJECT: project,
    SPEX_MANAGER_CRASH_ARM: crashArm,
    SPEX_MANAGER_CRASH_CLAIM: crashClaim,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${crashPreload}`.trim(),
  }
  delete env.SPEXCODE_API_URL
  delete env.SPEXCODE_SESSION_ID
  for (const key of ['CLAUDE_CODE_SESSION_ID', 'CODEX_THREAD_ID', 'OPENCODE_SESSION_ID', 'PI_SESSION_ID']) delete env[key]

  const backends = new Set<Backend>()
  const startBackend = (port: number): Backend => {
    const child = spawn(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'serve', '--port', String(port)], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    })
    const backend = { child, readLog: capture(child) }
    backends.add(backend)
    return backend
  }
  const stopBackend = async (backend: Backend | null) => {
    if (!backend) return
    const { child } = backend
    if (child.exitCode === null) {
      try { process.kill(-child.pid!, 'SIGTERM') } catch { child.kill('SIGTERM') }
      await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))])
      if (child.exitCode === null) { try { process.kill(-child.pid!, 'SIGKILL') } catch { child.kill('SIGKILL') } }
    }
    backends.delete(backend)
  }
  const baseA = `http://127.0.0.1:${portA}`
  const baseB = `http://127.0.0.1:${portB}`
  const waitHealth = (base: string, label: string) => waitFor(async () => {
    try { return (await request(base, '/health')).status } catch { return 0 }
  }, (status) => status === 200, label)
  let backendA: Backend | null = startBackend(portA)
  let backendB: Backend | null = startBackend(portB)
  let id = ''
  let cliId = ''
  let siblingId = ''
  let crashId = ''
  try {
    await Promise.all([waitHealth(baseA, 'backend A health'), waitHealth(baseB, 'backend B health')])
    const created = await request(baseA, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'manager-authority-session' },
      body: JSON.stringify({ prompt: 'manager authority fixture', launcher: 'fake' }),
    })
    assert.equal(created.status, 201, created.text)
    id = created.body.id
    assert.ok(id)
    const detail = await waitFor(
      () => request(baseA, `/api/sessions/${id}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'fixture session online',
    )
    const worktree = detail.path as string
    const sessionBranch = git(worktree, 'branch', '--show-current')
    assert.ok(worktree)
    assert.ok(sessionBranch)
    const runtime = join(home, 'projects', encodeProject(project))
    const sessionDir = join(runtime, 'sessions', id)

    writeFileSync(join(worktree, 'value.txt'), 'review-one\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority one')
    const headOne = git(worktree, 'rev-parse', 'HEAD')
    const baseOne = git(project, 'rev-parse', 'main')
    const reviewOne = await request(baseA, `/api/sessions/${id}/review`)
    assert.equal(reviewOne.status, 200, reviewOne.text)

    writeFileSync(join(worktree, 'value.txt'), 'review-two\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority two')
    const headTwo = git(worktree, 'rev-parse', 'HEAD')
    assert.notEqual(headTwo, headOne)
    writeFileSync(join(project, 'base.txt'), 'base-two\n')
    git(project, 'add', 'base.txt')
    git(project, 'commit', '-qm', 'base two')
    const baseTwo = git(project, 'rev-parse', 'main')
    assert.notEqual(baseTwo, baseOne)
    const reviewTwo = await request(baseB, `/api/sessions/${id}/review`)
    assert.equal(reviewTwo.status, 200, reviewTwo.text)

    const merge = (base: string, key: string | null, expectedBranchHead: string, expectedBaseHead: string, extra: Record<string, unknown> = {}) => request(base, `/api/sessions/${id}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key !== null ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify({ expectedBranchHead, expectedBaseHead, ...extra }),
    })
    const declare = (proposal: 'merge' | 'nothing') => execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', proposal, '--note', `authority ${proposal}`,
    ], { cwd: worktree, env: { ...env, SPEXCODE_SESSION_ID: id }, encoding: 'utf8' })

    const activeBefore = await request(baseA, `/api/sessions/${id}`)
    const activeRefusal = await merge(baseA, 'state-active', headTwo, baseTwo)
    const activeAfter = await request(baseA, `/api/sessions/${id}`)
    declare('nothing')
    const nothingBefore = await request(baseA, `/api/sessions/${id}`)
    const nothingRefusal = await merge(baseA, 'state-nothing', headTwo, baseTwo)
    const nothingAfter = await request(baseA, `/api/sessions/${id}`)
    declare('merge')

    const noKey = await merge(baseA, null, headTwo, baseTwo)
    const emptyKey = await merge(baseA, '', headTwo, baseTwo)
    const missingBase = await request(baseA, `/api/sessions/${id}/merge`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'missing-base' },
      body: JSON.stringify({ expectedBranchHead: headTwo }),
    })
    const extraField = await merge(baseA, 'extra-field', headTwo, baseTwo, { reviewedHead: headTwo })
    const legacyKey = 'legacy-single-head-receipt'
    const hash = (value: string) => createHash('sha256').update(value).digest('hex')
    appendFileSync(join(sessionDir, 'timeline.ndjson'), JSON.stringify({
      ts: new Date().toISOString(), kind: 'sent', mid: 'legacy-receipt', text: 'legacy accepted merge', from: null,
      dispatchReceipt: {
        operation: 'merge',
        requestDigest: hash(`spexcode-session-merge\0${legacyKey}`),
        payloadHash: hash(JSON.stringify({ reviewedHead: headTwo })),
      },
    }) + '\n')
    const legacyReceipt = await merge(baseA, legacyKey, headTwo, baseTwo)

    writeFileSync(join(project, 'base.txt'), 'base-three\n')
    git(project, 'add', 'base.txt')
    git(project, 'commit', '-qm', 'base three')
    const baseThree = git(project, 'rev-parse', 'main')
    const staleBaseBefore = await request(baseA, `/api/sessions/${id}`)
    const staleBase = await merge(baseA, 'stale-base', headTwo, baseTwo)
    const staleBaseAfter = await request(baseA, `/api/sessions/${id}`)
    const reviewThree = await request(baseA, `/api/sessions/${id}/review`)
    assert.equal(reviewThree.status, 200, reviewThree.text)

    writeFileSync(join(worktree, 'value.txt'), 'review-three\n')
    git(worktree, 'add', 'value.txt')
    git(worktree, 'commit', '-qm', 'spec: authority three')
    const headThree = git(worktree, 'rev-parse', 'HEAD')
    const staleBranchBefore = await request(baseA, `/api/sessions/${id}`)
    const staleBranch = await merge(baseA, 'stale-branch', headTwo, baseThree)
    const staleBranchAfter = await request(baseA, `/api/sessions/${id}`)
    const reviewFour = await request(baseA, `/api/sessions/${id}/review`)
    assert.equal(reviewFour.status, 200, reviewFour.text)
    const beforeKeyed = await request(baseA, `/api/sessions/${id}/timeline`)
    const baselinePrompts = beforeKeyed.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))

    const pendingPath = join(sessionDir, 'pending.json')
    const rendezvousPath = readFileSync(join(sessionDir, 'rv.path'), 'utf8').trim()
    rmSync(rendezvousPath, { force: true })
    assert.equal(existsSync(rendezvousPath), false)
    const pendingCount = () => {
      if (!existsSync(pendingPath)) return 0
      const value = JSON.parse(readFileSync(pendingPath, 'utf8'))
      return Array.isArray(value) ? value.length : -1
    }

    const concurrent = await Promise.all([
      merge(baseA, 'maintenance-release-1', headThree, baseThree),
      merge(baseB, 'maintenance-release-1', headThree, baseThree),
    ])
    const pendingAfterConcurrent = pendingCount()
    await Promise.all([stopBackend(backendA), stopBackend(backendB)])
    backendA = null
    backendB = null
    backendA = startBackend(portA)
    await waitHealth(baseA, 'restarted backend health')
    const replay = await merge(baseA, 'maintenance-release-1', headThree, baseThree)
    const pendingAfterRestartReplay = pendingCount()
    const reused = await merge(baseA, 'maintenance-release-1', headTwo, baseThree)

    declare('merge')
    git(worktree, 'checkout', '--detach', '-q', headThree)
    const detached = await merge(baseA, 'maintenance-release-detached', headThree, baseThree)
    git(worktree, 'checkout', '-q', sessionBranch)
    git(worktree, 'checkout', '-qb', 'authority-other', headThree)
    const wrongBranch = await merge(baseA, 'maintenance-release-wrong-branch', headThree, baseThree)
    git(worktree, 'checkout', '-q', sessionBranch)
    git(worktree, 'branch', '-D', 'authority-other')

    writeFileSync(refMoveArm, 'armed\n')
    const movedDuringReview = await request(baseA, `/api/sessions/${id}/review`)
    rmSync(refMoveArm, { force: true })
    const baseAfterMove = git(project, 'rev-parse', 'main')
    const stableAfterMove = await request(baseA, `/api/sessions/${id}/review`)
    assert.equal(stableAfterMove.status, 200, stableAfterMove.text)

    const finalTimeline = await request(baseA, `/api/sessions/${id}/timeline`)
    const finalMergePrompts = finalTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text))
    const keyedPrompt = finalMergePrompts.find((event: any) => event.text.includes(headThree) && event.text.includes(baseThree))?.text ?? ''
    const rawTimeline = [join(sessionDir, 'timeline.ndjson'), join(sessionDir, 'timeline')]
      .flatMap((path) => existsSync(path) && !path.endsWith('timeline') ? [path]
        : existsSync(path) ? readdirSync(path).map((name) => join(path, name)) : [])
      .map((path) => readFileSync(path, 'utf8')).join('\n')
    const gitArgv = existsSync(gitTrace) ? readFileSync(gitTrace, 'utf8').split('\n').filter(Boolean) : []
    const reviewUsesExactPair = (baseHead: string, branchHead: string) =>
      gitArgv.some((line) => line.includes(`rev-list --count ${baseHead}..${branchHead}`))
      && gitArgv.some((line) => line.includes(`merge-base ${baseHead} ${branchHead}`))
      && gitArgv.some((line) => line.includes(`merge-tree --write-tree --no-messages ${baseHead} ${branchHead}`))
    const observed = {
      reviewOne: { branchHead: reviewOne.body.branchHead, baseHead: reviewOne.body.baseHead },
      reviewTwo: { branchHead: reviewTwo.body.branchHead, baseHead: reviewTwo.body.baseHead },
      reviewThree: { branchHead: reviewThree.body.branchHead, baseHead: reviewThree.body.baseHead },
      reviewFour: { branchHead: reviewFour.body.branchHead, baseHead: reviewFour.body.baseHead },
      reviewUsesExactPair: reviewUsesExactPair(baseOne, headOne) && reviewUsesExactPair(baseTwo, headTwo)
        && reviewUsesExactPair(baseThree, headTwo) && reviewUsesExactPair(baseThree, headThree),
      activeRefusal: { status: activeRefusal.status, code: activeRefusal.body.code, stateUnchanged: activeAfter.body.lifecycle === activeBefore.body.lifecycle && activeAfter.body.proposal === activeBefore.body.proposal },
      nothingRefusal: { status: nothingRefusal.status, code: nothingRefusal.body.code, stateUnchanged: nothingAfter.body.lifecycle === nothingBefore.body.lifecycle && nothingAfter.body.proposal === nothingBefore.body.proposal },
      noKey: { status: noKey.status, code: noKey.body.code },
      emptyKey: { status: emptyKey.status, code: emptyKey.body.code },
      missingBase: { status: missingBase.status, code: missingBase.body.code },
      extraField: { status: extraField.status, code: extraField.body.code },
      legacyReceipt: { status: legacyReceipt.status, code: legacyReceipt.body.code },
      staleBase: { status: staleBase.status, code: staleBase.body.code, stateUnchanged: staleBaseAfter.body.lifecycle === staleBaseBefore.body.lifecycle && staleBaseAfter.body.proposal === staleBaseBefore.body.proposal },
      staleBranch: { status: staleBranch.status, code: staleBranch.body.code, stateUnchanged: staleBranchAfter.body.lifecycle === staleBranchBefore.body.lifecycle && staleBranchAfter.body.proposal === staleBranchBefore.body.proposal },
      baselinePromptCount: baselinePrompts.length,
      concurrent: concurrent.map((reply) => ({ status: reply.status, dispatched: reply.body.dispatched, replayed: reply.body.replayed }))
        .sort((left, right) => Number(left.replayed) - Number(right.replayed)),
      pendingAfterConcurrent,
      replay: { status: replay.status, dispatched: replay.body.dispatched, replayed: replay.body.replayed },
      pendingAfterRestartReplay,
      reused: { status: reused.status, code: reused.body.code },
      detached: { status: detached.status, code: detached.body.code },
      wrongBranch: { status: wrongBranch.status, code: wrongBranch.body.code },
      movedDuringReview: { status: movedDuringReview.status, code: movedDuringReview.body.code },
      stableAfterMove: { branchHead: stableAfterMove.body.branchHead, baseHead: stableAfterMove.body.baseHead },
      finalPromptCount: finalMergePrompts.length,
      promptBindsReviewedPair: keyedPrompt.includes(headThree) && keyedPrompt.includes(baseThree),
      promptReprovesSymbolicBranch: keyedPrompt.includes('symbolic-ref --quiet --short HEAD'),
      promptReprovesStoredRef: keyedPrompt.includes(`show-ref --verify --hash 'refs/heads/${sessionBranch}'`),
      promptReprovesBaseRef: keyedPrompt.includes(`show-ref --verify --hash 'refs/heads/main'`),
      promptMergesExactObject: keyedPrompt.includes('merge --no-ff') && keyedPrompt.includes('"$candidate"'),
      rawKeyVisible: rawTimeline.includes('maintenance-release-1'),
    }
    console.log(`manager-authority-proof ${JSON.stringify(observed)}`)
    assert.deepEqual(observed, {
      reviewOne: { branchHead: headOne, baseHead: baseOne },
      reviewTwo: { branchHead: headTwo, baseHead: baseTwo },
      reviewThree: { branchHead: headTwo, baseHead: baseThree },
      reviewFour: { branchHead: headThree, baseHead: baseThree },
      reviewUsesExactPair: true,
      activeRefusal: { status: 409, code: 'session_merge_not_proposed', stateUnchanged: true },
      nothingRefusal: { status: 409, code: 'session_merge_not_proposed', stateUnchanged: true },
      noKey: { status: 400, code: 'session_merge_invalid_request' },
      emptyKey: { status: 400, code: 'session_merge_invalid_request' },
      missingBase: { status: 400, code: 'session_merge_invalid_request' },
      extraField: { status: 400, code: 'session_merge_invalid_request' },
      legacyReceipt: { status: 409, code: 'session_merge_key_reused' },
      staleBase: { status: 409, code: 'session_merge_head_changed', stateUnchanged: true },
      staleBranch: { status: 409, code: 'session_merge_head_changed', stateUnchanged: true },
      baselinePromptCount: 0,
      concurrent: [
        { status: 200, dispatched: true, replayed: false },
        { status: 200, dispatched: true, replayed: true },
      ],
      pendingAfterConcurrent: 1,
      replay: { status: 200, dispatched: true, replayed: true },
      pendingAfterRestartReplay: 1,
      reused: { status: 409, code: 'session_merge_key_reused' },
      detached: { status: 409, code: 'session_merge_branch_unproven' },
      wrongBranch: { status: 409, code: 'session_merge_branch_unproven' },
      movedDuringReview: { status: 409, code: 'session_review_head_changed' },
      stableAfterMove: { branchHead: headThree, baseHead: baseAfterMove },
      finalPromptCount: 1,
      promptBindsReviewedPair: true,
      promptReprovesSymbolicBranch: true,
      promptReprovesStoredRef: true,
      promptReprovesBaseRef: true,
      promptMergesExactObject: true,
      rawKeyVisible: false,
    })

    const missingObject = 'f'.repeat(headThree.length)
    const beforeMissingRecord = readFileSync(join(sessionDir, 'session.json'), 'utf8')
    const beforeMissingTimeline = (await request(baseA, `/api/sessions/${id}/timeline`)).text
    const beforeMissingPending = existsSync(pendingPath) ? readFileSync(pendingPath, 'utf8') : null
    const missingObjectResult = await merge(baseA, 'missing-object', missingObject, baseAfterMove)
    const missingObjectObserved = {
      status: missingObjectResult.status,
      code: missingObjectResult.body?.code,
      mutation: readFileSync(join(sessionDir, 'session.json'), 'utf8') !== beforeMissingRecord
        || (await request(baseA, `/api/sessions/${id}/timeline`)).text !== beforeMissingTimeline
        || (existsSync(pendingPath) ? readFileSync(pendingPath, 'utf8') : null) !== beforeMissingPending,
    }
    console.log(`manager-authority-missing-object ${JSON.stringify(missingObjectObserved)}`)

    const siblingCreated = await request(baseA, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'manager-authority-sibling-session' },
      body: JSON.stringify({ prompt: 'manager authority sibling fixture', launcher: 'fake' }),
    })
    assert.equal(siblingCreated.status, 201, siblingCreated.text)
    siblingId = siblingCreated.body.id
    const siblingDetail = await waitFor(
      () => request(baseA, `/api/sessions/${siblingId}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'sibling fixture session online',
    )
    writeFileSync(join(siblingDetail.path, 'sibling.txt'), 'reviewed sibling\n')
    git(siblingDetail.path, 'add', 'sibling.txt')
    git(siblingDetail.path, 'commit', '-qm', 'spec: reviewed sibling authority')
    execFileSync(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', 'merge'], {
      cwd: siblingDetail.path, env: { ...env, SPEXCODE_SESSION_ID: siblingId }, encoding: 'utf8',
    })
    const siblingReview = await request(baseA, `/api/sessions/${siblingId}/review`)
    assert.equal(siblingReview.status, 200, siblingReview.text)
    const siblingMerge = await request(baseA, `/api/sessions/${siblingId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'maintenance-release-1' },
      body: JSON.stringify({ expectedBranchHead: siblingReview.body.branchHead, expectedBaseHead: siblingReview.body.baseHead }),
    })
    const siblingTimeline = await request(baseA, `/api/sessions/${siblingId}/timeline`)
    assert.deepEqual({ status: siblingMerge.status, dispatched: siblingMerge.body.dispatched, replayed: siblingMerge.body.replayed === true }, { status: 200, dispatched: true, replayed: false })
    assert.equal(siblingTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text)).length, 1)
    console.log(`manager-authority-route-scope ${JSON.stringify({ sameRawKey: true, independentAcceptance: true, promptCount: 1 })}`)

    const cliCreated = await request(baseA, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'manager-authority-cli-session' },
      body: JSON.stringify({ prompt: 'manager authority CLI fixture', launcher: 'fake' }),
    })
    assert.equal(cliCreated.status, 201, cliCreated.text)
    cliId = cliCreated.body.id
    const cliDetail = await waitFor(
      () => request(baseA, `/api/sessions/${cliId}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'CLI fixture session online',
    )
    writeFileSync(join(cliDetail.path, 'cli.txt'), 'reviewed CLI\n')
    git(cliDetail.path, 'add', 'cli.txt')
    git(cliDetail.path, 'commit', '-qm', 'spec: reviewed CLI authority')
    execFileSync(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', 'merge'], {
      cwd: cliDetail.path, env: { ...env, SPEXCODE_SESSION_ID: cliId }, encoding: 'utf8',
    })
    const cliOutput = execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'merge', cliId, '--api', baseA,
    ], { cwd: project, env, encoding: 'utf8' })
    const cliReplayOutput = execFileSync(process.execPath, [
      tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'merge', cliId, '--api', baseA,
    ], { cwd: project, env, encoding: 'utf8' })
    const cliTimeline = await request(baseA, `/api/sessions/${cliId}/timeline`)
    assert.match(cliOutput, /merge dispatched/)
    assert.match(cliReplayOutput, /merge dispatched/)
    assert.equal(cliTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text)).length, 1)
    console.log(`manager-authority-cli ${JSON.stringify({ dispatched: true, replayed: true, promptCount: 1 })}`)

    const crashCreated = await request(baseA, '/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'manager-authority-crash-session' },
      body: JSON.stringify({ prompt: 'manager authority crash fixture', launcher: 'fake' }),
    })
    assert.equal(crashCreated.status, 201, crashCreated.text)
    crashId = crashCreated.body.id
    const crashDetail = await waitFor(
      () => request(baseA, `/api/sessions/${crashId}`).then((reply) => reply.body),
      (session) => session?.liveness === 'online',
      'crash fixture session online',
    )
    writeFileSync(join(crashDetail.path, 'crash.txt'), 'reviewed crash recovery\n')
    git(crashDetail.path, 'add', 'crash.txt')
    git(crashDetail.path, 'commit', '-qm', 'spec: reviewed crash recovery')
    execFileSync(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'session', 'done', '--propose', 'merge'], {
      cwd: crashDetail.path, env: { ...env, SPEXCODE_SESSION_ID: crashId }, encoding: 'utf8',
    })
    const crashReview = await request(baseA, `/api/sessions/${crashId}/review`)
    assert.equal(crashReview.status, 200, crashReview.text)
    const crashDir = join(runtime, 'sessions', crashId)
    const crashPending = join(crashDir, 'pending.json')
    const crashMerge = () => request(baseA, `/api/sessions/${crashId}/merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'crash-after-receipt' },
      body: JSON.stringify({ expectedBranchHead: crashReview.body.branchHead, expectedBaseHead: crashReview.body.baseHead }),
    })
    writeFileSync(crashArm, 'armed\n')
    const disconnected = await crashMerge().then(() => false, () => true)
    await waitFor(async () => existsSync(crashClaim), Boolean, 'backend crash after receipt')
    await waitFor(async () => {
      try { return (await request(baseA, '/health')).status } catch { return 0 }
    }, (status) => status === 0, 'crashed backend listener absent')
    const debtAbsentAfterCrash = !existsSync(crashPending)
    await stopBackend(backendA)
    backendA = startBackend(portA)
    await waitHealth(baseA, 'receipt-recovery backend health')
    const afterCrashTimeline = await request(baseA, `/api/sessions/${crashId}/timeline`)
    const crashPromptCount = afterCrashTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text)).length
    const recovered = await crashMerge()
    const captureAfterRecovery = await request(baseA, `/api/sessions/${crashId}/capture`)
    const nativeCountAfterRecovery = (captureAfterRecovery.text.match(/FAKE-HARNESS REPLY Merge your branch/g) ?? []).length
    const afterRecoveryTimeline = await request(baseA, `/api/sessions/${crashId}/timeline`)
    const timelineCountAfterRecovery = afterRecoveryTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text)).length
    const debtAbsentAfterRecovery = !existsSync(crashPending)

    execFileSync(process.execPath, [tsxBin(packageRoot), join(packageRoot, 'src', 'cli.ts'), 'internal', 'session-state', 'active', '--session', crashId], {
      cwd: crashDetail.path, env, encoding: 'utf8',
    })
    const crashRecordPath = join(crashDir, 'session.json')
    const activeBeforeReplay = readFileSync(crashRecordPath, 'utf8')
    const activeReplay = await crashMerge()
    const activeAfterReplay = readFileSync(crashRecordPath, 'utf8')
    const activeCapture = await request(baseA, `/api/sessions/${crashId}/capture`)
    const nativeCountAfterActiveReplay = (activeCapture.text.match(/FAKE-HARNESS REPLY Merge your branch/g) ?? []).length

    const stopped = await request(baseA, `/api/sessions/${crashId}/stop`, { method: 'POST' })
    assert.equal(stopped.status, 200, stopped.text)
    const archived = await request(baseA, `/api/sessions/${crashId}/archive`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ on: true }),
    })
    assert.equal(archived.status, 200, archived.text)
    assert.equal(archived.body.ok, true)
    const archivedBeforeReplay = readFileSync(crashRecordPath, 'utf8')
    const archivedReplay = await crashMerge()
    const archivedAfterReplay = readFileSync(crashRecordPath, 'utf8')
    const finalCrashTimeline = await request(baseA, `/api/sessions/${crashId}/timeline`)
    const finalCrashPromptCount = finalCrashTimeline.body.events.filter((event: any) => event.kind === 'sent' && /^Merge your branch/.test(event.text)).length
    const recoveryObserved = {
      missingObject: missingObjectObserved,
      disconnected,
      receiptWithoutDebt: crashPromptCount === 1 && debtAbsentAfterCrash,
      recovered: { status: recovered.status, replayed: recovered.body?.replayed === true, nativeCount: nativeCountAfterRecovery, timelineCount: timelineCountAfterRecovery, debtAbsent: debtAbsentAfterRecovery },
      activeReplay: { status: activeReplay.status, replayed: activeReplay.body?.replayed === true, recordUnchanged: activeBeforeReplay === activeAfterReplay, nativeCount: nativeCountAfterActiveReplay, debtAbsent: !existsSync(crashPending) },
      archivedReplay: { status: archivedReplay.status, replayed: archivedReplay.body?.replayed === true, recordUnchanged: archivedBeforeReplay === archivedAfterReplay, timelineCount: finalCrashPromptCount, debtAbsent: !existsSync(crashPending) },
    }
    console.log(`manager-authority-receipt-recovery ${JSON.stringify(recoveryObserved)}`)
    assert.deepEqual(recoveryObserved, {
      missingObject: { status: 409, code: 'session_merge_head_changed', mutation: false },
      disconnected: true,
      receiptWithoutDebt: true,
      recovered: { status: 200, replayed: true, nativeCount: 1, timelineCount: 1, debtAbsent: true },
      activeReplay: { status: 200, replayed: true, recordUnchanged: true, nativeCount: 1, debtAbsent: true },
      archivedReplay: { status: 200, replayed: true, recordUnchanged: true, timelineCount: 1, debtAbsent: true },
    })
  } finally {
    if (crashId && backendA) await request(baseA, `/api/sessions/${crashId}/close`, { method: 'POST' }).catch(() => {})
    if (siblingId && backendA) await request(baseA, `/api/sessions/${siblingId}/close`, { method: 'POST' }).catch(() => {})
    if (cliId && backendA) await request(baseA, `/api/sessions/${cliId}/close`, { method: 'POST' }).catch(() => {})
    if (id && backendA) await request(baseA, `/api/sessions/${id}/close`, { method: 'POST' }).catch(() => {})
    for (const backend of [...backends]) {
      await stopBackend(backend)
      if (backend.child.exitCode && backend.child.exitCode !== 0 && backend.child.signalCode !== 'SIGTERM') console.error(backend.readLog())
    }
    try { execFileSync('tmux', ['-L', tmux, 'kill-server'], { stdio: 'ignore' }) } catch { /* public close may already stop the private server */ }
    rmSync(fixture, { recursive: true, force: true })
  }
})
