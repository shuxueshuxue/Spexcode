import { createHash } from 'node:crypto'
import { tagBytes, type Units } from './graph-delta.js'

export * from './graph-delta.js'

// the snapshot tag: a digest over every unit's key + serialization, order-independent (keys sorted). Two
// builds serializing equal content get equal tags; JSON.stringify equality is conservative (equal strings ⇒
// equal values; a key-order difference at worst re-sends an unchanged unit, never misses a changed one).
// The BYTES come from `tagBytes` so this and the browser's `tagOfAsync` cannot drift apart; only the digest
// call differs, which is the only thing about them that is a platform question.
export function tagOf(units: Units): string {
  return createHash('sha1').update(tagBytes(units)).digest('hex')
}
