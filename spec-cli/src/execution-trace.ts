import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ExecutionStepKind = 'command' | 'read' | 'write' | 'search' | 'tool'
export type ExecutionStep = Readonly<{
  id: string
  kind: ExecutionStepKind
  label: string
  detail?: string
  state: 'running' | 'done'
}>
export type ExecutionTrace = Readonly<{
  revision: string
  workingNote: string | null
  steps: readonly ExecutionStep[]
}>

type CachedTrace = {
  size: number
  remainder: Buffer
  workingNote: string | null
  steps: ExecutionStep[]
}

const cache = new Map<string, CachedTrace>()
const emptyTrace = (): ExecutionTrace => ({ revision: '0', workingNote: null, steps: [] })

// Codex owns both this native on-disk rollout format and the exact place its transcript lives. The caller only
// receives this module's compact projection, never the file path or one of its native envelopes.
const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
const children = (dir: string): string[] => { try { return readdirSync(dir).sort().reverse() } catch { return [] } }

export function codexRolloutPath(threadId: string, root = codexSessionsDir()): string | null {
  for (const year of children(root)) for (const month of children(join(root, year))) for (const day of children(join(root, year, month))) {
    const dir = join(root, year, month, day)
    const file = children(dir).find((name) => name.includes(threadId))
    if (file) return join(dir, file)
  }
  return null
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const field = (value: Record<string, unknown>, ...names: string[]): string | null => {
  for (const name of names) {
    const found = text(value[name])
    if (found) return found
  }
  return null
}

function toolKind(name: string): ExecutionStepKind {
  const normalized = name.toLowerCase()
  if (/(search|browse|web)/.test(normalized)) return 'search'
  if (/(read|list|find|grep|glob|stat)/.test(normalized)) return 'read'
  if (/(write|edit|patch|create|delete|move|rename)/.test(normalized)) return 'write'
  if (/(exec|shell|command|terminal|bash|npm|git)/.test(normalized)) return 'command'
  return 'tool'
}

function toolLabel(name: string, kind: ExecutionStepKind): string {
  const labels: Record<ExecutionStepKind, string> = {
    command: 'Run command', read: 'Read files', write: 'Update files', search: 'Search', tool: 'Use tool',
  }
  return name.trim() || labels[kind]
}

const sensitive = /(token|secret|password|authorization|bearer|cookie|credential|api[_-]?key|private[ _-]?key)/i
const detailFields = [
  ['cmd', 'cmd'], ['command', 'command'], ['path', 'path'], ['file_path', 'path'],
  ['query', 'query'], ['pattern', 'pattern'], ['url', 'url'], ['workdir', 'in'],
] as const

function recordInput(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function sensitiveInput(value: unknown): boolean {
  if (typeof value === 'string') return sensitive.test(value)
  if (Array.isArray(value)) return value.some(sensitiveInput)
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .some(([key, entry]) => sensitive.test(key) || sensitiveInput(entry))
  return false
}

function compactValue(key: string, value: string | number | boolean): string {
  const text = String(value).trim()
  if (key === 'path' || key === 'file_path' || key === 'workdir') {
    const parts = text.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts.slice(-2).join('/') || text
  }
  return text.length > 96 ? `${text.slice(0, 95)}…` : text
}

function toolDetail(payload: Record<string, unknown>): string | undefined {
  const input = recordInput(payload.input ?? payload.arguments ?? payload.args)
  if (!input || sensitiveInput(input)) return undefined
  const details: string[] = []
  for (const [key, title] of detailFields) {
    const value = input[key]
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue
    details.push(`${title}: ${compactValue(key, value)}`)
    if (details.length === 2) break
  }
  const lineStart = input.line_start
  const lineEnd = input.line_end
  if (details.length < 2 && (typeof lineStart === 'number' || typeof lineEnd === 'number')) {
    details.push(`lines: ${typeof lineStart === 'number' ? lineStart : 1}-${typeof lineEnd === 'number' ? lineEnd : lineStart}`)
  }
  return details.length ? details.join(' · ') : undefined
}

function applyRolloutEvent(trace: CachedTrace, value: unknown, ordinal: number): void {
  if (!value || typeof value !== 'object') return
  const event = value as Record<string, unknown>
  const payload = event.payload && typeof event.payload === 'object' ? event.payload as Record<string, unknown> : null
  if (!payload) return

  // Codex writes working commentary as event_msg/agent_message. A later note begins a new visible execution
  // slice, deliberately discarding prior commentary and tool history.
  if (event.type === 'event_msg' && payload.type === 'agent_message' && payload.phase === 'commentary') {
    const note = field(payload, 'message', 'text')
    if (note) { trace.workingNote = note; trace.steps = [] }
    return
  }
  if (!trace.workingNote) return

  if (event.type === 'response_item' && payload.type === 'custom_tool_call') {
    const name = field(payload, 'name', 'tool_name') || 'tool'
    const id = field(payload, 'call_id', 'id') || `tool-${ordinal}`
    const kind = toolKind(name)
    const detail = toolDetail(payload)
    trace.steps.push({ id, kind, label: toolLabel(name, kind), ...(detail ? { detail } : {}), state: 'running' })
    return
  }
  if (event.type === 'response_item' && payload.type === 'custom_tool_call_output') {
    const id = field(payload, 'call_id', 'id')
    let index = id ? trace.steps.findIndex((step) => step.id === id) : -1
    if (!id) for (let cursor = trace.steps.length - 1; cursor >= 0; cursor--) {
      if (trace.steps[cursor].state === 'running') { index = cursor; break }
    }
    if (index >= 0) trace.steps[index] = { ...trace.steps[index], state: 'done' }
    return
  }
  if (event.type === 'event_msg' && payload.type === 'web_search_end') {
    trace.steps.push({ id: field(payload, 'id', 'call_id') || `search-${ordinal}`, kind: 'search', label: 'Search', state: 'done' })
  }
}

function completeLines(buffer: Buffer): { lines: Buffer[]; remainder: Buffer } {
  const lines: Buffer[] = []
  let start = 0
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] !== 10) continue
    if (index > start) lines.push(buffer.subarray(start, index))
    start = index + 1
  }
  return { lines, remainder: buffer.subarray(start) }
}

function readFrom(path: string, start: number): Buffer | null {
  let fd: number | null = null
  try {
    const size = statSync(path).size
    if (size <= start) return Buffer.alloc(0)
    const chunk = Buffer.allocUnsafe(size - start)
    fd = openSync(path, 'r')
    readSync(fd, chunk, 0, chunk.length, start)
    return chunk
  } catch { return null }
  finally { if (fd !== null) closeSync(fd) }
}

export function readCodexExecutionTrace(threadId: string, root = codexSessionsDir()): ExecutionTrace {
  const path = codexRolloutPath(threadId, root)
  if (!path) return emptyTrace()
  let size: number
  try { size = statSync(path).size } catch { return emptyTrace() }

  const prior = cache.get(path)
  const trace = prior && prior.size <= size
    ? { ...prior, steps: [...prior.steps] }
    : { size: 0, remainder: Buffer.alloc(0), workingNote: null, steps: [] as ExecutionStep[] }
  const appended = readFrom(path, trace.size)
  if (appended === null) return emptyTrace()
  const { lines, remainder } = completeLines(Buffer.concat([trace.remainder, appended]))
  for (const [index, line] of lines.entries()) {
    try { applyRolloutEvent(trace, JSON.parse(line.toString('utf8')), trace.size + index) } catch { /* an incomplete/corrupt native line is not a UI event */ }
  }
  trace.size = size
  trace.remainder = remainder
  cache.set(path, trace)
  return { revision: String(size), workingNote: trace.workingNote, steps: trace.steps }
}

export const noExecutionTrace = (): ExecutionTrace | null => null
