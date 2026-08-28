import assert from 'node:assert/strict'
import test from 'node:test'
import { ABSENT_REVISION, FrameProducer, LiveTranscript, TranscriptReadError, claudeEvent, isErrorFrame, mergeTranscriptFrame, openFrameStream, unsupportedTranscript, type StreamFrame, type TranscriptRead } from './index.js'

const T = (clock: string) => Date.parse(`2026-08-20T${clock}.000Z`)
const read = (turns: TranscriptRead['turns'], revision = 'r'): TranscriptRead =>
  ({ revision, from: 0, to: 1, turns, truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0 })

test('the producer sends the whole interval once, then only what changed, and the subscriber merges back to it', () => {
  const producer = new FrameProducer()
  const first = producer.next(read([
    { id: 'u1', at: 1, role: 'user', text: 'do it' },
    { id: 'a1', at: 2, role: 'assistant', tools: [{ id: 't1', name: 'Bash', input: 'ls', outputLines: 0, outputBytes: 0 }] },
  ]))
  assert.equal(first?.kind, 'full')
  assert.equal(first?.turns[1]?.tools?.[0]?.output, undefined, 'a running call has no output field')
  assert.equal(producer.next(read(first!.turns as TranscriptRead['turns'])), null, 'an unchanged read is not a frame')
  const second = producer.next(read([
    { id: 'u1', at: 1, role: 'user', text: 'do it' },
    { id: 'a1', at: 2, role: 'assistant', tools: [{ id: 't1', name: 'Bash', input: 'ls', output: 'a\nb', outputLines: 2, outputBytes: 3 }] },
    { id: 'a2', at: 3, role: 'assistant', text: 'done' },
  ]))
  assert.equal(second?.kind, 'delta')
  assert.deepEqual(second?.turns.map((turn) => turn.id), ['a1', 'a2'], 'only the changed and the new turn travel')
  assert.equal(second?.turns[0]?.tools?.[0]?.output, null, 'a recorded body is withheld, its size told')
  assert.equal(second?.turns[0]?.tools?.[0]?.outputBytes, 3)
  let held = mergeTranscriptFrame({ turns: [] }, first!)
  held = mergeTranscriptFrame(held.state, second!)
  assert.deepEqual(held.payload.turns.map((turn) => turn.id), ['u1', 'a1', 'a2'])
  const third = producer.next({ ...read([{ id: 'a2', at: 3, role: 'assistant', text: 'done' }]), omittedTurns: 2, truncated: true })
  assert.deepEqual(third?.removed, ['u1', 'a1'], 'evicted turns are named')
  held = mergeTranscriptFrame(held.state, third!)
  assert.deepEqual(held.payload.turns.map((turn) => turn.id), ['a2'])
  assert.equal((held.payload as StreamFrame).omittedTurns, 2, 'counters are absolute')
  producer.reset()
  assert.equal(producer.next(read([]))?.kind, 'full', 'after a reset the next frame is full again')
  const error = mergeTranscriptFrame(held.state, { revision: 'r4', from: 0, to: 1, error: 'gone', reason: 'missing' })
  assert.ok(isErrorFrame(error.payload) && error.payload.error === 'gone', 'an error frame passes through')
  assert.deepEqual(error.state.turns.map((turn) => turn.id), ['a2'], 'and holds what was there for the next good frame')
  const plain = mergeTranscriptFrame(error.state, { ...read([{ id: 'u9', at: 9, role: 'user', text: 'x' }]), kind: undefined as unknown as 'full' })
  assert.deepEqual(plain.payload.turns.map((turn) => turn.id), ['u9'], 'a frame without a kind (a closed read) is read whole')
  assert.equal('kind' in plain.payload, false, 'the wire kind never reaches the renderer')
})

test('a frame stream reads only when the revision moves, reports absence and failure in place', async () => {
  const live = new LiveTranscript(claudeEvent, 'thread')
  const stream = openFrameStream(live, 'thread', T('00:00:00'), () => T('00:10:00'))
  const absent = await stream.publish()
  assert.ok(absent && !isErrorFrame(absent) && absent.kind === 'full' && absent.revision === ABSENT_REVISION)
  assert.equal(await stream.publish(), null, 'an unchanged revision publishes nothing')
  live.push({ type: 'user', timestamp: '2026-08-20T00:01:00.000Z', message: { role: 'user', content: 'hi' } })
  const full = await stream.publish() as StreamFrame
  assert.equal(full.kind, 'full')
  assert.deepEqual(full.turns.map((turn) => turn.text), ['hi'])
  assert.equal(await stream.publish(), null)
  live.push({ type: 'assistant', timestamp: '2026-08-20T00:01:05.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } })
  const delta = await stream.publish() as StreamFrame
  assert.equal(delta.kind, 'delta')
  assert.deepEqual(delta.turns.map((turn) => turn.text), ['hello'])
  stream.close()
  const refused = openFrameStream(unsupportedTranscript('zcode'), 'thread', 0)
  assert.equal((await refused.publish())?.revision, ABSENT_REVISION, 'an unsupported reader reads as absent, never as a failure')
  const broken = openFrameStream({ revision: () => 'r1', read: async () => { throw new Error('boom') }, tail: () => ({ advance: async () => { throw new Error('boom') }, close: () => {} }) }, 't', 0)
  await assert.rejects(broken.publish(), /boom/, 'a non-transcript failure is not swallowed')
  const failing = await openFrameStream({
    revision: () => 'r1',
    read: async () => { throw new Error('unused') },
    tail: () => ({ advance: async () => { throw new TranscriptReadError('unreadable', 'gone') }, close: () => {} }),
  }, 't', 0).publish()
  assert.ok(failing && isErrorFrame(failing) && failing.reason === 'unreadable')
})
