import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type ExecutionTurn = Readonly<{
  token: string
  acceptedAt: string
}>
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
  turnId: string | null
  workingNote: string | null
  steps: readonly ExecutionStep[]
}>

type TraceEvent =
  | Readonly<{ type: 'boundary'; ids: readonly string[]; at: number | null }>
  | Readonly<{ type: 'note'; text: string }>
  | Readonly<{ type: 'call'; step: ExecutionStep }>
  | Readonly<{ type: 'done'; id: string }>
type CachedTrace = { size: number; remainder: Buffer; events: TraceEvent[] }
type ApplyEvent = (value: unknown, ordinal: number) => readonly TraceEvent[]
type ExportLoader = (threadId: string) => string

const cache = new Map<string, CachedTrace>()
const sessionJsonlPaths = new Map<string, string>()
const localStoreCache = new Map<string, { revision: string; events: TraceEvent[] }>()

const emptyTrace = (turn: ExecutionTurn | null, revision = '0'): ExecutionTrace => ({
  revision: `${turn?.token ?? '0'}:${revision}`,
  turnId: turn?.token ?? null,
  workingNote: null,
  steps: [],
})

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const items = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : []
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null
const field = (value: Record<string, unknown>, ...names: string[]): string | null => {
  for (const name of names) {
    const found = text(value[name])
    if (found) return found
  }
  return null
}
const children = (dir: string): string[] => { try { return readdirSync(dir).sort().reverse() } catch { return [] } }

const sensitive = /(token|secret|password|authorization|bearer|cookie|credential|api[_-]?key|private[ _-]?key)/i
const detailFields = [
  ['cmd', 'cmd'], ['command', 'command'], ['path', 'path'], ['file_path', 'path'],
  ['query', 'query'], ['pattern', 'pattern'], ['url', 'url'], ['workdir', 'in'],
] as const

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
  const compact = String(value).trim().replace(/\s+/g, ' ')
  if (key === 'path' || key === 'file_path' || key === 'workdir') {
    const parts = compact.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts.slice(-2).join('/') || compact
  }
  return compact.length > 96 ? `${compact.slice(0, 95)}...` : compact
}

function detailFromInput(value: unknown): string | undefined {
  const input = recordInput(value)
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

function displayableNote(value: unknown): string | null {
  const note = text(value)?.replace(/\s+/g, ' ')
  return note ? (note.length > 240 ? `${note.slice(0, 239)}...` : note) : null
}

function stepFromInput(id: string, name: string, input: unknown, state: ExecutionStep['state']): ExecutionStep {
  const kind = toolKind(name)
  const detail = detailFromInput(input)
  return { id, kind, label: toolLabel(name, kind), ...(detail ? { detail } : {}), state }
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const number = Number(value)
  if (Number.isFinite(number)) return number
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function identities(...values: Array<Record<string, unknown> | null>): string[] {
  const result = new Set<string>()
  for (const value of values) for (const key of ['id', 'uuid', 'message_id', 'messageId', 'client_id', 'clientId', 'client_user_message_id', 'clientUserMessageId', 'promptId']) {
    const id = field(value || {}, key)
    if (id) result.add(id)
  }
  return [...result]
}

function at(value: Record<string, unknown>): number | null {
  for (const key of ['timestamp', 'created_at', 'createdAt', 'created', 'time']) {
    const found = timestamp(value[key])
    if (found !== null) return found
  }
  return null
}

function isPrompt(content: unknown): boolean {
  if (typeof content === 'string') return !!content.trim()
  const blocks = items(content)
  return blocks.some((block) => object(block)?.type !== 'tool_result')
}

function project(events: readonly TraceEvent[], sourceRevision: string, turn: ExecutionTurn | null): ExecutionTrace {
  let start = -1
  if (!turn) {
    for (const [index, event] of events.entries()) if (event.type === 'boundary') start = index
  } else {
    const acceptedAt = timestamp(turn.acceptedAt)
    const exact = events.flatMap((event, index) => event.type === 'boundary' && event.ids.includes(turn.token) ? [index] : [])
    start = exact.length === 1 ? exact[0] : -1
    if (start < 0 && exact.length === 0 && acceptedAt !== null) {
      const candidates = events.flatMap((event, index) => event.type === 'boundary' && event.at !== null && event.at >= acceptedAt
        ? [{ index, at: event.at }] : [])
      const earliest = candidates.reduce<number | null>((value, candidate) => value === null || candidate.at < value ? candidate.at : value, null)
      const matches = earliest === null ? [] : candidates.filter((candidate) => candidate.at === earliest)
      if (matches.length === 1) start = matches[0].index
    }
  }
  if (turn && start < 0) return emptyTrace(turn, sourceRevision)

  let note: string | null = null
  let steps: ExecutionStep[] = []
  for (let index = start + 1; index < events.length; index++) {
    const event = events[index]
    if (event.type === 'boundary') return emptyTrace(turn, sourceRevision)
    if (event.type === 'note') { note = event.text; steps = []; continue }
    if (event.type === 'call') {
      if (note) steps.push(event.step)
      continue
    }
    const step = steps.find((value) => value.id === event.id)
    if (step) steps[steps.indexOf(step)] = { ...step, state: 'done' }
  }
  return note
    ? { revision: `${turn?.token ?? '0'}:${sourceRevision}`, turnId: turn?.token ?? null, workingNote: note, steps }
    : emptyTrace(turn, sourceRevision)
}

function applyRolloutEvent(value: unknown, ordinal: number): readonly TraceEvent[] {
  const event = object(value)
  const payload = object(event?.payload)
  if (!event || !payload) return []
  const result: TraceEvent[] = []
  const type = field(payload, 'type')
  if ((event.type === 'event_msg' && type === 'user_message')
    || (event.type === 'response_item' && (type === 'message' || type === 'input_message') && payload.role === 'user')) {
    result.push({ type: 'boundary', ids: identities(payload, event), at: at(payload) ?? at(event) })
  }
  if (event.type === 'event_msg' && type === 'agent_message' && payload.phase === 'commentary') {
    const note = displayableNote(payload.message ?? payload.text)
    if (note) result.push({ type: 'note', text: note })
  }
  if (event.type === 'response_item' && (type === 'custom_tool_call' || type === 'function_call')) {
    const name = field(payload, 'name', 'tool_name') || 'tool'
    const id = field(payload, 'call_id', 'id') || `tool-${ordinal}`
    result.push({ type: 'call', step: stepFromInput(id, name, payload.input ?? payload.arguments ?? payload.args, 'running') })
  }
  if (event.type === 'response_item' && (type === 'custom_tool_call_output' || type === 'function_call_output')) {
    const id = field(payload, 'call_id', 'id')
    if (id) result.push({ type: 'done', id })
  }
  if (event.type === 'event_msg' && type === 'web_search_end') {
    result.push({ type: 'call', step: stepFromInput(field(payload, 'id', 'call_id') || `search-${ordinal}`, 'Search', payload, 'done') })
  }
  return result
}

function applyProjectJsonlEvent(value: unknown, ordinal: number): readonly TraceEvent[] {
  const entry = object(value)
  const message = object(entry?.message)
  if (!entry || !message) return []
  const result: TraceEvent[] = []
  if (entry.type === 'user' && message.role === 'user' && isPrompt(message.content))
    result.push({ type: 'boundary', ids: identities(entry, message), at: at(entry) ?? at(message) })
  if (entry.type === 'assistant' && message.role === 'assistant') for (const blockValue of items(message.content)) {
    const block = object(blockValue)
    if (block?.type === 'text') {
      const note = displayableNote(block.text)
      if (note) result.push({ type: 'note', text: note })
    }
    if (block?.type === 'tool_use') {
      const id = field(block, 'id') || `tool-${ordinal}`
      result.push({ type: 'call', step: stepFromInput(id, field(block, 'name') || 'tool', block.input, 'running') })
    }
  }
  if (entry.type === 'user' && message.role === 'user') for (const blockValue of items(message.content)) {
    const block = object(blockValue)
    if (block?.type === 'tool_result') {
      const id = field(block, 'tool_use_id')
      if (id) result.push({ type: 'done', id })
    }
  }
  return result
}

function applySessionJsonlEvent(value: unknown, ordinal: number): readonly TraceEvent[] {
  const entry = object(value)
  const message = object(entry?.message)
  if (!entry || entry.type !== 'message' || !message) return []
  const result: TraceEvent[] = []
  if (message.role === 'user' && isPrompt(message.content))
    result.push({ type: 'boundary', ids: identities(entry, message), at: at(entry) ?? at(message) })
  if (message.role === 'assistant') for (const blockValue of items(message.content)) {
    const block = object(blockValue)
    if (block?.type === 'text') {
      const note = displayableNote(block.text)
      if (note) result.push({ type: 'note', text: note })
    }
    if (block?.type === 'toolCall') {
      const id = field(block, 'id') || `tool-${ordinal}`
      result.push({ type: 'call', step: stepFromInput(id, field(block, 'name') || 'tool', block.arguments, 'running') })
    }
  }
  if (message.role === 'toolResult') {
    const id = field(message, 'toolCallId')
    if (id) result.push({ type: 'done', id })
  }
  return result
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

function readIncremental(path: string | null, apply: ApplyEvent, turn: ExecutionTurn | null): ExecutionTrace {
  if (!path) return emptyTrace(turn)
  let size: number
  try { size = statSync(path).size } catch { return emptyTrace(turn) }
  const prior = cache.get(path)
  const trace = prior && prior.size <= size
    ? { ...prior, events: [...prior.events] }
    : { size: 0, remainder: Buffer.alloc(0), events: [] as TraceEvent[] }
  const appended = readFrom(path, trace.size)
  if (appended === null) return emptyTrace(turn)
  const { lines, remainder } = completeLines(Buffer.concat([trace.remainder, appended]))
  for (const [index, line] of lines.entries()) {
    try { trace.events.push(...apply(JSON.parse(line.toString('utf8')), trace.size + index)) } catch { /* malformed native data is ignored */ }
  }
  trace.size = size
  trace.remainder = remainder
  cache.set(path, trace)
  return project(trace.events, String(size), turn)
}

const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')

export function codexRolloutPath(threadId: string, root = codexSessionsDir()): string | null {
  for (const year of children(root)) for (const month of children(join(root, year))) for (const day of children(join(root, year, month))) {
    const dir = join(root, year, month, day)
    const file = children(dir).find((name) => name.includes(threadId))
    if (file) return join(dir, file)
  }
  return null
}

export function readCodexExecutionTrace(threadId: string, turn: ExecutionTurn | null, root = codexSessionsDir()): ExecutionTrace {
  return readIncremental(codexRolloutPath(threadId, root), applyRolloutEvent, turn)
}

const projectTranscriptRoot = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')

function projectJsonlPath(threadId: string, root = projectTranscriptRoot()): string | null {
  for (const project of children(root)) {
    const path = join(root, project, `${threadId}.jsonl`)
    try { if (statSync(path).isFile()) return path } catch { /* try next */ }
  }
  return null
}

export function readProjectJsonlExecutionTrace(threadId: string, turn: ExecutionTurn | null, root = projectTranscriptRoot()): ExecutionTrace {
  return readIncremental(projectJsonlPath(threadId, root), applyProjectJsonlEvent, turn)
}

const sessionJsonlRoot = () => join(process.env.SPEXCODE_PI_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions')

function sessionJsonlPath(threadId: string, root = sessionJsonlRoot()): string | null {
  const key = `${root}:${threadId}`
  const cached = sessionJsonlPaths.get(key)
  if (cached) {
    try { if (statSync(cached).isFile()) return cached } catch { sessionJsonlPaths.delete(key) }
  }
  for (const directory of children(root)) for (const file of children(join(root, directory))) {
    if (!file.endsWith('.jsonl')) continue
    const path = join(root, directory, file)
    try {
      const header = object(JSON.parse(readFileSync(path, 'utf8').split('\n', 1)[0]))
      if (header?.type === 'session' && header.id === threadId) {
        sessionJsonlPaths.set(key, path)
        return path
      }
    } catch { /* unreadable entries are not a match */ }
  }
  return null
}

export function readSessionJsonlExecutionTrace(threadId: string, turn: ExecutionTurn | null, root = sessionJsonlRoot()): ExecutionTrace {
  return readIncremental(sessionJsonlPath(threadId, root), applySessionJsonlEvent, turn)
}

const localStoreRoot = () => process.env.SPEXCODE_OPENCODE_DATA_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode')

function readLocalExport(threadId: string): string {
  return execFileSync(process.env.SPEXCODE_OPENCODE_CMD || 'opencode', ['export', threadId, '--sanitize'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function localStoreRevision(root: string): string | null {
  try {
    const database = statSync(join(root, 'opencode.db'))
    let writeAheadLog = '0:0'
    try {
      const stat = statSync(join(root, 'opencode.db-wal'))
      writeAheadLog = `${stat.size}:${Math.floor(stat.mtimeMs)}`
    } catch { /* a checkpointed database has no separate write-ahead log */ }
    return `${database.size}:${Math.floor(database.mtimeMs)}:${writeAheadLog}`
  } catch { return null }
}

function localStoreEvents(value: unknown): TraceEvent[] {
  const events: TraceEvent[] = []
  for (const messageValue of items(object(value)?.messages)) {
    const message = object(messageValue)
    const info = object(message?.info)
    if (!message || !info) continue
    if (info.role === 'user') events.push({ type: 'boundary', ids: identities(info, message), at: at(object(info.time) || info) })
    if (info.role !== 'assistant') continue
    for (const partValue of items(message.parts)) {
      const part = object(partValue)
      if (part?.type === 'text') {
        const note = displayableNote(part.text)
        if (note) events.push({ type: 'note', text: note })
      }
      if (part?.type === 'tool') {
        const state = object(part.state)
        const status = field(state || {}, 'status')?.toLowerCase() || ''
        const id = field(part, 'callID', 'id') || `tool-${events.length}`
        events.push({ type: 'call', step: stepFromInput(id, field(part, 'tool') || 'tool', state?.input, /completed|error|cancelled/.test(status) ? 'done' : 'running') })
      }
    }
  }
  return events
}

export function readLocalStoreExecutionTrace(threadId: string, turn: ExecutionTurn | null, root = localStoreRoot(), load: ExportLoader = readLocalExport): ExecutionTrace {
  const revision = localStoreRevision(root)
  if (!revision) return emptyTrace(turn)
  const key = `${root}:${threadId}`
  let cached = localStoreCache.get(key)
  if (!cached || cached.revision !== revision) {
    try {
      cached = { revision, events: localStoreEvents(JSON.parse(load(threadId))) }
      localStoreCache.set(key, cached)
    } catch { return emptyTrace(turn, revision) }
  }
  return project(cached.events, revision, turn)
}

export const noExecutionTrace = (_threadId: string, _turn: ExecutionTurn | null): ExecutionTrace | null => null
