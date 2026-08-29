import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { claudeTranscript, codexTranscript, geminiTranscript, hermesTranscriptReader, openclawTranscript, opencodeTranscriptReader, piTranscript, TranscriptReadError, unsupportedTranscript } from './index.js'

const line = (value: unknown) => `${JSON.stringify(value)}\n`
const T = (clock: string) => Date.parse(`2026-08-20T${clock}.000Z`)
const fixture = (harness: string, name: string) => join(process.cwd(), 'fixtures', harness, name)

function withEnv(name: string, value: string, run: () => Promise<void>): Promise<void> {
  const old = process.env[name]
  process.env[name] = value
  return run().finally(() => { if (old === undefined) delete process.env[name]; else process.env[name] = old })
}

test('Gemini and OpenClaw fixture readers normalize prose, calls, and results', async () => {
  await withEnv('GEMINI_HOME', join(process.cwd(), 'fixtures', 'gemini'), async () => {
    const read = await geminiTranscript.read('9fbeda16-d7fa-4d34-abfe-4207e5733917', { from: 0, to: 2_000_000_000_000 })
    assert.ok(read.turns.some((turn) => turn.role === 'assistant' && turn.tools?.some((tool) => tool.name === 'mcp_g1_probe_tool' && tool.output?.includes('MCP_MARKER:alpha'))))
    assert.ok(read.turns.some((turn) => turn.role === 'assistant' && turn.text === 'TOOL_OK'))
  })
  await withEnv('OPENCLAW_STATE_DIR', join(process.cwd(), 'fixtures', 'openclaw'), async () => {
    const read = await openclawTranscript.read('c6d0ca7e-8549-4b69-aaf9-ffc04117e3c2', { from: 0, to: 2_000_000_000_000 })
    assert.ok(read.turns.some((turn) => turn.tools?.some((tool) => tool.name === 'g1-probe__g1_marker' && tool.output === 'G1_MARKER:first-turn')))
    assert.ok(read.turns.some((turn) => turn.text?.startsWith('RESUME_OK')))
    assert.ok(!read.turns.some((turn) => turn.text?.includes('The user wants me to:')))
  })
})

test('Hermes export fixture reader uses state.db revision and joins tool results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-hermes-'))
  writeFileSync(join(root, 'state.db'), 'fixture')
  const exported = readFileSync(fixture('hermes', 'hermes-20260829_024341_62ec96.jsonl'), 'utf8')
  const reader = hermesTranscriptReader(root, () => exported)
  // the window is DERIVED from the fixture's own clock, in the epoch MILLISECONDS the session API passes: a
  // window wide enough to hold both the right answer and a seconds-as-milliseconds one (1970) cannot tell them
  // apart, and that is exactly the defect this asserts against — Hermes writes epoch seconds
  const stamps = (JSON.parse(exported).messages as { timestamp: number }[]).map((m) => Math.round(m.timestamp * 1000))
  const read = await reader.read('20260829_024341_62ec96', { from: Math.min(...stamps), to: Math.max(...stamps) })
  assert.ok(read.turns.length > 0, 'the real millisecond window contains the thread')
  assert.ok(read.turns.every((turn) => turn.at >= Math.min(...stamps) && turn.at <= Math.max(...stamps)))
  assert.ok(read.turns.some((turn) => turn.role === 'assistant' && turn.tools?.some((tool) => tool.name === 'terminal' && tool.output?.includes('exit_code'))))
  assert.ok(read.turns.some((turn) => turn.text === 'G1_RESUME_OK'))
  assert.ok(!read.turns.some((turn) => turn.text?.includes('The user wants me to:')))
  rmSync(root, { recursive: true, force: true })
})

test('claude transcript reader filters the requested interval and joins tool output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CLAUDE_CONFIG_DIR', root, async () => {
    const path = join(root, 'projects', 'fixture', 'claude-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [
      line({ type: 'user', timestamp: '2026-08-20T00:00:00.000Z', message: { role: 'user', content: 'before' } }),
      line({ type: 'assistant', timestamp: '2026-08-20T00:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'inside' }, { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'printf ok' } }, { type: 'tool_use', id: 'tool-2', name: 'Read', input: { path: 'notes.md' } }] } }),
      line({ type: 'user', timestamp: '2026-08-20T00:01:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok\nsecond' }, { type: 'tool_result', tool_use_id: 'tool-2', content: 'notes' }, { type: 'tool_result', tool_use_id: 'outside-interval', content: 'orphan' }] } }),
      line({ type: 'assistant', timestamp: '2026-08-20T00:03:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'after' }] } }),
    ].join(''))
    assert.ok(claudeTranscript.revision('claude-thread'))
    const result = await claudeTranscript.read('claude-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.deepEqual(result.turns.map((turn) => turn.text), ['inside'])
    assert.equal(result.turns[0]?.tools?.[0]?.input, '{"command":"printf ok"}')
    assert.equal(result.turns[0]?.tools?.[0]?.output, 'ok\nsecond')
    assert.equal(result.turns[0]?.tools?.[0]?.outputLines, 2)
    assert.equal(result.turns[0]?.tools?.[1]?.output, 'notes')
    assert.equal(result.turns[0]?.tools?.[1]?.outputLines, 1)
    assert.equal(result.omittedBytes, Buffer.byteLength('orphan'))
    assert.equal(result.truncated, true)
    assert.equal(result.revision, claudeTranscript.revision('claude-thread'))
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('an open interval re-read seeks to its first event and sees a still-running tool as output-less', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CLAUDE_CONFIG_DIR', root, async () => {
    const path = join(root, 'projects', 'fixture', 'live-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    const lines: string[] = []
    for (let index = 0; index < 300; index++) lines.push(line({ type: 'assistant', timestamp: `2026-08-19T00:00:${String(index % 60).padStart(2, '0')}.000Z`, message: { role: 'assistant', content: [{ type: 'text', text: `old ${index}` }] } }))
    lines.push(line({ type: 'user', timestamp: '2026-08-20T00:00:00.000Z', message: { role: 'user', content: 'current prompt' } }))
    lines.push(line({ type: 'assistant', timestamp: '2026-08-20T00:00:05.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'run', name: 'Bash', input: { command: 'sleep 30' } }] } }))
    writeFileSync(path, lines.join(''))
    const from = T('00:00:00')
    const first = await claudeTranscript.read('live-thread', { from, to: T('00:00:10') })
    assert.deepEqual(first.turns.map((turn) => turn.role), ['user', 'assistant'])
    assert.equal(first.turns[1]?.tools?.[0]?.output, undefined, 'a call without its result is still running')
    const revision = claudeTranscript.revision('live-thread')
    appendFileSync(path, line({ type: 'user', timestamp: '2026-08-20T00:00:36.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'run', content: 'done' }] } }))
    assert.notEqual(claudeTranscript.revision('live-thread'), revision, 'an append moves the revision')
    const second = await claudeTranscript.read('live-thread', { from, to: T('00:01:00') })
    assert.equal(second.turns[1]?.tools?.[0]?.output, 'done')
    assert.equal(second.omittedTurns, 0, 'the seek starts at the interval, so nothing older is parsed or counted')
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('an open interval tail parses only what the harness appended, keys every turn, and starts over when the file shrinks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CLAUDE_CONFIG_DIR', root, async () => {
    const path = join(root, 'projects', 'fixture', 'tail-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    const from = T('00:00:00')
    const tail = claudeTranscript.tail('tail-thread', from)
    await assert.rejects(() => tail.advance(T('00:00:01')), /file was not found/, 'a tail opened before the thread exists fails as missing on advance')
    writeFileSync(path, [
      line({ type: 'assistant', timestamp: '2026-08-19T23:59:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'older stretch' }] } }),
      line({ type: 'user', timestamp: '2026-08-20T00:00:00.000Z', message: { role: 'user', content: 'current prompt' } }),
      line({ type: 'assistant', timestamp: '2026-08-20T00:00:05.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'run', name: 'Bash', input: { command: 'sleep 30' } }] } }),
    ].join(''))
    const first = await tail.advance(T('00:00:10'))
    assert.deepEqual(first.turns.map((turn) => turn.role), ['user', 'assistant'])
    assert.equal(first.turns[1]?.tools?.[0]?.output, undefined)
    // a partial trailing line is still being written: it is carried, not parsed, until its newline lands
    const result = line({ type: 'user', timestamp: '2026-08-20T00:00:36.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'run', content: 'done' }] } })
    appendFileSync(path, result.slice(0, 40))
    const partial = await tail.advance(T('00:00:40'))
    assert.equal(partial.turns.length, 2)
    assert.equal(partial.turns[1]?.tools?.[0]?.output, undefined)
    appendFileSync(path, result.slice(40))
    appendFileSync(path, line({ type: 'assistant', timestamp: '2026-08-20T00:00:37.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'after' }] } }))
    const second = await tail.advance(T('00:01:00'))
    assert.equal(second.turns[1]?.tools?.[0]?.output, 'done', 'the result joined the call from an earlier advance')
    assert.deepEqual(second.turns.map((turn) => turn.text ?? null), ['current prompt', null, 'after'])
    assert.ok(second.turns.every((turn) => typeof turn.id === 'string' && turn.id), 'every turn carries an id')
    assert.deepEqual(second.turns.map((turn) => turn.id), first.turns.map((turn) => turn.id).concat(second.turns[2]!.id), 'ids are stable across advances')
    // the same interval read one-shot agrees with the cursor
    const whole = await claudeTranscript.read('tail-thread', { from, to: T('00:01:00') })
    assert.deepEqual(whole.turns, second.turns)
    // a rewritten (shorter) file is read afresh rather than from a stale position
    writeFileSync(path, line({ type: 'user', timestamp: '2026-08-20T00:00:01.000Z', message: { role: 'user', content: 'rewritten' } }))
    const fresh = await tail.advance(T('00:01:30'))
    assert.deepEqual(fresh.turns.map((turn) => turn.text), ['rewritten'])
    tail.close()
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('a turn without a native id is keyed by its place in the thread', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CODEX_HOME', root, async () => {
    const path = join(root, 'sessions', '2026', '08', '20', 'rollout-keyed-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [
      line({ timestamp: '2026-08-20T00:00:01.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'go' } }),
      line({ timestamp: '2026-08-20T00:00:02.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'first' } }),
      line({ timestamp: '2026-08-20T00:00:02.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'second, same clock' } }),
    ].join(''))
    const read = await codexTranscript.read('keyed-thread', { from: T('00:00:00'), to: T('00:00:10') })
    assert.deepEqual(read.turns.map((turn) => turn.id), [`user@${T('00:00:01')}`, `assistant@${T('00:00:02')}`, `assistant@${T('00:00:02')}#1`])
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('append-only Codex files keep each native id as its own turn', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CODEX_HOME', root, async () => {
    const path = join(root, 'sessions', '2026', '08', '20', 'rollout-native-ids.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [
      line({ type: 'event_msg', payload: { id: 'message-1', type: 'agent_message', timestamp: '2026-08-20T00:00:01.000Z', message: 'first' } }),
      line({ type: 'event_msg', payload: { id: 'message-2', type: 'agent_message', timestamp: '2026-08-20T00:00:02.000Z', message: 'second' } }),
    ].join(''))
    const read = await codexTranscript.read('native-ids', { from: T('00:00:00'), to: T('00:00:10') })
    assert.deepEqual(read.turns.map((turn) => turn.id), ['message-1', 'message-2'])
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('codex transcript reader detects timestamp disorder inside its bounded post-range lookahead', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CODEX_HOME', root, async () => {
    const path = join(root, 'sessions', '2026', '08', '20', 'rollout-1-disordered-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', timestamp: '2026-08-20T00:03:00.000Z', message: 'past interval' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', timestamp: '2026-08-20T00:01:00.000Z', message: 'late in file' } }),
    ].join(''))
    const result = await codexTranscript.read('disordered-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.equal(result.turns[0]?.text, 'late in file')
    assert.equal(result.outOfOrderEvents, 1)
    assert.equal(result.truncated, true)
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('codex transcript reader keeps the newest turns under its cap and reports the rest omitted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CODEX_HOME', root, async () => {
    const path = join(root, 'sessions', '2026', '08', '20', 'rollout-1-codex-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    const records = [
      line({ timestamp: '2026-08-20T00:00:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'before' } }),
      line({ timestamp: '2026-08-20T00:01:00.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'inside' } }),
      line({ timestamp: '2026-08-20T00:01:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'tool-1', name: 'shell', arguments: '{}' } }),
      line({ timestamp: '2026-08-20T00:01:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'tool-1', output: 'done' } }),
    ]
    for (let index = 0; index < 205; index++) records.push(line({ timestamp: '2026-08-20T00:01:10.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: `turn ${index}` } }))
    records.push(line({ timestamp: '2026-08-20T00:01:50.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'final_answer', message: 'the answer' } }))
    records.push(line({ timestamp: '2026-08-20T00:03:00.000Z', type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'after' } }))
    writeFileSync(path, records.join(''))
    const result = await codexTranscript.read('codex-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.equal(result.turns.length, 200)
    assert.equal(result.turns.at(-1)?.text, 'the answer', 'the final answer is what the agent said, and the newest turn survives the cap')
    assert.equal(result.turns[0]?.text, 'turn 6', 'the oldest turns are the ones dropped')
    assert.equal(result.truncated, true)
    assert.equal(result.omittedTurns, 8)
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('pi transcript reader locates the session by its header and joins tool results', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('SPEXCODE_PI_AGENT_DIR', root, async () => {
    const path = join(root, 'sessions', '--project--', 'trace.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [
      line({ type: 'session', version: 3, id: 'pi-thread', timestamp: '2026-08-20T00:00:00.000Z' }),
      line({ type: 'message', id: 'u1', timestamp: '2026-08-20T00:01:00.000Z', message: { role: 'user', content: 'current prompt' } }),
      line({ type: 'message', id: 'a1', timestamp: '2026-08-20T00:01:05.000Z', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'text', text: 'Inspect the focused file' }, { type: 'toolCall', id: 'session-call', name: 'read', arguments: { path: '/repo/focus.ts' } }] } }),
      line({ type: 'message', id: 'r1', timestamp: '2026-08-20T00:01:06.000Z', message: { role: 'toolResult', toolCallId: 'session-call', content: [{ type: 'text', text: 'file body' }] } }),
    ].join(''))
    assert.ok(piTranscript.revision('pi-thread'))
    assert.equal(piTranscript.revision('other-thread'), null)
    const result = await piTranscript.read('pi-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.deepEqual(result.turns.map((turn) => [turn.role, turn.text]), [['user', 'current prompt'], ['assistant', 'Inspect the focused file']])
    assert.equal(result.turns[1]?.tools?.[0]?.name, 'read')
    assert.equal(result.turns[1]?.tools?.[0]?.input, '{"path":"/repo/focus.ts"}')
    assert.equal(result.turns[1]?.tools?.[0]?.output, 'file body')
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING/)
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('opencode transcript reader parses one export per store revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-store-'))
  try {
    writeFileSync(join(root, 'opencode.db'), '')
    writeFileSync(join(root, 'opencode.db-wal'), '')
    let exports = 0
    const data = { messages: [
      { info: { role: 'user', id: 'u1', time: { created: T('00:01:00') } }, parts: [{ type: 'text', text: 'current prompt' }] },
      { info: { role: 'assistant', id: 'a1', time: { created: T('00:01:05') } }, parts: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'text', text: 'Check the stored selection' }, { type: 'tool', callID: 'store-call', tool: 'read', state: { status: 'running', input: { path: '/repo/store.ts' } } }] },
    ] }
    const reader = opencodeTranscriptReader(root, () => { exports++; return JSON.stringify(data) })
    const first = await reader.read('store-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.deepEqual(first.turns.map((turn) => [turn.role, turn.text]), [['user', 'current prompt'], ['assistant', 'Check the stored selection']])
    assert.equal(first.turns[1]?.tools?.[0]?.input, '{"path":"/repo/store.ts"}')
    assert.equal(first.turns[1]?.tools?.[0]?.output, undefined, 'a running tool has no output yet')
    await reader.read('store-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.equal(exports, 1, 'an unchanged store is not exported again')
    data.messages[1].parts[2] = { type: 'tool', callID: 'store-call', tool: 'read', state: { status: 'completed', input: { path: '/repo/store.ts' }, output: 'stored\nbody' } } as never
    appendFileSync(join(root, 'opencode.db-wal'), 'x')
    const second = await reader.read('store-thread', { from: T('00:00:30'), to: T('00:02:00') })
    assert.equal(exports, 2)
    assert.equal(second.turns[1]?.tools?.[0]?.output, 'stored\nbody')
    assert.equal(second.turns[1]?.tools?.[0]?.outputLines, 2)
    assert.doesNotMatch(JSON.stringify(second), /PRIVATE_REASONING/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('unsupported, missing, timestamp-less, and malformed transcripts fail loudly', async () => {
  await assert.rejects(() => unsupportedTranscript('zcode').read('x', { from: 1, to: 2 }), (error: unknown) => error instanceof TranscriptReadError && error.reason === 'unsupported')
  assert.equal(unsupportedTranscript('zcode').revision('x'), null)
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CLAUDE_CONFIG_DIR', root, async () => {
    const dir = join(root, 'projects', 'fixture')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'missing-time.jsonl'), line({ type: 'user', message: { role: 'user', content: 'no clock' } }))
    writeFileSync(join(dir, 'bad.jsonl'), '{not-json}\n')
    await assert.rejects(() => claudeTranscript.read('missing-time', { from: 1, to: 2 }), /no reliable timestamps/)
    // a file that is not this format at all still fails loudly: nothing in it parses, so no line ever carried a clock
    await assert.rejects(() => claudeTranscript.read('bad', { from: 1, to: 2 }),
      (error: unknown) => error instanceof TranscriptReadError && error.reason === 'invalid')
    await assert.rejects(() => claudeTranscript.read('gone', { from: 1, to: 2 }), /file was not found/)
    assert.equal(claudeTranscript.revision('gone'), null)
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('one unparsable line is omitted payload, not an unreadable transcript', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CLAUDE_CONFIG_DIR', root, async () => {
    const dir = join(root, 'projects', 'fixture')
    mkdirSync(dir, { recursive: true })
    const at = (clock: string) => new Date(T(clock)).toISOString()
    const corrupt = '{"type":"assistant","timestamp":"2026-08-20T00:00:01.500Z","message"'
    writeFileSync(join(dir, 'torn.jsonl'), [
      line({ type: 'user', uuid: 'u1', timestamp: at('00:00:01'), message: { role: 'user', content: 'before' } }),
      `${corrupt}\n`,
      line({ type: 'assistant', uuid: 'a1', timestamp: at('00:00:02'), message: { role: 'assistant', content: [{ type: 'text', text: 'after' }] } }),
    ].join(''))
    // the conversation survives the torn record, and the read says how much it could not read
    const read = await claudeTranscript.read('torn', { from: T('00:00:00'), to: T('00:00:03') })
    assert.deepEqual(read.turns.map((turn) => turn.text), ['before', 'after'])
    assert.equal(read.truncated, true)
    assert.equal(read.omittedBytes, Buffer.byteLength(corrupt))
    assert.equal(read.omittedTurns, 0)
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

test('an archived codex rollout is still located and read', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CODEX_HOME', root, async () => {
    const archive = join(root, 'archived_sessions')
    mkdirSync(archive, { recursive: true })
    mkdirSync(join(root, 'sessions'), { recursive: true })
    writeFileSync(join(archive, 'rollout-2026-08-29T03-56-51-thread-archived.jsonl'), [
      line({ type: 'event_msg', payload: { type: 'user_message', message: 'compute', timestamp: '2026-08-20T00:00:00.000Z' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', message: '42', timestamp: '2026-08-20T00:00:01.000Z' } }),
    ].join(''))
    assert.ok(codexTranscript.revision('thread-archived'), 'the revision probe sees the archived file')
    const read = await codexTranscript.read('thread-archived', { from: T('00:00:00'), to: T('00:00:05') })
    assert.deepEqual(read.turns.map((turn) => turn.text), ['compute', '42'])
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})

const CODEX_146 = (name: string) => join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'codex-0.146', name)

test('a Codex 0.146 rollout: the person once, never as JSON blocks; the agent once, never twice', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  await withEnv('CODEX_HOME', root, async () => {
    const dir = join(root, 'sessions', '2026', '08', '29')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'rollout-2026-08-29T06-15-54-01a04a71-9ccb-77a0-b9e9-1341f534ef72.jsonl'), readFileSync(CODEX_146('rollout-meeting-participant.jsonl')))
    writeFileSync(join(dir, 'rollout-2026-08-29T06-15-53-01a04a71-98e0-7961-adc4-a228b1185373.jsonl'), readFileSync(CODEX_146('rollout-meeting-participant-prose.jsonl')))
    const range = { from: 1, to: Date.parse('2026-08-29T00:00:00Z') }
    const quiet = await codexTranscript.read('01a04a71-9ccb-77a0-b9e9-1341f534ef72', range)
    assert.equal(quiet.turns.filter((turn) => turn.role === 'user').length, 3, 'three human messages, each once — the response_item echo and the AGENTS.md injection are not turns')
    assert.ok(!quiet.turns.some((turn) => (turn.text || '').startsWith('[{"type":"input_text"')), 'no JSON-encoded content blocks as text')
    assert.equal(quiet.turns.filter((turn) => turn.role === 'assistant' && turn.text).length, 0, 'an agent that only answered through tool calls has no prose turns (its empty agent_message events are clocks)')
    assert.ok(quiet.turns.some((turn) => turn.tools?.length), 'its tool calls are turns')
    const prose = await codexTranscript.read('01a04a71-98e0-7961-adc4-a228b1185373', range)
    const said = prose.turns.filter((turn) => turn.role === 'assistant' && turn.text).map((turn) => turn.text)
    assert.equal(said.length, 2, 'two prose replies — the response_item copy of each agent_message is not a second turn')
    assert.match(said[0] || '', /four-day work week/)
  }).finally(() => rmSync(root, { recursive: true, force: true }))
})
