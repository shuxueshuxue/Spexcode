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
