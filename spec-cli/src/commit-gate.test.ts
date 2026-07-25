import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn, spawnSync } from 'node:child_process'

const SRC = dirname(fileURLToPath(import.meta.url))
const PACKAGE = join(SRC, '..')
const HOOK_TEMPLATES = join(PACKAGE, 'templates', 'hooks')
const CLI = join(SRC, 'cli.ts')

const SOURCE = (value: number) => `def apply_rate():\n    return ${value}\n\ndef helper():\n    return 0\n`
const NODE = `---
title: calc
code:
  - src/calc.py#apply_rate
---
# calc

The calculation contract.
`

type Fixture = {
  root: string
  git: (...args: string[]) => string
  commit: (...args: string[]) => ReturnType<typeof spawnSync>
  commitEnv: (env: NodeJS.ProcessEnv, ...args: string[]) => ReturnType<typeof spawnSync>
  runGit: (env: NodeJS.ProcessEnv, ...args: string[]) => ReturnType<typeof spawnSync>
  lint: (...args: string[]) => ReturnType<typeof spawnSync>
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'spex-commit-gate-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'gate@example.com')
  git('config', 'user.name', 'Gate Probe')

  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, '.spec', 'project', 'calc'), { recursive: true })
  writeFileSync(join(root, 'src', 'calc.py'), SOURCE(1))
  writeFileSync(join(root, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(root, 'README.md'), 'fixture\n')
  writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
  writeFileSync(join(root, '.spec', 'project', 'calc', 'spec.md'), NODE)
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ mainBranch: 'main', lint: { governedRoots: ['src'] } }) + '\n')
  git('add', '-A')
  git('commit', '-qm', 'seed contract')
  git('switch', '-qc', 'node/calc')

  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true })
  const spex = join(root, 'node_modules', '.bin', 'spex')
  writeFileSync(spex, `#!/usr/bin/env bash\nexec tsx ${JSON.stringify(CLI)} "$@"\n`)
  chmodSync(spex, 0o755)
  const hooks = join(root, '.git', 'hooks')
  for (const name of readdirSync(HOOK_TEMPLATES)) {
    const target = join(hooks, name)
    copyFileSync(join(HOOK_TEMPLATES, name), target)
    chmodSync(target, 0o755)
  }
  const runGit = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}`, ...env },
  })
  const commitEnv = (env: NodeJS.ProcessEnv, ...args: string[]) => runGit(env, 'commit', ...args)
  const commit = (...args: string[]) => commitEnv({}, ...args)
  const lint = (...args: string[]) => spawnSync(spex, ['spec', 'lint', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}` },
  })
  return { root, git, commit, commitEnv, runGit, lint }
}

test('new anchored drift is rejected before the branch ref advances', () => {
  const fx = fixture()
  const before = fx.git('rev-parse', 'HEAD')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')

  const result = fx.commit('-m', 'change implementation only')
  const output = `${result.stdout}${result.stderr}`
  assert.notEqual(result.status, 0, `the HEAD-only gate let the drift-producing commit land:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before, 'a rejected commit must leave the branch ref unchanged')
  assert.match(output, /anchor-drift.*src\/calc\.py#apply_rate/)
  assert.match(output, /git commit --trailer "Spec-OK: calc"/)
  assert.match(output, /git merge --continue.*git cherry-pick --continue.*git rebase --continue/)
  assert.match(output, /git merge --abort.*git cherry-pick --abort.*git rebase --abort/)
})

test('a content commit self-ack does not pardon older unacknowledged drift', () => {
  const fx = fixture()
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const debt = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'seed unanswered drift')
  assert.equal(debt.status, 0, `${debt.stdout}${debt.stderr}`)
  const before = fx.git('rev-parse', 'HEAD')

  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(3))
  fx.git('add', 'src/calc.py')
  const result = fx.commit('-m', 'self attest only', '--trailer', 'Spec-OK: calc')
  const output = `${result.stdout}${result.stderr}`
  assert.notEqual(result.status, 0, `the content self-ack washed older debt:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.match(output, /anchor-drift.*\[[0-9a-f]{8}\]/)

  const landed = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'self attest only', '--trailer', 'Spec-OK: calc')
  assert.equal(landed.status, 0, `${landed.stdout}${landed.stderr}`)
  const head = fx.lint()
  const headOutput = `${head.stdout}${head.stderr}`
  assert.notEqual(head.status, 0, `HEAD lint let the same content self-ack wash older debt:\n${headOutput}`)
  assert.match(headOutput, /anchor-drift/)
})

test('content self-acks stay node-scoped on a shared anchored file', () => {
  const fx = fixture()
  const taxDir = join(fx.root, '.spec', 'project', 'tax')
  mkdirSync(taxDir)
  writeFileSync(join(taxDir, 'spec.md'), NODE.replace('title: calc', 'title: tax').replace('# calc', '# tax'))
  fx.git('add', join(taxDir, 'spec.md'))
  const addTax = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '--amend', '--no-edit')
  assert.equal(addTax.status, 0, `${addTax.stdout}${addTax.stderr}`)

  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const c1 = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'change for calc', '--trailer', 'Spec-OK: calc')
  assert.equal(c1.status, 0, `${c1.stdout}${c1.stderr}`)
  const c1Hash = fx.git('rev-parse', '--short=8', 'HEAD')

  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(3))
  fx.git('add', 'src/calc.py')
  const pending = fx.commit('-m', 'change for tax', '--trailer', 'Spec-OK: tax')
  const pendingOutput = `${pending.stdout}${pending.stderr}`
  assert.notEqual(pending.status, 0, `pending node-scoped self-acks crossed over:\n${pendingOutput}`)
  assert.match(pendingOutput, /since spec 'calc'/)
  assert.match(pendingOutput, /since spec 'tax'/)
  const c2 = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'change for tax', '--trailer', 'Spec-OK: tax')
  assert.equal(c2.status, 0, `${c2.stdout}${c2.stderr}`)
  const c2Hash = fx.git('rev-parse', '--short=8', 'HEAD')

  const head = fx.lint()
  const output = `${head.stdout}${head.stderr}`
  assert.notEqual(head.status, 0, `node-scoped self-acks crossed over:\n${output}`)
  assert.match(output, new RegExp(`spec 'calc'.*\\[${c2Hash}\\]`))
  assert.match(output, new RegExp(`spec 'tax'.*\\[${c1Hash}\\]`))
})

test('a candidate trailer acknowledges only its named node when nodes share one version commit', () => {
  const candidate = (trailer?: string) => {
    const fx = fixture()
    const taxDir = join(fx.root, '.spec', 'project', 'tax')
    mkdirSync(taxDir)
    writeFileSync(join(taxDir, 'spec.md'), NODE
      .replace('title: calc', 'title: tax')
      .replace('src/calc.py#apply_rate', 'src/calc.py#helper')
      .replace('# calc', '# tax'))
    fx.git('add', join(taxDir, 'spec.md'))
    const version = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '--amend', '--no-edit')
    assert.equal(version.status, 0, `${version.stdout}${version.stderr}`)
    writeFileSync(join(fx.root, 'src', 'calc.py'), 'def apply_rate():\n    return 1\n\ndef helper():\n    return 2\n')
    fx.git('add', 'src/calc.py')
    return fx.commit('-m', 'change helper', ...(trailer ? ['--trailer', `Spec-OK: ${trailer}`] : []))
  }

  const bare = candidate()
  assert.notEqual(bare.status, 0, `undeclared helper change landed:\n${bare.stdout}${bare.stderr}`)
  const wrong = candidate('calc')
  assert.notEqual(wrong.status, 0, `Spec-OK for calc washed tax in the same version commit:\n${wrong.stdout}${wrong.stderr}`)
  assert.match(`${wrong.stdout}${wrong.stderr}`, /since spec 'tax'/)
  const right = candidate('tax')
  assert.equal(right.status, 0, `Spec-OK for tax did not cover its own candidate hit:\n${right.stdout}${right.stderr}`)
})

test('a real empty ack stamp covers existing drift in pending and HEAD lint', () => {
  const fx = fixture()
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const debt = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'seed unanswered drift')
  assert.equal(debt.status, 0, `${debt.stdout}${debt.stderr}`)

  const ack = fx.commit('--only', '--allow-empty', '-m', 'ack: Spec-OK calc', '-m', 'calculation contract remains true', '--trailer', 'Spec-OK: calc')
  assert.equal(ack.status, 0, `pending lint rejected a real empty stamp:\n${ack.stdout}${ack.stderr}`)
  const head = fx.lint()
  assert.equal(head.status, 0, `HEAD lint rejected the landed empty stamp:\n${head.stdout}${head.stderr}`)
})

test('an ours merge trailer cannot checkpoint unanswered side-branch drift', () => {
  const fx = fixture()
  fx.git('switch', '-qc', 'side')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const debt = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'side drift')
  assert.equal(debt.status, 0, `${debt.stdout}${debt.stderr}`)
  fx.git('switch', '-q', 'node/calc')
  const before = fx.git('rev-parse', 'HEAD')
  const message = 'record side as merged\n\nSpec-OK: calc'

  const rejected = fx.runGit({}, 'merge', '--no-ff', '-s', 'ours', 'side', '-m', message)
  const rejectedOutput = `${rejected.stdout}${rejected.stderr}`
  assert.notEqual(rejected.status, 0, `ours merge washed side debt in pending lint:\n${rejectedOutput}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.match(rejectedOutput, /anchor-drift/)
  fx.git('merge', '--abort')

  const landed = fx.runGit({ SPEXCODE_SKIP_LINT: '1' }, 'merge', '--no-ff', '-s', 'ours', 'side', '-m', message)
  assert.equal(landed.status, 0, `${landed.stdout}${landed.stderr}`)
  const head = fx.lint()
  assert.notEqual(head.status, 0, `ours merge washed side debt after landing:\n${head.stdout}${head.stderr}`)
})

test('amend -m judges the real replacement parents and accepts an atomic spec plus code tree', () => {
  const fx = fixture()
  const spec = join(fx.root, '.spec', 'project', 'calc', 'spec.md')
  writeFileSync(spec, NODE.replace('The calculation contract.', 'The calculation contract, revised.'))
  fx.git('add', spec)
  const specOnly = fx.commit('-m', 'revise calculation contract')
  assert.equal(specOnly.status, 0, `${specOnly.stdout}${specOnly.stderr}`)
  const replaced = fx.git('rev-parse', 'HEAD')

  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const amend = fx.commit('--amend', '-m', 'revise contract and implementation')
  assert.equal(amend.status, 0, `real replacement is clean but amend was rejected:\n${amend.stdout}${amend.stderr}`)
  assert.notEqual(fx.git('rev-parse', 'HEAD'), replaced)
  assert.equal(fx.lint().status, 0)
})

test('a detached HEAD commit is still judged before HEAD advances', () => {
  const fx = fixture()
  fx.git('checkout', '--detach', '-q')
  const before = fx.git('rev-parse', 'HEAD')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')

  const result = fx.commit('-m', 'detached drift')
  const output = `${result.stdout}${result.stderr}`
  assert.notEqual(result.status, 0, `detached HEAD bypassed the candidate gate:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.match(output, /anchor-drift/)
})

test('a failed GPG signing arm is cleared before a same-tree no-verify commit', () => {
  const fx = fixture()
  const gpg = join(fx.root, 'reject-signing')
  writeFileSync(gpg, '#!/bin/sh\nexit 1\n')
  chmodSync(gpg, 0o755)
  fx.git('config', 'gpg.program', gpg)
  fx.git('config', 'commit.gpgsign', 'true')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const before = fx.git('rev-parse', 'HEAD')
  const markerName = fx.git('rev-parse', '--git-path', 'SPEXCODE_PENDING_LINT')
  const marker = isAbsolute(markerName) ? markerName : join(fx.root, markerName)

  const failed = fx.commit('-m', 'signing will fail')
  assert.notEqual(failed.status, 0, 'the signing probe unexpectedly committed')
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.ok(existsSync(marker), 'commit-msg did not leave the arm that this regression needs')

  const bypass = fx.runGit({}, '-c', 'commit.gpgsign=false', 'commit', '--no-verify', '-m', 'explicit bypass')
  const output = `${bypass.stdout}${bypass.stderr}`
  assert.equal(bypass.status, 0, `stale arm incorrectly gated --no-verify:\n${output}`)
  assert.notEqual(fx.git('rev-parse', 'HEAD'), before)
  assert.ok(!existsSync(marker), 'prepare-commit-msg did not clear the stale arm')
  assert.doesNotMatch(output, /spex spec lint|anchor-drift/)
  assert.notEqual(fx.lint().status, 0, 'HEAD lint missed the explicit no-verify debt')
})

test('canonical pre-commit identifies custom commit-msg statically and never probes it', () => {
  const fx = fixture()
  const hook = join(fx.root, '.git', 'hooks', 'commit-msg')
  const calls = join(fx.root, 'custom-commit-msg.calls')
  writeFileSync(hook, `#!/bin/sh\nprintf '%s\\n' "$1" >> ${JSON.stringify(calls)}\n`)
  chmodSync(hook, 0o755)
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')

  const first = fx.commit('-m', 'baseline custom hook path')
  assert.equal(first.status, 0, `${first.stdout}${first.stderr}`)
  const argv = readFileSync(calls, 'utf8').trim().split('\n')
  assert.equal(argv.length, 1, `custom commit-msg was invoked more than once: ${argv.join(', ')}`)
  assert.doesNotMatch(argv[0], /spexcode-probe/)

  writeFileSync(join(fx.root, 'README.md'), 'unrelated successor\n')
  fx.git('add', 'README.md')
  const second = fx.commit('-m', 'successor sees old debt')
  assert.notEqual(second.status, 0, 'fallback HEAD gate disappeared behind a custom commit-msg hook')
  assert.match(`${second.stdout}${second.stderr}`, /anchor-drift/)
  assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 1, 'rejected successor reached custom commit-msg')
})

test('concurrent linked-worktree commits keep independent arms and both reach the gate', async () => {
  const fx = fixture()
  const linkedParent = mkdtempSync(join(tmpdir(), 'spex-commit-gate-linked-'))
  const linked = join(linkedParent, 'worktree')
  fx.git('branch', 'node/linked')
  fx.git('worktree', 'add', '-q', linked, 'node/linked')
  const rootMarker = fx.git('rev-parse', '--path-format=absolute', '--git-path', 'SPEXCODE_PENDING_LINT')
  const linkedMarker = execFileSync('git', ['-C', linked, 'rev-parse', '--path-format=absolute', '--git-path', 'SPEXCODE_PENDING_LINT'], { encoding: 'utf8' }).trim()
  assert.notEqual(rootMarker, linkedMarker, 'linked worktrees unexpectedly share one candidate marker')

  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  writeFileSync(join(linked, 'src', 'calc.py'), SOURCE(3))
  execFileSync('git', ['-C', linked, 'add', 'src/calc.py'])
  const env = { ...process.env, PATH: `${join(fx.root, 'node_modules', '.bin')}:${process.env.PATH}` }
  const commit = (root: string, message: string) => new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn('git', ['-C', root, 'commit', '-m', message], { env })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('close', (code) => resolve({ code: code ?? -1, output }))
  })

  const [a, b] = await Promise.all([commit(fx.root, 'root concurrent drift'), commit(linked, 'linked concurrent drift')])
  assert.notEqual(a.code, 0, `root commit silently escaped during concurrency:\n${a.output}`)
  assert.notEqual(b.code, 0, `linked commit silently escaped during concurrency:\n${b.output}`)
  assert.match(a.output, /anchor-drift/)
  assert.match(b.output, /anchor-drift/)
  assert.ok(!existsSync(rootMarker) && !existsSync(linkedMarker), 'a rejected candidate left a live arm')
})

test('a candidate cannot delete a governor while leaving its governed subject behind', () => {
  const fx = fixture()
  const spec = join(fx.root, '.spec', 'project', 'calc', 'spec.md')
  fx.git('rm', spec)
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const before = fx.git('rev-parse', 'HEAD')

  const result = fx.commit('-m', 'erase the contract and change its subject')
  const output = `${result.stdout}${result.stderr}`
  assert.notEqual(result.status, 0, `deleted governor degraded to a coverage warning:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.match(output, /integrity: candidate deletes governor .*calc\/spec\.md.*leaves its governed subject 'src\/calc\.py'/)
})

test('commit --only judges its candidate tree and ignores conflicting unstaged worktree content', () => {
  const fx = fixture()
  const spec = join(fx.root, '.spec', 'project', 'calc', 'spec.md')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  writeFileSync(spec, NODE.replace('The calculation contract.', 'An unstaged decoy repair.'))
  const before = fx.git('rev-parse', 'HEAD')

  const result = fx.commit('--only', 'src/calc.py', '-m', 'only the implementation')
  const output = `${result.stdout}${result.stderr}`
  assert.notEqual(result.status, 0, `--only read the unstaged spec decoy instead of its candidate:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.match(output, /anchor-drift/)
})

test('commit --only excludes an unstaged anchored edit from an unrelated candidate', () => {
  const fx = fixture()
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  writeFileSync(join(fx.root, 'README.md'), 'candidate only\n')

  const result = fx.commit('--only', 'README.md', '-m', 'unrelated candidate')
  assert.equal(result.status, 0, `--only was polluted by unstaged anchored content:\n${result.stdout}${result.stderr}`)
  assert.equal(fx.git('show', 'HEAD:src/calc.py'), SOURCE(1).trim())
  assert.equal(readFileSync(join(fx.root, 'src', 'calc.py'), 'utf8'), SOURCE(2))
})

function rejectedConflictMerge() {
  const fx = fixture()
  fx.git('switch', '-qc', 'side-conflict')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const side = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'side unanswered change')
  assert.equal(side.status, 0, `${side.stdout}${side.stderr}`)

  fx.git('switch', '-q', 'node/calc')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(3))
  fx.git('add', 'src/calc.py')
  const main = fx.commit('-m', 'main implementation change', '--trailer', 'Spec-OK: calc')
  assert.equal(main.status, 0, `${main.stdout}${main.stderr}`)
  const before = fx.git('rev-parse', 'HEAD')
  const conflict = fx.runGit({}, 'merge', 'side-conflict')
  assert.notEqual(conflict.status, 0, 'fixture merge unexpectedly avoided its conflict')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(4))
  fx.git('add', 'src/calc.py')

  const rejected = fx.commit('-m', 'resolve conflicting implementations')
  const output = `${rejected.stdout}${rejected.stderr}`
  assert.notEqual(rejected.status, 0, `resolved merge with side debt unexpectedly landed:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.ok(existsSync(join(fx.root, '.git', 'MERGE_HEAD')), 'rejection discarded MERGE_HEAD')
  assert.match(fx.git('diff', '--cached', '--', 'src/calc.py'), /return 4/)
  assert.match(output, /git merge --continue/)
  assert.match(output, /git merge --abort/)
  return { fx, before }
}

test('a rejected conflict merge preserves resolution and succeeds through merge --continue after a spec repair', () => {
  const { fx, before } = rejectedConflictMerge()
  const spec = join(fx.root, '.spec', 'project', 'calc', 'spec.md')
  writeFileSync(spec, NODE.replace('The calculation contract.', 'The merged calculation contract.'))
  fx.git('add', spec)

  const continued = fx.runGit({ GIT_EDITOR: 'true' }, 'merge', '--continue')
  assert.equal(continued.status, 0, `merge --continue did not recover after the spec repair:\n${continued.stdout}${continued.stderr}`)
  assert.notEqual(fx.git('rev-parse', 'HEAD'), before)
  assert.equal(fx.git('rev-list', '--parents', '-n', '1', 'HEAD').split(' ').length, 3, 'continued result is not a two-parent merge')
  assert.ok(!existsSync(join(fx.root, '.git', 'MERGE_HEAD')))
  assert.equal(fx.lint().status, 0)
})

test('a rejected conflict merge can be aborted back to its exact pre-merge state', () => {
  const { fx, before } = rejectedConflictMerge()
  const aborted = fx.runGit({}, 'merge', '--abort')
  assert.equal(aborted.status, 0, `${aborted.stdout}${aborted.stderr}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.equal(readFileSync(join(fx.root, 'src', 'calc.py'), 'utf8'), SOURCE(3))
  assert.equal(fx.git('status', '--porcelain'), '')
  assert.ok(!existsSync(join(fx.root, '.git', 'MERGE_HEAD')))
})

test('a merge-authored conflict resolution hunk enters the pending and HEAD anchor window', () => {
  const fx = fixture()
  fx.git('switch', '-qc', 'readme-side')
  writeFileSync(join(fx.root, 'README.md'), 'side text\n')
  fx.git('add', 'README.md')
  fx.git('commit', '-qm', 'side readme')
  fx.git('switch', '-q', 'node/calc')
  writeFileSync(join(fx.root, 'README.md'), 'main text\n')
  fx.git('add', 'README.md')
  const main = fx.commit('-m', 'main readme')
  assert.equal(main.status, 0, `${main.stdout}${main.stderr}`)
  const before = fx.git('rev-parse', 'HEAD')
  const conflict = fx.runGit({}, 'merge', 'readme-side')
  assert.notEqual(conflict.status, 0, 'README fixture did not conflict')
  writeFileSync(join(fx.root, 'README.md'), 'resolved text\n')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(777))
  fx.git('add', 'README.md', 'src/calc.py')

  const rejected = fx.commit('-m', 'resolve readme and alter calculation')
  const output = `${rejected.stdout}${rejected.stderr}`
  assert.notEqual(rejected.status, 0, `merge-authored anchor hunk was invisible in pending lint:\n${output}`)
  assert.equal(fx.git('rev-parse', 'HEAD'), before)
  assert.match(output, /anchor-drift.*src\/calc\.py#apply_rate/)

  const landed = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'resolve readme and alter calculation')
  assert.equal(landed.status, 0, `${landed.stdout}${landed.stderr}`)
  const head = fx.lint()
  assert.notEqual(head.status, 0, `merge-authored anchor hunk disappeared after landing:\n${head.stdout}${head.stderr}`)
  assert.match(`${head.stdout}${head.stderr}`, /anchor-drift/)
})

test('a clean no-ff merge does not charge transported code already answered with its spec', () => {
  const fx = fixture()
  fx.git('switch', '-qc', 'answered-side')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  writeFileSync(join(fx.root, '.spec', 'project', 'calc', 'spec.md'), NODE.replace('The calculation contract.', 'The calculation contract now returns two.'))
  fx.git('add', 'src/calc.py', '.spec/project/calc/spec.md')
  const answered = fx.commit('-m', 'change contract and implementation together')
  assert.equal(answered.status, 0, `${answered.stdout}${answered.stderr}`)
  fx.git('switch', '-q', 'node/calc')

  const merged = fx.runGit({}, 'merge', '--no-ff', 'answered-side', '-m', 'merge answered side')
  assert.equal(merged.status, 0, `clean merge was charged for transported side content:\n${merged.stdout}${merged.stderr}`)
  assert.equal(fx.lint().status, 0)
})

test('a mixed combined hunk does not charge an adjacent side-inherited anchor line', () => {
  const fx = fixture()
  const source = join(fx.root, 'src', 'calc.py')
  const spec = join(fx.root, '.spec', 'project', 'calc', 'spec.md')
  const code = (governed: number, neighbor: number) =>
    `def apply_rate(): return ${governed}\ndef neighbor(): return ${neighbor}\n`
  writeFileSync(source, code(1, 1))
  fx.git('add', source)
  const seeded = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '--amend', '--no-edit')
  assert.equal(seeded.status, 0, `${seeded.stdout}${seeded.stderr}`)

  fx.git('switch', '-qc', 'answered-side')
  writeFileSync(source, code(2, 1))
  writeFileSync(spec, NODE.replace('The calculation contract.', 'The calculation contract now returns two.'))
  fx.git('add', source, spec)
  const answered = fx.commit('-m', 'answer side anchor change')
  assert.equal(answered.status, 0, `${answered.stdout}${answered.stderr}`)

  fx.git('switch', '-q', 'node/calc')
  writeFileSync(source, code(1, 3))
  fx.git('add', source)
  const main = fx.commit('-m', 'change ungoverned neighbor on target')
  assert.equal(main.status, 0, `${main.stdout}${main.stderr}`)
  fx.runGit({}, 'merge', '--no-ff', '--no-commit', 'answered-side')
  assert.ok(existsSync(join(fx.root, '.git', 'MERGE_HEAD')), 'fixture did not stop before the merge commit')
  writeFileSync(source, code(2, 777))
  fx.git('add', source)

  const merged = fx.commit('-m', 'author only the ungoverned neighbor in merge')
  assert.equal(merged.status, 0, `side-inherited anchor line was widened to its mixed combined hunk:\n${merged.stdout}${merged.stderr}`)
  assert.equal(fx.lint().status, 0)
})

test('pending lint handles more than 16 MiB of governed tracked text without aggregate buffering', () => {
  const fx = fixture()
  writeFileSync(join(fx.root, 'src', 'large.txt'), 'x'.repeat(17 * 1024 * 1024))
  fx.git('add', 'src/large.txt')
  const seeded = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'seed large governed text')
  assert.equal(seeded.status, 0, `${seeded.stdout}${seeded.stderr}`)
  writeFileSync(join(fx.root, 'README.md'), 'large corpus candidate\n')
  fx.git('add', 'README.md')

  const result = fx.commit('-m', 'lint candidate over large corpus')
  assert.equal(result.status, 0, `pending lint overflowed on governed text:\n${result.stdout}${result.stderr}`)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /maxBuffer|ERR_CHILD_PROCESS_STDIO_MAXBUFFER/)
})

test('commit -a, message reuse, explicit git-dir, and GIT_INDEX_FILE all reach the candidate gate', () => {
  const attempt = (kind: string, prepare: (fx: Fixture) => ReturnType<typeof spawnSync>) => {
    const fx = fixture()
    writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
    const result = prepare(fx)
    const output = `${result.stdout}${result.stderr}`
    assert.notEqual(result.status, 0, `${kind} escaped the candidate gate:\n${output}`)
    assert.match(output, /anchor-drift/, `${kind} failed for a reason other than anchor judgment`)
  }

  attempt('commit -a', (fx) => fx.commit('-am', 'tracked candidate'))
  attempt('commit -C HEAD', (fx) => { fx.git('add', 'src/calc.py'); return fx.commit('-C', 'HEAD') })
  attempt('--git-dir/--work-tree', (fx) => {
    fx.git('add', 'src/calc.py')
    return fx.runGit({}, '--git-dir=.git', '--work-tree=.', 'commit', '-m', 'explicit git dir')
  })
  attempt('GIT_INDEX_FILE', (fx) => {
    const index = join(fx.root, '.git', 'candidate-index')
    fx.runGit({ GIT_INDEX_FILE: index }, 'read-tree', 'HEAD')
    fx.runGit({ GIT_INDEX_FILE: index }, 'add', 'src/calc.py')
    return fx.runGit({ GIT_INDEX_FILE: index }, 'commit', '-m', 'alternate index')
  })
})

test('a squash final commit is judged as its own candidate', () => {
  const fx = fixture()
  fx.git('switch', '-qc', 'squashed-side')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  const side = fx.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'side code')
  assert.equal(side.status, 0)
  fx.git('switch', '-q', 'node/calc')
  fx.git('merge', '--squash', 'squashed-side')

  const rejected = fx.commit('-m', 'squashed candidate')
  assert.notEqual(rejected.status, 0, `${rejected.stdout}${rejected.stderr}`)
  assert.match(`${rejected.stdout}${rejected.stderr}`, /anchor-drift/)
  const declared = fx.commit('-m', 'squashed candidate', '--trailer', 'Spec-OK: calc')
  assert.equal(declared.status, 0, `${declared.stdout}${declared.stderr}`)
})

test('cherry-pick and rebase keep baseline local coverage while landed HEAD lint catches the debt', () => {
  const cherry = fixture()
  cherry.git('switch', '-qc', 'picked-side')
  writeFileSync(join(cherry.root, 'src', 'calc.py'), SOURCE(2))
  cherry.git('add', 'src/calc.py')
  assert.equal(cherry.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'picked code').status, 0)
  const picked = cherry.git('rev-parse', 'HEAD')
  cherry.git('switch', '-q', 'node/calc')
  const pick = cherry.runGit({ SPEXCODE_GATE_TRACE: '1' }, 'cherry-pick', picked)
  assert.equal(pick.status, 0, `${pick.stdout}${pick.stderr}`)
  assert.doesNotMatch(`${pick.stdout}${pick.stderr}`, /spex spec lint/)
  assert.notEqual(cherry.lint().status, 0, 'CI/HEAD fallback missed cherry-picked debt')

  const rebased = fixture()
  const base = rebased.git('rev-parse', 'HEAD')
  rebased.git('switch', '-qc', 'upstream')
  writeFileSync(join(rebased.root, 'README.md'), 'upstream\n')
  rebased.git('add', 'README.md')
  assert.equal(rebased.commit('-m', 'advance upstream').status, 0)
  rebased.git('switch', '-qc', 'rebased-side', base)
  writeFileSync(join(rebased.root, 'src', 'calc.py'), SOURCE(3))
  rebased.git('add', 'src/calc.py')
  assert.equal(rebased.commitEnv({ SPEXCODE_SKIP_LINT: '1' }, '-m', 'rebased code').status, 0)
  const rebase = rebased.runGit({ SPEXCODE_GATE_TRACE: '1' }, 'rebase', 'upstream')
  assert.equal(rebase.status, 0, `${rebase.stdout}${rebase.stderr}`)
  assert.doesNotMatch(`${rebase.stdout}${rebase.stderr}`, /spex spec lint/)
  assert.notEqual(rebased.lint().status, 0, 'CI/HEAD fallback missed rebased debt')
})

test('a clone without hooks keeps baseline local coverage and HEAD lint catches its commit', () => {
  const source = fixture()
  const clone = mkdtempSync(join(tmpdir(), 'spex-commit-gate-clone-'))
  execFileSync('git', ['clone', '-q', source.root, clone])
  execFileSync('git', ['-C', clone, 'config', 'user.email', 'clone@example.com'])
  execFileSync('git', ['-C', clone, 'config', 'user.name', 'Clone Probe'])
  writeFileSync(join(clone, 'src', 'calc.py'), SOURCE(2))
  execFileSync('git', ['-C', clone, 'add', 'src/calc.py'])
  execFileSync('git', ['-C', clone, 'commit', '-qm', 'unhooked drift'])
  const lint = spawnSync(join(source.root, 'node_modules', '.bin', 'spex'), ['spec', 'lint'], {
    cwd: clone,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(source.root, 'node_modules', '.bin')}:${process.env.PATH}` },
  })
  assert.notEqual(lint.status, 0, `HEAD lint missed unhooked clone debt:\n${lint.stdout}${lint.stderr}`)
})

test('a stale arm never turns branch, tag, fetch, or reset-to-ancestor into a lint gate', () => {
  const fx = fixture()
  writeFileSync(join(fx.root, 'README.md'), 'advance before stale arm\n')
  fx.git('add', 'README.md')
  assert.equal(fx.commit('-m', 'advance head').status, 0)
  const advanced = fx.git('rev-parse', 'HEAD')
  const gpg = join(fx.root, 'reject-signing')
  writeFileSync(gpg, '#!/bin/sh\nexit 1\n')
  chmodSync(gpg, 0o755)
  fx.git('config', 'gpg.program', gpg)
  fx.git('config', 'commit.gpgsign', 'true')
  writeFileSync(join(fx.root, 'src', 'calc.py'), SOURCE(2))
  fx.git('add', 'src/calc.py')
  assert.notEqual(fx.commit('-m', 'leave stale arm').status, 0)

  const env = { SPEXCODE_GATE_TRACE: '1' }
  for (const [name, args] of [
    ['branch', ['branch', 'noise-branch']],
    ['tag', ['tag', 'noise-tag']],
  ] as const) {
    const result = fx.runGit(env, ...args)
    assert.equal(result.status, 0, `${name}: ${result.stdout}${result.stderr}`)
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /spex spec lint|anchor-drift/)
  }
  const bare = mkdtempSync(join(tmpdir(), 'spex-commit-gate-remote-'))
  execFileSync('git', ['init', '--bare', '-q', bare])
  fx.git('remote', 'add', 'probe', bare)
  const fetched = fx.runGit(env, 'fetch', 'probe')
  assert.equal(fetched.status, 0, `${fetched.stdout}${fetched.stderr}`)
  assert.doesNotMatch(`${fetched.stdout}${fetched.stderr}`, /spex spec lint|anchor-drift/)

  const reset = fx.runGit(env, 'reset', '--hard', 'HEAD^')
  assert.equal(reset.status, 0, `${reset.stdout}${reset.stderr}`)
  assert.notEqual(fx.git('rev-parse', 'HEAD'), advanced)
  assert.doesNotMatch(`${reset.stdout}${reset.stderr}`, /spex spec lint|anchor-drift/)
})
