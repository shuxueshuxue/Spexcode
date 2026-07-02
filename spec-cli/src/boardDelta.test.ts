import { test } from 'node:test'
import assert from 'node:assert'
import { unitize, tagOf, diffUnits, applyDelta, boardFromUnits, unitValues } from './boardDelta.js'

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
