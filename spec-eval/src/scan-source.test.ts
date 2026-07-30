import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

const SRC = dirname(fileURLToPath(import.meta.url))
const CLI = join(SRC, '..', '..', 'spec-cli', 'src', 'cli.ts')
const TSX = 'tsx'

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

test('real eval fallback inherits node anchors while explicit bare scenario code stays file-wide', { skip }, () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-eval-inherited-anchor-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const run = (...args: string[]) => {
    const result = spawnSync(TSX, [CLI, ...args], { cwd: root, encoding: 'utf8' })
    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` }
  }
  const source = (rate: number, helper: number) => `def apply_rate():\n    return ${rate}\n\ndef helper():\n    return ${helper}\n`

  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    write('.spec/project/spec.md', '---\ntitle: project\n---\n# project\n')
    write('.spec/project/calc/spec.md', '---\ntitle: calc\ncode: src/calc.py#apply_rate\n---\n# calc\n')
    write('.spec/project/calc/eval.md', [
      '---',
      'scenarios:',
      '  - name: inherited',
      '    tags: [cli]',
      '    description: inherited selector stays narrow',
      '    expected: only apply_rate stales this reading',
      '  - name: whole-file',
      '    tags: [cli]',
      '    code: src/calc.py',
      '    description: explicit bare code stays file-wide',
      '    expected: any calc.py change stales this reading',
      '---',
      '',
    ].join('\n'))
    write('src/calc.py', source(1, 2))
    git('add', '-A')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    write('.spec/project/calc/evals.ndjson', [
      JSON.stringify({ scenario: 'inherited', codeSha: base, ts: '2026-07-29T00:00:00.000Z' }),
      JSON.stringify({ scenario: 'whole-file', codeSha: base, ts: '2026-07-29T00:00:00.000Z' }),
      '',
    ].join('\n'))
    git('add', '.spec/project/calc/evals.ndjson')
    git('commit', '-qm', 'file base readings')

    write('src/calc.py', source(1, 20))
    git('add', 'src/calc.py')
    git('commit', '-qm', 'change helper only')
    const helperSpec = run('spec', 'lint')
    assert.equal(helperSpec.code, 0, helperSpec.out)
    assert.doesNotMatch(helperSpec.out, /anchor-drift/, helperSpec.out)
    const helperEval = run('eval', 'lint')
    assert.equal(helperEval.code, 0, helperEval.out)
    assert.doesNotMatch(helperEval.out, /scenario 'inherited'.*stale/, helperEval.out)
    assert.match(helperEval.out, /scenario 'whole-file'.*stale/, helperEval.out)

    write('src/calc.py', source(10, 20))
    git('add', 'src/calc.py')
    git('commit', '-qm', 'change anchored function')
    const anchoredSpec = run('spec', 'lint')
    assert.equal(anchoredSpec.code, 1, anchoredSpec.out)
    assert.match(anchoredSpec.out, /anchor-drift.*src\/calc\.py#apply_rate/, anchoredSpec.out)
    const anchoredEval = run('eval', 'lint')
    assert.equal(anchoredEval.code, 0, anchoredEval.out)
    assert.match(anchoredEval.out, /scenario 'inherited'.*stale/, anchoredEval.out)
    assert.match(anchoredEval.out, /scenario 'whole-file'.*stale/, anchoredEval.out)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('real changed eval lint proves its scope and fails loud when the base is unavailable', { skip }, () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-eval-changed-scope-'))
  const candidate = join(root, 'candidate')
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  const writeCandidate = (path: string, content: string) => {
    mkdirSync(dirname(join(candidate, path)), { recursive: true })
    writeFileSync(join(candidate, path), content)
  }
  const lint = () => {
    const result = spawnSync(TSX, [CLI, 'eval', 'lint', '--changed'], { cwd: candidate, encoding: 'utf8' })
    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` }
  }

  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  write('.spec/project/spec.md', '---\ntitle: project\n---\n# project\n')
  write('.spec/project/calc/spec.md', '---\ntitle: calc\ncode:\n  - src/calc.ts\n---\n# calc\n')
  write('.spec/project/calc/eval.md', '---\nscenarios:\n  - name: calc\n    tags: [cli]\n    description: add\n    expected: adds\n---\n')
  write('src/calc.ts', 'export const add = (a: number, b: number) => a + b\n')
  write('spexcode.json', JSON.stringify({ mainBranch: 'main', lint: { governedRoots: ['src'] } }) + '\n')
  git('add', '-A')
  git('commit', '-qm', 'seed')
  const base = git('rev-parse', 'HEAD')
  git('worktree', 'add', '-q', '-b', 'node/calc', candidate, 'main')
  writeCandidate('README.md', '# candidate\n')
  execFileSync('git', ['-C', candidate, 'add', 'README.md'])
  execFileSync('git', ['-C', candidate, 'commit', '-qm', 'candidate change'])
  writeCandidate('src/extra.ts', 'export const extra = true\n')

  const valid = lint()
  assert.equal(valid.code, 0, valid.out)
  assert.match(
    valid.out,
    new RegExp(`spex eval lint --changed scope: base=${base} paths=2 config=${candidate.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}/spexcode\\.json`),
    valid.out,
  )

  execFileSync('git', ['-C', candidate, 'mv', 'src/calc.ts', 'src/renamed.ts'])
  const renamed = lint()
  assert.equal(renamed.code, 0, renamed.out)
  assert.match(renamed.out, /paths=4/, renamed.out)
  assert.match(renamed.out, /eval-schema: 'calc'.*src\/calc\.ts/, renamed.out)

  unlinkSync(join(candidate, 'spexcode.json'))
  const defaults = lint()
  assert.equal(defaults.code, 0, defaults.out)
  assert.match(
    defaults.out,
    /paths=5 config=defaults/,
    defaults.out,
  )

  write('spexcode.json', JSON.stringify({ mainBranch: 'missing-main', lint: { governedRoots: ['src'] } }) + '\n')
  const missing = lint()
  assert.notEqual(missing.code, 0, missing.out)
  assert.match(missing.out, /cannot establish changed scope against 'missing-main'/, missing.out)
  assert.doesNotMatch(missing.out, /node\(s\) flagged/, missing.out)

  write('spexcode.local.json', '{ malformed\n')
  write('spexcode.json', JSON.stringify({ mainBranch: 'main', lint: { governedRoots: ['src'] } }) + '\n')
  const malformed = lint()
  assert.notEqual(malformed.code, 0, malformed.out)
  assert.match(malformed.out, /malformed .*spexcode\.local\.json/, malformed.out)
  assert.doesNotMatch(malformed.out, /node\(s\) flagged/, malformed.out)
})
