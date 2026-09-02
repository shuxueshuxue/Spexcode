import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { tsxBin } from './tsx-bin.js'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = tsxBin(join(SRC, '..'))

function fixture(extraCode = '') {
  const root = mkdtempSync(join(tmpdir(), 'spex-lint-json-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  mkdirSync(join(root, '.spec/project'), { recursive: true })
  mkdirSync(join(root, 'src/a'), { recursive: true })
  mkdirSync(join(root, 'src/z'), { recursive: true })
  writeFileSync(join(root, '.spec/project/spec.md'), `---\ntitle: project\ncode:\n  - src/z/covered.ts${extraCode}\n---\n# project\n`)
  writeFileSync(join(root, '.spec/spexcode.json'), '{"lint":{"governedRoots":["src/z","src/a"],"testGlobs":[]}}\n')
  writeFileSync(join(root, 'src/z/covered.ts'), 'export const covered = true\n')
  writeFileSync(join(root, 'src/a/uncovered.ts'), 'export const uncovered = true\n')
  git('add', '-A')
  git('commit', '-qm', 'seed')
  const result = spawnSync(process.execPath, [TSX, CLI, 'spec', 'lint', '--json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' },
  })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

test('spec lint JSON is a versioned report with raw source candidates and structured coverage findings', () => {
  const result = fixture()
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.equal(report.projection, 'spex.spec-lint.report')
  assert.equal(report.schemaVersion, 1)
  assert.deepEqual(report.sourceFiles, ['src/a/uncovered.ts', 'src/z/covered.ts'])
  assert.deepEqual(report.findings.map((finding: { level: string; rule: string; file?: string }) => ({
    level: finding.level, rule: finding.rule, file: finding.file,
  })), [{ level: 'warn', rule: 'coverage', file: 'src/a/uncovered.ts' }])
})

test('spec lint JSON preserves the blocking error exit while still emitting the full report', () => {
  const result = fixture('\n  - src/missing.ts')
  assert.equal(result.code, 1)
  assert.equal(result.stderr, '')
  const report = JSON.parse(result.stdout)
  assert.deepEqual(report.sourceFiles, ['src/a/uncovered.ts', 'src/z/covered.ts'])
  assert.ok(report.findings.some((finding: { level: string; rule: string; file?: string }) =>
    finding.level === 'error' && finding.rule === 'integrity' && finding.file === 'src/missing.ts'))
  assert.ok(report.findings.some((finding: { rule: string; file?: string }) =>
    finding.rule === 'coverage' && finding.file === 'src/a/uncovered.ts'))
})
