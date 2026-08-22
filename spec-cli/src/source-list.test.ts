import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { listSourceDir, SOURCE_LIST_MAX_ENTRIES } from './source-list.js'
import { SourceReadError } from './source-read.js'
import { DEFAULT_TEST_GLOBS, type SourcePolicy } from './source-files.js'

const POLICY: SourcePolicy = {
  sourceIncludeGlobs: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
  sourceExcludeGlobs: [],
  testGlobs: DEFAULT_TEST_GLOBS,
}
const ROOTS = ['app/src', 'lib/src']

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
const skip = !gitAvailable() && 'git not available'

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'spex-source-list-'))
  execFileSync('git', ['-C', root, 'init', '-q'])
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

const names = (root: string, dir: string, policy = POLICY, roots = ROOTS) =>
  listSourceDir(root, dir, policy, roots).entries.map((e) => `${e.kind === 'dir' ? '/' : ''}${e.name}`)

test('the empty dir lists the way down to the governed roots, and nothing beside them', { skip }, () => {
  const root = fixture({
    'app/src/a.ts': 'a\n', 'lib/src/b.ts': 'b\n',
    'other/c.ts': 'c\n', 'README.md': '#\n', 'node_modules/pkg/i.js': 'x\n', '.git/HEAD': 'ref\n',
  })
  // `other/` holds a real source file but no governed root, so it is not a way down to anything.
  assert.deepEqual(names(root, ''), ['/app', '/lib'])
  assert.deepEqual(names(root, 'app'), ['/src'])
})

test('a file appears exactly when /api/source could open it', { skip }, () => {
  const root = fixture({
    'app/src/a.ts': 'a\n',
    'app/src/styles.css': 'body{}\n',          // outside the include globs — unreadable, so unlisted
    'app/src/a.test.ts': 'test\n',             // a test glob — same
    'app/src/nested/d.ts': 'd\n',
  })
  assert.deepEqual(names(root, 'app/src'), ['/nested', 'a.ts'])
})

test('directories lead, then files, each alphabetical', { skip }, () => {
  const root = fixture({
    'app/src/z.ts': 'z\n', 'app/src/a.ts': 'a\n',
    'app/src/beta/x.ts': 'x\n', 'app/src/alpha/y.ts': 'y\n',
  })
  assert.deepEqual(names(root, 'app/src'), ['/alpha', '/beta', 'a.ts', 'z.ts'])
})

test('dot-directories and node_modules are never offered as somewhere to browse', { skip }, () => {
  const root = fixture({
    'app/src/a.ts': 'a\n', 'app/src/.cache/x.ts': 'x\n', 'app/src/node_modules/dep/y.js': 'y\n',
  })
  assert.deepEqual(names(root, 'app/src'), ['a.ts'])
})

test('an escape is refused before anything is read, and refused loudly', { skip }, () => {
  const root = fixture({ 'app/src/a.ts': 'a\n' })
  for (const bad of ['/etc', '../..', 'app/../../etc', '/etc/passwd']) {
    assert.throws(() => listSourceDir(root, bad, POLICY, ROOTS), (e: unknown) => {
      assert.ok(e instanceof SourceReadError)
      assert.equal((e as SourceReadError).status, 400)
      return true
    }, bad)
  }
  // a `..` that normalises back INSIDE is legitimate — containment is resolved, not pattern-matched.
  assert.deepEqual(names(root, 'app/src/../src'), ['a.ts'])
})

test('a directory outside every governed root is declined, not silently empty', { skip }, () => {
  const root = fixture({ 'app/src/a.ts': 'a\n', 'other/c.ts': 'c\n' })
  assert.throws(() => listSourceDir(root, 'other', POLICY, ROOTS), (e: unknown) => {
    assert.ok(e instanceof SourceReadError)
    assert.equal((e as SourceReadError).status, 404)
    return true
  })
  // a missing directory is the same honest refusal, and it never leaks the host path
  assert.throws(() => listSourceDir(root, 'app/src/nope', POLICY, ROOTS), (e: unknown) => {
    assert.ok(e instanceof SourceReadError)
    assert.equal((e as SourceReadError).status, 404)
    assert.ok(!(e as Error).message.includes(root))
    return true
  })
})

test('`.` as a governed root means the whole project', { skip }, () => {
  const root = fixture({ 'anywhere/a.ts': 'a\n', 'README.md': '#\n' })
  assert.deepEqual(names(root, '', POLICY, ['.']), ['/anywhere'])
  assert.deepEqual(names(root, 'anywhere', POLICY, ['.']), ['a.ts'])
})

test('a swollen directory degrades into a capped list that says it was capped', { skip }, () => {
  const files: Record<string, string> = {}
  for (let i = 0; i < SOURCE_LIST_MAX_ENTRIES + 25; i++) files[`app/src/f${String(i).padStart(4, '0')}.ts`] = 'x\n'
  const root = fixture(files)
  const listing = listSourceDir(root, 'app/src', POLICY, ROOTS)
  assert.equal(listing.entries.length, SOURCE_LIST_MAX_ENTRIES)
  assert.equal(listing.truncated, true)
  // and an ordinary listing never claims truncation it did not do
  assert.equal(listSourceDir(fixture({ 'app/src/a.ts': 'a\n' }), 'app/src', POLICY, ROOTS).truncated, false)
})
