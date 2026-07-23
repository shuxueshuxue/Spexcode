import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionStoreDir } from './layout.js'
import { readMessageBatchFile, readSessionMessages } from './message-stream.js'

function withHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), 'spex-messages-'))
  const previous = process.env.SPEXCODE_HOME
  process.env.SPEXCODE_HOME = home
  try { return fn(home) }
  finally {
    if (previous === undefined) delete process.env.SPEXCODE_HOME
    else process.env.SPEXCODE_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

function seedSession(id: string, events?: string): string {
  const dir = sessionStoreDir(id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.json'), `${JSON.stringify({ session_id: id, governed: true })}\n`)
  if (events !== undefined) writeFileSync(join(dir, 'messages.ndjson'), events)
  return dir
}

test('full read returns ordered native events and byte cursors', () => withHome(() => {
  const id = 'messages-full'
  const first = { type: 'user', message: { role: 'user', content: '你好' } }
  const second = { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }
  seedSession(id, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`)

  const batch = readSessionMessages(id)
  assert.ok(batch)
  assert.deepEqual(batch.messages.map((item) => item.event), [first, second])
  assert.equal(batch.cursor, Buffer.byteLength(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`))
}))

test('cursor follow withholds an unterminated append until its newline lands', () => withHome(() => {
  const id = 'messages-follow'
  const first = JSON.stringify({ type: 'user', message: { content: 'one' } })
  const second = JSON.stringify({ type: 'assistant', message: { content: 'two' } })
  const dir = seedSession(id, `${first}\n${second}`)

  const initial = readSessionMessages(id)
  assert.ok(initial)
  assert.equal(initial.messages.length, 1)
  assert.equal(initial.cursor, Buffer.byteLength(`${first}\n`))
  assert.deepEqual(readSessionMessages(id, initial.cursor), { messages: [], cursor: initial.cursor })

  appendFileSync(join(dir, 'messages.ndjson'), '\n')
  const appended = readSessionMessages(id, initial.cursor)
  assert.ok(appended)
  assert.equal(appended.messages.length, 1)
  assert.equal(appended.messages[0].event.type, 'assistant')
}))

test('known missing stream is empty, unknown is null, malformed complete line fails loudly', () => withHome(() => {
  const known = seedSession('messages-empty')
  assert.deepEqual(readSessionMessages('messages-empty'), { messages: [], cursor: 0 })
  assert.equal(readSessionMessages('messages-unknown'), null)

  const malformed = join(known, 'malformed.ndjson')
  writeFileSync(malformed, '{nope}\n')
  assert.throws(() => readMessageBatchFile(malformed), /invalid messages\.ndjson event at byte 0/)
}))
