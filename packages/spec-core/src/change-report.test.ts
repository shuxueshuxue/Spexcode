import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { buildChangeReport } from './change-report.js'

const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

test('buildChangeReport is deterministic and includes spec, code, and parent request', () => {
  const root = mkdtempSync(join(tmpdir(), 'spec-report-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'test')
  mkdirSync(join(root, '.spec', 'alpha'), { recursive: true })
  writeFileSync(join(root, '.spec', 'alpha', 'spec.md'), '---\ntitle: Alpha\ndesc: First contract\nstatus: active\ncode:\n  - src/app.ts\n---\n# Alpha\nold\n')
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'app.ts'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'initial')
  writeFileSync(join(root, '.spec', 'alpha', 'spec.md'), '---\ntitle: Alpha\ndesc: First contract\nstatus: active\ncode:\n  - src/app.ts\n---\n# Alpha\nnew\n')
  writeFileSync(join(root, 'src', 'app.ts'), 'one\ntwo\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'change')
  const report = buildChangeReport({ repoRoot: root, rev: 'HEAD', parentSessionId: 'parent-1', note: 'why' })
  assert.match(report, /alpha/)
  assert.match(report, /First contract/)
  assert.match(report, /src\/app\.ts \(\+1 −0\)/)
  assert.match(report, /parent session parent-1/)
  assert.equal(report, buildChangeReport({ repoRoot: root, rev: 'HEAD', parentSessionId: 'parent-1', note: 'why' }))
})

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'spec-report-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.invalid')
  git(root, 'config', 'user.name', 'test')
  git(root, 'config', 'commit.gpgsign', 'false')
  mkdirSync(join(root, '.spec', 'alpha'), { recursive: true })
  mkdirSync(join(root, 'packages', 'lib'), { recursive: true })
  writeFileSync(join(root, '.spec', 'alpha', 'spec.md'), '---\ntitle: Alpha\ndesc: First contract\nstatus: active\ncode:\n  - packages/lib/a.ts\nrelated:\n  - packages/lib/b.ts\n---\n# Alpha\nbody line one\n')
  writeFileSync(join(root, 'packages', 'lib', 'a.ts'), 'one\n')
  writeFileSync(join(root, 'packages', 'lib', 'b.ts'), 'bee\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'initial')
  return root
}

test('an ack stamp is an empty commit, so it reports as ack/eval only', () => {
  const root = scratch()
  git(root, 'commit', '-q', '--allow-empty', '-m', 'ack: Spec-OK alpha', '--trailer', 'Spec-OK: alpha')
  assert.match(buildChangeReport({ repoRoot: root, rev: 'HEAD' }), /ack\/eval only, no body change \(empty=true\)/)
})

test('a code change under packages/ is a real change, never ack/eval only', () => {
  const root = scratch()
  writeFileSync(join(root, 'packages', 'lib', 'a.ts'), 'one\ntwo\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'code under packages/')
  const report = buildChangeReport({ repoRoot: root, rev: 'HEAD' })
  assert.doesNotMatch(report, /ack\/eval only/)
  assert.match(report, /file packages\/lib\/a\.ts \(\+1 −0\), governed by node alpha/)
})

test('a moved code: claim is reported as frontmatter, not as body prose', () => {
  const root = scratch()
  writeFileSync(join(root, '.spec', 'alpha', 'spec.md'), '---\ntitle: Alpha\ndesc: First contract\nstatus: retired\ncode:\n  - packages/lib/c.ts\nrelated:\n  - packages/lib/b.ts\n  - packages/lib/d.ts\n---\n# Alpha\nbody line one\n')
  writeFileSync(join(root, 'packages', 'lib', 'c.ts'), 'sea\n')
  writeFileSync(join(root, 'packages', 'lib', 'd.ts'), 'dee\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'governance move')
  const report = buildChangeReport({ repoRoot: root, rev: 'HEAD' })
  const frontmatter = report.split('\n').find((line) => line.startsWith('status: ')) ?? ''
  assert.match(frontmatter, /\+code: packages\/lib\/c\.ts/)
  assert.match(frontmatter, /-code: packages\/lib\/a\.ts/)
  assert.match(frontmatter, /\+related: packages\/lib\/d\.ts/)
  assert.match(frontmatter, /status: active → retired/)
  // the governance rows must not also arrive as body lines, where they read as edited prose
  assert.doesNotMatch(report, /^[+-] {2}- packages\/lib\//m)
})

test('an evals.ndjson-only change stays ack/eval only', () => {
  const root = scratch()
  writeFileSync(join(root, '.spec', 'alpha', 'evals.ndjson'), '{"scenario":"s","score":1}\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'eval reading')
  assert.match(buildChangeReport({ repoRoot: root, rev: 'HEAD' }), /ack\/eval only, no body change \(empty=true\)/)
})
