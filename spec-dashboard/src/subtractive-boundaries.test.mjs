import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = dirname(fileURLToPath(import.meta.url))
const dashboardDir = dirname(srcDir)

// These paths are deliberate: a retired surface must fail loudly if a future change restores its entry point.
const retiredPaths = [
  join(srcDir, 'SessionSelectBar.jsx'),
  join(dashboardDir, 'test', 'session-multi-select.e2e.mjs'),
]

const governedSessionFiles = [
  'SessionInterface.jsx',
  'SessionContextMenu.jsx',
  'SessionWindow.jsx',
  'Dock.jsx',
]

test('withdrawn session multi-select surface stays absent', () => {
  for (const path of retiredPaths) {
    assert.equal(existsSync(path), false, `retired multi-select artifact returned: ${path}`)
  }

  const forbidden = /SessionSelectBar|onBulkClosed|startSelect|const \[selecting|const \[picked|bulk-close/
  for (const name of governedSessionFiles) {
    const source = readFileSync(join(srcDir, name), 'utf8')
    assert.doesNotMatch(source, forbidden, `${name} revived the withdrawn multi-select mechanism`)
  }
})
