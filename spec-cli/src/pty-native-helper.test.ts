import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import test from 'node:test'

const moduleUrl = pathToFileURL(join(import.meta.dirname, 'pty-native-helper.mjs')).href

test('repairs a native spawn helper execute mode idempotently', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'spex-node-pty-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const helper = join(dir, 'spawn-helper')
  writeFileSync(helper, '#!/bin/sh\n')
  chmodSync(helper, 0o644)

  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { ensureExecutableIfPresent } from ${JSON.stringify(moduleUrl)}
    ensureExecutableIfPresent(${JSON.stringify(helper)})
    ensureExecutableIfPresent(${JSON.stringify(helper)})
  `])

  assert.equal(statSync(helper).mode & 0o777, 0o755)
})

test('derives spawn-helper from the native addon node-pty actually loaded', () => {
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import * as pty from 'node-pty'
    import { createRequire } from 'node:module'
    import { nodePtySpawnHelperPath } from ${JSON.stringify(moduleUrl)}
    const require = createRequire(import.meta.url)
    const nativeAddon = Object.values(require.cache).find((loaded) => loaded?.exports === pty.native)?.filename
    process.stdout.write(JSON.stringify({ nativeAddon, helper: nodePtySpawnHelperPath(pty.native) }))
  `], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' })
  const resolved = JSON.parse(output)

  assert.ok(resolved.nativeAddon)
  assert.equal(dirname(resolved.helper), dirname(resolved.nativeAddon))
  assert.equal(basename(resolved.helper), 'spawn-helper')
})
