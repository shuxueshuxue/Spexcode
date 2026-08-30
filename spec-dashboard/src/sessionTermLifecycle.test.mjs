import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./terminal/SessionTerminal.tsx', import.meta.url), 'utf8')

test('SessionTerm keeps the identity-owned resource effect across active pane switches', () => {
  assert.match(source, /useEffect\(\(\) => \{[\s\S]*?new Terminal\(/, 'the identity effect owns Terminal construction')
  assert.match(source, /\n  \}, \[sessionId\]\)/, 'terminal/socket teardown is keyed only by session identity')
  assert.doesNotMatch(source, /useEffect\(\(\) => \{\n    if \(!active\) return undefined/, 'active=false does not skip the identity resource effect')
  assert.match(source, /JSON\.stringify\(\{ t: 'visible', visible: false \}\)/, 'hidden transitions send the bridge visibility claim')
  assert.match(source, /if \(active && document\.visibilityState !== 'hidden'\) \{[\s\S]*?measureRef\.current\?\.\(\)/, 'visible transitions reuse measurement instead of rebuilding xterm')
  assert.match(source, /else \{[\s\S]*?hideRef\.current\?\.\(\)/, 'inactive transitions claim the bridge as hidden')
  assert.match(source, /term\.options\.disableStdin = !writable/, 'activation updates xterm input state without remounting')
})
