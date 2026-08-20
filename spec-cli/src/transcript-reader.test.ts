import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { readTranscript, TranscriptReadError } from './transcript-reader.js'

const line = (value: unknown) => `${JSON.stringify(value)}\n`

test('claude transcript reader filters the requested interval and joins tool output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  const old = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = root
    const path = join(root, 'projects', 'fixture', 'claude-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, [
      line({ type: 'user', timestamp: '2026-08-20T00:00:00.000Z', message: { role: 'user', content: 'before' } }),
      line({ type: 'assistant', timestamp: '2026-08-20T00:01:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'inside' }, { type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'printf ok' } }] } }),
      line({ type: 'user', timestamp: '2026-08-20T00:01:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok\nsecond' }] } }),
      line({ type: 'assistant', timestamp: '2026-08-20T00:03:00.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'after' }] } }),
    ].join(''))
    const result = await readTranscript('claude', 'claude-thread', { from: Date.parse('2026-08-20T00:00:30.000Z'), to: Date.parse('2026-08-20T00:02:00.000Z') })
    assert.deepEqual(result.turns.map((turn) => turn.text), ['inside'])
    assert.equal(result.turns[0]?.tools?.[0]?.output, 'ok\nsecond')
    assert.equal(result.turns[0]?.tools?.[0]?.outputLines, 2)
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = old
    rmSync(root, { recursive: true, force: true })
  }
})

test('codex transcript reader filters rollout events and reports bounded truncation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  const old = process.env.CODEX_HOME
  try {
    process.env.CODEX_HOME = root
    const path = join(root, 'sessions', '2026', '08', '20', 'rollout-1-codex-thread.jsonl')
    mkdirSync(dirname(path), { recursive: true })
    const records = [
      line({ type: 'event_msg', payload: { type: 'user_message', timestamp: '2026-08-20T00:00:00.000Z', message: 'before' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', timestamp: '2026-08-20T00:01:00.000Z', message: 'inside' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', timestamp: '2026-08-20T00:01:01.000Z', call_id: 'tool-1', name: 'shell', arguments: '{}' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call_output', timestamp: '2026-08-20T00:01:02.000Z', call_id: 'tool-1', output: 'done' } }),
    ]
    for (let index = 0; index < 205; index++) records.push(line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', timestamp: '2026-08-20T00:01:10.000Z', message: `turn ${index}` } }))
    records.push(line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', timestamp: '2026-08-20T00:03:00.000Z', message: 'after' } }))
    writeFileSync(path, records.join(''))
    const result = await readTranscript('codex', 'codex-thread', { from: Date.parse('2026-08-20T00:00:30.000Z'), to: Date.parse('2026-08-20T00:02:00.000Z') })
    assert.equal(result.turns[0]?.text, 'inside')
    assert.equal(result.turns.length, 200)
    assert.equal(result.turns.find((turn) => turn.tools?.length)?.tools?.[0]?.output, 'done')
    assert.equal(result.truncated, true)
    assert.equal(result.omittedTurns, 7)
  } finally {
    if (old === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = old
    rmSync(root, { recursive: true, force: true })
  }
})

test('unsupported, missing, timestamp-less, and malformed transcripts fail loudly', async () => {
  await assert.rejects(() => readTranscript('opencode', 'x', { from: 1, to: 2 }), (error: unknown) => error instanceof TranscriptReadError && error.reason === 'unsupported')
  const root = mkdtempSync(join(tmpdir(), 'spex-transcript-'))
  const old = process.env.CLAUDE_CONFIG_DIR
  try {
    process.env.CLAUDE_CONFIG_DIR = root
    const dir = join(root, 'projects', 'fixture')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'missing-time.jsonl'), line({ type: 'user', message: { role: 'user', content: 'no clock' } }))
    writeFileSync(join(dir, 'bad.jsonl'), '{not-json}\n')
    await assert.rejects(() => readTranscript('claude', 'missing-time', { from: 1, to: 2 }), /no reliable timestamps/)
    await assert.rejects(() => readTranscript('claude', 'bad', { from: 1, to: 2 }), /cannot be parsed/)
    await assert.rejects(() => readTranscript('claude', 'gone', { from: 1, to: 2 }), /file was not found/)
  } finally {
    if (old === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = old
    rmSync(root, { recursive: true, force: true })
  }
})
