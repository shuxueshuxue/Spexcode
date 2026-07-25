import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  const commitEnv = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync('git', ['-C', root, 'commit', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH}`, ...env },
  })
  const commit = (...args: string[]) => commitEnv({}, ...args)
  return { root, git, commit, commitEnv }
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
})
