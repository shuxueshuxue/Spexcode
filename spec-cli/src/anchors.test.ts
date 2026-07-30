import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { parseRelation, anchorHitCommits, anchorHitQueries, diffHunkRanges, selectorsHitRanges, tsAstExtractor } from './anchors.js'

// [[code-anchor]] — the structured relation grammar (ONE parser for code: and related:) and the
// multi-selector hit engine: selectors on one base file are OR'd, a commit counts ONCE, and each hit
// names exactly the selectors whose units its hunks intersected.

const SRC = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SRC, '..', '..')

test('ordinary hunk ranges preserve old-side deletions below line one', () => {
  const patch = '@@ -4,2 +3,0 @@ removed beta\n'
  assert.deepEqual(diffHunkRanges(patch, 'old'), [[4, 5]])
  assert.deepEqual(diffHunkRanges(patch, 'new'), [])
  assert.deepEqual(selectorsHitRanges(
    [{ name: 'beta', kind: 'function', start: 4, end: 5 }],
    ['beta'],
    diffHunkRanges(patch, 'old'),
  ), ['beta'])
})

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

// ---- ts-ast readiness: governed repository -> loud unverified skip ----

test('ts-ast resolves the governed repository typescript', () => {
  const x = tsAstExtractor(ROOT)

  assert.equal(x.ready(), true)
  assert.deepEqual(x.extract('export function applyRate() {\n  return 1\n}\n', 'src/calc.ts'), [
    { name: 'applyRate', kind: 'function', start: 1, end: 3 },
  ])
})

test('ts-ast reports a loud unverified skip without throwing when the governed repository has no typescript', () => {
  const adopter = mkdtempSync(join(tmpdir(), 'spex-adopter-no-ts-'))
  const x = tsAstExtractor(adopter)

  let ready: ReturnType<typeof x.ready>
  assert.doesNotThrow(() => { ready = x.ready() })
  assert.notEqual(ready!, true, 'missing extractors must never be reported as ready')
  assert.match(ready! as string, /JS-family anchors were skipped and remain unverified/)
  assert.match(ready! as string, /npm i -D typescript@5/)
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

  const x = tsAstExtractor(ROOT) // resolves this governed repo's TypeScript; content comes from the fixture's git
  const hits = await anchorHitCommits(root, [c2, c3, c4, c5].map((commit) => ({ commit, historicalPath: 'src/x.ts', parents: [] })), ['f', 'g'], [x])
  assert.deepEqual(hits.map((h) => ({ commit: h.commit, selectors: h.selectors, unparseable: !!h.unparseable })), [
    { commit: c2, selectors: ['f'], unparseable: false },
    { commit: c3, selectors: ['f', 'g'], unparseable: false }, // both units in one commit — one row
    { commit: c5, selectors: ['f', 'g'], unparseable: true },  // c4 (outside both units) is absent
  ])
})

test('anchor query batch reads one shared immutable window for distinct selectors', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-batch-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const oldPath = process.env.PATH
  try {
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/x.ts'), 'export function f() { return 1 }\nexport function g() { return 2 }\n')
    g('add', '-A'); g('commit', '-qm', 'v1')
    writeFileSync(join(root, 'src/x.ts'), 'export function f() { return 10 }\nexport function g() { return 20 }\n')
    g('add', '-A'); g('commit', '-qm', 'change both'); const change = g('rev-parse', 'HEAD')
    const bin = mkdtempSync(join(tmpdir(), 'spex-git-count-'))
    const count = join(bin, 'count')
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf x >> ${count}\nexec /usr/bin/git \"$@\"\n`)
    chmodSync(join(bin, 'git'), 0o755)
    process.env.PATH = `${bin}:${oldPath}`
    const x = tsAstExtractor(ROOT)
    const win = [{ commit: change, historicalPath: 'src/x.ts', parents: [] }]
    const hits = await anchorHitQueries(root, [{ win, symbols: ['f'] }, { win, symbols: ['g'] }], [x])
    assert.deepEqual(hits.map((rows) => rows.map((row) => row.selectors)), [[['f']], [['g']]])
    assert.equal(readFileSync(count, 'utf8').length, 4, 'one format probe, two object batches, and one shared hunk batch')
    rmSync(bin, { recursive: true, force: true })
  } finally {
    process.env.PATH = oldPath
    rmSync(root, { recursive: true, force: true })
  }
})

test('a repeated read costs the MOVEMENT, and a commit git was never asked about is always asked', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-repeat-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const oldPath = process.env.PATH
  const bin = mkdtempSync(join(tmpdir(), 'spex-git-argv-'))
  const argv = join(bin, 'argv')
  const unit = (name: string, body: string) => `export function ${name}() {\n  return ${body}\n}\n`
  const calls = () => readFileSync(argv, 'utf8').split('\n').filter(Boolean)
  const hunkQueries = () => calls().filter((line) => line.includes(' log ')).length
  const blobReads = () => calls().filter((line) => /cat-file --batch$/.test(line)).length
  try {
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/repeat.ts'), unit('f', '1') + unit('g', '2'))
    g('add', '-A'); g('commit', '-qm', 'v1')
    writeFileSync(join(root, 'src/repeat.ts'), unit('f', '11') + unit('g', '2'))
    g('add', '-A'); g('commit', '-qm', 'f moves'); const first = g('rev-parse', 'HEAD')
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${argv}\nexec /usr/bin/git "$@"\n`)
    chmodSync(join(bin, 'git'), 0o755)
    process.env.PATH = `${bin}:${oldPath}`
    const x = tsAstExtractor(ROOT)
    const event = (commit: string) => ({ commit, historicalPath: 'src/repeat.ts', parents: [] })

    writeFileSync(argv, '')
    const cold = await anchorHitQueries(root, [{ win: [event(first)], symbols: ['f', 'g'] }], [x])
    assert.deepEqual(cold[0].map((row) => row.selectors), [['f']])
    assert.equal(hunkQueries(), 1, 'the cold read asks for the window it has not read')

    // Same window, same process: every image and ordinary hunk is a permanent property of that commit.
    writeFileSync(argv, '')
    const repeat = await anchorHitQueries(root, [{ win: [event(first)], symbols: ['f', 'g'] }], [x])
    assert.deepEqual(repeat, cold, 'the reused verdict must be the measured one')
    assert.equal(hunkQueries(), 0, 'a repeated read re-derives no immutable hunk')
    assert.equal(blobReads(), 0, 'and re-streams no immutable blob')

    // The movement, and only the movement, is asked for — and its verdict is never masked by the memo.
    writeFileSync(join(root, 'src/repeat.ts'), unit('f', '11') + unit('g', '22'))
    g('add', '-A'); g('commit', '-qm', 'g moves'); const second = g('rev-parse', 'HEAD')
    writeFileSync(argv, '')
    const advanced = await anchorHitQueries(root, [{ win: [event(first), event(second)], symbols: ['f', 'g'] }], [x])
    assert.deepEqual(advanced[0].map((row) => ({ commit: row.commit, selectors: row.selectors })), [
      { commit: first, selectors: ['f'] },
      { commit: second, selectors: ['g'] },
    ])
    assert.equal(hunkQueries(), 1, 'one query for the advance, not one per window commit')
  } finally {
    process.env.PATH = oldPath
    rmSync(bin, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

// A `.gitattributes` `diff` attribute is read from the WORKING TREE even for historical diffs, so it can flip
// whether Git emits `@@` for a commit at all. That made the anchor verdict a function of mutable state outside
// the commit — silently unblockable by an attribute edit, and unmemoizable by (commit,path). The seam pins its
// interpretation instead, so this asserts the property the memo needs: one commit, one answer, whatever the
// attribute says, and a cached answer identical to a fresh module's.
test('an anchor verdict is invariant under a dirty .gitattributes diff-attribute flip', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-attr-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  try {
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/x.py'), 'def f():\n    return 1\n\ndef g():\n    return 2\n')
    g('add', '-A'); g('commit', '-qm', 'v1')
    writeFileSync(join(root, 'src/x.py'), 'def f():\n    return 11\n\ndef g():\n    return 2\n')
    g('add', '-A'); g('commit', '-qm', 'f moves'); const moved = g('rev-parse', 'HEAD')
    const win = [{ commit: moved, historicalPath: 'src/x.py', parents: [{ commit: g('rev-parse', 'HEAD~1'), historicalPath: 'src/x.py' }] }]
    const ask = async (mod: typeof import('./anchors.js')) =>
      (await mod.anchorHitQueries(root, [{ win, symbols: ['f'] }], mod.extractors(root)))[0].map((row) => row.selectors)

    // `-diff` marks the path binary for diff purposes: Git prints "Binary files … differ", no `@@`.
    writeFileSync(join(root, '.gitattributes'), 'src/x.py -diff\n')
    const suppressed = await ask(await import('./anchors.js'))
    // flip the same dirty attribute to its opposite and ask the SAME process again
    writeFileSync(join(root, '.gitattributes'), 'src/x.py diff\n')
    const flipped = await ask(await import('./anchors.js'))
    // a module with empty memos is the oracle: whatever it says, the memoized answer must equal it
    const fresh = await ask(await import(`./anchors.js?attr-oracle=${moved}`))

    assert.deepEqual(flipped, suppressed, 'one commit must have ONE anchor verdict, whatever .gitattributes says')
    assert.deepEqual(flipped, fresh, 'a memoized verdict must equal a fresh module\'s on the same commit and path')
    assert.deepEqual(fresh, [['f']], 'the anchored unit did move, so the verdict is a hit — an attribute may not hide it')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// A commit id is not immutable interpretation: `refs/replace` swaps the object it names, and a graft or an
// unshallow changes its parents. The reusable hunk fact is therefore keyed on the ORDERED IMAGES that decide
// it, so these two controls must each move the answer rather than serve the previous one.
test('a replaced commit object and a regrafted parent are different hunk facts, not one cached fact', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-identity-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const unit = (name: string, body: string) => `export function ${name}() {\n  return ${body}\n}\n`
  try {
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/i.ts'), unit('f', '1') + unit('g', '2'))
    g('add', '-A'); g('commit', '-qm', 'v1'); const v1 = g('rev-parse', 'HEAD')
    writeFileSync(join(root, 'src/i.ts'), unit('f', '11') + unit('g', '2'))
    g('add', '-A'); g('commit', '-qm', 'f moves'); const movesF = g('rev-parse', 'HEAD')
    writeFileSync(join(root, 'src/i.ts'), unit('f', '11') + unit('g', '22'))
    g('add', '-A'); g('commit', '-qm', 'g moves'); const movesG = g('rev-parse', 'HEAD')
    const mod = await import('./anchors.js')
    const x = tsAstExtractor(ROOT)
    const ask = async (event: any) => (await mod.anchorHitQueries(root, [{ win: [event], symbols: ['f'] }], [x]))[0].map((r) => r.selectors)

    // (1) ordered PARENT identity, via a REAL graft. Git answers "what did this commit change" from its own
    //     parents, so the control has to move Git's parents — `replace --graft` does, and the event the index
    //     derives moves with it. Before: movesG against movesF changed only g. After the graft its parent is
    //     v1, where f moved too. A (commit,path) key would have served the first answer for the second.
    const askG = (parent: string) => ask({ commit: movesG, historicalPath: 'src/i.ts', parents: [{ commit: parent, historicalPath: 'src/i.ts' }] })
    const beforeGraft = await askG(movesF)
    g('replace', '--graft', movesG, v1)
    const afterGraft = await askG(v1)
    const freshGraft = (await (await import(`./anchors.js?graft-oracle=${movesG}`)).anchorHitQueries(
      root, [{ win: [{ commit: movesG, historicalPath: 'src/i.ts', parents: [{ commit: v1, historicalPath: 'src/i.ts' }] }], symbols: ['f'] }], [x]))[0].map((r: any) => r.selectors)
    assert.deepEqual(beforeGraft, [], 'against its real parent only g moved, so the f anchor is not hit')
    assert.deepEqual(afterGraft, freshGraft, 'after a real graft the memoized answer must equal a fresh module\'s')
    assert.deepEqual(afterGraft, [['f']], 'the grafted parent predates f moving, so f IS hit — a cached (commit,path) fact hid this')
    g('replace', '-d', movesG)

    // (2) IMAGE identity: `refs/replace` makes commit:path resolve to different bytes, and `cat-file
    //     --batch-check` follows it — so the resolved image oid, not the commit id, is the honest key. The
    //     stand-in is a SIBLING of v1 (never a descendant: replacing a commit by its own child is a cycle,
    //     and the oracle would be degenerate rather than a control).
    g('checkout', '-q', '-b', 'side', v1)
    writeFileSync(join(root, 'src/i.ts'), unit('f', '1') + unit('g', '22'))
    g('add', '-A'); g('commit', '-qm', 'sibling moves only g'); const sibling = g('rev-parse', 'HEAD')
    g('checkout', '-q', 'main')
    const askF = () => ask({ commit: movesF, historicalPath: 'src/i.ts', parents: [{ commit: v1, historicalPath: 'src/i.ts' }] })
    const before = await askF()
    g('replace', movesF, sibling)
    const after = await askF()
    const fresh = (await (await import(`./anchors.js?identity-oracle=${movesF}`)).anchorHitQueries(
      root, [{ win: [{ commit: movesF, historicalPath: 'src/i.ts', parents: [{ commit: v1, historicalPath: 'src/i.ts' }] }], symbols: ['f'] }], [x]))[0].map((r: any) => r.selectors)
    assert.deepEqual(before, [['f']], 'the original object moved f')
    assert.deepEqual(after, fresh, 'after refs/replace the memoized answer must equal a fresh module\'s')
    assert.deepEqual(after, [], 'the replacement object leaves f alone, so f is no longer hit — a commit-id key would have kept the old hit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Repo config decides hunk boundaries too — `diff.algorithm`, `diff.indentHeuristic` and
// `diff.interHunkContext` are all settable per repository and all move ranges on some inputs. Pinned, a
// same-process config flip must leave the verdict alone. (On these fixtures every algorithm agreed, so this
// asserts INVARIANCE; it is not a red-to-green pair, and is not presented as one.)
test('an anchor verdict is invariant under a same-process diff-config flip', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-config-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  try {
    g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src/c.py'), 'def f():\n    return 1\n\ndef tail():\n    return 9\n')
    g('add', '-A'); g('commit', '-qm', 'v1'); const v1 = g('rev-parse', 'HEAD')
    writeFileSync(join(root, 'src/c.py'), 'def f():\n    return 1\n\ndef f():\n    return 1\n\ndef tail():\n    return 9\n')
    g('add', '-A'); g('commit', '-qm', 'duplicate the block'); const dup = g('rev-parse', 'HEAD')
    const mod = await import('./anchors.js')
    const win = [{ commit: dup, historicalPath: 'src/c.py', parents: [{ commit: v1, historicalPath: 'src/c.py' }] }]
    const ask = async () => (await mod.anchorHitQueries(root, [{ win, symbols: ['f'] }], mod.extractors(root)))[0].map((r) => r.selectors)

    const verdicts: string[][][] = []
    for (const [algorithm, heuristic, inter] of [['myers', 'false', '0'], ['histogram', 'true', '3'], ['patience', 'false', '1'], ['minimal', 'true', '0']]) {
      g('config', 'diff.algorithm', algorithm)
      g('config', 'diff.indentHeuristic', heuristic)
      g('config', 'diff.interHunkContext', inter)
      verdicts.push(await ask())
    }
    const fresh = (await (await import(`./anchors.js?config-oracle=${dup}`)).anchorHitQueries(
      root, [{ win, symbols: ['f'] }], mod.extractors(root)))[0].map((r: any) => r.selectors)
    for (const v of verdicts) assert.deepEqual(v, verdicts[0], 'repo diff config must not move an anchor verdict')
    assert.deepEqual(verdicts[0], fresh, 'and the memoized verdict must equal a fresh module\'s under the flipped config')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('historical extractor memo stays stable across order and same-process repetition', { skip: !gitAvailable() && 'git not available' }, async () => {
  const source = 'export const f = <T>(x: T) => x\n'
  for (const order of [['src/same.tsx', 'src/same.ts'], ['src/same.ts', 'src/same.tsx']]) {
    const root = mkdtempSync(join(tmpdir(), 'spex-anchor-memo-key-'))
    const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
    try {
      g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
      mkdirSync(join(root, 'src'))
      for (const path of order) writeFileSync(join(root, path), source)
      g('add', '-A'); g('commit', '-qm', 'same bytes')
      const commit = g('rev-parse', 'HEAD')
      const x = tsAstExtractor(ROOT)
      for (const path of order) {
        const hits = await anchorHitCommits(root, [{ commit, historicalPath: path, parents: [] }], ['f'], [x])
        if (path.endsWith('.tsx')) assert.equal(hits[0]?.unparseable !== undefined, true, 'TSX must retain its parse error')
        else assert.equal(hits[0]?.unparseable, undefined, 'TS must not inherit the TSX memo result')
      }
      for (const path of [...order].reverse()) {
        const hits = await anchorHitCommits(root, [{ commit, historicalPath: path, parents: [] }], ['f'], [x])
        if (path.endsWith('.tsx')) assert.equal(hits[0]?.unparseable !== undefined, true, 'repeat TSX query must stay conservative')
        else assert.equal(hits[0]?.unparseable, undefined, 'repeat TS query must stay parseable')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
