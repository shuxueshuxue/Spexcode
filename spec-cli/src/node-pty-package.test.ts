import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import test from 'node:test'

const require = createRequire(import.meta.url)
const nodePtyRoot = dirname(require.resolve('node-pty/package.json'))

test('node-pty publishes executable Darwin spawn helpers', () => {
  for (const arch of ['arm64', 'x64']) {
    const helper = join(nodePtyRoot, 'prebuilds', `darwin-${arch}`, 'spawn-helper')
    assert.notEqual(statSync(helper).mode & 0o111, 0, `${arch} spawn-helper must be executable in the npm artifact`)
  }
})
