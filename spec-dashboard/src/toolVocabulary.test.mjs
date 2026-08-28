import assert from 'node:assert/strict'
import test from 'node:test'
import { toolTarget } from './toolVocabulary.js'

test('tool targets recognize native path and shell argument spellings', () => {
  assert.equal(toolTarget('{"file_path":"/repo/claude.ts"}'), '/repo/claude.ts')
  assert.equal(toolTarget('{"path":"/repo/pi.ts"}'), '/repo/pi.ts')
  assert.equal(toolTarget('{"filePath":"/repo/opencode.ts"}'), '/repo/opencode.ts')
  assert.equal(toolTarget('{"cmd":"npm test"}'), 'npm test')
})
