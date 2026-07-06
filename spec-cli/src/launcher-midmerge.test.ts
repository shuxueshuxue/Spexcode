import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// @@@ mid-merge guard ([[merge-tooling-resilience]]) - the launcher must refuse to spawn tsx into a source
// tree that holds merge-conflict markers, degrading to one actionable line + exit 75 instead of the raw
// esbuild stacktrace that used to hit every spex call (Stop hook included) while a merge was being resolved.
// Hermetic: the launcher is copied into a fixture package whose cli.ts is conflicted, so the preflight fires
// before tsx is ever needed. The marker is built by concatenation so THIS file never trips the real guard.
const SRC = dirname(fileURLToPath(import.meta.url))
const LAUNCHER = join(SRC, '..', 'bin', 'spex.mjs')
const MARKER = '<<<' + '<<<< HEAD'

test('launcher exits 75 with a clean message when the source tree is mid-merge', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'spex-midmerge-'))
  try {
    mkdirSync(join(tmp, 'spec-cli', 'bin'), { recursive: true })
    mkdirSync(join(tmp, 'spec-cli', 'src'), { recursive: true })
    copyFileSync(LAUNCHER, join(tmp, 'spec-cli', 'bin', 'spex.mjs'))
    writeFileSync(
      join(tmp, 'spec-cli', 'src', 'cli.ts'),
      `${MARKER}\nconst a = 1\n=======\nconst a = 2\n>>>` + `>>>> side\n`,
    )
    let code = 0
    let stderr = ''
    try {
      execFileSync(process.execPath, [join(tmp, 'spec-cli', 'bin', 'spex.mjs'), 'internal', 'trunk'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e: any) {
      code = e.status
      stderr = String(e.stderr)
    }
    assert.equal(code, 75)
    assert.match(stderr, /paused mid-merge/)
    assert.match(stderr, /cli\.ts/)
    assert.doesNotMatch(stderr, /TransformError|at /)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})
