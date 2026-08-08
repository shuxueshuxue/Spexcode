import assert from 'node:assert/strict'
import { appendFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { HARNESSES } from './harness.js'
import { noExecutionTrace, readCodexExecutionTrace, readLocalStoreExecutionTrace, readProjectJsonlExecutionTrace, readSessionJsonlExecutionTrace, type ExecutionTurn } from './execution-trace.js'

const line = (value: unknown) => `${JSON.stringify(value)}\n`
const turn: ExecutionTurn = { token: 'turn-current', acceptedAt: '2026-08-08T08:00:00.000Z' }

function assertTrace(trace: ReturnType<typeof readCodexExecutionTrace>, note: string, step: { id: string; label: string; detail?: string; state: string }) {
  assert.equal(trace.turnId, 'turn-current')
  assert.equal(trace.workingNote, note)
  assert.deepEqual(trace.steps, [{ kind: 'read', ...step }])
  assert.doesNotMatch(JSON.stringify(trace), /OLD_|PRIVATE_|SECRET_/)
}

function assertUnbound(trace: ReturnType<typeof readCodexExecutionTrace>, note: string) {
  assert.equal(trace.turnId, null)
  assert.equal(trace.workingNote, note)
  assert.doesNotMatch(JSON.stringify(trace), /OLD_|PRIVATE_|SECRET_/)
}

function assertWaiting(trace: ReturnType<typeof readCodexExecutionTrace>) {
  assert.deepEqual({ turnId: trace.turnId, workingNote: trace.workingNote, steps: trace.steps }, {
    turnId: turn.token, workingNote: null, steps: [],
  })
}

test('rollout reader selects the current boundary and projects only safe following tools', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-execution-rollout-'))
  const thread = 'rollout-thread'
  const path = join(root, '2026', '08', '08', `rollout-${thread}.jsonl`)
  mkdirSync(join(root, '2026', '08', '08'), { recursive: true })
  try {
    writeFileSync(path, [
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'Inspecting launch state' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'launch-call', name: 'read_file', arguments: JSON.stringify({ path: '/project/launch.md' }) } }),
    ].join(''))
    assertUnbound(readCodexExecutionTrace(thread, null, root), 'Inspecting launch state')
    assertWaiting(readCodexExecutionTrace(thread, turn, root))
    appendFileSync(path, [
      line({ type: 'event_msg', payload: { type: 'user_message', client_user_message_id: 'turn-current', timestamp: '2026-08-08T08:00:00.000Z' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'analysis', message: 'PRIVATE_REASONING' } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'Inspect the selected source' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'current-call', name: 'read_file', arguments: JSON.stringify({ path: '/project/src/trace.ts', line_start: 4, line_end: 12 }) } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'current-call', output: 'PRIVATE_OUTPUT' } }),
    ].join(''))
    assertTrace(readCodexExecutionTrace(thread, turn, root), 'Inspect the selected source', {
      id: 'current-call', label: 'read_file', detail: 'path: src/trace.ts · lines: 4-12', state: 'done',
    })
    appendFileSync(path, line({ type: 'response_item', payload: { type: 'function_call', call_id: 'sensitive', name: 'read_file', arguments: JSON.stringify({ path: '/project/.env', token: 'SECRET_INPUT' }) } }))
    const updated = readCodexExecutionTrace(thread, turn, root)
    assert.equal(updated.steps[1]?.detail, undefined)
    assert.doesNotMatch(JSON.stringify(updated), /SECRET_INPUT/)
    appendFileSync(path, line({ type: 'event_msg', payload: { type: 'user_message', client_user_message_id: 'newer-turn', timestamp: '2026-08-08T08:01:00.000Z' } }))
    assert.equal(readCodexExecutionTrace(thread, turn, root).workingNote, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reader withholds a prior slice until the exact current turn reaches the native rollout', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-execution-trace-'))
  const thread = 'turn-fence-thread'
  const dir = join(root, '2026', '08', '08')
  const rollout = join(dir, `rollout-456-${thread}.jsonl`)
  const previous: ExecutionTurn = { token: '11111111-1111-4111-8111-111111111111', acceptedAt: '2026-08-08T00:00:00.000Z' }
  const current: ExecutionTurn = { token: '22222222-2222-4222-8222-222222222222', acceptedAt: '2026-08-08T00:01:00.000Z' }
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(rollout, [
      line({ type: 'event_msg', payload: { type: 'user_message', client_id: previous.token } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'previous turn note' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'previous-tool', name: 'read_file', arguments: JSON.stringify({ path: '/project/old.ts' }) } }),
    ].join(''))

    assert.equal(readCodexExecutionTrace(thread, previous, root).workingNote, 'previous turn note')
    const waiting = readCodexExecutionTrace(thread, current, root)
    assert.equal(waiting.revision.startsWith(`${current.token}:`), true)
    assert.deepEqual({ turnId: waiting.turnId, workingNote: waiting.workingNote, steps: waiting.steps }, { turnId: current.token, workingNote: null, steps: [] })

    appendFileSync(rollout, line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'stale continuation' } }))
    assert.equal(readCodexExecutionTrace(thread, current, root).workingNote, null)

    appendFileSync(rollout, [
      line({ type: 'event_msg', payload: { type: 'user_message', client_id: current.token } }),
      line({ type: 'event_msg', payload: { type: 'agent_message', phase: 'commentary', message: 'current turn note' } }),
      line({ type: 'response_item', payload: { type: 'custom_tool_call', call_id: 'current-tool', name: 'read_file', arguments: JSON.stringify({ path: '/project/current.ts' }) } }),
    ].join(''))
    const attached = readCodexExecutionTrace(thread, current, root)
    assert.equal(attached.turnId, current.token)
    assert.equal(attached.workingNote, 'current turn note')
    assert.deepEqual(attached.steps, [{ id: 'current-tool', kind: 'read', label: 'read_file', detail: 'path: project/current.ts', state: 'running' }])
    assert.equal(readCodexExecutionTrace(thread, previous, root).workingNote, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('project JSONL reader uses the unambiguous accepted-at boundary and skips structured reasoning', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-execution-project-'))
  const thread = 'project-thread'
  const path = join(root, 'project', `${thread}.jsonl`)
  mkdirSync(join(root, 'project'), { recursive: true })
  try {
    writeFileSync(path, line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Reading launch plan' }, { type: 'tool_use', id: 'launch-call', name: 'Read', input: { path: '/repo/launch.md' } }] } }))
    assertUnbound(readProjectJsonlExecutionTrace(thread, null, root), 'Reading launch plan')
    assertWaiting(readProjectJsonlExecutionTrace(thread, turn, root))
    appendFileSync(path, [
      line({ type: 'user', uuid: 'native-current', timestamp: '2026-08-08T08:00:00.000Z', message: { role: 'user', content: 'current prompt' } }),
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'text', text: 'Read the current plan' }, { type: 'tool_use', id: 'project-call', name: 'Read', input: { path: '/repo/plan.md' } }] } }),
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'project-call', content: 'PRIVATE_OUTPUT' }] } }),
    ].join(''))
    assertTrace(readProjectJsonlExecutionTrace(thread, turn, root), 'Read the current plan', {
      id: 'project-call', label: 'Read', detail: 'path: repo/plan.md', state: 'done',
    })
    appendFileSync(path, line({ type: 'user', uuid: 'newer-user', timestamp: '2026-08-08T08:01:00.000Z', message: { role: 'user', content: 'newer prompt' } }))
    assert.equal(readProjectJsonlExecutionTrace(thread, turn, root).workingNote, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('session JSONL reader projects the selected assistant prose and matching result', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-execution-session-'))
  const thread = 'session-thread'
  const path = join(root, '--project--', 'trace.jsonl')
  mkdirSync(join(root, '--project--'), { recursive: true })
  try {
    writeFileSync(path, [
      line({ type: 'session', id: thread }),
      line({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Inspecting launch file' }, { type: 'toolCall', id: 'launch-call', name: 'read', arguments: { path: '/repo/launch.ts' } }] } }),
    ].join(''))
    assertUnbound(readSessionJsonlExecutionTrace(thread, null, root), 'Inspecting launch file')
    assertWaiting(readSessionJsonlExecutionTrace(thread, turn, root))
    appendFileSync(path, [
      line({ type: 'message', id: 'native-current', timestamp: '2026-08-08T08:00:00.000Z', message: { role: 'user', content: 'current prompt' } }),
      line({ type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'text', text: 'Inspect the focused file' }, { type: 'toolCall', id: 'session-call', name: 'read', arguments: { path: '/repo/focus.ts' } }] } }),
      line({ type: 'message', message: { role: 'toolResult', toolCallId: 'session-call', content: [{ type: 'text', text: 'PRIVATE_OUTPUT' }] } }),
    ].join(''))
    assertTrace(readSessionJsonlExecutionTrace(thread, turn, root), 'Inspect the focused file', {
      id: 'session-call', label: 'read', detail: 'path: repo/focus.ts', state: 'done',
    })
    appendFileSync(path, line({ type: 'message', id: 'newer-user', timestamp: '2026-08-08T08:01:00.000Z', message: { role: 'user', content: 'newer prompt' } }))
    assert.equal(readSessionJsonlExecutionTrace(thread, turn, root).workingNote, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('local store reader maps current prose, tool state, and safe input without exporting source payloads', () => {
  const root = mkdtempSync(join(tmpdir(), 'spex-execution-store-'))
  writeFileSync(join(root, 'opencode.db'), '')
  writeFileSync(join(root, 'opencode.db-wal'), '')
  const data: { messages: Array<{ info: Record<string, unknown>; parts: unknown[] }> } = {
    messages: [{ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Checking launch store' }, { type: 'tool', callID: 'launch-call', tool: 'read', state: { status: 'completed', input: { path: '/repo/launch.ts' }, output: 'PRIVATE_OUTPUT' } }] }],
  }
  try {
    assertUnbound(readLocalStoreExecutionTrace('store-thread', null, root, () => JSON.stringify(data)), 'Checking launch store')
    assertWaiting(readLocalStoreExecutionTrace('store-thread', turn, root, () => JSON.stringify(data)))
    data.messages.push(
      { info: { role: 'user', id: 'turn-current', time: { created: '2026-08-08T08:00:00.000Z' } }, parts: [] },
      { info: { role: 'assistant' }, parts: [{ type: 'reasoning', text: 'PRIVATE_REASONING' }, { type: 'text', text: 'Check the stored selection' }, { type: 'tool', callID: 'store-call', tool: 'read', state: { status: 'completed', input: { path: '/repo/store.ts' }, output: 'PRIVATE_OUTPUT' } }] },
    )
    appendFileSync(join(root, 'opencode.db-wal'), 'x')
    assertTrace(readLocalStoreExecutionTrace('store-thread', turn, root, () => JSON.stringify(data)), 'Check the stored selection', {
      id: 'store-call', label: 'read', detail: 'path: repo/store.ts', state: 'done',
    })
    data.messages.push({ info: { role: 'user', id: 'newer-user', time: { created: '2026-08-08T08:01:00.000Z' } }, parts: [] })
    appendFileSync(join(root, 'opencode.db-wal'), 'x')
    assert.equal(readLocalStoreExecutionTrace('store-thread', turn, root, () => JSON.stringify(data)).workingNote, null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('registered trace readers cover four base rows and inherited headless rows without a shared fallback', () => {
  const readers = HARNESSES.filter((harness) => harness.executionTrace !== noExecutionTrace)
  const base = readers.filter((harness) => !harness.headless)
  const headless = readers.filter((harness) => harness.headless)
  assert.equal(base.length, 4)
  assert.equal(headless.length, 4)
  assert.equal(new Set(base.map((harness) => harness.executionTrace)).size, 4)
  assert.ok(headless.every((harness) => base.some((candidate) => candidate.executionTrace === harness.executionTrace)))
})
