import { createHash } from 'node:crypto'

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

// @@@ the one true source for "what unit kinds exist" - consumers must NOT re-derive this from
// unitize's body. That derivation was tried and it was wrong: reading the two keyed() calls yields
// four kinds and misses `meta`, which carries identity and drives the map title plus two gates.
// Exhaustiveness is a property of the OUTPUT set, so it lives beside the code that produces it.
//
// Unknown kinds are reported, never thrown: producer and consumer version independently once this
// package is published, so a newly added kind must degrade to "ignored, and visibly so" rather than
// crash a consumer that predates it. (Tolerating an unknown key is not the same as letting a
// fallback branch stand in for handling a known one — only the latter hides a never-taken path.)
export type UnitKeyKind =
  | { kind: 'node'; id: string }
  | { kind: 'nodes-order' }
  | { kind: 'session'; id: string }
  | { kind: 'sessions-order' }
  | { kind: 'meta' }
  | { kind: 'unknown'; key: string }

export function unitKeyKind(key: string): UnitKeyKind {
  if (key === 'nodes#order') return { kind: 'nodes-order' }
  if (key === 'sess#order') return { kind: 'sessions-order' }
  if (key === 'meta') return { kind: 'meta' }
  if (key.startsWith('node:') && key.length > 'node:'.length) return { kind: 'node', id: key.slice(5) }
  if (key.startsWith('sess:') && key.length > 'sess:'.length) return { kind: 'session', id: key.slice(5) }
  return { kind: 'unknown', key }
}

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
