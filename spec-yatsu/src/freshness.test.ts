import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedSince, codeDrift, staleAxes, remarkStale, type ContentProbe, type RemarkSignal } from './freshness.js'
import type { DriftIndex } from '../../spec-cli/src/git.js'

// The teeth ([[remark-teeth]] T1) as a pure state machine — the five transitions the CLI verification walks,
// proven here without git so the critical edge is pinned regardless of a repo's history.
const R = (ts: string) => ({ ts })
const unresolved: RemarkSignal = { resolved: false }
const resolvedAt = (at: string): RemarkSignal => ({ resolved: true, resolvedAt: at })

test('remarkStale: no remarks → clean', () => {
  assert.equal(remarkStale(R('2026-07-03T10:00:00Z'), []), false)
})

test('remarkStale: an unresolved remark ages the scenario, whatever the reading time', () => {
  assert.equal(remarkStale(R('2026-07-03T10:00:00Z'), [unresolved]), true)
  assert.equal(remarkStale(R('2030-01-01T00:00:00Z'), [unresolved]), true)   // re-running later doesn't clear it
})

test('remarkStale: resolved but the reading PRE-dates the resolution → still stale (can\'t out-run it)', () => {
  // reading filed before the resolve — the eval-before-resolve that must not count.
  assert.equal(remarkStale(R('2026-07-03T10:00:00Z'), [resolvedAt('2026-07-03T11:00:00Z')]), true)
  // reading exactly at the resolution instant does NOT post-date it (strict >) → stale.
  assert.equal(remarkStale(R('2026-07-03T11:00:00Z'), [resolvedAt('2026-07-03T11:00:00Z')]), true)
})

test('remarkStale: resolved AND the reading post-dates the resolution → clean', () => {
  assert.equal(remarkStale(R('2026-07-03T12:00:00Z'), [resolvedAt('2026-07-03T11:00:00Z')]), false)
})

test('remarkStale: many remarks — ANY not-yet-cleared one keeps it stale', () => {
  const reading = R('2026-07-03T12:00:00Z')
  assert.equal(remarkStale(reading, [resolvedAt('2026-07-03T11:00:00Z'), resolvedAt('2026-07-03T11:30:00Z')]), false)
  assert.equal(remarkStale(reading, [resolvedAt('2026-07-03T11:00:00Z'), unresolved]), true)
  assert.equal(remarkStale(reading, [resolvedAt('2026-07-03T11:00:00Z'), resolvedAt('2026-07-03T13:00:00Z')]), true)
})

test('remarkStale: a resolved bit with no timestamp stays conservatively stale', () => {
  assert.equal(remarkStale(R('2026-07-03T12:00:00Z'), [{ resolved: true }]), true)
})

// ---- the code axis is an ancestry question, not a log-position one ----

// hand-built DAG (same shape as git.test.ts): reachability decides, never walk order.
function didx(parents: Record<string, string[]>, fileCommits: [string, string[]][]): DriftIndex {
  const ord = new Map<string, number>(), p = new Map<string, string[]>()
  let i = 0
  for (const [h, ps] of Object.entries(parents)) { ord.set(h, i++); p.set(h, ps) }
  return { ord, parents: p, fileCommits: new Map(fileCommits), acks: new Map(), specNodes: new Map(), anc: new Map() }
}

test('changedSince: a merged side-branch change stales a reading even when its date pre-dates the codeSha', () => {
  // reading taken at VER; f.ts changed on parallel C (back-dated), merged in M. The old pos-compare
  // read C as "older than the reading" → fresh; by ancestry C is not reachable from VER → stale.
  const i = didx({ M: ['VER', 'C'], VER: ['BASE'], C: ['BASE'], BASE: [] }, [['f.ts', ['C', 'BASE']]])
  assert.equal(changedSince(i, 'VER', 'f.ts'), true)
})

test('changedSince: only ancestors of the codeSha count as already-measured', () => {
  const i = didx({ TIP: ['B'], B: ['A'], A: ['BASE'], BASE: [] }, [['f.ts', ['A', 'BASE']]])
  assert.equal(changedSince(i, 'B', 'f.ts'), false)   // both changes are ancestors of the reading
  assert.equal(changedSince(i, 'BASE', 'f.ts'), true) // A came after that reading
})

test('changedSince: an off-history codeSha (rebased away or never merged) is conservatively stale', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']]])
  assert.equal(changedSince(i, 'GONE', 'f.ts'), true)
})

// ---- the off-history CONTENT fallback: trees testify when ancestry can't ----

// a hand-built probe: `diff` = the changed-paths set (null = anchor commit object gone), `blocks` answers
// scenarioDiffers. Also asserts the in-history fast path NEVER consults the probe.
function probeOf(diff: Set<string> | null, scenarioDiffers = false): ContentProbe {
  return {
    changedPaths: () => diff,
    scenarioDiffers: () => scenarioDiffers,
    behind: () => 7,
  }
}
const throwingProbe: ContentProbe = {
  changedPaths: () => { throw new Error('probe consulted on the in-history fast path') },
  scenarioDiffers: () => { throw new Error('probe consulted on the in-history fast path') },
  behind: () => { throw new Error('probe consulted on the in-history fast path') },
}
const READING = { scenario: 's1', codeSha: 'GONE', evaluator: 'manual@1', ts: '2026-07-09T00:00:00Z' }

test('content fallback: off-history anchor with byte-identical governed content reads FRESH', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']], ['y/yatsu.md', ['BASE']]])
  // the tree diff names only an unrelated path — governed file and yatsu.md are byte-identical
  const probe = probeOf(new Set(['other.txt']))
  assert.equal(changedSince(i, 'GONE', 'f.ts', probe), false)
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/yatsu.md', i, new Map(), [], probe), [])
})

test('content fallback: a genuinely changed governed file still stales the code axis', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']]])
  const probe = probeOf(new Set(['f.ts']))
  assert.equal(changedSince(i, 'GONE', 'f.ts', probe), true)
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/yatsu.md', i, new Map(), [], probe), ['code'])
})

test('content fallback: scenario axis is per-scenario — a changed yatsu.md stales only if THIS block moved', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [])
  // yatsu.md changed but this scenario's block did not (a sibling moved) → fresh
  assert.deepEqual(staleAxes(READING, [], 'y/yatsu.md', i, new Map(), [], probeOf(new Set(['y/yatsu.md']), false)), [])
  // this scenario's own block moved → stale
  assert.deepEqual(staleAxes(READING, [], 'y/yatsu.md', i, new Map(), [], probeOf(new Set(['y/yatsu.md']), true)), ['scenario'])
})

test('content fallback: a truly GONE anchor commit stays conservatively stale, named as the anchor axis', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['f.ts', ['BASE']]])
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/yatsu.md', i, new Map(), [], probeOf(null)), ['anchor'])
  // without a probe the old conservative rule holds unchanged
  assert.deepEqual(staleAxes(READING, ['f.ts'], 'y/yatsu.md', i, new Map(), []), ['code', 'scenario'])
})

test('content fallback: the in-history fast path never consults the probe', () => {
  const i = didx({ TIP: ['B'], B: ['A'], A: ['BASE'], BASE: [] }, [['f.ts', ['A', 'BASE']], ['y/yatsu.md', ['BASE']]])
  assert.equal(changedSince(i, 'B', 'f.ts', throwingProbe), false)
  assert.deepEqual(staleAxes({ ...READING, codeSha: 'B' }, ['f.ts'], 'y/yatsu.md', i, new Map([['y/yatsu.md', new Map()]]), [], throwingProbe), [])
})

test('codeDrift: off-history fallback reports only content-changed files, by the probe count', () => {
  const i = didx({ TIP: ['BASE'], BASE: [] }, [['a.ts', ['BASE']], ['b.ts', ['BASE']]])
  const probe = probeOf(new Set(['a.ts']))
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts', 'b.ts'], probe), [{ file: 'a.ts', behind: 7 }])
  // no probe → the old conservative every-touch count
  assert.deepEqual(codeDrift(i, 'GONE', ['a.ts', 'b.ts']), [{ file: 'a.ts', behind: 1 }, { file: 'b.ts', behind: 1 }])
})
