import test from 'node:test'
import assert from 'node:assert/strict'

import { loadSpecs } from './specs.js'

test('loadSpecs rejects an immutable declaration snapshot bound to another tip', async () => {
  await assert.rejects(
    loadSpecs(process.cwd(), {
      tip: 'tip-a',
      history: null,
      drift: null,
      snapshot: { tip: 'tip-b', files: new Map() },
    }),
    /snapshot tip 'tip-b' does not match requested tip 'tip-a'/,
  )
})
