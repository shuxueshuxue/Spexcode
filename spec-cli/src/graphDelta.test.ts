import { test } from 'node:test'
import assert from 'node:assert'
import { unitize, tagOf, tagOfAsync, diffUnits, diffFromPosition, positionOf, applyDelta, applyDeltaUnits, boardFromUnits, unitValues, unitKeyKind } from '@spexcode/spec-core'

// Executable evidence for the two lemmas the incremental push stands on (see the board-delta spec node's
// equivalence.md): RECONSTRUCTION — boardFromUnits(unitize(B)) = B whenever unitize reports ok; ROUND-TRIP —
// applyDelta(U(B), diffUnits(U(B), U(B'))) = U(B'). Randomized over a seeded generator so the space of
// board shapes (node add/remove/mutate/reorder, session churn, meta flips) is swept, deterministically.

// tiny seeded PRNG (mulberry32) — deterministic runs, no Date/Math.random needed.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)]

function randNode(r: () => number, id: string): Record<string, unknown> {
  return {
    id,
    title: `t${Math.floor(r() * 1000)}`,
    status: pick(r, ['merged', 'active', 'pending']),
    version: Math.floor(r() * 20),
    evals: r() < 0.5 ? [{ scenario: 's', pass: r() < 0.5 }] : [],
    desc: r() < 0.3 ? undefined : `d${Math.floor(r() * 100)}`,
  }
}

function randBoard(r: () => number, ids: string[]): Record<string, unknown> {
  const nodes = ids.map((id) => randNode(r, id))
  const sessions = ids.slice(0, Math.floor(r() * 3)).map((id) => ({ id: `sess-${id}`, status: pick(r, ['working', 'review', 'idle']) }))
  return { nodes, sessions, project: pick(r, ['spexcode', 'other']), projectIcon: 'mdi:x' }
}

// mutate a board the way real change bursts do: flip fields, add/remove nodes, churn sessions, reorder.
function mutate(r: () => number, board: Record<string, unknown>): Record<string, unknown> {
  const nodes = [...(board.nodes as Record<string, unknown>[])]
  if (nodes.length && r() < 0.6) { const i = Math.floor(r() * nodes.length); nodes[i] = { ...nodes[i], version: (nodes[i].version as number) + 1 } }
  if (r() < 0.3) nodes.push(randNode(r, `new-${Math.floor(r() * 10000)}`))
  if (nodes.length > 1 && r() < 0.3) nodes.splice(Math.floor(r() * nodes.length), 1)
  if (nodes.length > 1 && r() < 0.3) nodes.reverse()
  const sessions = r() < 0.5 ? (board.sessions as unknown[]) : [{ id: `sess-${Math.floor(r() * 100)}`, status: 'working' }]
  return { ...board, nodes, sessions, project: r() < 0.1 ? 'renamed' : board.project }
}

test('reconstruction: boardFromUnits(unitize(B)) deep-equals B when ok', () => {
  const r = rng(42)
  for (let i = 0; i < 200; i++) {
    const board = randBoard(r, ['a', 'b', 'c', 'd'].slice(0, 1 + Math.floor(r() * 4)))
    const { units, ok } = unitize(board)
    assert.ok(ok, 'generator produces P-satisfying boards')
    assert.deepStrictEqual(boardFromUnits(unitValues(units)), board)
  }
})

test('round-trip: applyDelta(U(B), diff(U(B), U(B\'))) = U(B\') across mutation chains', () => {
  const r = rng(7)
  for (let run = 0; run < 50; run++) {
    let board = randBoard(r, ['a', 'b', 'c'])
    let { units } = unitize(board)
    let values = unitValues(units)
    // walk a chain of mutations, applying each diff client-style; the client map must track every step
    for (let step = 0; step < 8; step++) {
      const next = mutate(r, board)
      const { units: nextUnits, ok } = unitize(next)
      assert.ok(ok)
      const d = diffUnits(units, nextUnits)
      values = applyDelta(values, d)
      assert.deepStrictEqual(boardFromUnits(values), next, `chain diverged at step ${step}`)
      board = next
      units = nextUnits
    }
  }
})

test('tag: equal content ⇒ equal tag; a content change moves the tag', () => {
  const r = rng(99)
  const board = randBoard(r, ['a', 'b'])
  const t1 = tagOf(unitize(board).units)
  const t2 = tagOf(unitize(JSON.parse(JSON.stringify(board))).units)
  assert.strictEqual(t1, t2, 'stringify-equal snapshots tag identically')
  const changed = mutate(rng(100), board)
  assert.notStrictEqual(tagOf(unitize(changed).units), t1)
})

// The whole point of a HOLDER's fingerprint is that the other side computes the identical function over the
// identical bytes. Two digest call-sites is a platform accommodation; two ANSWERS would silently break the
// only guarantee the tag carries, and would break it in the direction that certifies a board nobody has.
test('the two platforms compute one tag: tagOf === await tagOfAsync, over many random boards', async () => {
  const r = rng(4242)
  for (let i = 0; i < 24; i++) {
    const units = unitize(randBoard(r, ['a', 'b', 'c'])).units
    assert.strictEqual(await tagOfAsync(units), tagOf(units), `platform tags diverged on board ${i}`)
  }
})

// A holder that keeps only values cannot state what it has. Carrying `j` through every apply must land on
// exactly the units a fresh decomposition of the same board would produce — otherwise the fingerprint drifts
// from the board it claims to describe, patch by patch, and says so only once it is far too late.
test('applyDeltaUnits keeps a holder byte-identical to a fresh decomposition across a mutation chain', () => {
  const r = rng(777)
  let board = randBoard(r, ['a', 'b'])
  let held = unitize(board).units
  for (let step = 0; step < 12; step++) {
    const next = mutate(r, board)
    const nextUnits = unitize(next).units
    held = applyDeltaUnits(held, diffUnits(unitize(board).units, nextUnits))
    assert.strictEqual(tagOf(held), tagOf(nextUnits), `held tag diverged at step ${step}`)
    assert.deepStrictEqual(boardFromUnits(unitValues(held)), next, `held board diverged at step ${step}`)
    board = next
  }
})

// A remembered position keeps only serializations, so the resume path answers "what changed" from strictly
// less than the units-based diff has. That is only safe if it reaches the SAME answer — otherwise a
// reconnecting client is carried forward by a patch that differs from the one a live subscriber received,
// and the two would render different boards from the same server state.
test('a diff from a remembered position equals the diff from the whole snapshot', () => {
  const r = rng(31337)
  let board = randBoard(r, ['a', 'b', 'c'])
  for (let step = 0; step < 20; step++) {
    const next = mutate(r, board)
    const prev = unitize(board).units
    const nextUnits = unitize(next).units
    assert.deepStrictEqual(diffFromPosition(positionOf(prev), nextUnits), diffUnits(prev, nextUnits),
      `position-based diff diverged at step ${step}`)
    board = next
  }
})

// A resume may be answered from a position many changes old, so the patch has to carry a holder across the
// whole gap in one hop — not just across the most recent change.
test('a position several changes old still carries a holder exactly to the present', () => {
  const r = rng(90210)
  const start = randBoard(r, ['a', 'b'])
  const startUnits = unitize(start).units
  const remembered = positionOf(startUnits)
  let board = start
  for (let i = 0; i < 9; i++) board = mutate(r, board)
  const nowUnits = unitize(board).units
  const caught = applyDeltaUnits(startUnits, diffFromPosition(remembered, nowUnits))
  assert.strictEqual(tagOf(caught), tagOf(nowUnits), 'a nine-change gap did not close in one patch')
  assert.deepStrictEqual(boardFromUnits(unitValues(caught)), board)
})

test('P violation (duplicate node id) is reported, never silently decomposed', () => {
  const dup = { nodes: [{ id: 'x', v: 1 }, { id: 'x', v: 2 }], sessions: [] }
  assert.strictEqual(unitize(dup).ok, false)
  const noId = { nodes: [{ title: 'anon' }], sessions: [] }
  assert.strictEqual(unitize(noId).ok, false)
  const notArray = { nodes: 'nope', sessions: [] }
  assert.strictEqual(unitize(notArray as never).ok, false)
})

test('empty/degenerate boards survive the loop', () => {
  for (const b of [{ nodes: [], sessions: [] }, { nodes: [], sessions: [], extra: null }]) {
    const { units, ok } = unitize(b)
    assert.ok(ok)
    assert.deepStrictEqual(boardFromUnits(unitValues(units)), b)
  }
})

test('delta is minimal: an untouched unit never rides set', () => {
  const r = rng(5)
  const board = { ...randBoard(r, ['a', 'b', 'c', 'd']), sessions: [{ id: 'sess-old', status: 'idle' }] }
  const next = { ...board, sessions: [{ id: 'sess-z', status: 'working' }] }
  const d = diffUnits(unitize(board).units, unitize(next).units)
  const keys = Object.keys(d.set)
  assert.ok(keys.every((k) => k.startsWith('sess')), `only session units move, got ${keys}`)
  assert.deepStrictEqual(d.del, ['sess:sess-old']) // exactly the replaced session, nothing else
})
