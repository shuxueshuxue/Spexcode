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

test('test bootstrap redirects CODEX_HOME into the disposable home and never at the user codex home', () => {
  const codexHome = process.env.CODEX_HOME
  assert.ok(codexHome, 'the test bootstrap must set CODEX_HOME')
  assert.notEqual(resolve(codexHome), resolve(join(homedir(), '.codex')))
  assert.equal(resolve(codexHome), resolve(join(process.env.SPEXCODE_HOME!, 'codex-home')), 'the codex home lives inside the disposable SpexCode home and dies with it')
  assert.ok(existsSync(codexHome), 'the disposable codex home exists so a trust write never has to create the user path')

  const env = { ...process.env }
  const inherited = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.CODEX_HOME)'], { encoding: 'utf8', env })
  assert.equal(inherited.status, 0, inherited.stderr)
  assert.equal(inherited.stdout, codexHome, 'a Node child keeps the parent test process disposable codex home')

  delete env.SPEXCODE_HOME
  delete env.CODEX_HOME
  const probe = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.CODEX_HOME)'], { encoding: 'utf8', env })
  assert.equal(probe.status, 0, probe.stderr)
  assert.ok(probe.stdout.startsWith(`${resolve(tmpdir())}/spexcode-test-home-`), `a fresh process gets its own disposable codex home: ${probe.stdout}`)
  assert.equal(existsSync(probe.stdout), false, 'the disposable codex home is removed with the test home at process exit')

  const fixtureCodexHome = mkdtempSync(join(tmpdir(), 'spex-explicit-codex-home-'))
  try {
    const explicit = spawnSync(process.execPath, ['--eval', 'process.stdout.write(process.env.CODEX_HOME)'], { encoding: 'utf8', env: { ...env, CODEX_HOME: fixtureCodexHome } })
    assert.equal(explicit.status, 0, explicit.stderr)
    assert.equal(explicit.stdout, fixtureCodexHome, 'an explicit fixture codex home keeps control')
  } finally {
    rmSync(fixtureCodexHome, { recursive: true, force: true })
  }

  const unsafe = spawnSync(process.execPath, ['--import', bootstrap, '--eval', ''], {
    encoding: 'utf8', env: { ...env, CODEX_HOME: join(homedir(), '.codex') },
  })
  assert.notEqual(unsafe.status, 0)
  assert.match(unsafe.stderr, /Refusing to run tests with CODEX_HOME pointed at the user codex home/)
})
