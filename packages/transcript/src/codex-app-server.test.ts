import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { LiveTranscript, mergeTranscriptFrame, openFrameStream, type StreamFrame } from './index.js'
import { codexAppServerEvent, codexAppServerStream } from './parsers.js'

const fixture = join(process.cwd(), 'fixtures', 'codex-app-server', 'notifications.jsonl')
const notifications = readFileSync(fixture, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>)
const params = (notification: Record<string, unknown>) => notification.params as Record<string, unknown>
const item = (notification: Record<string, unknown>) => params(notification).item as Record<string, unknown>

test('codex app-server parser maps native item ids and ignores unrelated notifications', () => {
  const started = notifications.find((notification) => notification.method === 'item/started' && item(notification).type === 'commandExecution')!
  const completed = notifications.find((notification) => notification.method === 'item/completed' && item(notification).type === 'commandExecution')!
  const first = codexAppServerEvent(started)!
  const second = codexAppServerEvent(completed)!
  assert.equal(first.turn?.id, item(started).id)
  assert.equal(first.turn?.tools?.[0]?.id, item(started).id)
  assert.equal(first.turn?.tools?.[0]?.output, undefined)
  assert.deepEqual(second.toolOutputs, [{ id: item(completed).id, text: 'ok' }])
  assert.equal(codexAppServerEvent({ method: 'thread/status/changed', params: {} }), null)
})

test('real app-server notifications produce one delta stream and attach command output', async () => {
  const threadId = String((params(notifications.find((notification) => notification.method === 'turn/started')!)).threadId)
  const live = new LiveTranscript(codexAppServerStream(), threadId)
  let now = 0
  const stream = openFrameStream(live, threadId, 0, () => now)
  let held: { turns: readonly any[] } = { turns: [] }
  const frames: StreamFrame[] = []
  let runningSeen = false
  let completedSeen = false

  for (const notification of notifications) {
    now = Number(notification.emittedAtMs) || now + 1
    live.push(notification)
    const frame = await stream.publish()
    if (frame && 'kind' in frame) {
      frames.push(frame)
      held = mergeTranscriptFrame(held, frame).state
    }
    if (notification.method === 'item/started' && item(notification).type === 'commandExecution') {
      const read = await live.read(threadId, { from: 0, to: now })
      const tool = read.turns.find((turn) => turn.tools?.some((call) => call.id === item(notification).id))?.tools?.[0]
      assert.equal(tool?.output, undefined)
      runningSeen = true
    }
    if (notification.method === 'item/completed' && item(notification).type === 'commandExecution') {
      const read = await live.read(threadId, { from: 0, to: now })
      const tool = read.turns.find((turn) => turn.tools?.some((call) => call.id === item(notification).id))?.tools?.[0]
      assert.equal(tool?.output, 'ok')
      completedSeen = true
    }
  }
  assert.equal(runningSeen, true)
  assert.equal(completedSeen, true)
  assert.equal(frames[0]?.kind, 'full')
  assert.ok(frames.some((frame) => frame.kind === 'delta'))

  const read = await live.read(threadId, { from: 0, to: now })
  const agentTurns = read.turns.filter((turn) => turn.role === 'assistant' && turn.text)
  assert.equal(agentTurns.length, 2, 'commentary and final agent items are each one turn despite many deltas')
  assert.equal(new Set(agentTurns.map((turn) => turn.id)).size, agentTurns.length)
  const projected = (turns: readonly any[]) => turns.map(({ tools, ...turn }) => ({
    ...turn,
    tools: tools?.map(({ output, ...tool }: any) => tool),
  }))
  assert.deepEqual(projected(held.turns), projected(read.turns), 'merged frames carry the same turns as a one-shot read')
})

