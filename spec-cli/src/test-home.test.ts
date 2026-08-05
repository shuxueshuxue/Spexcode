import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const bootstrap = join(import.meta.dirname, '..', '..', 'scripts', 'test-home.mjs')
const userHome = resolve(join(homedir(), '.spexcode'))

test('test bootstrap assigns each process a disposable SPEXCODE_HOME outside the user home', () => {
  const home = process.env.SPEXCODE_HOME
  assert.ok(home, 'the test bootstrap must set SPEXCODE_HOME')
  assert.notEqual(resolve(home), userHome)
  assert.ok(resolve(home).startsWith(`${resolve(tmpdir())}/spexcode-test-home-`))
  assert.match(process.env.NODE_OPTIONS || '', /--import=file:.*scripts\/test-home\.mjs/)
})

test('test bootstrap propagates a disposable home to Node children and preserves explicit fixture homes', () => {
  const env = { ...process.env }
  const inherited = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
    encoding: 'utf8', env,
  })
  assert.equal(inherited.status, 0, inherited.stderr)
  assert.equal(inherited.stdout, process.env.SPEXCODE_HOME)

  delete env.SPEXCODE_HOME
  const probe = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
    encoding: 'utf8', env,
  })
  assert.equal(probe.status, 0, probe.stderr)
  const disposableHome = probe.stdout.trim()
  assert.ok(disposableHome, 'the probe must report its assigned test home')
  assert.equal(existsSync(disposableHome), false, 'the bootstrap must remove its test home at process exit')

  const fixtureUserHome = mkdtempSync(join(tmpdir(), 'spex-explicit-test-user-'))
  const fixtureHome = join(fixtureUserHome, '.spexcode')
  try {
    const explicit = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
      encoding: 'utf8', env: { ...env, HOME: fixtureUserHome, SPEXCODE_HOME: fixtureHome },
    })
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.equal(explicit.stdout, fixtureHome)
  } finally {
    rmSync(fixtureUserHome, { recursive: true, force: true })
  }
})

test('test bootstrap rejects the real home', () => {
  const env = { ...process.env }
  const unsafe = spawnSync(process.execPath, ['--import', bootstrap, '--eval', ''], {
    encoding: 'utf8', env: { ...env, SPEXCODE_HOME: userHome },
  })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /Refusing to run tests with SPEXCODE_HOME pointed at the user home/)
})
