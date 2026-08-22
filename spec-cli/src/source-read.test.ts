import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { readSourceSlice, SourceReadError, SOURCE_SLICE_MAX_BYTES } from './source-read.js'
import { DEFAULT_TEST_GLOBS, type SourcePolicy } from './source-files.js'

const POLICY: SourcePolicy = {
  sourceIncludeGlobs: null,
  sourceExcludeGlobs: [],
  testGlobs: DEFAULT_TEST_GLOBS,
}

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}
const skip = !gitAvailable() && 'git not available'

// isSourceFile consults the WORKTREE (is it a real text file), not the index, so a fixture only needs the
// bytes on disk — but a git dir keeps the fixture shaped like a real project.
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'spex-source-read-'))
  execFileSync('git', ['-C', root, 'init', '-q'])
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), body)
  }
  return root
}

const LINES = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n'

test('a whole small file comes back in one slice, flagged eof', { skip }, () => {
  const root = fixture({ 'src/a.ts': 'export const a = 1\n' })
  const s = readSourceSlice(root, 'src/a.ts', POLICY)
  assert.equal(s.text, 'export const a = 1\n')
  assert.equal(s.size, 19)
  assert.equal(s.bytes, 19)
  assert.equal(s.eof, true)
  assert.equal(s.path, 'src/a.ts')
})

test('a window reports the file size, not the window size', { skip }, () => {
  const root = fixture({ 'src/big.ts': LINES })
  const s = readSourceSlice(root, 'src/big.ts', POLICY, 0, 64)
  assert.equal(s.size, LINES.length)
  assert.ok(s.bytes <= 64)
  assert.equal(s.eof, false)
})

test('a window ends on a line boundary and the next offset resumes exactly there', { skip }, () => {
  const root = fixture({ 'src/big.ts': LINES })
  let offset = 0, joined = ''
  for (let guard = 0; guard < 100; guard++) {
    const s = readSourceSlice(root, 'src/big.ts', POLICY, offset, 97)   // deliberately not a line multiple
    if (!s.eof) assert.ok(s.text.endsWith('\n'), 'a non-final slice must stop after a newline')
    joined += s.text
    offset += s.bytes
    if (s.eof) break
  }
  assert.equal(joined, LINES, 'paging through the windows reassembles the file byte-for-byte')
})

test('a single line longer than the window is still handed over', { skip }, () => {
  const root = fixture({ 'src/min.js': 'x'.repeat(500) + '\n' })
  const s = readSourceSlice(root, 'src/min.js', POLICY, 0, 100)
  assert.equal(s.bytes, 100, 'no newline to snap to — the raw window is returned rather than nothing')
  assert.equal(s.eof, false)
})

test('reading past the end is an empty eof slice, not an error', { skip }, () => {
  const root = fixture({ 'src/a.ts': 'a\n' })
  const s = readSourceSlice(root, 'src/a.ts', POLICY, 999)
  assert.equal(s.bytes, 0)
  assert.equal(s.text, '')
  assert.equal(s.eof, true)
})

test('the limit is clamped to the slice ceiling', { skip }, () => {
  const root = fixture({ 'src/big.ts': LINES })
  const s = readSourceSlice(root, 'src/big.ts', POLICY, 0, SOURCE_SLICE_MAX_BYTES * 10)
  assert.equal(s.text, LINES, 'the whole file fits under the ceiling here')
  assert.equal(s.eof, true)
})

test('escaping the worktree is refused before any read', { skip }, () => {
  const root = fixture({ 'src/a.ts': 'a\n' })
  for (const bad of ['../etc/passwd', '/etc/passwd', '..']) {
    assert.throws(() => readSourceSlice(root, bad, POLICY), (e: unknown) => {
      assert.ok(e instanceof SourceReadError)
      assert.equal((e as SourceReadError).status, 400)
      return true
    }, `expected ${bad} to be refused`)
  }
})

test('the spec tree and spexcode config are not source files', { skip }, () => {
  const root = fixture({ '.spec/x/spec.md': '# x\n', 'spexcode.json': '{}\n' })
  for (const hidden of ['.spec/x/spec.md', 'spexcode.json']) {
    assert.throws(() => readSourceSlice(root, hidden, POLICY), (e: unknown) =>
      e instanceof SourceReadError && (e as SourceReadError).status === 404)
  }
})

test('a test file is excluded by the same policy the coverage walk uses', { skip }, () => {
  const root = fixture({ 'src/a.test.ts': 'test()\n' })
  assert.throws(() => readSourceSlice(root, 'src/a.test.ts', POLICY), (e: unknown) =>
    e instanceof SourceReadError && (e as SourceReadError).status === 404)
})

test('a missing file is a 404, not a crash', { skip }, () => {
  const root = fixture({ 'src/a.ts': 'a\n' })
  assert.throws(() => readSourceSlice(root, 'src/gone.ts', POLICY), (e: unknown) =>
    e instanceof SourceReadError && (e as SourceReadError).status === 404)
})
