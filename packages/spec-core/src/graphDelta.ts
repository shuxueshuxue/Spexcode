import { createHash } from 'node:crypto'
import type { Units } from './graph-delta.js'

export * from './graph-delta.js'

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
