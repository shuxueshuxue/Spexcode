import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { isHeadlessSession, isMessageStreamSession, rowsFromMessages } from './messageStream.js'

const sessionInterface = readFileSync(new URL('./SessionInterface.jsx', import.meta.url), 'utf8')
const timelineChat = readFileSync(new URL('./TimelineChat.jsx', import.meta.url), 'utf8')

test('console surfaces read adapter capabilities without interpreting harness ids', () => {
  assert.equal(isHeadlessSession({ capabilities: { headless: true, messageStream: false } }), true)
  assert.equal(isHeadlessSession({ harness: 'claude-headless' }), false)
  assert.equal(isMessageStreamSession({ capabilities: { headless: true, messageStream: true } }), true)
  assert.equal(isMessageStreamSession({ harness: 'claude-headless' }), false)
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

test('headless layers reuse TimelineChat while pane-backed layers retain SessionTerm', () => {
  assert.match(sessionInterface, /isHeadlessSession\(s\) \|\| s\.liveness !== 'offline'/)
  assert.match(sessionInterface, /headless\s*\? <TimelineChat s=\{session\}/)
  assert.match(sessionInterface, /: <SessionTerm sessionId=\{id\}/)
  assert.doesNotMatch(sessionInterface, /claude-headless/)
})

test('TimelineChat gates the native full-process drill-down on messageStream capability', () => {
  assert.match(timelineChat, /const hasFullProcess = isMessageStreamSession\(s\)/)
  assert.match(timelineChat, /hasFullProcess && \(/)
  assert.match(timelineChat, /<SessionMessages sessionId=\{s\.id\} active=\{active\} \/>/)
  assert.match(timelineChat, /sendSessionText\(s\.id, text, \{ replyVia: 'note' \}\)/)
  assert.doesNotMatch(timelineChat, /claude-headless/)
})
