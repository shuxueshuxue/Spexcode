import assert from 'node:assert/strict'
import test from 'node:test'
import { IntervalCollector, claudeEvent, codexAppServerEvent, geminiEvent, openclawEvent, opencodeEvents, piEvent, type ParsedEvent } from './parsers.js'

// A tool's outcome is the harness's OWN structured verdict, carried through the result event to the call.
// Prose that merely says "error" is not read: absence means "no signal", never "succeeded".

const collect = (events: (ParsedEvent | null)[]) => {
  const collector = new IntervalCollector({ from: 0, to: Number.MAX_SAFE_INTEGER })
  for (const event of events) if (event) collector.add(event)
  return collector.turns.flatMap((turn) => turn.tools)
}

test('claude: is_error on a tool_result marks the call failed; a plain result carries no outcome', () => {
  const at = '2026-08-29T00:00:00.000Z'
  const use = (id: string) => claudeEvent({ type: 'assistant', timestamp: at, uuid: `a-${id}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'x' } }] } })
  const tools = collect([
    use('t1'), use('t2'),
    claudeEvent({ type: 'user', timestamp: at, uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Exit code 1\nboom', is_error: true }] } }),
    claudeEvent({ type: 'user', timestamp: at, uuid: 'r2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'error: not really, just prose' }] } }),
  ])
  assert.equal(tools.find((tool) => tool.id === 't1')?.outcome, 'failed')
  assert.equal(tools.find((tool) => tool.id === 't2')?.outcome, undefined)
  assert.equal(tools.find((tool) => tool.id === 't2')?.output, 'error: not really, just prose')
})

test('codex app-server: item status failed → failed, declined → rejected (and ends the call without output)', () => {
  const started = (id: string) => codexAppServerEvent({ method: 'item/started', params: { startedAtMs: 1, item: { id, type: 'commandExecution', command: 'rm -rf /', status: 'inProgress' } } })
  const tools = collect([
    started('c1'), started('c2'), started('c3'),
    codexAppServerEvent({ method: 'item/completed', params: { completedAtMs: 2, item: { id: 'c1', type: 'commandExecution', command: 'x', status: 'failed', exitCode: 1, aggregatedOutput: 'no such file' } } }),
    codexAppServerEvent({ method: 'item/completed', params: { completedAtMs: 2, item: { id: 'c2', type: 'commandExecution', command: 'x', status: 'declined', aggregatedOutput: null } } }),
    codexAppServerEvent({ method: 'item/completed', params: { completedAtMs: 2, item: { id: 'c3', type: 'commandExecution', command: 'x', status: 'completed', exitCode: 0, aggregatedOutput: 'ok' } } }),
  ])
  const by = (id: string) => tools.find((tool) => tool.id === id)!
  assert.equal(by('c1').outcome, 'failed')
  assert.equal(by('c2').outcome, 'rejected')
  assert.equal(by('c2').output, '', 'a declined call is over — it never ran, so it must not read as running')
  assert.equal(by('c3').outcome, undefined)
})

test('pi and openclaw: isError on the toolResult marks the call failed', () => {
  const at = '2026-08-29T00:00:00.000Z'
  for (const parse of [piEvent, openclawEvent]) {
    const tools = collect([
      parse({ type: 'message', timestamp: at, id: 'a1', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'p1', name: 'bash', arguments: { command: 'x' } }] } }),
      parse({ type: 'message', timestamp: at, id: 'r1', message: { role: 'toolResult', toolCallId: 'p1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true } }),
    ])
    assert.equal(tools[0]?.outcome, 'failed', parse.name)
  }
})

test('opencode: a tool part in state error is failed; gemini: a call with status error is failed', () => {
  const opencode = opencodeEvents({ messages: [{ info: { id: 'm1', role: 'assistant', time: { created: 1 } }, parts: [
    { type: 'tool', callID: 'o1', tool: 'bash', state: { status: 'error', input: { command: 'x' }, error: 'boom' } },
    { type: 'tool', callID: 'o2', tool: 'bash', state: { status: 'completed', input: { command: 'y' }, output: 'fine' } },
  ] }] })
  const tools = collect(opencode)
  assert.equal(tools.find((tool) => tool.id === 'o1')?.outcome, 'failed')
  assert.equal(tools.find((tool) => tool.id === 'o2')?.outcome, undefined)
  const gemini = collect([geminiEvent({ type: 'gemini', id: 'g1', timestamp: '2026-08-29T00:00:00.000Z', content: '', toolCalls: [
    { id: 'gc1', name: 'run_shell_command', args: { command: 'x' }, status: 'error' },
    { id: 'gc2', name: 'run_shell_command', args: { command: 'y' }, status: 'success' },
  ] })])
  assert.equal(gemini.find((tool) => tool.id === 'gc1')?.outcome, 'failed')
  assert.equal(gemini.find((tool) => tool.id === 'gc2')?.outcome, undefined)
})
