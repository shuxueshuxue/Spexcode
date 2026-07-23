import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { isMessageStreamSession, rowsFromMessages } from './messageStream.js'

const sessionInterface = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')

test('only registered headless harnesses select the message console', () => {
  assert.equal(isMessageStreamSession({ harness: 'claude-headless' }), true)
  assert.equal(isMessageStreamSession({ harness: 'claude' }), false)
  assert.equal(isMessageStreamSession({ harness: 'codex' }), false)
})

test('native turns become ordered bubbles and compact tool summaries', () => {
  const messages = [
    { cursor: 10, event: { type: 'user', message: { role: 'user', content: 'inspect the session stream' } } },
    { cursor: 20, event: { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'text', text: 'I will inspect it.' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/messages.ndjson' } },
    ] } } },
  ]
  assert.deepEqual(rowsFromMessages(messages), [
    { key: '10:0', kind: 'user', text: 'inspect the session stream' },
    { key: '20:0', kind: 'assistant', text: 'I will inspect it.' },
    { key: '20:1', kind: 'tool', name: 'Read', summary: '/tmp/messages.ndjson' },
  ])
})

test('tool results and non-conversation envelopes stay out of the chat', () => {
  const messages = [
    { cursor: 10, event: { type: 'system', subtype: 'init' } },
    { cursor: 20, event: { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'large output' }] } } },
    { cursor: 30, event: { type: 'result', result: 'done' } },
  ]
  assert.deepEqual(rowsFromMessages(messages), [])
})

test('headless layers mount SessionMessages instead of SessionTerm, including while offline', () => {
  assert.match(sessionInterface, /isMessageStreamSession\(s\) \|\| s\.liveness !== 'offline'/)
  assert.match(sessionInterface, /stream\s*\? <SessionMessages sessionId=\{id\}/)
  assert.match(sessionInterface, /: <SessionTerm sessionId=\{id\}/)
  assert.match(sessionInterface, /!messageConsole && noLivePane/)
})
