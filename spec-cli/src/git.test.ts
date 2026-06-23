import { test } from 'node:test'
import assert from 'node:assert/strict'

import { driftFor, type DriftIndex } from './git.js'

// @@@ driftFor unit - drift is a pure function of a DriftIndex (commit positions, which commits touched a
// file, the Spec-OK acks, and which nodes each commit versioned), so we build one by hand and assert the
// count. pos: 0 = newest (HEAD), increasing into the past. The KEY case is `ack at the tip`: an ack quiets
// a node's drift WHEREVER its files moved, so `spex ack` at HEAD just works after stacking commits.
function idx(parts: Partial<DriftIndex>): DriftIndex {
  return { pos: new Map(), fileCommits: new Map(), acks: new Map(), specNodes: new Map(), ...parts }
}

test('drift counts code commits newer than the spec version', () => {
  const i = idx({
    pos: new Map([['VER', 3], ['A', 2], ['B', 1], ['TIP', 0]]),
    fileCommits: new Map([['f.ts', ['B', 'A']]]),         // f moved in A and B, both newer than the version
    specNodes: new Map([['VER', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 2)
})

test('a Spec-OK ack at the TIP quiets all drift below it — the trailer need not sit on the moving commit', () => {
  const i = idx({
    pos: new Map([['VER', 3], ['A', 2], ['B', 1], ['TIP', 0]]),
    fileCommits: new Map([['f.ts', ['B', 'A']]]),         // f moved in A and B …
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['TIP', new Set(['X'])]]),             // … but X is acked on TIP, not on A/B
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 0)             // regression guard: was 2 under the old per-commit rule
})

test('a change made AFTER the ack is fresh, un-acknowledged drift', () => {
  const i = idx({
    pos: new Map([['VER', 4], ['A', 3], ['ACK', 2], ['C', 1], ['TIP', 0]]),
    fileCommits: new Map([['f.ts', ['C', 'A']]]),         // A is below the ack, C is above it
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['ACK', new Set(['X'])]]),
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)             // A quieted; C (post-ack) still drifts
})

test('an ack naming a different node does not quiet X', () => {
  const i = idx({
    pos: new Map([['VER', 2], ['A', 1], ['TIP', 0]]),
    fileCommits: new Map([['f.ts', ['A']]]),
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['TIP', new Set(['Y'])]]),             // Spec-OK: Y, not X
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)
})

test('an ack at or before the spec version cannot speak for it (a re-version invalidates older acks)', () => {
  const i = idx({
    pos: new Map([['OLDACK', 3], ['VER', 2], ['A', 1], ['TIP', 0]]),
    fileCommits: new Map([['f.ts', ['A']]]),
    specNodes: new Map([['VER', new Set(['X'])]]),
    acks: new Map([['OLDACK', new Set(['X'])]]),          // ack predates the current version → irrelevant
  })
  assert.equal(driftFor(i, 'VER', 'f.ts'), 1)
})
