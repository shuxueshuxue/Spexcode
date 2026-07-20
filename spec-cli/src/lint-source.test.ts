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
  specBody = '# project\n',
  args: string[] = ['spec', 'lint'],
  extraConfig: Record<string, unknown> = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'spex-source-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  mkdirSync(join(root, '.spec/project'), { recursive: true })
  writeFileSync(join(root, '.spec/project/spec.md'), `---\ntitle: project\n---\n${specBody}`)
  writeFileSync(join(root, 'spexcode.json'), JSON.stringify({ lint, ...extraConfig }) + '\n')
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
  const result = spawnSync(TSX, [CLI, ...args], { cwd: root, encoding: 'utf8' })
  return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` }
}

function altitudeFixture(
  files: Record<string, Content>,
  token: string,
  lint: Record<string, unknown> = {},
  identifierExtensions: string[] = [],
) {
  return fixture(files, {
    governedRoots: ['.'],
    testGlobs: [],
    ...lint,
  }, {}, `# project\n\n${token} ${token} ${token}\n`, ['doctor'], {
    doctor: { altitude: { sizeable: 0, dense: 1, identifierExtensions } },
  })
}

function breadthFiles(children: number): Record<string, Content> {
  return Object.fromEntries(Array.from({ length: children }, (_, i) => [
    `.spec/project/child-${i}/spec.md`,
    `---\ntitle: child-${i}\n---\n# child-${i}\n`,
  ]))
}

test('fresh Python repo treats every tracked regular text file as source without semantic guesses', { skip }, () => {
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
    '.plugins/note.txt': 'SpexCode-owned plugin data\n',
    'spexcode.local.json': '{}\n',
  }, { governedRoots: ['.'] }, { 'src/untracked.py': 'VALUE = 1\n' })
  assert.equal(code, 0, out)
  for (const included of ['src/app.py', 'src/pkg/util.py', 'vendor/dependency.py', 'generated/models.py', 'build/output.py', 'docs/example.py', 'README.md', 'pyproject.toml', 'assets/logo.svg'])
    assert.match(out, new RegExp(`coverage: no spec governs: ${included.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `${included} is tracked text and must be source: ${out}`)
  for (const excluded of ['untracked.py', 'test_helper.py', 'util_test.py', 'conftest.py', 'blob.dat', '.plugins/note.txt', 'spexcode.local.json', 'spexcode.json', '.spec/project/spec.md'])
    assert.ok(!out.includes(`no spec governs: ${excluded}`), `${excluded} must stay outside the candidate set: ${out}`)
  assert.ok(!out.includes('governing NOTHING'), out)
})

test('TypeScript uses the same default; explicit exclude globs alone remove docs/build paths', { skip }, () => {
  const files = {
    'src/index.ts': 'export const answer = 42\n',
    'src/view.tsx': 'export const View = () => null\n',
    'src/index.test.ts': 'export {}\n',
    'src/view.spec.tsx': 'export {}\n',
    'test/helper.ts': 'export {}\n',
    'dist/bundle.js': 'generated\n',
    'docs/example.ts': 'export {}\n',
  }
  const defaults = fixture(files)
  assert.equal(defaults.code, 0, defaults.out)
  for (const included of ['src/index.ts', 'src/view.tsx', 'dist/bundle.js', 'docs/example.ts'])
    assert.ok(defaults.out.includes(`no spec governs: ${included}`), `${included} must be default source: ${defaults.out}`)
  for (const testPath of ['src/index.test.ts', 'src/view.spec.tsx', 'test/helper.ts'])
    assert.ok(!defaults.out.includes(`no spec governs: ${testPath}`), `${testPath} is removed by testGlobs: ${defaults.out}`)

  const configured = fixture(files, { governedRoots: ['.'], sourceExcludeGlobs: ['dist/**', 'docs/**'] })
  assert.equal(configured.code, 0, configured.out)
  for (const included of ['src/index.ts', 'src/view.tsx']) assert.ok(configured.out.includes(`no spec governs: ${included}`), configured.out)
  for (const excluded of ['dist/bundle.js', 'docs/example.ts']) assert.ok(!configured.out.includes(`no spec governs: ${excluded}`), configured.out)
})

test('extensions lower into the same include union before explicit exclude/test subtraction', { skip }, () => {
  const { code, out } = fixture({
    'src/app.py': 'VALUE = 1\n',
    'src/ignore.py': 'VALUE = 2\n',
    'src/pkg/util_test.py': 'def test_util():\n    pass\n',
    'src/engine.rs': 'fn main() {}\n',
    'tools/build.rs': 'fn build() {}\n',
    'README.md': '# app\n',
  }, {
    governedRoots: ['.'],
    sourceIncludeGlobs: ['tools/*.rs'],
    sourceExtensions: ['.py'],
    sourceExcludeGlobs: ['ignore.py'],
    testGlobs: ['*_test.py'],
  })
  assert.equal(code, 0, out)
  for (const included of ['src/app.py', 'tools/build.rs']) assert.ok(out.includes(`no spec governs: ${included}`), out)
  for (const excluded of ['src/ignore.py', 'src/pkg/util_test.py', 'src/engine.rs', 'README.md'])
    assert.ok(!out.includes(`no spec governs: ${excluded}`), `${excluded} must be removed by the compiled policy: ${out}`)
})

test('an intentionally empty include set warns with every active policy knob', { skip }, () => {
  const { code, out } = fixture({
    'README.md': '# docs only\n',
    'config/project.toml': '[project]\n',
    'docs/guide.py': 'print("sample")\n',
  }, { governedRoots: ['.'], sourceIncludeGlobs: [], sourceExcludeGlobs: ['docs/**'], testGlobs: [] })
  assert.equal(code, 0, out)
  assert.match(out, /coverage: governing NOTHING/)
  assert.match(out, /governedRoots \[\.\]/)
  assert.match(out, /includes \[\]/)
  assert.match(out, /sourceExcludeGlobs \[docs\/\*\*\]/)
  assert.match(out, /testGlobs \[\]/)
  assert.match(out, /under the "lint" key/)
  assert.match(out, /sourceIncludeGlobs/)
  assert.match(out, /sourceExcludeGlobs/)
  assert.match(out, /testGlobs/)
  assert.match(out, /sourceExtensions/)
})

test('spec lint omits altitude even when the body trips the doctor proxy', { skip }, () => {
  const body = Array.from({ length: 55 }, (_, i) => `${i + 1}. callThing(foo_bar)`).join('\n')
  const { code, out } = fixture({ 'src/foo.py': 'VALUE = 1\n' }, { governedRoots: ['.'], testGlobs: [] }, {}, body)
  assert.equal(code, 0, out)
  assert.doesNotMatch(out, /altitude/i)
})

test('breadth is reported only by doctor with per-node evidence and repair', { skip }, () => {
  const files = breadthFiles(8)
  const lint = fixture(files, { governedRoots: [], maxChildren: 99 }, {}, '# project\n', ['spec', 'lint'], {
    doctor: { breadth: { maxChildren: 8 } },
  })
  assert.equal(lint.code, 0, lint.out)
  assert.doesNotMatch(lint.out, /breadth/i)

  const doctor = fixture(files, { governedRoots: [], maxChildren: 99 }, {}, '# project\n', ['doctor'], {
    doctor: { breadth: { maxChildren: 8 } },
  })
  assert.equal(doctor.code, 0, doctor.out)
  assert.match(doctor.out, /breadth\s+: 1 finding\(s\)/)
  assert.match(doctor.out, /project\s+: tree fan-out may be missing a natural grouping layer/)
  assert.match(doctor.out, /evidence\s+: 8 direct child nodes \(>= 8\)/)
  assert.match(doctor.out, /repair\s+: .*regroup workflow/)
  assert.match(doctor.out, /RETIRED key\s+: `lint\.maxChildren` is no longer read.*`doctor\.breadth\.maxChildren`/)
})

test('doctor breadth ignores retired lint threshold and obeys only doctor config', { skip }, () => {
  const { code, out } = fixture(breadthFiles(8), { governedRoots: [], maxChildren: 1 }, {}, '# project\n', ['doctor'], {
    doctor: { breadth: { maxChildren: 9 } },
  })
  assert.equal(code, 0, out)
  assert.match(out, /breadth\s+: healthy/)
  assert.doesNotMatch(out, /tree fan-out may be missing/)
  assert.match(out, /`lint\.maxChildren` is no longer read/)
})

test('settings guide assigns breadth only to doctor and retires the lint key', { skip }, () => {
  const { code, out } = fixture({}, {}, {}, '# project\n', ['guide', 'settings'])
  assert.equal(code, 0, out)
  assert.match(out, /doctor\.breadth\s+the one tree-breadth hypothesis/)
  assert.match(out, /`lint\.maxChildren` is RETIRED and no longer read.*doctor\.breadth\.maxChildren/s)
  assert.doesNotMatch(out, /lint\.maxChildren\s+breadth budget/)
})

test('doctor altitude recognises a tracked Python basename without configured identifier extensions', { skip }, () => {
  const { code, out } = altitudeFixture({ 'src/foo.py': 'VALUE = 1\n' }, 'foo.py')
  assert.equal(code, 0, out)
  assert.match(out, /altitude\s+: 1 finding\(s\)/)
  assert.match(out, /project\s+: body reads like mechanics rather than a contract/)
})

test('doctor altitude recognises an extensionless tracked source basename', { skip }, () => {
  const { code, out } = altitudeFixture({ Makefile: 'all:\n\ttrue\n' }, 'Makefile')
  assert.equal(code, 0, out)
  assert.match(out, /altitude\s+: 1 finding\(s\)/)
})

test('doctor altitude does not recognise a basename removed by source exclusions', { skip }, () => {
  const { code, out } = altitudeFixture({
    'src/main.rs': 'fn main() {}\n',
    'generated/foo.py': 'VALUE = 1\n',
  }, 'foo.py', { sourceExcludeGlobs: ['generated/**'] })
  assert.equal(code, 0, out)
  assert.match(out, /altitude\s+: healthy/)
})

test('doctor altitude identifierExtensions lowers to wildcard filename candidates', { skip }, () => {
  const { code, out } = altitudeFixture(
    { 'src/main.rs': 'fn main() {}\n' },
    'untracked.legacy',
    {},
    ['.legacy'],
  )
  assert.equal(code, 0, out)
  assert.match(out, /altitude\s+: 1 finding\(s\)/)
})
