import assert from 'node:assert/strict'
import test from 'node:test'
import { LiveTranscript, TranscriptReadError, claudeEvent, codexEvent } from './index.js'

const T = (clock: string) => Date.parse(`2026-08-20T${clock}.000Z`)

test('a live transcript is a reader: absent until pushed, then interval reads and an incremental tail', async () => {
  const live = new LiveTranscript(claudeEvent, 'claude-thread')
  assert.equal(live.revision('claude-thread'), null)
  let changes = 0
  const stop = live.onChange(() => { changes++ })
  assert.equal(live.push({ type: 'system', subtype: 'init', session_id: 'claude-thread' }), false, 'a control record is not a turn')
  assert.equal(live.push({ type: 'user', timestamp: '2026-08-20T00:00:00.000Z', message: { role: 'user', content: 'run it' } }), true)
  assert.equal(live.push({ type: 'assistant', timestamp: '2026-08-20T00:00:05.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'run', name: 'Bash', input: { command: 'sleep 1' } }] } }), true)
  assert.equal(changes, 2)
  const tail = live.tail('claude-thread', T('00:00:00'))
  const first = await tail.advance(T('00:00:10'))
  assert.deepEqual(first.turns.map((turn) => turn.role), ['user', 'assistant'])
  assert.equal(first.turns[1]?.tools?.[0]?.output, undefined, 'a call without its result is running')
  live.push({ type: 'user', timestamp: '2026-08-20T00:00:06.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'run', content: 'ok' }] } })
  assert.equal(live.push({ type: 'result', subtype: 'success', result: 'done' }), false)
  const second = await tail.advance(T('00:00:20'))
  assert.equal(second.turns[1]?.tools?.[0]?.output, 'ok', 'the result joins the call from the earlier advance')
  assert.equal(second.revision, '3')
  const whole = await live.read('claude-thread', { from: T('00:00:00'), to: T('00:00:20') })
  assert.deepEqual(whole, second, 'a one-shot read equals the cursor snapshot')
  stop()
  live.push({ type: 'user', timestamp: '2026-08-20T00:00:30.000Z', message: { role: 'user', content: 'more' } })
  assert.equal(changes, 3, 'a removed listener is not called')
  await assert.rejects(live.read('other', { from: 0, to: 1 }), (error: unknown) => error instanceof TranscriptReadError && error.reason === 'missing')
})

test('the same codex parser reads a rollout line from memory', async () => {
  const live = new LiveTranscript(codexEvent, 'codex-thread')
  live.push({ type: 'event_msg', payload: { type: 'user_message', message: 'hello', timestamp: '2026-08-20T00:00:00.000Z' } })
  live.push({ type: 'event_msg', payload: { type: 'agent_message', message: 'hi there', timestamp: '2026-08-20T00:00:01.000Z' } })
  const read = await live.read('codex-thread', { from: T('00:00:00'), to: T('00:00:05') })
  assert.deepEqual(read.turns.map((turn) => [turn.role, turn.text, turn.id]), [['user', 'hello', `user@${T('00:00:00')}`], ['assistant', 'hi there', `assistant@${T('00:00:01')}`]])
})

// captured 2026-08-29 from a real claude-headless session steered mid-turn (bench 3.6, ~/spexcode-evidence/9b7bbed4/claude-steer-attachment.jsonl)
const STEER_ATTACHMENT = { parentUuid: 'cfcdaf08-d5e6-47e6-86b5-c63d7ca92e9f', isSidechain: false, attachment: { type: 'queued_command', prompt: [{ type: 'text', text: 'STEER: stop counting now. Do not run any further sleep command. Declare done immediately with the last number you echoed.' }] }, uuid: 'b1c2d3e4-0000-4000-8000-000000000001', type: 'attachment', timestamp: '2026-08-28T20:58:39.012Z', userType: 'external', entrypoint: 'cli' }

test('a message steered into a running Claude turn is a user turn, in both sources', async () => {
  const live = new LiveTranscript(claudeEvent, 'steered')
  live.push({ type: 'assistant', timestamp: '2026-08-28T20:58:30.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c10', name: 'Bash', input: { command: 'sleep 4 && echo 10' } }] } })
  assert.equal(live.push(STEER_ATTACHMENT), true, 'the queued command is recognized')
  live.push({ type: 'assistant', timestamp: '2026-08-28T20:58:50.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Done. Counted 1 through 11.' }] } })
  const read = await live.read('steered', { from: Date.parse('2026-08-28T20:58:00Z'), to: Date.parse('2026-08-28T20:59:00Z') })
  assert.deepEqual(read.turns.map((turn) => [turn.role, turn.id]), [['assistant', 'assistant@1787950710000'], ['user', 'b1c2d3e4-0000-4000-8000-000000000001'], ['assistant', 'assistant@1787950730000']])
  assert.match(read.turns[1].text || '', /^STEER: stop counting now/)
  assert.equal(live.push({ type: 'attachment', timestamp: '2026-08-28T20:58:40.000Z', attachment: { type: 'total_tokens_reminder', text: '<total_tokens>1</total_tokens>' } }), false, 'other attachments are not turns')
})
