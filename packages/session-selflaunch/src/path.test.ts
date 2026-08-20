import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DatabasePathError, resolveDatabasePath } from './path.js'

const pathError = (body: () => unknown): DatabasePathError => {
  try {
    body()
    assert.fail('expected ProtocolError')
  } catch (error) {
    assert.ok(error instanceof DatabasePathError, String(error))
    return error
  }
}

test('database path precedence is explicit, environment, selected config, then relocatable home', () => {
  assert.equal(resolveDatabasePath({
    databasePath: '/explicit/sessions.sqlite',
    env: { SPEX_SESSION_DATABASE_PATH: '/env/sessions.sqlite', SPEX_SESSION_CONFIG: '/config.json' },
    readFile: () => assert.fail('config must not be read after an explicit path'),
  }), '/explicit/sessions.sqlite')

  assert.equal(resolveDatabasePath({
    env: { SPEX_SESSION_DATABASE_PATH: '/env/sessions.sqlite', SPEX_SESSION_CONFIG: '/config.json' },
    readFile: () => assert.fail('config must not be read after an environment path'),
  }), '/env/sessions.sqlite')

  assert.equal(resolveDatabasePath({
    env: { SPEX_SESSION_CONFIG: '/config.json', SPEXCODE_HOME: '/product-home' },
    readFile: path => {
      assert.equal(path, '/config.json')
      return JSON.stringify({ databasePath: '/config/sessions.sqlite' })
    },
  }), '/config/sessions.sqlite')

  assert.equal(resolveDatabasePath({ env: { HOME: '/operator' } }), '/operator/.spexcode/sessions.sqlite')
  assert.equal(resolveDatabasePath({
    env: { SPEXCODE_HOME: '/relocated', HOME: '/ignored' },
  }), '/relocated/sessions.sqlite')
})

test('a relative database path is refused without reading cwd', () => {
  let cwdRead = false
  const originalCwd = process.cwd
  process.cwd = () => {
    cwdRead = true
    throw new Error('cwd must not be read')
  }
  try {
    assert.throws(
      () => resolveDatabasePath({ databasePath: 'relative.sqlite', env: {} }),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'PROTOCOL_PATH_NOT_ABSOLUTE',
      'resolveDatabasePath accepted a relative path instead of raising PROTOCOL_PATH_NOT_ABSOLUTE',
    )
    assert.equal(cwdRead, false)
  } finally {
    process.cwd = originalCwd
  }
})

test('relative values from environment, config, and home are refused rather than resolved', () => {
  assert.equal(pathError(() => resolveDatabasePath({
    env: { SPEX_SESSION_DATABASE_PATH: 'env.sqlite' },
  })).code, 'PROTOCOL_PATH_NOT_ABSOLUTE')
  assert.equal(pathError(() => resolveDatabasePath({
    env: { SPEX_SESSION_CONFIG: '/config.json' },
    readFile: () => JSON.stringify({ databasePath: 'config.sqlite' }),
  })).code, 'PROTOCOL_PATH_NOT_ABSOLUTE')
  assert.equal(pathError(() => resolveDatabasePath({
    env: { SPEXCODE_HOME: 'relative-home' },
  })).code, 'PROTOCOL_PATH_NOT_ABSOLUTE')
})

test('an explicit empty path is invalid and never falls through to another source', () => {
  assert.equal(pathError(() => resolveDatabasePath({
    databasePath: '',
    env: { SPEX_SESSION_DATABASE_PATH: '/must-not-win/sessions.sqlite' },
  })).code, 'PROTOCOL_PATH_INVALID')
})

test('a selected config fails loudly when unreadable or missing databasePath', () => {
  assert.equal(pathError(() => resolveDatabasePath({
    env: { SPEX_SESSION_CONFIG: '/missing.json' },
    readFile: () => { throw new Error('absent') },
  })).code, 'PROTOCOL_PATH_INVALID')
  assert.equal(pathError(() => resolveDatabasePath({
    env: { SPEX_SESSION_CONFIG: '/config.json' },
    readFile: () => JSON.stringify({ assumeLocalStorage: true }),
  })).code, 'PROTOCOL_PATH_INVALID')
})

test('the default fails loudly when neither home source exists', () => {
  assert.equal(pathError(() => resolveDatabasePath({ env: {} })).code, 'PROTOCOL_PATH_INVALID')
})
