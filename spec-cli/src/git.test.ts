import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { driftFor, ancestorsOf, inAncestors, commitReachable, pathCommitsSince, mergeBaseDiff, worktreeSpecDelta, driftIndex, primeLazyPathWindows, withGitAbortSignal, type DriftIndex } from './git.js'

// build a DriftIndex by hand from DAG edges: `parents` maps each commit to its parent hashes —
// reachability is all that matters, insertion order is only the bitset slot assignment.
function idx(parents: Record<string, string[]>, parts: Partial<DriftIndex> = {}): DriftIndex {
  const ord = new Map<string, number>(), p = new Map<string, string[]>()
  let i = 0
  for (const [h, ps] of Object.entries(parents)) { ord.set(h, i++); p.set(h, ps) }
  return { ord, parents: p, fileCommits: new Map(), acks: new Map(), specNodes: new Map(), anc: new Map(), ...parts }
}
const LINEAR = { TIP: ['B'], B: ['A'], A: ['VER'], VER: [] } // TIP -> B -> A -> VER

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
    *" rev-list HEAD") while :; do sleep 1; done ;;
  esac
fi
exec "${realGit}" "$@"
`)
  chmodSync(shim, 0o755)
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath || ''}`
  const reachSpawns = () => readFileSync(argvLog, 'utf8').split('\n')
    .filter((line) => line === `-C ${root} rev-list HEAD`).length
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
