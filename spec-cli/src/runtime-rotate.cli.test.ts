import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

test('runtime rotate reads launcher configuration from the project, not its runtime store', () => {
  const home = mkdtempSync(`${tmpdir()}/spex-runtime-rotate-`)
  try {
    const result = spawnSync('tsx', [cli, 'runtime', 'rotate', 'codex'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: { ...process.env, SPEXCODE_HOME: home },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /there is no proven canonical Codex generation to rotate/)
    assert.doesNotMatch(result.stderr, /sessions\.defaultLauncher is required/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})
