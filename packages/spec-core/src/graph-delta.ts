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

// apply a patch to a unit-value map — the algorithm the dashboard RUNS (it imports this entry rather than
// mirroring it), kept here so the round-trip property is provable against the real shape.
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

export const unitValues = (units: Units): Map<string, unknown> => new Map([...units].map(([k, u]) => [k, u.v]))

// the same patch onto a full Units map, keeping each unit's serialization beside its value. A holder that
// keeps only values cannot state its own tag — it would have to re-serialize the whole board to say what it
// has — so a consumer that must FINGERPRINT what it holds carries `j` forward through every apply.
export function applyDeltaUnits(units: Units, d: Pick<Delta, 'set' | 'del'>): Units {
  const out: Units = new Map(units)
  for (const key of d.del) out.delete(key)
  for (const [key, v] of Object.entries(d.set)) out.set(key, { j: JSON.stringify(v), v })
  return out
}

// @@@ one answer to WHAT gets hashed - the canonical byte sequence a snapshot tag is taken over: every
// unit as `key \0 serialization \0`, keys sorted so map order cannot matter. Which digest API produces the
// hash from these bytes is a PLATFORM difference (node:crypto on the server, WebCrypto in a browser) and
// belongs at that boundary; what the bytes ARE is product semantics and has exactly one definition. Two
// definitions would let both sides "work" while disagreeing, which is the one failure this tag exists to
// make impossible.
export function tagBytes(units: Units): Uint8Array {
  let joined = ''
  for (const key of [...units.keys()].sort()) joined += `${key}\0${units.get(key)!.j}\0`
  return new TextEncoder().encode(joined)
}

// the snapshot tag computed the browser's way. Held byte-equal to the Node-side `tagOf` by test, because a
// holder's fingerprint is only meaningful if the other side computes the identical function.
export async function tagOfAsync(units: Units): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', tagBytes(units) as unknown as ArrayBuffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
