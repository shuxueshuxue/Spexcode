import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readCodexExecutionTrace } from './execution-trace.js'

const line = (value: unknown) => `${JSON.stringify(value)}\n`

test('Codex execution trace keeps only the latest working note and its normalized following tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-execution-trace-'))
  const thread = 'trace-thread'
  const dir = join(root, '2026', '08', '07')
  const rollout = join(dir, `rollout-123-${thread}.jsonl`)
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(rollout, [
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'old working note' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'old', name: 'exec_command', arguments: 'SECRET_OLD_ARGUMENT' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'current working note' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'read', name: 'read_file', arguments: JSON.stringify({ path: '/project/src/trace.ts', line_start: 4, line_end: 12 }) } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'read', output: 'SECRET_READ_OUTPUT' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'run', name: 'exec_command', arguments: JSON.stringify({ cmd: 'printf SECRET_RUN_ARGUMENT' }) } }),
    ].join(''))

    const first = readCodexExecutionTrace(thread, root)
    assert.equal(first.workingNote, 'current working note')
    assert.deepEqual(first.steps, [
      { id: 'read', kind: 'read', label: 'read_file', detail: 'path: src/trace.ts · lines: 4-12', state: 'done' },
      { id: 'run', kind: 'command', label: 'exec_command', state: 'running' },
    ])
    assert.doesNotMatch(JSON.stringify(first), /SECRET_|old working note/)

    appendFileSync(rollout, line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'run', output: 'SECRET_RUN_OUTPUT' } }))
    const second = readCodexExecutionTrace(thread, root)
    assert.equal(second.steps[1].state, 'done')
    assert.equal(second.revision !== first.revision, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
