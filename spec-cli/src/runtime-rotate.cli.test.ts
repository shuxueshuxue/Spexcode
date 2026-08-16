import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const pkgRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('./cli.ts', import.meta.url))

test('doctor repair app-server reads launcher configuration from the project, not its runtime store', () => {
  const home = mkdtempSync(`${tmpdir()}/spex-runtime-rotate-`)
  try {
    const result = spawnSync('tsx', [cli, 'doctor', 'repair', 'app-server'], {
      cwd: pkgRoot,
      encoding: 'utf8',
      env: { ...process.env, SPEXCODE_HOME: home },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /there is no proven canonical app-server generation to switch/)
    assert.doesNotMatch(result.stderr, /sessions\.defaultLauncher is required/)
  } finally { rmSync(home, { recursive: true, force: true }) }
})

test('doctor repair app-server has a precise non-mutating help probe', () => {
  const result = spawnSync('tsx', [cli, 'doctor', 'repair', 'app-server', '--help'], {
    cwd: pkgRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0)
  assert.match(result.stdout, /Usage: spex doctor repair app-server \[--launcher <name>\]/)
  assert.doesNotMatch(result.stdout, /runtime rotate/)
})

test('the removed runtime drawer signposts the doctor repair without executing it', () => {
  const result = spawnSync('tsx', [cli, 'runtime', 'rotate', 'codex'], {
    cwd: pkgRoot,
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.match(result.stderr, /`spex runtime` was removed/)
  assert.match(result.stderr, /use: spex doctor repair app-server/)
})
