import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, readFileSync, renameSync, rmSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { driftFor, ancestorsOf, inAncestors, commitReachable, pathCommitsSince, mergeBaseDiff, worktreeSpecDelta, driftIndex, driftIndexFull, historyIndex, historyIndexFull, rowsFor, historyCacheStats, resetHistoryCachesForTests, historyEventCachePathForTests, primeLazyPathWindows, withGitAbortSignal, gitPrefixA, git, gitA, batchRevisionOids, batchBlobTexts, combinedDiffOwnedRanges, type DriftIndex } from './git.js'

// build a DriftIndex by hand from DAG edges: `parents` maps each commit to its parent hashes —
// reachability is all that matters, insertion order is only the bitset slot assignment.
function idx(parents: Record<string, string[]>, parts: Partial<DriftIndex> = {}): DriftIndex {
  const ord = new Map<string, number>(), p = new Map<string, string[]>()
  let i = 0
  for (const [h, ps] of Object.entries(parents)) { ord.set(h, i++); p.set(h, ps) }
  return { ord, parents: p, fileCommits: new Map(), acks: new Map(), specNodes: new Map(), anc: new Map(), ...parts }
}
const LINEAR = { TIP: ['B'], B: ['A'], A: ['VER'], VER: [] } // TIP -> B -> A -> VER

test('optimized history and drift indexes match the full-history oracle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-index-oracle-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'oracle@example.com'); run('config', 'user.name', 'Oracle')
    mkdirSync(join(root, '.spec', 'project', 'a'), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
    writeFileSync(join(root, '.spec', 'project', 'a', 'spec.md'), '---\ntitle: a\n---\n# a\n')
    run('add', '.'); run('commit', '-qm', 'seed')
    appendFileSync(join(root, '.spec/project/a/spec.md'), '\nchanged\n'); run('add', '.'); run('commit', '-qm', 'revise a')
    const fastH = await historyIndex(root), fullH = await historyIndexFull(root)
    const paths = new Set([...fastH.versions.keys(), ...fullH.versions.keys()])
    for (const path of paths) assert.deepEqual(rowsFor(fastH, path), rowsFor(fullH, path), `history mismatch for ${path}`)
    const fastD = await driftIndex(root), fullD = await driftIndexFull(root)
    const tip = run('rev-parse', 'HEAD')
    assert.equal(commitReachable(fastD, tip), commitReachable(fullD, tip))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('batch revision/blob reads preserve exact bytes, including large newline blobs and missing entries', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-batch-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'batch@example.com'); run('config', 'user.name', 'Batch')
    mkdirSync(join(root, 'src'), { recursive: true })
    const text = `${'line\n'.repeat(20000)}tail-without-newline`
    writeFileSync(join(root, 'src/blob.txt'), text); run('add', '.'); run('commit', '-qm', 'blob')
    const head = run('rev-parse', 'HEAD')
    const [oid, missing] = batchRevisionOids(root, [`${head}:src/blob.txt`, `${head}:src/missing.txt`])
    assert.ok(oid && !missing)
    assert.equal(batchBlobTexts(root, [oid!]).get(oid!), text)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('versioned global event cache ignores a legacy .git ledger and stays oracle-equivalent after an upgrade', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-cache-upgrade-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  let cachePath = ''
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'cache@example.com'); run('config', 'user.name', 'Cache')
    mkdirSync(join(root, '.spec', 'project'), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
    run('add', '.'); run('commit', '-qm', 'seed')
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# revised\n')
    run('add', '.'); run('commit', '-qm', 'revise')
    // This is the pre-schema location/shape. A new implementation must never parse it.
    const legacy = join(root, '.git', 'spexcode', 'history-events-deprecated.ndjson')
    mkdirSync(dirname(legacy), { recursive: true })
    writeFileSync(legacy, JSON.stringify({ k: 'numstat', h: run('rev-parse', 'HEAD'), r: 'corrupt legacy row' }) + '\n')
    resetHistoryCachesForTests()
    const fast = await historyIndex(root), full = await historyIndexFull(root)
    const paths = new Set([...fast.versions.keys(), ...full.versions.keys()])
    for (const path of paths) assert.deepEqual(rowsFor(fast, path), rowsFor(full, path), `legacy cache affected ${path}`)
    cachePath = historyEventCachePathForTests(root)
    assert.match(cachePath, /\.spexcode[\\/]projects[\\/]/)
    assert.match(cachePath, /history-events-v3-/)
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('a damaged event row invalidates the ledger instead of changing history verdicts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-cache-integrity-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  let cachePath = ''
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'integrity@example.com'); run('config', 'user.name', 'Integrity')
    mkdirSync(join(root, '.spec', 'project'), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
    run('add', '.'); run('commit', '-qm', 'seed')
    appendFileSync(join(root, '.spec', 'project', 'spec.md'), '\nrevised\n')
    run('add', '.'); run('commit', '-qm', 'revise')
    const head = run('rev-parse', 'HEAD')

    resetHistoryCachesForTests()
    await historyIndex(root)
    cachePath = historyEventCachePathForTests(root)
    const lines = readFileSync(cachePath, 'utf8').split('\n')
    const event = lines.findIndex((line) => {
      try {
        const row = JSON.parse(line)
        return row.k === 'numstat' && row.h === head
      } catch { return false }
    })
    assert.notEqual(event, -1, 'fixture did not persist the revised spec event')
    lines[event] = `!${lines[event].slice(1)}`
    writeFileSync(cachePath, lines.join('\n'))

    resetHistoryCachesForTests()
    const fast = await historyIndex(root), full = await historyIndexFull(root)
    assert.deepEqual(
      rowsFor(fast, '.spec/project/spec.md'),
      rowsFor(full, '.spec/project/spec.md'),
      'a parseable remainder with one damaged event row changed the cached history verdict',
    )
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('concurrent different-tip builders share an atomic ledger and recover on reopen', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-cache-concurrent-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  let cachePath = ''
  try {
    run('init', '-q', '-b', 'main'); run('config', 'user.email', 'concurrent@example.com'); run('config', 'user.name', 'Concurrent')
    mkdirSync(join(root, '.spec', 'project'), { recursive: true })
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# project\n')
    run('add', '.'); run('commit', '-qm', 'seed')
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# one\n')
    run('add', '.'); run('commit', '-qm', 'one')
    const tipOne = run('rev-parse', 'HEAD')
    writeFileSync(join(root, '.spec', 'project', 'spec.md'), '---\ntitle: project\n---\n# two\n')
    run('add', '.'); run('commit', '-qm', 'two')
    const tipTwo = run('rev-parse', 'HEAD')
    cachePath = historyEventCachePathForTests(root)
    const tsx = resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs')
    const module = pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), 'git.ts')).href
    const child = `(async()=>{const g=await import(${JSON.stringify(module)}); await Promise.all([g.historyIndex(process.argv[1], process.argv[2]),g.driftIndex(process.argv[1], process.argv[2])])})()`
    const runChild = (tip: string) => new Promise<void>((resolveChild, reject) => {
      const p = spawn(process.execPath, [tsx, '-e', child, '--', root, tip], { stdio: ['ignore', 'pipe', 'pipe'] })
      let stderr = ''; p.stderr.on('data', (chunk) => { stderr += chunk })
      p.on('error', reject); p.on('exit', (code) => code === 0 ? resolveChild() : reject(new Error(`cache child exited ${code}: ${stderr}`)))
    })
    await Promise.all([runChild(tipOne), runChild(tipTwo)])
    resetHistoryCachesForTests()
    for (const tip of [tipOne, tipTwo]) {
      const fast = await historyIndex(root, tip), full = await historyIndexFull(root, tip)
      const paths = new Set([...fast.versions.keys(), ...full.versions.keys()])
      for (const path of paths) assert.deepEqual(rowsFor(fast, path), rowsFor(full, path), `concurrent cache mismatch at ${tip}:${path}`)
    }
    const names = readdirSync(dirname(cachePath))
    assert.equal(names.some((name) => name.includes('.lock') || name.endsWith('.tmp')), false, `cache residue: ${names.join(', ')}`)
  } finally {
    if (cachePath) rmSync(dirname(cachePath), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }
})

test('combined diff ownership is line-level across mixed, deletion, and octopus prefixes', () => {
  const parsed = combinedDiffOwnedRanges([
    'diff --cc src/consts.ts',
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
    '@@@ -1,2 -1,2 +1 @@@',
    '  export const kept = 1',
    '--export const removed = 1',
    'diff --cc octopus.ts',
    '@@@@ -1 -1 -1 +1 @@@@',
    '+++export const authored = 1',
  ].join('\n'))

  assert.deepEqual(parsed.get('src/consts.ts'), [[2, 2]], 'mixed +space must not inherit an adjacent ++ range')
  assert.equal(parsed.has('spec.md'), false, 'a mixed-only file has no merge-owned line')
  assert.deepEqual(parsed.get('deleted.ts'), [[2, 2]], 'all-parent deletion maps to its result point')
  assert.deepEqual(parsed.get('octopus.ts'), [[1, 1]], 'all parent columns participate in octopus ownership')
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

test('large-history representation delegates reachable path windows to git without materializing a DAG', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-lazy-drift-'))
  const run = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
  run('init', '-q')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')
  writeFileSync(join(root, 'f.ts'), 'one\n')
  run('add', '.'); run('commit', '-qm', 'version')
  const version = run('rev-parse', 'HEAD')
  appendFileSync(join(root, 'f.ts'), 'two\n')
  run('commit', '-qam', 'move code')
  const changed = run('rev-parse', 'HEAD')
  const lazy = {
    root,
    specNodes: new Map([[version, new Set(['X'])]]),
    ackByNode: new Map<string, string[]>(),
    counts: new Map<string, number>(), windows: new Map<string, string[]>(),
    rawWindows: new Map<string, string[]>(), reachable: new Set([version, changed]),
  }
  const i = { ...idx({}), lazy } as DriftIndex

  assert.equal(commitReachable(i, version), true)
  assert.deepEqual(pathCommitsSince(i, version, 'f.ts'), [changed])
  assert.equal(driftFor(i, version, 'f.ts'), 1)
  assert.equal(commitReachable(i, '0'.repeat(40)), false)
  assert.equal(pathCommitsSince(i, '0'.repeat(40), 'f.ts'), null)
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
    assert.equal((didx.fileCommits.get('f.py') ?? []).includes(hit), true)
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

test('large-history HEAD reachability is one recoverable flight, never per-reading git fanout', { concurrency: false }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-lazy-reachable-'))
  const bin = mkdtempSync(join(tmpdir(), 'spex-lazy-reachable-bin-'))
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const run = (...args: string[]) => execFileSync(realGit, ['-C', root, ...args], { encoding: 'utf8' }).trim()
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 'test@example.com')
  run('config', 'user.name', 'test')

  let stream = 'blob\nmark :1\ndata 2\nx\n'
  stream += 'commit refs/heads/main\nmark :2\ncommitter Test <test@example.com> 1700000000 +0000\ndata 4\nbase\n'
  for (let i = 0; i < 12_000; i++) stream += `M 100644 :1 .fixture/path-${String(i).padStart(5, '0')}-${'x'.repeat(80)}\n`
  stream += '\n'
  for (let i = 2; i <= 10_138; i++) {
    stream += `commit refs/heads/main\nmark :${i + 1}\ncommitter Test <test@example.com> ${1700000000 + i} +0000\ndata 0\nfrom :${i}\n\n`
  }
  execFileSync(realGit, ['-C', root, 'fast-import', '--quiet'], { input: stream })
  run('read-tree', 'HEAD')

  const argvLog = join(bin, 'argv.log')
  const trigger = join(bin, 'hang-reachable')
  const shim = join(bin, 'git')
  writeFileSync(argvLog, '')
  writeFileSync(shim, `#!/bin/sh
printf '%s\n' "$*" >> "${argvLog}"
if [ -e "${trigger}" ]; then
  case "$*" in
    *" -C ${root} rev-list "*) while :; do sleep 1; done ;;
  esac
fi
exec "${realGit}" "$@"
`)
  chmodSync(shim, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath || ''}`
  // match by the call itself, not the whole argv: a build context legitimately prefixes resource flags
  const reachSpawns = () => readFileSync(argvLog, 'utf8').split('\n')
    .filter((line) => new RegExp(`-C ${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} rev-list [0-9a-f]{40}$`).test(line)).length
  const ancestorSpawns = () => readFileSync(argvLog, 'utf8').split('\n')
    .filter((line) => line.includes('merge-base --is-ancestor')).length
  const waitFor = async (want: number) => {
    const deadline = Date.now() + 2000
    while (reachSpawns() < want && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  }

  try {
    const first = await Promise.all(Array.from({ length: 100 }, () => driftIndex(root)))
    assert.ok(first.every((idx) => idx === first[0]), 'same HEAD did not share one drift-index flight')
    assert.equal(reachSpawns(), 1)
    assert.equal(ancestorSpawns(), 0)
    const head1 = run('rev-parse', 'HEAD')
    assert.equal(commitReachable(first[0], head1), true)
    assert.equal(commitReachable(first[0], '0'.repeat(40)), false)
    await Promise.all(Array.from({ length: 100 }, () => primeLazyPathWindows(first[0], head1, [])))
    assert.equal(reachSpawns(), 1, 'same-SHA readers spawned reachability work')

    run('commit', '--allow-empty', '-qm', 'move head')
    const second = await Promise.all(Array.from({ length: 100 }, () => driftIndex(root)))
    assert.notEqual(second[0], first[0])
    assert.equal(reachSpawns(), 2, 'new HEAD did not build exactly one replacement set')
    assert.equal(ancestorSpawns(), 0)

    run('commit', '--allow-empty', '-qm', 'abort head')
    writeFileSync(trigger, 'hang\n')
    const controller = new AbortController()
    const aborted = withGitAbortSignal(controller.signal, () => driftIndex(root))
    await waitFor(3)
    assert.equal(reachSpawns(), 3, 'abort fixture never started the reachable-set child')
    controller.abort()
    await assert.rejects(aborted, (error: unknown) => (error as Error)?.name === 'AbortError')
    rmSync(trigger, { force: true })

    const recovered = await driftIndex(root)
    assert.equal(reachSpawns(), 4, 'failed reachable-set promise was cached instead of retried')
    assert.equal(ancestorSpawns(), 0)
    assert.equal(commitReachable(recovered, run('rev-parse', 'HEAD')), true)
    assert.equal(commitReachable(recovered, 'f'.repeat(40)), false)
  } finally {
    process.env.PATH = oldPath
    rmSync(root, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

// ---- the byte-budget read: measure a stream by its prefix, never by walking all of it ----

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

test('a byte-budget read stops the stream at the budget and reports the truncation', async () => {
  const { root, streamBytes } = prefixRepo(1_000, 90)
  try {
    const budget = 100_000
    assert.ok(streamBytes > budget, 'fixture must overflow the budget for this to mean anything')
    const capped = await gitPrefixA(['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only', '--format=', 'HEAD'], budget)
    assert.equal(capped.truncated, true)
    assert.ok(capped.text.length <= budget, 'the transport retained more than the budget')
    // the verdict a caller forms from the prefix is the verdict the whole stream would have given
    assert.equal(capped.truncated || capped.text.length >= budget, streamBytes >= budget)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a byte-budget read under budget returns the whole stream, untruncated, and a failure stays fail-soft', async () => {
  const { root, streamBytes } = prefixRepo(3, 20)
  try {
    const budget = 100_000
    assert.ok(streamBytes < budget)
    const whole = await gitPrefixA(['-C', root, '-c', 'core.quotePath=false', 'log', '--name-only', '--format=', 'HEAD'], budget)
    assert.equal(whole.truncated, false)
    assert.equal(whole.text.length, streamBytes)
    assert.equal(whole.truncated || whole.text.length >= budget, streamBytes >= budget)
    // a genuine git failure is neither truncation nor a lie about size
    const failed = await gitPrefixA(['-C', root, 'log', '--name-only', '--format=', 'no-such-ref'], budget)
    assert.deepEqual(failed, { text: '', truncated: false })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the large-history switch reads a bounded prefix, and a stream past the old buffer still switches', { concurrency: false }, async () => {
  // a name stream far past the transport's 16MB read buffer, which used to come back empty and read as a
  // SMALL history — the switch failing exactly on the corpus that needs it most.
  const { root, streamBytes } = prefixRepo(18_000, 1_000)
  const bin = mkdtempSync(join(tmpdir(), 'spex-prefix-bin-'))
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()
  const argvLog = join(bin, 'argv.log')
  const shim = join(bin, 'git')
  writeFileSync(argvLog, '')
  writeFileSync(shim, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${argvLog}"\nexec "${realGit}" "$@"\n`)
  chmodSync(shim, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath || ''}`
  try {
    assert.ok(streamBytes > (1 << 24), 'fixture must exceed the old 16MB read buffer')
    const index = await driftIndex(root)
    assert.ok(index.lazy, 'an oversized name stream must take the large-history representation')
    assert.equal(index.fileCommits.size, 0, 'the large-history path retains no commit/file edge map')
    // the prefix read is the only whole-repo name-stream child the switch spawns
    const nameStreamSpawns = readFileSync(argvLog, 'utf8').split('\n')
      .filter((line) => /log --name-only --format= [0-9a-f]{40}$/.test(line)).length
    assert.equal(nameStreamSpawns, 1)
  } finally {
    process.env.PATH = oldPath
    rmSync(root, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

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
    await gitPrefixA(['-C', root, 'log', '--format=%H', 'HEAD'], 1 << 20)
    assert.equal(lines().length, 1)
    assert.ok(LIMITS.every((flag) => !lines()[0].includes(flag)), 'an ordinary call must not be re-tuned')

    // inside a build: every child carries the same bound, async and sync alike
    writeFileSync(argvLog, '')
    const controller = new AbortController()
    await withGitAbortSignal(controller.signal, async () => {
      await gitPrefixA(['-C', root, 'log', '--format=%H', 'HEAD'], 1 << 20)
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
    await gitPrefixA(['-C', root, 'log', '--format=%H', 'HEAD'], 1 << 20)
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
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
