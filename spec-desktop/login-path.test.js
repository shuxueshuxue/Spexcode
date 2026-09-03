'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { needsLoginPath, mergePath, parseLoginPath, loginShellCommand, repairLoginPath } = require('./login-path.js')

const GUI_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
const PROFILE_PATH = `/opt/homebrew/bin:${GUI_PATH}`

test('a GUI-minimal PATH is detected, a profile PATH is left alone', () => {
  assert.equal(needsLoginPath('darwin', GUI_PATH), true)
  assert.equal(needsLoginPath('linux', GUI_PATH), true)
  assert.equal(needsLoginPath('darwin', PROFILE_PATH), false)
  // Windows PATH comes from the registry and is complete in a GUI launch, so it is never probed.
  assert.equal(needsLoginPath('win32', GUI_PATH), false)
})

test('merging keeps every inherited dir and puts the login dirs first', () => {
  assert.equal(mergePath(GUI_PATH, '/opt/homebrew/bin:/usr/bin'), `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`)
  assert.equal(mergePath(GUI_PATH, ''), GUI_PATH)
})

test('the marker survives an rc file that prints a banner', () => {
  assert.equal(parseLoginPath('welcome to your shell\n__SPEXCODE_LOGIN_PATH__/opt/homebrew/bin:/usr/bin'), '/opt/homebrew/bin:/usr/bin')
  assert.equal(parseLoginPath('only noise'), '')
})

test('the probe runs the user login shell interactively', () => {
  assert.deepEqual(loginShellCommand('/bin/zsh'), { file: '/bin/zsh', args: ['-ilc', 'printf %s __SPEXCODE_LOGIN_PATH__"$PATH"'] })
  assert.equal(loginShellCommand(undefined).file, '/bin/sh')
})

test('a GUI launch gains the login PATH; the tools it names become resolvable', () => {
  const env = { PATH: GUI_PATH, SHELL: '/bin/zsh' }
  const result = repairLoginPath(env, 'darwin', () => `__SPEXCODE_LOGIN_PATH__/opt/homebrew/bin:${GUI_PATH}`)
  assert.deepEqual(result, { needed: true, repaired: true, reason: 'read from /bin/zsh' })
  assert.equal(env.PATH, `/opt/homebrew/bin:${GUI_PATH}`)
})

test('a failed probe reports itself and never shrinks the inherited PATH', () => {
  const env = { PATH: GUI_PATH, SHELL: '/bin/zsh' }
  const failed = repairLoginPath(env, 'darwin', () => { throw new Error('timed out') })
  assert.equal(failed.needed, true)
  assert.equal(failed.repaired, false)
  assert.match(failed.reason, /\/bin\/zsh did not answer: timed out/)
  assert.equal(env.PATH, GUI_PATH)

  const silent = repairLoginPath(env, 'darwin', () => 'banner only')
  assert.deepEqual(silent, { needed: true, repaired: false, reason: '/bin/zsh printed no PATH' })
  assert.equal(env.PATH, GUI_PATH)
})

test('a shell-launched app is not probed at all', () => {
  const env = { PATH: PROFILE_PATH, SHELL: '/bin/zsh' }
  const result = repairLoginPath(env, 'darwin', () => { throw new Error('must not run') })
  assert.deepEqual(result, { needed: false, repaired: false, reason: 'inherited a profile PATH' })
  assert.equal(env.PATH, PROFILE_PATH)
})
