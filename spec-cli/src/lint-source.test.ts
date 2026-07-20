import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
const skip = !gitAvailable() && 'git not available'

type Content = string | Uint8Array

function fixture(
  files: Record<string, Content>,
  lint: Record<string, unknown> = { governedRoots: ['.'] },
  untracked: Record<string, Content> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'spex-source-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  mkdirSync(join(root, '.spec/project'), { recursive: true })
  writeFileSync(join(root, '.spec/project/spec.md'), '---\ntitle: project\n---\n# project\n')
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ lint }) + '\n')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  git('add', '-A')
  git('commit', '-qm', 'seed')
  for (const [path, content] of Object.entries(untracked)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const result = spawnSync(TSX, [CLI, 'spec', 'lint'], { cwd: root, encoding: 'utf8' })
  return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` }
}

test('fresh Python repo discovers product source and excludes tests, docs, vendor, generated/build output, metadata, and binary', { skip }, () => {
  const { code, out } = fixture({
    'src/app.py': 'def main():\n    return 0\n',
    'src/pkg/util.py': 'VALUE = 1\n',
    'src/test_helper.py': 'def helper():\n    pass\n',
    'src/pkg/util_test.py': 'def test_util():\n    pass\n',
    'tests/conftest.py': 'VALUE = 1\n',
    'vendor/dependency.py': 'VALUE = 1\n',
    'generated/models.py': 'VALUE = 1\n',
    'build/output.py': 'VALUE = 1\n',
    'docs/example.py': 'VALUE = 1\n',
    'README.md': '# Python app\n',
    'pyproject.toml': '[project]\nname = "app"\n',
    'assets/logo.svg': '<svg/>\n',
    'assets/blob.dat': new Uint8Array([1, 0, 2, 3]),
  }, { governedRoots: ['.'] }, { 'src/untracked.py': 'VALUE = 1\n' })
  assert.equal(code, 0, out)
  assert.match(out, /coverage: no spec governs: src\/app\.py/)
  assert.match(out, /coverage: no spec governs: src\/pkg\/util\.py/)
  for (const excluded of ['untracked.py', 'test_helper.py', 'util_test.py', 'conftest.py', 'dependency.py', 'models.py', 'output.py', 'example.py', 'README.md', 'pyproject.toml', 'logo.svg', 'blob.dat'])
    assert.ok(!out.includes(excluded), `${excluded} must not be default source: ${out}`)
  assert.ok(!out.includes('governing NOTHING'), out)
})

test('fresh TypeScript repo uses the same default policy', { skip }, () => {
  const { code, out } = fixture({
    'src/index.ts': 'export const answer = 42\n',
    'src/view.tsx': 'export const View = () => null\n',
    'src/index.test.ts': 'export {}\n',
    'src/view.spec.tsx': 'export {}\n',
    'test/helper.ts': 'export {}\n',
    'dist/bundle.js': 'generated\n',
    'docs/example.ts': 'export {}\n',
  })
  assert.equal(code, 0, out)
  assert.match(out, /coverage: no spec governs: src\/index\.ts/)
  assert.match(out, /coverage: no spec governs: src\/view\.tsx/)
  for (const excluded of ['index.test.ts', 'view.spec.tsx', 'test/helper.ts', 'dist/bundle.js', 'docs/example.ts'])
    assert.ok(!out.includes(excluded), `${excluded} must not be default source: ${out}`)
})

test('explicit extension/test overrides remain exact and tolerate dotted extensions plus slash-less globs', { skip }, () => {
  const { code, out } = fixture({
    'src/app.py': 'VALUE = 1\n',
    'src/pkg/util_test.py': 'def test_util():\n    pass\n',
    'src/engine.rs': 'fn main() {}\n',
  }, { governedRoots: ['src'], sourceExtensions: ['.py'], testGlobs: ['*_test.py'] })
  assert.equal(code, 0, out)
  assert.match(out, /coverage: no spec governs: src\/app\.py/)
  assert.ok(!out.includes('src/engine.rs'), out)
  assert.ok(!out.includes('util_test.py'), `slash-less test glob must match at any depth: ${out}`)
})

test('an empty default candidate set warns with the active policy and both repair knobs', { skip }, () => {
  const { code, out } = fixture({
    'README.md': '# docs only\n',
    'config/project.toml': '[project]\n',
    'docs/guide.py': 'print("sample")\n',
  })
  assert.equal(code, 0, out)
  assert.match(out, /coverage: governing NOTHING/)
  assert.match(out, /governedRoots \[\.\]/)
  assert.match(out, /default tracked-text policy/)
  assert.match(out, /under the "lint" key/)
  assert.match(out, /sourceExtensions/)
})
