import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

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
  const addTax = fx.commit('-m', 'add tax contract')
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
