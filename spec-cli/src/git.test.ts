import { test } from 'node:test'
import assert from 'node:assert/strict'

import { driftFor, ancestorsOf, inAncestors, type DriftIndex } from './git.js'

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
