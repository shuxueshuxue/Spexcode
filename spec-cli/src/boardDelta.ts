import { createHash } from 'node:crypto'

// @@@ board-delta — the pure core of the board's incremental push: decompose a board snapshot into a keyed
// UNIT MAP, tag it, and diff two unit maps into a minimal {set, del} patch. The transport ([[graph-stream]])
// chains these patches over SSE (`from`/`to` tags) so a subscribed dashboard applies a few KB per change
// instead of refetching the full ~600KB snapshot; the client-side mirror of apply/reconstruct lives in the
// dashboard's data layer. Everything here is pure and synchronous — no fs, no git, no stream — so the
// equivalence argument (see the spec node's equivalence.md) is checkable by the property tests alone.
//
// Unit keys: `node:<id>` (one spec node), `sess:<id>` (one session row), `nodes#order` / `sess#order`
// (id sequences, preserving array order), `meta` (every other top-level field as one small object).
// Precondition P: node ids and session ids are collision-free. unitize REPORTS P (`ok`) rather than
// assuming it — on a violation the transport falls back to full-snapshot sends, so a delta is only ever
// chained between snapshots where the decomposition is a real bijection.

export type Units = Map<string, { j: string; v: unknown }>
export type Delta = { from: string; to: string; set: Record<string, unknown>; del: string[] }

type Boardish = { nodes?: unknown; sessions?: unknown; [k: string]: unknown }

// decompose a board into units. `ok` = the bijection precondition held (arrays are arrays, ids unique &
// non-empty); when false the map is still returned (usable for tagging) but must not seed a delta chain.
export function unitize(board: Boardish): { units: Units; ok: boolean } {
  const units: Units = new Map()
  let ok = true
  const keyed = (arr: unknown, prefix: string, orderKey: string): void => {
    const list = Array.isArray(arr) ? arr : (ok = false, [])
    const order: string[] = []
    for (const item of list) {
      const id = (item as { id?: unknown })?.id
      if (typeof id !== 'string' || !id || units.has(`${prefix}${id}`)) { ok = false; continue }
      units.set(`${prefix}${id}`, { j: JSON.stringify(item), v: item })
      order.push(id)
    }
    units.set(orderKey, { j: JSON.stringify(order), v: order })
  }
  const { nodes, sessions, ...meta } = board
  keyed(nodes, 'node:', 'nodes#order')
  keyed(sessions, 'sess:', 'sess#order')
  units.set('meta', { j: JSON.stringify(meta), v: meta })
  return { units, ok }
}

// the snapshot tag: a digest over every unit's key + content hash, order-independent (keys sorted). Two
// builds serializing equal content get equal tags; JSON.stringify equality is conservative (equal strings ⇒
// equal values; a key-order difference at worst re-sends an unchanged unit, never misses a changed one).
export function tagOf(units: Units): string {
  const h = createHash('sha1')
  for (const key of [...units.keys()].sort()) {
    const u = units.get(key)!
    h.update(key).update('\0').update(u.j).update('\0')
  }
  return h.digest('hex')
}

// diff two unit maps into the minimal patch: units whose serialized content moved land in `set` (with the
// NEW value), units that vanished land in `del`. apply(prev, diff(prev, next)) = next — the round-trip
// lemma the property tests pin down.
export function diffUnits(prev: Units, next: Units): { set: Record<string, unknown>; del: string[] } {
  const set: Record<string, unknown> = {}
  const del: string[] = []
  for (const [key, u] of next) {
    const p = prev.get(key)
    if (!p || p.j !== u.j) set[key] = u.v
  }
  for (const key of prev.keys()) if (!next.has(key)) del.push(key)
  return { set, del }
}

// apply a patch to a unit-value map — the exact algorithm the dashboard mirrors in data.js, kept here so
// the round-trip property is provable against the real shape, not a paraphrase of it.
export function applyDelta(values: Map<string, unknown>, d: Pick<Delta, 'set' | 'del'>): Map<string, unknown> {
  const out = new Map(values)
  for (const key of d.del) out.delete(key)
  for (const [key, v] of Object.entries(d.set)) out.set(key, v)
  return out
}

// reconstruct the board from unit values — R(U(B)) = B on the P-satisfying subspace (the client's render
// input after every applied patch). Order rides the #order units, so array order survives the round trip.
export function boardFromUnits(values: Map<string, unknown>): Boardish {
  const pick = (prefix: string, orderKey: string): unknown[] => {
    const order = (values.get(orderKey) as string[] | undefined) || []
    return order.map((id) => values.get(`${prefix}${id}`))
  }
  const meta = (values.get('meta') as Record<string, unknown> | undefined) || {}
  return { ...meta, nodes: pick('node:', 'nodes#order'), sessions: pick('sess:', 'sess#order') }
}

export const unitValues = (units: Units): Map<string, unknown> => new Map([...units].map(([k, u]) => [k, u.v]))
