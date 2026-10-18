import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const library = fileURLToPath(new URL('../hooks/harness.sh', import.meta.url))

test('Codex hook paths preserve every patch operation on the platform shell tools', () => {
  const payload = JSON.stringify({
    tool_name: 'apply_patch',
    tool_input: { command: [
      '*** Begin Patch',
      '*** Add File: src/new.ts',
      '+export const added = true',
      '*** Update File: src/with spaces.ts',
      '@@',
      '-old',
      '+new',
      '*** Delete File: src/旧.ts',
      '*** End Patch',
    ].join('\n') },
  })
  for (const mode of ['access', 'mutate', 'read']) {
    const result = spawnSync('bash', ['-c', '. "$1"; hp_code_path "$2" "$3"', 'hook-path-test', library, payload, mode], {
      env: { ...process.env, SPEXCODE_HARNESS: 'codex' }, encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.stdout.trim().split('\n').filter(Boolean), mode === 'read' ? [] : ['src/new.ts', 'src/with spaces.ts', 'src/旧.ts'])
  }
})
