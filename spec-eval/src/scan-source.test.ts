import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, '..', '..', 'spec-cli', 'src', 'cli.ts')
const TSX = join(SRC, '..', 'node_modules', '.bin', 'tsx')

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
const skip = !gitAvailable() && 'git not available'

test('real eval lint shares tracked-text algebra and compiled extension compatibility', { skip }, () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-eval-source-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const node = (id: string, path: string) =>
    write(`.spec/project/${id}/spec.md`, `---\ntitle: ${id}\ncode:\n  - ${path}\n---\n# ${id}\n`)
  const lint = () => {
    const result = spawnSync(TSX, [CLI, 'eval', 'lint'], { cwd: root, encoding: 'utf8' })
    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` }
  }

  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('.spec/project/spec.md', '---\ntitle: project\n---\n# project\n')
  write('spexcode.json', JSON.stringify({ lint: { governedRoots: ['.'] } }) + '\n')
  for (const [id, path, content] of [
    ['python', 'src/app.py', 'VALUE = 1\n'],
    ['rust', 'src/lib.rs', 'pub fn value() {}\n'],
    ['backend', 'src/server.ts', 'export const value = 1\n'],
    ['frontend', 'src/View.jsx', 'export const View = () => null\n'],
    ['docs', 'README.md', '# docs\n'],
    ['config', 'pyproject.toml', '[project]\n'],
  ]) {
    write(path, content)
    node(id, path)
  }
  git('add', '-A')
  git('commit', '-qm', 'seed')

  const auto = lint()
  assert.equal(auto.code, 0, auto.out)
  for (const id of ['python', 'rust', 'backend', 'frontend', 'docs', 'config'])
    assert.match(auto.out, new RegExp(`eval-coverage: '${id}' governs source code`), auto.out)

  write('spexcode.json', JSON.stringify({ lint: {
    governedRoots: ['.'],
    sourceIncludeGlobs: ['src/*.ts', 'README.md'],
    sourceExtensions: ['rs'],
    sourceExcludeGlobs: ['server.ts', 'README.md'],
  } }) + '\n')
  git('add', 'spexcode.json')
  git('commit', '-qm', 'narrow source')
  const rustOnly = lint()
  assert.equal(rustOnly.code, 0, rustOnly.out)
  assert.match(rustOnly.out, /eval-coverage: 'rust' governs source code/)
  for (const id of ['python', 'backend', 'frontend', 'docs', 'config'])
    assert.ok(!rustOnly.out.includes(`eval-coverage: '${id}'`), rustOnly.out)
})
