import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
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
})

test('test bootstrap rejects the real home and removes its disposable home on exit', () => {
  const env = { ...process.env }
  delete env.SPEXCODE_HOME
  const probe = spawnSync(process.execPath, ['--import', bootstrap, '--eval', 'process.stdout.write(process.env.SPEXCODE_HOME)'], {
    encoding: 'utf8', env,
  })
  assert.equal(probe.status, 0, probe.stderr)
  const disposableHome = probe.stdout.trim()
  assert.ok(disposableHome, 'the probe must report its assigned test home')
  assert.equal(existsSync(disposableHome), false, 'the bootstrap must remove its test home at process exit')

  const unsafe = spawnSync(process.execPath, ['--import', bootstrap, '--eval', ''], {
    encoding: 'utf8', env: { ...env, SPEXCODE_HOME: userHome },
  })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /Refusing to run tests with SPEXCODE_HOME pointed at the user home/)
})
