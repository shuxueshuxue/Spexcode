import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { parseRelation, anchorHitCommits, tsAstExtractor } from './anchors.js'

// [[code-anchor]] — the structured relation grammar (ONE parser for code: and related:) and the
// multi-selector hit engine: selectors on one base file are OR'd, a commit counts ONCE, and each hit
// names exactly the selectors whose units its hunks intersected.

const SRC = dirname(fileURLToPath(import.meta.url))

// ---- parseRelation: grouping + structural problems (pure, no fs) ----

test('bare entries pass through untouched — one entry per path, no selectors, no problems', () => {
  const r = parseRelation(['src/a.ts', 'src/b.ts'], 'related')
  assert.deepEqual(r.entries, [{ path: 'src/a.ts', selectors: [] }, { path: 'src/b.ts', selectors: [] }])
  assert.deepEqual(r.problems, [])
})

test('several selectors on ONE base file group into one scoped entry (order kept)', () => {
  const r = parseRelation(['src/a.ts#f', 'src/a.ts#g', 'src/a.ts#h'], 'code')
  assert.deepEqual(r.entries, [{ path: 'src/a.ts', selectors: ['f', 'g', 'h'] }])
  assert.deepEqual(r.problems, [])
})

test('selectors on DIFFERENT files stay distinct base paths (one-govern is the caller’s verdict)', () => {
  const r = parseRelation(['src/a.ts#f', 'src/b.ts#g'], 'code')
  assert.equal(r.entries.length, 2)
  assert.deepEqual(r.problems, [])
})

test('a duplicate selector is a loud problem', () => {
  const r = parseRelation(['src/a.ts#f', 'src/a.ts#f'], 'code')
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /selector 'src\/a\.ts#f' twice/)
  assert.deepEqual(r.entries, [{ path: 'src/a.ts', selectors: ['f'] }])
})

test('a duplicate bare entry is a loud problem too', () => {
  const r = parseRelation(['src/a.ts', 'src/a.ts'], 'related')
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /'src\/a\.ts' twice/)
  assert.equal(r.entries.length, 1)
})

test('mixing bare with selectors on one base path is a loud problem', () => {
  const r = parseRelation(['src/a.ts', 'src/a.ts#f'], 'code')
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /mixes bare 'src\/a\.ts'/)
})

test('no selector-count cap on either relation — any finite number on one base file is legal', () => {
  const five = ['src/a.ts#f', 'src/a.ts#g', 'src/a.ts#h', 'src/a.ts#i', 'src/a.ts#j']
  const code = parseRelation(five, 'code')
  assert.deepEqual(code.problems, [])
  assert.deepEqual(code.entries, [{ path: 'src/a.ts', selectors: ['f', 'g', 'h', 'i', 'j'] }])
  assert.deepEqual(parseRelation(five, 'related').problems, [])
})

test('a selector on a glob is a loud problem (a selector scopes ONE real file)', () => {
  const r = parseRelation(['src/*.ts#f'], 'code')
  assert.equal(r.problems.length, 1)
  assert.match(r.problems[0], /glob/)
})

// ---- anchorHitCommits: historical file revisions, OR semantics, per-commit dedupe ----

function gitAvailable(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true } catch { return false }
}

test('multi-selector hits across file revisions: a commit counts ONCE and unparseable is conservative for all', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchors-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  mkdirSync(join(root, 'src'))
  const unit = (name: string, body: string) => `export function ${name}() {\n  return ${body}\n}\n`
  writeFileSync(join(root, 'src/x.ts'), unit('f', '1') + unit('g', '2') + unit('other', '3'))
  g('add', '-A'); g('commit', '-qm', 'v1')
  // c2 touches f only
  writeFileSync(join(root, 'src/x.ts'), unit('f', '10') + unit('g', '2') + unit('other', '3'))
  g('add', '-A'); g('commit', '-qm', 'c2'); const c2 = g('rev-parse', 'HEAD')
  // c3 touches BOTH f and g — must still be ONE hit row
  writeFileSync(join(root, 'src/x.ts'), unit('f', '100') + unit('g', '200') + unit('other', '3'))
  g('add', '-A'); g('commit', '-qm', 'c3'); const c3 = g('rev-parse', 'HEAD')
  // c4 touches other only — no hit
  writeFileSync(join(root, 'src/x.ts'), unit('f', '100') + unit('g', '200') + unit('other', '300'))
  g('add', '-A'); g('commit', '-qm', 'c4'); const c4 = g('rev-parse', 'HEAD')
  // c5 makes the file unparseable — a conservative hit for every selector
  writeFileSync(join(root, 'src/x.ts'), 'export function f( {{{\n')
  g('add', '-A'); g('commit', '-qm', 'c5'); const c5 = g('rev-parse', 'HEAD')

  const x = tsAstExtractor(SRC) // resolves the host typescript from this package, content comes from the fixture's git
  const hits = await anchorHitCommits(root, [c2, c3, c4, c5], 'src/x.ts', ['f', 'g'], x)
  assert.deepEqual(hits.map((h) => ({ commit: h.commit, selectors: h.selectors, unparseable: !!h.unparseable })), [
    { commit: c2, selectors: ['f'], unparseable: false },
    { commit: c3, selectors: ['f', 'g'], unparseable: false }, // both units in one commit — one row
    { commit: c5, selectors: ['f', 'g'], unparseable: true },  // c4 (outside both units) is absent
  ])
})
