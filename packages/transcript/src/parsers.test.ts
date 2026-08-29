import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { IntervalCollector, claudeEvent, codexAppServerEvent, codexAppServerStream, codexEvent, geminiEvent, openclawEvent, opencodeEvents, piEvent, type ParsedEvent } from './parsers.js'

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

test('pi and OpenClaw: one format, one parser — the turn keeps the producer\'s verdict even with nothing to show', () => {
  const entryAt = '2026-08-29T00:00:10.000Z'
  const record = (stopReason: string, errorMessage?: string) => ({
    type: 'message', id: 'e1', timestamp: entryAt,
    message: { role: 'assistant', timestamp: Date.parse('2026-08-29T00:00:00.000Z'), content: [], stopReason, ...(errorMessage ? { errorMessage } : {}) },
  })
  // the two harnesses write the same bytes, so they must read the same — including WHICH clock is the turn's
  assert.equal(openclawEvent, piEvent)
  const failed = piEvent(record('error', 'Request timed out.'))?.turn
  assert.equal(failed?.outcome, 'failed')
  assert.equal(failed?.error, 'Request timed out.')
  // a turn the provider failed carries no text and no calls; dropping it leaves a gap where the timeout was
  assert.equal(failed?.text, undefined)
  assert.equal(failed?.tools.length, 0)
  assert.equal(piEvent(record('aborted'))?.turn?.outcome, 'cancelled')
  assert.equal(piEvent(record('aborted'))?.turn?.error, undefined)
  assert.equal(piEvent(record('stop'))?.turn?.outcome, undefined)
  assert.equal(piEvent(record('toolUse'))?.turn?.outcome, undefined)
  // the entry's append time is the observable an interval read answers with, not the message's construction time
  assert.equal(piEvent(record('stop'))?.at, Date.parse(entryAt))
})

test('the codex app-server stream is read against the producer\'s own capture: deltas have a clock and become prose', () => {
  const capture = readFileSync(join(process.cwd(), 'fixtures', 'codex-app-server', 'notifications.jsonl'), 'utf8')
  const lines = capture.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  const deltas = lines.filter((line) => line.method === 'item/agentMessage/delta')
  assert.ok(deltas.length > 0, 'the capture contains deltas')
  // the envelope carries the clock beside `method` and `params`; a delta has no clock of its own inside params,
  // so reading it from there made every delta timeless and the whole streaming path silently empty
  assert.ok(deltas.every((line) => typeof line.emittedAtMs === 'number'))
  assert.ok(deltas.every((line) => (line.params as Record<string, unknown>).emittedAtMs === undefined))
  const parse = codexAppServerStream()
  const collector = new IntervalCollector({ from: 0, to: 2_000_000_000_000 })
  for (const line of lines) { const event = parse(line); if (event) collector.add(event) }
  const read = collector.finish('r1', 'codex-app-server')
  assert.ok(read.turns.some((turn) => turn.role === 'assistant' && (turn.text || '').length > 0), 'the deltas became prose')
})

test('a result recorded as content blocks reads as the text of those blocks, line breaks kept, non-text blocks named', () => {
  const at = '2026-08-29T00:00:00.000Z'
  const claude = collect([
    claudeEvent({ type: 'assistant', timestamp: at, uuid: 'a', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'm1', name: 'mcp__im__send', input: { chat: '1' } }, { type: 'tool_use', id: 'm2', name: 'Read', input: { file_path: 'x.png' } }] } }),
    claudeEvent({ type: 'user', timestamp: at, uuid: 'r', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'm1', content: [{ type: 'text', text: 'sent to 1\nid: 7' }, { type: 'text', text: 'ok' }] },
      { type: 'tool_result', tool_use_id: 'm2', content: [{ type: 'image', source: { type: 'base64', data: 'AAAA' } }] },
    ] } }),
  ])
  assert.equal(claude.find((tool) => tool.id === 'm1')?.output, 'sent to 1\nid: 7\nok')
  assert.equal(claude.find((tool) => tool.id === 'm2')?.output, '[image]')
  const codex = collect([
    codexEvent({ timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'c1', name: 'exec', input: 'print(1)' } }),
    codexEvent({ timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'c1', output: [{ type: 'input_text', text: 'Script completed\nOutput:\n' }, { type: 'input_text', text: '1\n' }] } }),
  ])
  assert.equal(codex[0]?.output, 'Script completed\nOutput:\n\n1\n', 'never the JSON of the block list')
})

test('codex code-mode exec: the shell command is surfaced, not the JS wrapper (specialization stays in the codex adapter)', () => {
  const at = '2026-08-29T00:00:00.000Z'
  const call = (id, input) => codexEvent({ timestamp: at, type: 'response_item', payload: { type: 'custom_tool_call', call_id: id, name: 'exec', input } })
  const one = collect([call('c1', 'const r = await tools.exec_command({cmd:"echo \\"$(date +%T) tick\\" >> /tmp/w.log",yield_time_ms:1000}); text(r.output);')])
  assert.equal(one[0].input, 'echo "$(date +%T) tick" >> /tmp/w.log', 'the cmd is unescaped and the JS wrapper is gone')
  const many = collect([call('c2', 'await Promise.all([tools.exec_command({cmd:"ls"}), tools.exec_command({cmd:"pwd"})])')])
  assert.equal(many[0].input, 'ls\npwd', 'a batch shows each command on its own line')
  const notExec = collect([call('c3', 'const x = 1; console.log(x)')])
  assert.equal(notExec[0].input, 'const x = 1; console.log(x)', 'a non-exec_command cell is left untouched')
})
