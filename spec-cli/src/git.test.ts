import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, existsSync, readFileSync, renameSync, rmSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { driftFor, ancestorsOf, inAncestors, commitReachable, mergeBaseDiff, worktreeSpecDelta, driftIndex, historyIndex, sourceIndexes, sourceIndexesFull, rowsFor, pathRangeEvents, historyCacheStats, resetHistoryCachesForTests, historyEventCachePathForTests, withGitAbortSignal, git, gitA, batchRevisionOids, batchBlobTexts, combinedDiffOwnedChanges, type DriftIndex } from './git.js'

// build a DriftIndex by hand from DAG edges: `parents` maps each commit to its parent hashes —
// reachability is all that matters, insertion order is only the bitset slot assignment.
type TestIndexParts = Partial<DriftIndex> & { fileCommits?: Map<string, string[]> }
function idx(parents: Record<string, string[]>, parts: TestIndexParts = {}): DriftIndex {
  const ord = new Map<string, number>(), p = new Map<string, string[]>()
  let i = 0
  for (const [h, ps] of Object.entries(parents)) { ord.set(h, i++); p.set(h, ps) }
  const { fileCommits = new Map<string, string[]>(), ...rest } = parts
  const fileEvents = new Map([...fileCommits].map(([path, commits]) =>
    [path, commits.map((commit) => ({
      commit,
      historicalPath: path,
      parents: (p.get(commit) ?? []).map((parent) => ({ commit: parent, historicalPath: path })),
    }))]))
  return { ord, parents: p, fileEvents, lineageEvents: fileEvents, lineageKeys: (path) => [path], acks: new Map(), specNodes: new Map(), anc: new Map(), ...rest }
}
const LINEAR = { TIP: ['B'], B: ['A'], A: ['VER'], VER: [] } // TIP -> B -> A -> VER

test('one persistent event transaction stays full-history-equivalent across seed, reopen, and advance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-index-oracle-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  let cachePath = ''
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'oracle@example.com'); run('config', 'user.name', 'Oracle')
    mkdirSync(join(root, '.spec', 'project', 'a'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(root, '.spec', 'project', 'a', 'spec.md'), '---\ntitle: a\ncode: src/a.ts\n---\n# a\n')
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
    run('add', '.'); run('commit', '-qm', 'seed')
    const version = run('rev-parse', 'HEAD')
    cachePath = historyEventCachePathForTests(root)

    const [[history, drift], [fullHistory, fullDrift]] = await Promise.all([
      sourceIndexes(root), sourceIndexesFull(root),
    ])
    assert.deepEqual(rowsFor(history, '.spec/project/a/spec.md'), rowsFor(fullHistory, '.spec/project/a/spec.md'))
    assert.equal(driftFor(drift, version, 'src/a.ts', 'a'), driftFor(fullDrift, version, 'src/a.ts', 'a'))
    const seeded = readFileSync(cachePath)
    const rows = seeded.toString('utf8').trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(rows.filter((row) => row.k.startsWith?.('tip:')).map((row) => row.k).sort(),
      ['tip:identity-raw', 'tip:merge'])

    resetHistoryCachesForTests()
    await sourceIndexes(root)
    assert.equal(readFileSync(cachePath).equals(seeded), true, 'an exact-tip reopen rewrote the ledger')

    appendFileSync(join(root, 'src/a.ts'), 'export const b = 2\n'); run('add', '.'); run('commit', '-qm', 'move governed code')
    resetHistoryCachesForTests()
    const [[advancedHistory, advancedDrift], [advancedFullHistory, advancedFullDrift]] = await Promise.all([
      sourceIndexes(root), sourceIndexesFull(root),
    ])
    assert.deepEqual(rowsFor(advancedHistory, '.spec/project/a/spec.md'), rowsFor(advancedFullHistory, '.spec/project/a/spec.md'))
    assert.equal(driftFor(advancedDrift, version, 'src/a.ts', 'a'), 1)
    assert.equal(driftFor(advancedDrift, version, 'src/a.ts', 'a'), driftFor(advancedFullDrift, version, 'src/a.ts', 'a'))

    appendFileSync(join(root, 'src/a.ts'), 'export const c = 3\n'); run('add', '.'); run('commit', '-qm', 'content ack\n\nSpec-OK: a')
    resetHistoryCachesForTests()
    const [selfAck, [, fullSelfAck]] = await Promise.all([driftIndex(root), sourceIndexesFull(root)])
    assert.equal(driftFor(selfAck, version, 'src/a.ts', 'a'), 1, 'a content-bearing Spec-OK self-acks only its own event')
    assert.equal(driftFor(selfAck, version, 'src/a.ts', 'a'), driftFor(fullSelfAck, version, 'src/a.ts', 'a'))

    run('commit', '--allow-empty', '-qm', 'checkpoint\n\nSpec-OK: a')
    resetHistoryCachesForTests()
    const [checkpoint, [, fullCheckpoint]] = await Promise.all([driftIndex(root), sourceIndexesFull(root)])
    assert.equal(driftFor(checkpoint, version, 'src/a.ts', 'a'), 0, 'an advancing empty Spec-OK checkpoint covers the earlier event')
    assert.equal(driftFor(checkpoint, version, 'src/a.ts', 'a'), driftFor(fullCheckpoint, version, 'src/a.ts', 'a'))
    resetHistoryCachesForTests()
    assert.equal(driftFor(await driftIndex(root), version, 'src/a.ts', 'a'), 0, 'a new-process same-tip reopen preserves checkpoint coverage')
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('raw identity drift preserves root, path, rename, and merge identity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-drift-raw-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const quiet = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  let cachePath = ''
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'raw@example.com'); run('config', 'user.name', 'Raw')
    run('config', 'diff.renameLimit', '1')
    mkdirSync(join(root, '.spec', 'project', 'a'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    const rsPath = `src/a${String.fromCharCode(0x1e)}b.ts`, us = String.fromCharCode(0x1f)
    writeFileSync(join(root, '.spec', 'project', 'a', 'spec.md'), '---\ntitle: a\ncode: src/**\n---\n# a\n')
    writeFileSync(join(root, 'src', 'keep.ts'), `${'line\n'.repeat(24)}`)
    writeFileSync(join(root, 'src', 'deleted.ts'), 'delete me\n')
    writeFileSync(join(root, 'src', 'noise-old.ts'), `${'noise\n'.repeat(24)}`)
    writeFileSync(join(root, 'src', 'type.ts'), 'will become a symlink\n')
    writeFileSync(join(root, 'src', 'merge.ts'), 'base merge line\n')
    writeFileSync(join(root, rsPath), 'record separator path\n')
    run('add', '.'); run('commit', '-qm', 'base')
    const version = run('rev-parse', 'HEAD')

    appendFileSync(join(root, 'src', 'keep.ts'), 'ordinary edit\n')
    appendFileSync(join(root, rsPath), 'ordinary edit\n')
    writeFileSync(join(root, 'src', 'added.ts'), 'added\n')
    run('rm', '-q', 'src/deleted.ts'); run('add', '.'); run('commit', '-qm', 'add modify delete')
    const ordinary = run('rev-parse', 'HEAD')

    run('rm', '-q', 'src/type.ts'); symlinkSync('added.ts', join(root, 'src', 'type.ts'))
    run('add', '.'); run('commit', '-qm', 'type change')
    const typeChange = run('rev-parse', 'HEAD')
    assert.match(run('show', '-1', '--raw', '--format=', 'HEAD'), /T\s+src\/type\.ts/)

    run('mv', 'src/keep.ts', 'src/moved.ts'); run('commit', '-qm', 'pure rename')
    const pureRename = run('rev-parse', 'HEAD')
    assert.match(run('show', '-1', '--raw', '-M', '--format=', 'HEAD'), /R100\s+src\/keep\.ts\s+src\/moved\.ts/)

    run('mv', 'src/moved.ts', 'src/final.ts')
    appendFileSync(join(root, 'src', 'final.ts'), 'rename edit\n')
    run('rm', '-q', 'src/noise-old.ts')
    writeFileSync(join(root, 'src', 'noise-new.ts'), `${'replacement\n'.repeat(24)}`)
    run('add', '.'); run('commit', '-qm', 'rename plus edit')
    const renameEdit = run('rev-parse', 'HEAD')
    assert.doesNotMatch(quiet('show', '-1', '--raw', '-M', '-l1', '--format=', 'HEAD'), /R\d+\s+src\/moved\.ts\s+src\/final\.ts/, 'the fixture must exceed the configured rename limit')
    assert.match(run('show', '-1', '--raw', '-M', '-l0', '--format=', 'HEAD'), /R(?!100\b)\d+\s+src\/moved\.ts\s+src\/final\.ts/)

    writeFileSync(join(root, 'src', 'keep.ts'), 'reused path\n')
    run('add', '.'); run('commit', '-qm', 'reuse old path')
    const reused = run('rev-parse', 'HEAD')

    run('switch', '-qc', 'side')
    appendFileSync(join(root, 'src', 'added.ts'), 'side edit\n')
    writeFileSync(join(root, rsPath), 'side parent\n')
    run('add', '.'); run('commit', '-qm', 'side edit')
    const side = run('rev-parse', 'HEAD')
    run('switch', '-q', 'main')
    writeFileSync(join(root, 'src', 'merge.ts'), 'main merge line\n')
    writeFileSync(join(root, rsPath), 'main parent\n')
    run('add', '.'); run('commit', '-qm', 'main edit')
    const mergeAttempt = spawnSync('git', ['-C', root, 'merge', '--quiet', '--no-ff', '--no-commit', 'side'], { encoding: 'utf8' })
    assert.equal(mergeAttempt.status, 1, `${mergeAttempt.stdout}\n${mergeAttempt.stderr}`)
    writeFileSync(join(root, 'src', 'merge.ts'), 'merge-authored line\n')
    writeFileSync(join(root, rsPath), 'merge authored third line\n')
    run('add', '.'); run('commit', '-qm', 'merge side with authored line')
    const merge = run('rev-parse', 'HEAD')
    assert.match(run('show', '--format=', '--cc', '--combined-all-paths', '--unified=0', merge), /diff --cc "src\/a\\036b\.ts"/)

    cachePath = historyEventCachePathForTests(root)
    const cached = await driftIndex(root)
    const commits = (path: string, index: DriftIndex) => new Set(pathRangeEvents(index, version, path)?.map((event) => event.commit) ?? [])
    const final = commits('src/final.ts', cached)
    assert.ok([...cached.lineageEvents.values()].flat().some((event) => event.commit === version && event.historicalPath === 'src/keep.ts' && event.parents.length === 0), 'root add event retained')
    assert.ok(final.has(ordinary), 'ordinary modification follows both renames')
    assert.ok(final.has(pureRename), 'R100 is an identity event')
    assert.ok(final.has(renameEdit), 'R<100 retains both rename endpoints')
    assert.equal(final.has(reused), false, 'a vacated path reuse does not enter the prior lineage')
    assert.ok(commits('src/added.ts', cached).has(ordinary), 'add event retained')
    assert.ok(commits('src/deleted.ts', cached).has(ordinary), 'delete event retained')
    assert.ok(commits('src/type.ts', cached).has(typeChange), 'type-change event retained')
    assert.ok(commits(rsPath, cached).has(ordinary), 'a pathname containing byte 0x1e does not reframe the NUL stream')
    assert.ok(commits('src/added.ts', cached).has(side), 'side branch event retained')
    assert.equal(commits('src/added.ts', cached).has(merge), false, 'merge transport is not a duplicate path event')
    assert.ok(cached.resolutionEvents?.get('src/merge.ts')?.some((event) => event.commit === merge), 'merge-authored line belongs to the independent combined merge stream')
    assert.ok(cached.resolutionEvents?.get(rsPath)?.some((event) => event.commit === merge), 'a C-quoted merge path decodes into its current identity')
    assert.ok(commits(rsPath, cached).has(merge), 'a C-quoted merge path remains in path-range projection')
    assert.deepEqual(pathRangeEvents(cached, version, rsPath)?.find((event) => event.commit === merge)?.parents.map((parent) => parent.historicalPath), [rsPath, rsPath], 'C-quoted parent headers retain both merge images')
    assert.equal([...cached.lineageEvents.values()].flat().some((event) => event.commit === merge && event.parents.length <= 1), false, 'raw identity stream does not duplicate merge-owned change')

    run('commit', '--allow-empty', '-qm', 'checkpoint\n\nSpec-OK: a')
    appendFileSync(join(root, rsPath), 'metadata subject ack\n')
    run('add', rsPath); run('commit', '-qm', `hit${us}tail\n\nSpec-OK: a`)
    const metadataAck = run('rev-parse', 'HEAD')
    resetHistoryCachesForTests()
    const metadataIndex = await driftIndex(root)
    assert.ok(metadataIndex.selfAcks?.get(metadataAck)?.has('a'), 'a control byte in the subject cannot reframe Spec-OK metadata')
    assert.equal(driftFor(metadataIndex, version, rsPath, 'a'), 0, 'the only post-checkpoint content ack quiets itself')
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    resetHistoryCachesForTests()
  }
})

test('raw identity drift accepts SHA-256 commit ids', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-drift-raw-sha256-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  let cachePath = ''
  try {
    run('init', '-q', '--object-format=sha256', '-b', 'main')
    run('config', 'user.email', 'sha256@example.com'); run('config', 'user.name', 'SHA256')
    mkdirSync(join(root, '.spec', 'project', 'a'), { recursive: true }); mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', 'a', 'spec.md'), '---\ntitle: a\ncode: src/a.ts\n---\n# a\n')
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
    run('add', '.'); run('commit', '-qm', 'base')
    const version = run('rev-parse', 'HEAD')
    appendFileSync(join(root, 'src', 'a.ts'), 'export const b = 2\n')
    run('add', '.'); run('commit', '-qm', 'move')
    cachePath = historyEventCachePathForTests(root)
    const cached = await driftIndex(root)
    assert.equal(version.length, 64)
    assert.equal(driftFor(cached, version, 'src/a.ts'), 1)
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    resetHistoryCachesForTests()
  }
})

test('batch revision/blob reads preserve exact bytes, including large newline blobs and missing entries', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-batch-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'batch@example.com'); run('config', 'user.name', 'Batch')
    mkdirSync(join(root, 'src'), { recursive: true })
    const text = `${'line\n'.repeat(20000)}tail-without-newline`
    writeFileSync(join(root, 'src/blob.txt'), text); run('add', '.'); run('commit', '-qm', 'blob')
    const head = run('rev-parse', 'HEAD')
    const [oid, missing] = await batchRevisionOids(root, [`${head}:src/blob.txt`, `${head}:src/missing.txt`])
    assert.ok(oid && !missing)
    assert.equal((await batchBlobTexts(root, [oid!])).get(oid!), text)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('combined diff ownership is line-level across mixed, deletion, and octopus prefixes', () => {
  const parsed = combinedDiffOwnedChanges([
    'diff --cc src/consts.ts',
    '--- a/src/consts.ts',
    '--- a/src/consts.ts',
    '+++ b/src/consts.ts',
    '@@@ -1,2 -1,2 +1,2 @@@',
    '- export const governed = 1',
    '- export const neighbor = 3',
    '+ export const governed = 2',
    ' -export const neighbor = 1',
    '++export const neighbor = 777',
    'diff --cc spec.md',
    '@@@ -1 -1 +1 @@@',
    '- old parent one',
    '+ inherited parent two',
    'diff --cc deleted.ts',
    '--- a/deleted.ts',
    '--- a/deleted.ts',
    '+++ b/deleted.ts',
    '@@@ -1,2 -1,2 +1 @@@',
    '  export const kept = 1',
    '--export const removed = 1',
    'diff --cc octopus.ts',
    '--- a/octopus.ts',
    '--- a/octopus.ts',
    '--- a/octopus.ts',
    '+++ b/octopus.ts',
    '@@@@ -1 -1 -1 +1 @@@@',
    '+++export const authored = 1',
    'diff --cc dash-source.ts',
    '--- a/left-name.ts',
    '--- a/right-name.ts',
    '+++ b/dash-source.ts',
    '@@@ -1 -1 +1,0 @@@',
    '--- source text itself starts with a dash',
  ].join('\n'))

  assert.deepEqual(parsed.get('src/consts.ts')?.after, [[2, 2]], 'parent-only mixed rows do not advance the result cursor or widen an adjacent ++ range')
  assert.deepEqual(parsed.get('src/consts.ts')?.parentPaths, ['src/consts.ts', 'src/consts.ts'])
  assert.equal(parsed.has('spec.md'), false, 'a mixed-only file has no merge-owned line')
  assert.deepEqual(parsed.get('deleted.ts')?.after, [], 'an all-parent deletion owns no result-image line')
  assert.deepEqual(parsed.get('deleted.ts')?.before, [[[2, 2]], [[2, 2]]], 'an all-parent deletion retains every parent-image line')
  assert.deepEqual(parsed.get('octopus.ts')?.after, [[1, 1]], 'all parent columns participate in octopus ownership')
  assert.deepEqual(parsed.get('dash-source.ts'), {
    after: [],
    before: [[[1, 1]], [[1, 1]]],
    parentPaths: ['left-name.ts', 'right-name.ts'],
  }, 'a deleted source line beginning with dash is not mistaken for a parent-path header')
})

test('drift counts code commits not reachable from the spec version', () => {
  const i = idx(LINEAR, {
    fileCommits: new Map([['f.ts', ['B', 'A']]]),         // f moved in A and B, both after the version
    specNodes: new Map([['VER', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 2)
})

test('a Spec-OK ack at the TIP quiets all drift reachable from it — the trailer need not sit on the moving commit', () => {
  const i = idx(LINEAR, {
    fileCommits: new Map([['f.ts', ['B', 'A']]]),         // f moved in A and B …
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['TIP', new Set(['X'])]]),             // … but X is acked on TIP, not on A/B
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 0)             // regression guard: was 2 under the old per-commit rule
})

test('a change made AFTER the ack is fresh, un-acknowledged drift', () => {
  const i = idx({ TIP: ['C'], C: ['ACK'], ACK: ['A'], A: ['VER'], VER: [] }, {
    fileCommits: new Map([['f.ts', ['C', 'A']]]),         // A is covered by the ack, C is not
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['ACK', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)             // A quieted; C (post-ack) still drifts
})

test('an ack naming a different node does not quiet X', () => {
  const i = idx({ TIP: ['A'], A: ['VER'], VER: [] }, {
    fileCommits: new Map([['f.ts', ['A']]]),
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['TIP', new Set(['Y'])]]),             // Spec-OK: Y, not X
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)
})

test('an ack that is an ancestor of the spec version cannot speak for it (a re-version invalidates older acks)', () => {
  const i = idx({ TIP: ['A'], A: ['VER'], VER: ['OLDACK'], OLDACK: [] }, {
    fileCommits: new Map([['f.ts', ['A']]]),
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['OLDACK', new Set(['X'])]]),          // ack predates the current version → irrelevant
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)
})

// ---- the position-vs-ancestry difference (the bug the linear pos-compare shipped) ----

// A back-dated side-branch change merged after the spec version: the date-ordered `git log HEAD`
// walk reads M, VER, C, BASE — a position compare places C "older than" VER and reports 0 drift.
// By ancestry C is NOT reachable from VER (it lies in VER..HEAD): 1 real drift commit.
test('branchy history: a merged side-branch change counts as drift even when its date pre-dates the version', () => {
  const i = idx({ M: ['VER', 'C'], VER: ['BASE'], C: ['BASE'], BASE: [] }, {
    fileCommits: new Map([['f.ts', ['C', 'BASE']]]),
    specNodes: new Map([['VER', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)             // the old pos-compare returned 0 here
})

test('a walk-newest parallel version can revive debt cleared in the other parent', () => {
  // R--H--VB and R--VA, then M(VA,VB). Each parent is clear against its own version. At M the
  // contract selects one incomparable version by full-history walk order; choosing VA makes H debt.
  const i = idx({ M: ['VA', 'VB'], VA: ['R'], VB: ['H'], H: ['R'], R: [] }, {
    fileCommits: new Map([['f.ts', ['H']]]),
    specNodes: new Map([['VA', new Set(['X'])], ['VB', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VA', 'f.ts'), 1)
  assert.equal(driftFor(i, 'VB', 'f.ts'), 0)
})

test("an ack on a parallel branch quiets only the commits reachable from it, not a sibling branch's drift", () => {
  // VER forks into A (moves f) and ACK (Spec-OK: X); M merges both. The ack is valid (not an
  // ancestor of VER) but A is not reachable from it — A stays drift. A linear floor would quiet it.
  const i = idx({ M: ['A', 'ACK'], A: ['VER'], ACK: ['VER'], VER: [] }, {
    fileCommits: new Map([['f.ts', ['A']]]),
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['ACK', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)
})

test('ancestorsOf: the reachability set is the sha itself plus every ancestor; off-history sha → undefined', () => {
  const i = idx({ M: ['VER', 'C'], VER: ['BASE'], C: ['BASE'], BASE: [] })
  const anc = ancestorsOf(i, 'VER')!
  assert.ok(anc)
  assert.equal(inAncestors(i, anc, 'VER'), true)
  assert.equal(inAncestors(i, anc, 'BASE'), true)
  assert.equal(inAncestors(i, anc, 'C'), false)           // parallel branch: not an ancestor
  assert.equal(inAncestors(i, anc, 'M'), false)           // descendant: not an ancestor
  assert.equal(ancestorsOf(i, 'GONE'), undefined)         // not on HEAD's history at all
})

test('an off-history spec version yields 0 drift (no basis on HEAD to measure from)', () => {
  const i = idx(LINEAR, {
    fileCommits: new Map([['f.ts', ['B']]]),
    specNodes: new Map([['LOST', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'LOST', 'f.ts'), 0)
})

test('mergeBaseDiff preserves the old path of a pure rename for merge-base readers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-merge-diff-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })
  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  const oldPath = '.spec/old-parent/n/eval.md'
  const newPath = '.spec/new-parent/n/eval.md'
  mkdirSync(dirname(join(root, oldPath)), { recursive: true })
  writeFileSync(join(root, oldPath), '---\nscenarios: []\n---\n')
  run('add', '.')
  run('commit', '-qm', 'base')
  run('branch', 'base')
  mkdirSync(dirname(join(root, newPath)), { recursive: true })
  run('mv', oldPath, newPath)
  run('commit', '-qm', 'move eval')

  assert.deepEqual(await mergeBaseDiff(root, 'base'), [{
    path: newPath,
    oldPath,
    status: 'renamed',
    additions: 0,
    deletions: 0,
  }])
})

test('history keeps reachable one-parent spec versions hidden by a TREESAME merge', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-full-history-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const path = '.spec/product/n/spec.md'
  try {
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), 'base\n')
    run('add', '.'); run('commit', '-qm', 'base')
    const base = run('rev-parse', 'HEAD')

    run('switch', '-qc', 'side')
    writeFileSync(join(root, path), 'changed\n')
    run('commit', '-qam', 'changed')
    const changed = run('rev-parse', 'HEAD')
    run('revert', '--no-edit', changed)
    const reverted = run('rev-parse', 'HEAD')
    run('switch', '-q', 'main')
    run('merge', '--no-ff', '-m', 'merge side', 'side')

    assert.equal(run('log', '--format=%H', '--', '.spec'), base, 'fixture must exercise default path simplification')
    const rows = rowsFor(await historyIndex(root), path)
    assert.equal(rows.length, 3)
    assert.deepEqual(rows.map((row) => row.hash), [reverted, changed, base],
      'full history must still order every descendant before its ancestor when commit timestamps tie')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parallel old-path edits survive a later-walked rename and keep walk-newest order', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-rename-branches-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const dated = (date: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim()
  const oldPath = '.spec/product/old-node/spec.md'
  const newPath = '.spec/product/new-node/spec.md'
  const body = (a: number, b: number) => `---\ntitle: node\n---\n# node\n\nA=${a}\n\n${'common\n'.repeat(12)}B=${b}\n`
  try {
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    mkdirSync(dirname(join(root, oldPath)), { recursive: true })
    writeFileSync(join(root, oldPath), body(0, 0))
    run('add', '.'); dated('2000-01-01T00:00:00Z', 'commit', '-qm', 'base')
    const base = run('rev-parse', 'HEAD')

    run('switch', '-qc', 'side')
    mkdirSync(dirname(join(root, newPath)), { recursive: true })
    renameSync(join(root, oldPath), join(root, newPath))
    writeFileSync(join(root, newPath), body(0, 1))
    run('add', '-A'); dated('2001-01-01T00:00:00Z', 'commit', '-qm', 'side renames and edits B')
    const side = run('rev-parse', 'HEAD')

    run('switch', '-q', 'main')
    writeFileSync(join(root, oldPath), body(1, 0))
    dated('2025-01-01T00:00:00Z', 'commit', '-qam', 'main edits A')
    const main = run('rev-parse', 'HEAD')
    dated('2026-01-01T00:00:00Z', 'merge', '--no-ff', '-m', 'merge side', 'side')

    const rows = rowsFor(await historyIndex(root), newPath)
    assert.deepEqual(rows.map((row) => row.hash), [main, side, base])
    assert.equal(rows[0].reason, 'main edits A')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('parallel spec versions prove that reset drift debt is not a scalar merge fold', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-parallel-version-fold-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const dated = (date: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  }).trim()
  const path = '.spec/product/n/spec.md'
  const body = (a: number, b: number) => `---\ntitle: n\ncode:\n  - f.py\n---\n# n\n\nA=${a}\n${'stable\n'.repeat(20)}B=${b}\n`
  try {
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body(0, 0))
    writeFileSync(join(root, 'f.py'), 'def governed(): return 0\n')
    run('add', '.')
    dated('2000-01-01T00:00:00Z', 'commit', '-qm', 'base')

    run('switch', '-qc', 'version-a')
    writeFileSync(join(root, path), body(1, 0))
    run('add', path)
    dated('2025-01-01T00:00:00Z', 'commit', '-qm', 'version A')
    const versionA = run('rev-parse', 'HEAD')
    assert.equal(driftFor(await driftIndex(root), versionA, 'f.py'), 0, 'A parent must be locally clean')

    run('switch', '-qc', 'version-b', 'main')
    writeFileSync(join(root, 'f.py'), 'def governed(): return 1\n')
    run('add', 'f.py')
    dated('2001-01-01T00:00:00Z', 'commit', '-qm', 'hit governed code on B')
    const hit = run('rev-parse', 'HEAD')
    writeFileSync(join(root, path), body(0, 1))
    run('add', path)
    dated('2002-01-01T00:00:00Z', 'commit', '-qm', 'version B clears its local debt')
    const versionB = run('rev-parse', 'HEAD')
    assert.equal(driftFor(await driftIndex(root), versionB, 'f.py'), 0, 'B parent resets the earlier hit locally')

    run('switch', '-q', 'version-a')
    dated('2026-01-01T00:00:00Z', 'merge', '--no-ff', '-m', 'merge incomparable versions', 'version-b')
    const merge = run('rev-parse', 'HEAD')
    const hidx = await historyIndex(root)
    const rows = rowsFor(hidx, path)
    assert.equal(rows[0]?.hash, versionA, 'the newer parallel version must be the product window floor')
    assert.ok(rows.some((row) => row.hash === versionB), 'the incomparable B version remains in history')
    assert.ok(!rows.some((row) => row.hash === merge), 'a mixed-only clean merge is not a version')

    const didx = await driftIndex(root)
    assert.equal(driftFor(didx, versionB, 'f.py'), 0, 'the hit remains answered relative to B')
    assert.equal(driftFor(didx, versionA, 'f.py'), 1,
      'the same hit reappears as debt relative to selected A, although both scalar parent debts were empty')
    assert.equal((didx.fileEvents.get('f.py') ?? []).some((event) => event.commit === hit), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reusing an old path after a rename starts a separate history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-rename-reuse-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const oldPath = '.spec/product/foo/spec.md'
  const newPath = '.spec/product/bar/spec.md'
  const body = (identity: string) => `---\ntitle: node\n---\n# node\n\n${'stable\n'.repeat(30)}identity=${identity}\n`
  try {
    run('init', '-q', '-b', 'main')
    run('config', 'user.email', 'test@example.com')
    run('config', 'user.name', 'test')
    mkdirSync(dirname(join(root, oldPath)), { recursive: true })
    writeFileSync(join(root, oldPath), body('old v1'))
    run('add', '.'); run('commit', '-qm', 'create old foo')
    const old = run('rev-parse', 'HEAD')

    mkdirSync(dirname(join(root, newPath)), { recursive: true })
    renameSync(join(root, oldPath), join(root, newPath))
    writeFileSync(join(root, newPath), body('renamed bar v2'))
    run('add', '-A'); run('commit', '-qm', 'rename foo to bar')
    const renamed = run('rev-parse', 'HEAD')

    mkdirSync(dirname(join(root, oldPath)), { recursive: true })
    writeFileSync(join(root, oldPath), body('unrelated new foo'))
    run('add', '.'); run('commit', '-qm', 'create unrelated new foo')
    const reused = run('rev-parse', 'HEAD')

    const idx = await historyIndex(root)
    assert.deepEqual(rowsFor(idx, newPath).map((row) => row.hash), [renamed, old])
    assert.deepEqual(rowsFor(idx, oldPath).map((row) => row.hash), [reused])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a repeated-result merge rename keeps the side hit on the new lineage', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-rename-merge-peers-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const oldPath = 'src/old.ts', newPath = 'src/new.ts'
  const body = (value: number) => `export function f() { return ${value} }\n`
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'test@example.com'); run('config', 'user.name', 'test')
    mkdirSync(join(root, 'src'), { recursive: true }); writeFileSync(join(root, oldPath), body(0))
    run('add', '.'); run('commit', '-qm', 'base'); const base = run('rev-parse', 'HEAD')

    run('switch', '-qc', 'side')
    writeFileSync(join(root, oldPath), body(1)); run('add', oldPath); run('commit', '-qm', 'side anchored hit')
    const hit = run('rev-parse', 'HEAD')
    writeFileSync(join(root, oldPath), body(0)); run('add', oldPath); run('commit', '-qm', 'side restores old content')

    run('switch', '-q', 'main'); run('merge', '--no-ff', '--no-commit', 'side')
    renameSync(join(root, oldPath), join(root, newPath)); run('add', '-A'); run('commit', '-qm', 'merge authored rename')
    const idx = await driftIndex(root)
    const events = pathRangeEvents(idx, base, newPath)
    assert.ok(events?.some((event) => event.commit === hit), 'side hit must follow the repeated-result rename')
    assert.equal(driftFor(idx, base, newPath), 2, 'the hit and its restoring commit remain in the new lineage')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// One branchy fixture for the whole rename projection: a merge that renames against BOTH parents (its
// combined raw reports the same rename once per parent), an incomparable fork editing the pre-rename path,
// and a later node created at the vacated path. Whatever answers ancestry underneath, these three must keep
// the same lineages — and the ledger projection must equal the full-history one on the same tree.
test('the rename projection holds equal-commit merge peers, an incomparable fork, and vacated reuse apart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-rename-composite-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  const at = (path: string) => join(root, path)
  // Both merges here are meant to CONFLICT — the manual resolution is what authors content and moves the
  // lineage. Swallowing every Git error would let an unrelated failure impersonate that conflict and leave
  // the fixture measuring nothing, so this asserts the exact state a resolution needs: the merge stopped
  // with conflict status, a merge is in progress, and the target is left unmerged in the index.
  const conflictedMerge = (branch: string, path: string) => {
    let status: unknown = 0
    try { run('merge', '--no-ff', '--no-commit', branch) } catch (error) { status = (error as { status?: unknown }).status }
    assert.equal(status, 1, `merging ${branch} must stop on the intended conflict, not succeed or fail otherwise`)
    assert.equal(existsSync(join(root, '.git', 'MERGE_HEAD')), true, `merging ${branch} must leave a merge in progress`)
    assert.match(run('ls-files', '-u', '--', path), /\S/, `${path} must be left unmerged for the manual resolution`)
  }
  const write = (path: string, lines: string[]) => {
    mkdirSync(dirname(at(path)), { recursive: true })
    writeFileSync(at(path), lines.join('\n') + '\n')
  }
  const oldPath = '.spec/p/old/spec.md', midPath = '.spec/p/mid/spec.md', newPath = '.spec/p/new/spec.md'
  const body = (head: string, mid: string, tail: string) => [head, ...Array.from({ length: 10 }, (_, i) => `line ${i}`), mid, tail]
  let cachePath = ''
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'test@example.com'); run('config', 'user.name', 'test')
    write(oldPath, body('base', 'stable', 'base-tail'))
    run('add', '.'); run('commit', '-qm', 'base')

    // an incomparable fork: it edits the pre-rename path while main renames that same path away
    run('switch', '-qc', 'fork')
    write(oldPath, body('fork-head', 'stable', 'base-tail'))
    run('commit', '-qam', 'fork edits the old path')
    run('switch', '-q', 'main')
    mkdirSync(dirname(at(midPath)), { recursive: true })
    run('mv', oldPath, midPath)
    write(midPath, body('main-head', 'stable', 'main-tail'))
    run('commit', '-qam', 'rename old to mid and edit')
    conflictedMerge('fork', midPath)
    write(midPath, body('merge-authored', 'stable', 'main-tail'))
    run('add', '-A'); run('commit', '-qm', 'merge fork: author the resolution')

    // a merge that renames relative to BOTH parents, so its combined raw reports one rename per parent
    run('switch', '-qc', 'fork2')
    write(midPath, body('merge-authored', 'fork2-mid', 'main-tail'))
    run('commit', '-qam', 'fork2 edits mid')
    run('switch', '-q', 'main')
    write(midPath, body('merge-authored', 'main-mid', 'main-tail-2'))
    run('commit', '-qam', 'main edits mid')
    conflictedMerge('fork2', midPath)
    mkdirSync(dirname(at(newPath)), { recursive: true })
    renameSync(at(midPath), at(newPath))
    write(newPath, body('merge2-authored', 'fork2-mid', 'main-tail-2'))
    run('add', '-A'); run('commit', '-qm', 'merge fork2: rename mid to new')

    // the vacated path is reused by an unrelated node
    write(oldPath, ['reused', 'body'])
    run('add', '-A'); run('commit', '-qm', 'reuse the vacated old path')
    write(oldPath, ['reused-edit', 'body'])
    run('commit', '-qam', 'edit the reused node')

    const raw = run('log', '--merges', '--raw', '--cc', '--combined-all-paths', '-M', '--format=', '--', '.spec')
    assert.match(raw, /\bRR\t\S*mid\/spec\.md\t\S*mid\/spec\.md\t\S*new\/spec\.md/,
      'fixture must exercise a merge-authored rename reported once per parent')

    cachePath = historyEventCachePathForTests(root)
    const [[history, drift], [fullHistory, fullDrift]] = await Promise.all([sourceIndexes(root), sourceIndexesFull(root)])

    assert.deepEqual(rowsFor(history, newPath).map((row) => row.reason), [
      'merge fork2: rename mid to new',      // the equal-commit peer rename authored content: one version, not two
      'main edits mid', 'fork2 edits mid',
      'merge fork: author the resolution',
      'rename old to mid and edit',
      'fork edits the old path',             // the incomparable fork joins the renamed lineage
      'base',
    ], 'every reachable version of the lineage lands on the current path exactly once')
    assert.deepEqual(rowsFor(history, oldPath).map((row) => row.reason), [
      'edit the reused node', 'reuse the vacated old path',
      'fork edits the old path',             // incomparable with the rename, so it keeps the event-side path too
    ], 'reuse starts its own history: nothing from before the rename except the fork that never saw it')

    assert.deepEqual(rowsFor(history, newPath), rowsFor(fullHistory, newPath))
    assert.deepEqual(rowsFor(history, oldPath), rowsFor(fullHistory, oldPath))
    const events = (index: DriftIndex, path: string) =>
      (index.fileEvents.get(path) ?? []).map((event) => `${event.commit}\0${event.historicalPath}`).sort()
    assert.deepEqual(events(drift, newPath), events(fullDrift, newPath))
    assert.deepEqual(events(drift, oldPath), events(fullDrift, oldPath))
    assert.deepEqual([...drift.lineageEvents.keys()].sort(), [...fullDrift.lineageEvents.keys()].sort())
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

// ---- worktreeSpecDelta ([[worktree-linker]]): an op = differs-from-main-tip AND branch-touched-since-fork ----

// one fixture, four judgments: main gains .spec after a pre-spec root commit; worktrees exercise each
// staleness/proposal combination against it.
function specRepo() {
  const root = mkdtempSync(join(tmpdir(), 'spex-delta-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  writeFileSync(join(root, 'README.md'), 'scratch\n')
  run('add', '.'); run('commit', '-qm', 'pre-spec root'); run('tag', 'prespec')
  for (const n of ['a', 'b']) {
    mkdirSync(join(root, '.spec', n), { recursive: true })
    writeFileSync(join(root, '.spec', n, 'spec.md'), `---\ntitle: ${n}\n---\n# ${n}\n`)
  }
  run('add', '.'); run('commit', '-qm', 'spec tree')
  const wt = (name: string, ref: string) => {
    const path = join(root, '.worktrees', name)
    run('worktree', 'add', '-q', '-b', `node/${name}`, path, ref)
    return path
  }
  return { root, run, wt }
}

test('foreign-base worktree whose .spec equals main tip yields ZERO ops (the +440 phantom)', async () => {
  const { run, wt } = specRepo()
  const w = wt('foreign', 'prespec')                       // fork point predates .spec entirely
  const wrun = (...a: string[]) => execFileSync('git', ['-C', w, ...a], { encoding: 'utf8' })
  wrun('checkout', '-q', 'main', '--', '.spec')            // restore .spec byte-identical to main
  wrun('add', '-A', '.spec'); wrun('commit', '-qm', 'restore .spec')
  assert.equal(run('merge-base', 'main', `node/foreign`), run('rev-parse', 'prespec'))
  assert.deepEqual(await worktreeSpecDelta(w, 'main'), [])

  // …and ONE real edit on that same foreign base surfaces as exactly ONE op, typed vs main: `edited`
  // (the node exists on main), never a spurious `added` from the ancient fork point.
  appendFileSync(join(w, '.spec/a/spec.md'), 'real change\n')
  const ops = await worktreeSpecDelta(w, 'main')
  assert.equal(ops.length, 1)
  assert.equal(ops[0].nodeId, 'a')
  assert.equal(ops[0].op, 'edited')
  assert.equal(ops[0].dirty, true)
})

test('a worktree merely BEHIND an advanced main contributes no phantom ops', async () => {
  const { root, run, wt } = specRepo()
  const w = wt('stale', 'main')                            // forks at main tip…
  mkdirSync(join(root, '.spec', 'c'), { recursive: true })
  writeFileSync(join(root, '.spec', 'c', 'spec.md'), '---\ntitle: c\n---\n# c\n')
  run('add', '.'); run('commit', '-qm', 'main advances: add c')  // …then main moves on
  assert.deepEqual(await worktreeSpecDelta(w, 'main'), [])
})

test('a genuine branch-added node reads `added` and committed', async () => {
  const { wt } = specRepo()
  const w = wt('feature', 'main')
  mkdirSync(join(w, '.spec', 'd'), { recursive: true })
  writeFileSync(join(w, '.spec', 'd', 'spec.md'), '---\ntitle: d\n---\n# d\n')
  const wrun = (...a: string[]) => execFileSync('git', ['-C', w, ...a], { encoding: 'utf8' })
  wrun('add', '-A', '.spec'); wrun('commit', '-qm', 'add d')
  const ops = await worktreeSpecDelta(w, 'main')
  assert.equal(ops.length, 1)
  assert.deepEqual([ops[0].nodeId, ops[0].op, ops[0].committed], ['d', 'added', true])
})

test('ops already LANDED on main dissolve from the overlay', async () => {
  const { root, run, wt } = specRepo()
  const w = wt('landed', 'main')
  const wrun = (...a: string[]) => execFileSync('git', ['-C', w, ...a], { encoding: 'utf8' })
  appendFileSync(join(w, '.spec/b/spec.md'), 'landed edit\n')
  wrun('add', '-A', '.spec'); wrun('commit', '-qm', 'edit b')
  assert.equal((await worktreeSpecDelta(w, 'main')).length, 1)   // pending before the merge…
  execFileSync('git', ['-C', root, 'merge', '-q', '--no-ff', '-m', 'merge node/landed', 'node/landed'])
  assert.deepEqual(await worktreeSpecDelta(w, 'main'), [])       // …gone once main contains it
})

test('an explicit pending tip never occupies or evicts the root-owned HEAD index caches', async () => {
  const { root, run } = specRepo()
  const [headHistory, headDrift] = await Promise.all([historyIndex(root), driftIndex(root)])
  const before = historyCacheStats()
  const pending = run('commit-tree', run('write-tree'), '-p', run('rev-parse', 'HEAD'), '-m', 'pending cache probe')
  await Promise.all([historyIndex(root, pending), driftIndex(root, pending)])
  assert.deepEqual(historyCacheStats(), before, 'pending tip changed HEAD cache ownership or occupancy')
  assert.equal(await historyIndex(root), headHistory, 'pending history evicted the warm HEAD object')
  assert.equal(await driftIndex(root), headDrift, 'pending drift evicted the warm HEAD object')
})

test('independent same-HEAD clones never share a source index across repository stores', async () => {
  const { root, run } = specRepo()
  const parent = mkdtempSync(join(tmpdir(), 'spex-index-clones-'))
  const first = join(parent, 'first'), second = join(parent, 'second')
  const specPath = '.spec/a/spec.md'
  let cachePaths: string[] = []
  try {
    appendFileSync(join(root, specPath), 'revision\n')
    run('add', specPath); run('commit', '-qm', 'revise a')
    execFileSync('git', ['clone', '-q', root, first])
    execFileSync('git', ['clone', '-q', root, second])
    mkdirSync(join(second, '.git', 'info'), { recursive: true })
    writeFileSync(join(second, '.git', 'info', 'attributes'), '.spec/** binary\n')

    resetHistoryCachesForTests()
    const [firstHistory, firstDrift] = await sourceIndexes(first)
    const [secondHistory, secondDrift] = await sourceIndexes(second)
    const [fullSecond] = await sourceIndexesFull(second)
    const firstRows = rowsFor(firstHistory, specPath), secondRows = rowsFor(secondHistory, specPath)
    assert.equal(firstRows.length, 2, 'the clean clone establishes the version window')
    assert.equal(rowsFor(fullSecond, specPath).length, 2, 'repository-local binary attributes cannot erase immutable content versions')
    assert.deepEqual(secondRows, rowsFor(fullSecond, specPath), 'the second clone cannot receive the first clone\'s cached rows')
    assert.notEqual(secondHistory, firstHistory, 'same HEAD in separate object stores must not share a history promise')
    assert.notEqual(secondDrift, firstDrift, 'same HEAD in separate object stores must not share a drift promise')
    assert.deepEqual(historyCacheStats(), {
      historyHeads: 2,
      driftHeads: 2,
      historyRoots: 2,
      driftRoots: 2,
    })
    rmSync(join(second, '.git', 'info', 'attributes'))
    writeFileSync(join(second, '.gitattributes'), '.spec/** binary\n')
    resetHistoryCachesForTests()
    const [dirtyHistory] = await sourceIndexesFull(second)
    assert.equal(rowsFor(dirtyHistory, specPath).length, 2, 'an uncommitted attributes file cannot erase immutable content versions')
    cachePaths = [historyEventCachePathForTests(first), historyEventCachePathForTests(second)]
  } finally {
    for (const cachePath of cachePaths) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(parent, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    resetHistoryCachesForTests()
  }
})

test('linked worktrees at one head share the one immutable source-index pair', async () => {
  const { root, run } = specRepo()
  const parent = mkdtempSync(join(tmpdir(), 'spex-index-linked-'))
  const linked = join(parent, 'worktree')
  try {
    run('worktree', 'add', '--detach', '-q', linked, 'HEAD')
    resetHistoryCachesForTests()
    const [firstHistory, firstDrift] = await sourceIndexes(root)
    const [secondHistory, secondDrift] = await sourceIndexes(linked)
    assert.equal(secondHistory, firstHistory, 'same immutable checkout view rebuilt history per worktree')
    assert.equal(secondDrift, firstDrift, 'same immutable checkout view rebuilt drift per worktree')
    assert.deepEqual(historyCacheStats(), {
      historyHeads: 1,
      driftHeads: 1,
      historyRoots: 2,
      driftRoots: 2,
    })
  } finally {
    try { run('worktree', 'remove', '--force', linked) } catch { /* fixture cleanup continues */ }
    rmSync(parent, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    resetHistoryCachesForTests()
  }
})

// A name stream of a chosen size, built from few long paths rather than many short ones — the switch reads
// BYTES, so width per path is as good as path count and a hundredth of the fast-import cost.
function prefixRepo(paths: number, pathLength: number): { root: string; streamBytes: number } {
  const root = mkdtempSync(join(tmpdir(), 'spex-prefix-'))
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const run = (...args: string[]) => execFileSync(realGit, ['-C', root, ...args], { encoding: 'utf8' }).trim()
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  let stream = 'blob\nmark :1\ndata 2\nx\n'
  stream += 'commit refs/heads/main\nmark :2\ncommitter Test <test@example.com> 1700000000 +0000\ndata 4\nbase\n'
  for (let i = 0; i < paths; i++) stream += `M 100644 :1 .fixture/p${String(i).padStart(6, '0')}-${'x'.repeat(pathLength)}\n`
  stream += '\n'
  execFileSync(realGit, ['-C', root, 'fast-import', '--quiet'], { input: stream })
  const full = execFileSync(realGit, ['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only', '--format=', 'HEAD'],
    { encoding: 'utf8', maxBuffer: 1 << 28 })
  return { root, streamBytes: full.length }
}

// ---- the build context's pack-footprint boundary: bounded inside, git's defaults outside ----

test('a graph build bounds its git children\'s pack footprint, and calls outside the build do not', async () => {
  const { root } = prefixRepo(3, 20)
  const bin = mkdtempSync(join(tmpdir(), 'spex-limits-bin-'))
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const argvLog = join(bin, 'argv.log')
  const shim = join(bin, 'git')
  writeFileSync(argvLog, '')
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argvLog}"\nexec "${realGit}" "$@"\n`)
  chmodSync(shim, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath || ''}`
  const lines = () => readFileSync(argvLog, 'utf8').split('\n').filter(Boolean)
  const LIMITS = ['core.packedGitWindowSize=1m', 'core.packedGitLimit=32m', 'core.deltaBaseCacheLimit=1m']
  try {
    // outside any build: git's own defaults, untouched
    await gitA(['-C', root, 'log', '--format=%H', 'HEAD'])
    assert.equal(lines().length, 1)
    assert.ok(LIMITS.every((flag) => !lines()[0].includes(flag)), 'an ordinary call must not be re-tuned')

    // inside a build: every child carries the same bound, async and sync alike
    writeFileSync(argvLog, '')
    const controller = new AbortController()
    await withGitAbortSignal(controller.signal, async () => {
      await gitA(['-C', root, 'log', '--format=%H', 'HEAD'])
      git(['-C', root, 'rev-parse', 'HEAD'])
    })
    const inside = lines()
    assert.equal(inside.length, 2)
    for (const line of inside) for (const flag of LIMITS)
      assert.ok(line.includes(`-c ${flag}`), `build child missing ${flag}: ${line}`)
    // the bound rides in front of the caller's own arguments, never replacing them
    assert.ok(inside.every((line) => line.includes(`-C ${root}`)))

    // and the boundary does not outlive the build
    writeFileSync(argvLog, '')
    await gitA(['-C', root, 'log', '--format=%H', 'HEAD'])
    assert.ok(LIMITS.every((flag) => !lines()[0].includes(flag)), 'the bound leaked past the build context')
  } finally {
    process.env.PATH = oldPath
    rmSync(root, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('the pack-footprint bound does not change what a build reads, and an abort still kills the child', async () => {
  const { root } = prefixRepo(40, 60)
  try {
    const plain = await driftIndex(root)
    const controller = new AbortController()
    const bounded = await withGitAbortSignal(controller.signal, () => driftIndex(root))
    assert.equal(bounded, plain, 'same HEAD shares one index whether or not the build bound applies')

    // an aborted build still rejects rather than running to completion under the new flags
    const aborted = new AbortController()
    aborted.abort()
    await assert.rejects(
      withGitAbortSignal(aborted.signal, () => gitA(['-C', root, 'log', '--format=%H', 'HEAD'])),
      (error: unknown) => (error as Error)?.name === 'AbortError')

    assert.equal(await gitA(['definitely-not-a-git-command'], 'x'.repeat(8 << 20)), '', 'a large stdin write survives an immediate command failure')
    assert.equal(await gitA(['-C', join(root, 'missing'), 'cat-file', '--batch-check'], `${'0'.repeat(40)}\n`.repeat(200_000)), '', 'a large stdin write survives an immediate repository failure')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
