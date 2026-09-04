import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const mentions = readFileSync(new URL('./mentions.jsx', import.meta.url), 'utf8')
const launch = readFileSync(new URL('./launch.js', import.meta.url), 'utf8')

test('the `@` menu offers both action doors, and each re-opens the menu behind its qualifier', () => {
  assert.match(mentions, /export const SESSION_DOORS = \{ new: '@new:', parent: '@parent:' \}/)
  assert.match(mentions, /id: 'parent', label: 'parent'/)
  // a door is not a referent: picking one writes its qualifier and re-runs the trigger scan
  assert.match(mentions, /if \(menu\.kind === 'session' && SESSION_DOORS\[item\.id\]\)/)
  assert.match(mentions, /setMenu\(sessionMentionAt\(nextValue, caret, sessions, launchers\)\)/)
})

test('`@parent:` completes over the ordinary board and writes the stable full id', () => {
  assert.match(mentions, /if \(query\.startsWith\('parent:'\)\) \{/)
  assert.match(mentions, /return \{ kind: 'parent', items, index: 0, start: i, end: caret, query: q \}/)
  // behind the qualifier the rows are sessions only — a supervisor that does not exist yet cannot be named
  assert.match(mentions, /matchSessions\(sessions, q, false\)/)
  assert.match(mentions, /menu\.kind === 'parent' \? `@parent:\$\{item\.id\} `/)
  assert.match(mentions, /parent\s*\n\s*\? `@parent:\$\{menu\.query\}`/)
})

test('the browser sends the directive as ordinary prompt text — the create boundary owns it', () => {
  // launch.js posts the raw draft: the dashboard never resolves a selector or sets `parent` itself, so the
  // phone composer, the CLI and a direct API call all get the same grammar from the one backend owner.
  assert.match(launch, /body: JSON\.stringify\(\{ prompt, \.\.\.\(launcher \? \{ launcher \} : \{\}\) \}\)/)
  assert.doesNotMatch(launch, /@parent/)
})
