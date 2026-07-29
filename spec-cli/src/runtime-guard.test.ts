import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sessionRuntimeBlock } from './runtime-guard.js'

test('runtime OK (tmux present) → no block, whatever the platform', () => {
  assert.equal(sessionRuntimeBlock({ hasTmux: true, platform: 'win32' }), null)
  assert.equal(sessionRuntimeBlock({ hasTmux: true, platform: 'linux' }), null)
})

test('native Windows without tmux → one actionable line pointing at WSL2', () => {
  const block = sessionRuntimeBlock({ hasTmux: false, platform: 'win32' })
  assert.ok(block, 'expected a block on a non-POSIX host')
  const text = block.join('\n')
  assert.match(text, /session runtime needs a POSIX host/)
  assert.match(text, /WSL2/)
  assert.match(text, /wsl --install/)
  // it must NOT mislead a Windows user toward `apt install tmux` — WSL2 is the honest fix.
  assert.doesNotMatch(text, /apt install tmux/)
})

test('POSIX host merely missing tmux → point at installing tmux, not WSL2', () => {
  const block = sessionRuntimeBlock({ hasTmux: false, platform: 'linux' })
  assert.ok(block)
  const text = block.join('\n')
  assert.match(text, /tmux is not on PATH/)
  assert.match(text, /apt install tmux|brew install tmux/)
  assert.doesNotMatch(text, /WSL2/)
})
