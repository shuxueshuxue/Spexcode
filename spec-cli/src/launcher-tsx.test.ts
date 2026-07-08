import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// @@@ cross-platform tsx resolution ([[platform-support]]) - the launcher must run tsx's JS entry through
// `node` (process.execPath), NEVER spawn the `.bin/tsx` shim. On Windows that shim is an extensionless sh
// script child_process.spawn can't execute — the #37 `spawn …\.bin\tsx ENOENT` crash of `spex init`.
const SRC = dirname(fileURLToPath(import.meta.url))
const LAUNCHER = join(SRC, '..', 'bin', 'spex.mjs')

test('the launcher actually runs a CLI command through node + tsx', () => {
  // an offline read-only command: proves the resolve-then-spawn path launches the TypeScript CLI end to end.
  const out = execFileSync(process.execPath, [LAUNCHER, 'help'], { encoding: 'utf8' })
  assert.match(out, /SpexCode CLI/)
})

test('the launcher spawns process.execPath against a resolved tsx JS entry, not the .bin shim', () => {
  const src = readFileSync(LAUNCHER, 'utf8')
  // spawns through THIS node binary…
  assert.match(src, /spawn\(process\.execPath,/)
  // …resolving tsx's JS entry (dist/cli.mjs) via Node's own resolver…
  assert.match(src, /resolve\('tsx\/package\.json'\)/)
  assert.match(src, /dist',\s*'cli\.mjs'/)
  // …and never reaches for the platform-specific `.bin/tsx` shim.
  assert.doesNotMatch(src, /'\.bin'/)
})
