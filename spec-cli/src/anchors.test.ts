import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { parseRelation, anchorHitCommits, anchorHitQueries, diffHunkRanges, selectorsHitRanges, extractors, extractorFor, resolveAnchor, blobShaForContent, extractCachedBlob, resetBlobExtractionCacheForTests } from '@spexcode/spec-core'
import { historyEventCachePathForTests } from '@spexcode/spec-core'

const freshAnchors = (tag: string) =>
  import(new URL(`anchors.js?${tag}`, import.meta.resolve('@spexcode/spec-core')).href) as Promise<typeof import('@spexcode/spec-core')>
type AnchorQueryModule = Pick<typeof import('@spexcode/spec-core'), 'anchorHitQueries'>

// [[code-anchor]] — the structured relation grammar (ONE parser for code: and related:) and the
// multi-selector hit engine: selectors on one base file are OR'd, a commit counts ONCE, and each hit
// names exactly the selectors whose units its hunks intersected.

const SRC = dirname(fileURLToPath(import.meta.url))
const ROOT = join(SRC, '..', '..')

function removeFixtureLedger(root: string): void {
  try { rmSync(dirname(historyEventCachePathForTests(root)), { recursive: true, force: true }) } catch {}
}

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

const treeSitter = (extension = 'ts') => extractorFor(extractors(ROOT), extension)!

test('Tree-sitter is shipped with SpexCode rather than resolved from the governed project', async () => {
  const adopter = mkdtempSync(join(tmpdir(), 'spex-adopter-no-compiler-'))
  const x = extractorFor(extractors(adopter), 'ts')!
  assert.equal(await x.ready(), true)
  assert.deepEqual(await x.extract('export function applyRate() {\n  return 1\n}\n', 'src/calc.ts'), [
    { name: 'applyRate', kind: 'function', start: 1, end: 3 },
  ])
  rmSync(adopter, { recursive: true, force: true })
})

test('live anchor extraction cache reuses a blob and invalidates on a changed blob', async () => {
  resetBlobExtractionCacheForTests()
  let calls = 0
  const x = {
    id: 'counting', claims: () => true, ready: () => true,
    memoKey: (filename: string) => filename,
    extract: async (content: string) => { calls++; return [{ name: content, kind: 'function', start: 1, end: 1 }] },
  }
  const first = 'one\n', second = 'two\n'
  const a = await extractCachedBlob(first, 'src/a.ts', x, blobShaForContent(first))
  const b = await extractCachedBlob(first, 'src/a.ts', x, blobShaForContent(first))
  assert.deepEqual(a, b)
  assert.equal(calls, 1)
  await extractCachedBlob(second, 'src/a.ts', x, blobShaForContent(second))
  assert.equal(calls, 2)
})

test('the Tree-sitter registry extracts the shared declaration vocabulary for every shipped language', async () => {
  const regs = extractors(ROOT)
  const cases: Array<[string, string, string, unknown[]]> = [
    ['ts', 'export class Box { get() { return 1 } }\nexport function run() { return 2 }\n', 'src/box.ts', [
      { name: 'Box', kind: 'class', start: 1, end: 1 },
      { name: 'Box.get', kind: 'method', start: 1, end: 1 },
      { name: 'run', kind: 'function', start: 2, end: 2 },
    ]],
    ['tsx', 'export function View() { return <div /> }\n', 'src/view.tsx', [
      { name: 'View', kind: 'function', start: 1, end: 1 },
    ]],
    ['py', 'class Box:\n    def get(self):\n        return 1\n\ndef run():\n    return 2\n', 'src/box.py', [
      { name: 'Box', kind: 'class', start: 1, end: 3 },
      { name: 'Box.get', kind: 'method', start: 2, end: 3 },
      { name: 'run', kind: 'function', start: 5, end: 6 },
    ]],
    ['go', 'type (\n  Command struct{}\n  Runner interface{}\n)\nfunc (c *Command) SetArgs() {}\nfunc Run() {}\n', 'src/command.go', [
      { name: 'Command', kind: 'struct', start: 2, end: 2 },
      { name: 'Runner', kind: 'interface', start: 3, end: 3 },
      { name: 'Command.SetArgs', kind: 'method', start: 5, end: 5 },
      { name: 'Run', kind: 'function', start: 6, end: 6 },
    ]],
    ['rs', 'struct Command;\nimpl Command { fn set_args(&self) {} }\nfn run() {}\n', 'src/command.rs', [
      { name: 'Command', kind: 'struct', start: 1, end: 1 },
      { name: 'Command.set_args', kind: 'method', start: 2, end: 2 },
      { name: 'run', kind: 'function', start: 3, end: 3 },
    ]],
    ['java', 'class Command { Command() {} void run() {} void run(int x) {} }\n', 'src/Command.java', [
      { name: 'Command', kind: 'class', start: 1, end: 1 },
      { name: 'Command.constructor', kind: 'method', start: 1, end: 1 },
      { name: 'Command.run', kind: 'method', start: 1, end: 1 },
      { name: 'Command.run', kind: 'method', start: 1, end: 1 },
    ]],
    ['rb', 'class Command\n  def run; end\n  def self.go; end\nend\ndef Foo.stop; end\n', 'src/command.rb', [
      { name: 'Command', kind: 'class', start: 1, end: 4 },
      { name: 'Command.run', kind: 'method', start: 2, end: 2 },
      { name: 'Command.go', kind: 'method', start: 3, end: 3 },
      { name: 'Foo.stop', kind: 'method', start: 5, end: 5 },
    ]],
  ]
  for (const [ext, source, filename, expected] of cases) {
    const x = extractorFor(regs, ext)
    assert.ok(x, `missing extractor for .${ext}`)
    assert.equal(await x!.ready(), true)
    assert.deepEqual(await x!.extract(source, filename), expected, ext)
  }
  const java = extractorFor(regs, 'java')!
  const units = await java.extract(cases.find(([ext]) => ext === 'java')![1] as string, 'src/Command.java')
  assert.deepEqual(resolveAnchor(units, 'Command.run'), { ambiguous: 2 })
})

test('Tree-sitter extractors reject syntax recovery instead of returning partial anchors', async () => {
  const regs = extractors(ROOT)
  const malformed: Array<[string, string]> = [
    ['ts', 'export function x( {'],
    ['tsx', 'export function x() { return <div>;'],
    ['py', 'def x(:\n pass'],
    ['go', 'func x( {'],
    ['rs', 'fn x( {'],
    ['java', 'class X { void x( {'],
    ['rb', 'def x( end'],
  ]
  for (const [ext, source] of malformed) {
    const x = extractorFor(regs, ext)!
    await assert.rejects(async () => {
      await x.extract(source, `broken.${ext}`)
    }, /Tree-sitter syntax errors/, ext)
  }
})

test('Tree-sitter parses the current governed TypeScript source before anchor resolution', async () => {
  const x = treeSitter()
  await assert.doesNotReject(async () => {
    await x.extract(
      readFileSync(join(ROOT, 'packages/spec-core/src/git.ts'), 'utf8'),
      'packages/spec-core/src/git.ts',
    )
  })
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

  const x = treeSitter() // content comes from the fixture's git; the parser is the production registry row
  const hits = await anchorHitCommits(root, [c2, c3, c4, c5].map((commit) => ({ commit, historicalPath: 'src/x.ts', parents: [] })), ['f', 'g'], [x])
  assert.deepEqual(hits.map((h) => ({ commit: h.commit, selectors: h.selectors, unparseable: !!h.unparseable })), [
    { commit: c2, selectors: ['f'], unparseable: false },
    { commit: c3, selectors: ['f', 'g'], unparseable: false }, // both units in one commit — one row
    { commit: c5, selectors: ['f', 'g'], unparseable: true },  // c4 (outside both units) is absent
  ])
  removeFixtureLedger(root)
  rmSync(root, { recursive: true, force: true })
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
    historyEventCachePathForTests(root) // production reaches anchors after the shared ledger path is known
    const bin = mkdtempSync(join(tmpdir(), 'spex-git-count-'))
    const count = join(bin, 'count')
    writeFileSync(join(bin, 'git'), `#!/bin/sh\nprintf x >> ${count}\nexec /usr/bin/git \"$@\"\n`)
    chmodSync(join(bin, 'git'), 0o755)
    process.env.PATH = `${bin}:${oldPath}`
    const x = treeSitter()
    const win = [{ commit: change, historicalPath: 'src/x.ts', parents: [] }]
    const hits = await anchorHitQueries(root, [{ win, symbols: ['f'] }, { win, symbols: ['g'] }], [x])
    assert.deepEqual(hits.map((rows) => rows.map((row) => row.selectors)), [[['f']], [['g']]])
    assert.equal(readFileSync(count, 'utf8').length, 3, 'two object batches and one shared hunk batch after ledger discovery')
    rmSync(bin, { recursive: true, force: true })
  } finally {
    process.env.PATH = oldPath
    removeFixtureLedger(root)
    rmSync(root, { recursive: true, force: true })
  }
})

test('a repeated read costs the MOVEMENT, and a commit git was never asked about is always asked', { skip: !gitAvailable() && 'git not available' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-repeat-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const oldPath = process.env.PATH
  const bin = mkdtempSync(join(tmpdir(), 'spex-git-argv-'))
  const argv = join(bin, 'argv')
  let ledgerPath = ''
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
    const x = treeSitter()
    const event = (commit: string) => ({ commit, historicalPath: 'src/repeat.ts', parents: [] })
    ledgerPath = historyEventCachePathForTests(root)

    writeFileSync(argv, '')
    const cold = await anchorHitQueries(root, [{ win: [event(first)], symbols: ['f', 'g'] }], [x])
    assert.deepEqual(cold[0].map((row) => row.selectors), [['f']])
    assert.equal(hunkQueries(), 1, 'the cold read asks for the window it has not read')

    // A fresh module has no process hunk memo. It must replay the same immutable fact from the existing
    // source-of-truth ledger, not re-run the historical patch query after a backend replacement.
    writeFileSync(argv, '')
    const fresh = await (await freshAnchors(`durable-hunks=${first}`)).anchorHitQueries(
      root, [{ win: [event(first)], symbols: ['f', 'g'] }], [x],
    )
    assert.deepEqual(fresh, cold, 'a durable image fact preserves the exact selector result')
    assert.equal(hunkQueries(), 0, 'a fresh process replays the hunk fact without another historical patch query')

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
    if (ledgerPath) rmSync(dirname(ledgerPath), { recursive: true, force: true })
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
    const ask = async (mod: typeof import('@spexcode/spec-core')) =>
      (await mod.anchorHitQueries(root, [{ win, symbols: ['f'] }], mod.extractors(root)))[0].map((row) => row.selectors)

    // `-diff` marks the path binary for diff purposes: Git prints "Binary files … differ", no `@@`.
    writeFileSync(join(root, '.gitattributes'), 'src/x.py -diff\n')
    const suppressed = await ask(await import('@spexcode/spec-core'))
    // flip the same dirty attribute to its opposite and ask the SAME process again
    writeFileSync(join(root, '.gitattributes'), 'src/x.py diff\n')
    const flipped = await ask(await import('@spexcode/spec-core'))
    // a module with empty memos is the oracle: whatever it says, the memoized answer must equal it
    const fresh = await ask(await freshAnchors(`attr-oracle=${moved}`))

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
    const mod = await import('@spexcode/spec-core')
    const x = treeSitter()
    const ask = async (event: any) => (await mod.anchorHitQueries(root, [{ win: [event], symbols: ['f'] }], [x]))[0].map((r) => r.selectors)

    // (1) ordered PARENT identity, via a REAL graft. Git answers "what did this commit change" from its own
    //     parents, so the control has to move Git's parents — `replace --graft` does, and the event the index
    //     derives moves with it. Before: movesG against movesF changed only g. After the graft its parent is
    //     v1, where f moved too. A (commit,path) key would have served the first answer for the second.
    const askG = (parent: string) => ask({ commit: movesG, historicalPath: 'src/i.ts', parents: [{ commit: parent, historicalPath: 'src/i.ts' }] })
    const beforeGraft = await askG(movesF)
    g('replace', '--graft', movesG, v1)
    const afterGraft = await askG(v1)
    const freshGraft = (await (await freshAnchors(`graft-oracle=${movesG}`)).anchorHitQueries(
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
    const fresh = (await (await freshAnchors(`identity-oracle=${movesF}`)).anchorHitQueries(
      root, [{ win: [{ commit: movesF, historicalPath: 'src/i.ts', parents: [{ commit: v1, historicalPath: 'src/i.ts' }] }], symbols: ['f'] }], [x]))[0].map((r: any) => r.selectors)
    assert.deepEqual(before, [['f']], 'the original object moved f')
    assert.deepEqual(after, fresh, 'after refs/replace the memoized answer must equal a fresh module\'s')
    assert.deepEqual(after, [], 'the replacement object leaves f alone, so f is no longer hit — a commit-id key would have kept the old hit')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Repo config decides hunk boundaries too, and these two flips are DISCRIMINATING: each makes the parent's
// verdict differ from the pinned one on the same commit, so a memo over image identity alone would freeze the
// ambient reading. The unit is a fixed line 3 (a pure extractor, so the fixture is about ranges only).
//
//   `c a c a` -> `c c a a a`:  myers authors new 4-5 and deletes old 2   -> line 3 MISSED
//                              histogram authors new 2-3 and deletes old 3 -> line 3 HIT
//   `color.ui=always`:         Git prefixes every `@@` with an ANSI escape, so a `/^@@/` parse sees ZERO
//                              hunks and the whole corpus reads as "nothing changed".
const line3Extractor = {
  id: 'line3-test',
  claims: (ext: string) => ext === 'txt',
  ready: () => true as const,
  extract: () => [{ name: 'f', kind: 'function', start: 3, end: 3 }],
  memoKey: (filename: string) => `line3-test\0${filename}`,
}

async function discriminatingFixture(configure: (g: (...a: string[]) => string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'spex-anchor-cfg-'))
  const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
  writeFileSync(join(root, 'src.txt'), 'c\na\nc\na\n')
  g('add', '-A'); g('commit', '-qm', 'v1'); const v1 = g('rev-parse', 'HEAD')
  writeFileSync(join(root, 'src.txt'), 'c\nc\na\na\na\n')
  g('add', '-A'); g('commit', '-qm', 'realign'); const moved = g('rev-parse', 'HEAD')
  configure(g)
  return { root, g, win: [{ commit: moved, historicalPath: 'src.txt', parents: [{ commit: v1, historicalPath: 'src.txt' }] }], moved }
}

test('a same-process diff.algorithm flip cannot change or freeze an anchor verdict', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { root, g, win, moved } = await discriminatingFixture((git) => git('config', 'diff.algorithm', 'myers'))
  try {
    const mod = await import('@spexcode/spec-core')
    const ask = async (m: AnchorQueryModule) => (await m.anchorHitQueries(root, [{ win, symbols: ['f'] }], [line3Extractor as any]))[0].map((r) => r.selectors)
    const underMyers = await ask(mod)
    g('config', 'diff.algorithm', 'histogram')
    const underHistogram = await ask(mod)
    const fresh = await ask(await freshAnchors(`algo-oracle=${moved}`))
    assert.deepEqual(underHistogram, underMyers, 'repo diff.algorithm must not move the verdict')
    assert.deepEqual(underHistogram, fresh, 'and the memoized verdict must equal a fresh module\'s after the flip')
    assert.deepEqual(fresh, [['f']], 'the pinned reading attributes the realignment to the anchored line — a myers reading misses it')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('an ambient color.ui cannot blank the hunk parse into a silent zero-drift verdict', { skip: !gitAvailable() && 'git not available' }, async () => {
  const { root, g, win, moved } = await discriminatingFixture((git) => git('config', 'color.ui', 'always'))
  try {
    const mod = await import('@spexcode/spec-core')
    const ask = async (m: AnchorQueryModule) => (await m.anchorHitQueries(root, [{ win, symbols: ['f'] }], [line3Extractor as any]))[0].map((r) => r.selectors)
    const colored = await ask(mod)
    g('config', '--unset', 'color.ui')
    const plain = await ask(mod)
    const fresh = await ask(await freshAnchors(`color-oracle=${moved}`))
    assert.deepEqual(colored, [['f']], 'an ANSI-coloured patch must still be parsed — zero hunks here would be a silent clean gate')
    assert.deepEqual(plain, colored, 'and color.ui must not move the verdict')
    assert.deepEqual(fresh, colored, 'nor may the memo hold a colour-blanked answer')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('historical extractor memo stays stable across order and same-process repetition', { skip: !gitAvailable() && 'git not available' }, async () => {
  const source = 'export const f = <number>value\n'
  for (const order of [['src/same.tsx', 'src/same.ts'], ['src/same.ts', 'src/same.tsx']]) {
    const root = mkdtempSync(join(tmpdir(), 'spex-anchor-memo-key-'))
    const g = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
    try {
      g('init', '-q', '-b', 'main'); g('config', 'user.email', 't@t.co'); g('config', 'user.name', 't')
      mkdirSync(join(root, 'src'))
      for (const path of order) writeFileSync(join(root, path), source)
      g('add', '-A'); g('commit', '-qm', 'same bytes')
      const commit = g('rev-parse', 'HEAD')
      const regs = extractors(ROOT)
      for (const path of order) {
        const hits = await anchorHitCommits(root, [{ commit, historicalPath: path, parents: [] }], ['f'], regs)
        if (path.endsWith('.tsx')) assert.equal(hits[0]?.unparseable !== undefined, true, 'TSX must retain its parse error')
        else assert.equal(hits[0]?.unparseable, undefined, 'TS must not inherit the TSX memo result')
      }
      for (const path of [...order].reverse()) {
        const hits = await anchorHitCommits(root, [{ commit, historicalPath: path, parents: [] }], ['f'], regs)
        if (path.endsWith('.tsx')) assert.equal(hits[0]?.unparseable !== undefined, true, 'repeat TSX query must stay conservative')
        else assert.equal(hits[0]?.unparseable, undefined, 'repeat TS query must stay parseable')
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
