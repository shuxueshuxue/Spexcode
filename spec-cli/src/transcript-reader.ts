import { execFileSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// THE ONE NATIVE-THREAD READER. Each harness keeps its conversation somewhere private — Claude's project
// JSONL, Codex's rollout, pi's session JSONL, OpenCode's store behind `opencode export` — and this module is
// the only place that knows those shapes. It answers exactly one question for every harness: "what happened
// in this thread between `from` and `to`?", as normalized turns. The history seam, the live tail, and the
// transcript stream all read through this one seam, so there is ONE parser per harness, not one per surface.

export type TranscriptRange = Readonly<{ from: number; to: number }>
export type TranscriptTool = Readonly<{
  id: string
  name: string
  input?: string
  output?: string          // absent until the harness recorded the result — the live tail reads that as "running"
  outputLines: number
  outputBytes: number
}>
export type TranscriptTurn = Readonly<{
  id: string | null
  at: number
  role: 'user' | 'assistant'
  text?: string
  tools?: readonly TranscriptTool[]
}>
export type TranscriptRead = Readonly<{
  revision: string          // the source's change token at read time — the stream re-reads only when it moves
  from: number
  to: number
  turns: readonly TranscriptTurn[]
  truncated: boolean
  omittedTurns: number
  omittedBytes: number
  outOfOrderEvents: number
}>

// An adapter's transcript capability. `revision` is the cheap "did anything change" probe (a stat, never a
// parse); `read` is the bounded interval read. A harness with no reliable native transcript declares
// `unsupportedTranscript`, which fails loudly instead of pretending the conversation was empty.
export type TranscriptReader = Readonly<{
  revision(threadId: string): string | null
  read(threadId: string, range: TranscriptRange): Promise<TranscriptRead>
}>

export class TranscriptReadError extends Error {
  constructor(readonly reason: 'unsupported' | 'missing' | 'unreadable' | 'invalid', message: string) {
    super(message)
    this.name = 'TranscriptReadError'
  }
}

const MAX_TURNS = 200
const MAX_OUTPUT_BYTES = 64 * 1024
const POST_RANGE_LOOKAHEAD_LINES = 256

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const items = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : []
const string = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const idOf = (value: Record<string, unknown> | null): string | null => {
  if (!value) return null
  for (const key of ['id', 'uuid', 'message_id', 'messageId', 'call_id', 'callId', 'client_id', 'clientId']) {
    const found = string(value[key])
    if (found) return found
  }
  return null
}
const timestamp = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
const at = (value: Record<string, unknown> | null): number | null => {
  if (!value) return null
  for (const key of ['timestamp', 'created_at', 'createdAt', 'created', 'time']) {
    const candidate = timestamp(value[key])
    if (candidate !== null) return candidate
  }
  return null
}
const compact = (value: unknown): string => {
  if (typeof value === 'string') return value
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}
const lineCount = (value: string): number => value ? value.split(/\r?\n/).length : 0
const children = (dir: string): string[] => { try { return readdirSync(dir).sort().reverse() } catch { return [] } }

type MutableTool = { id: string; name: string; input?: string; output?: string; outputLines: number; outputBytes: number }
type MutableTurn = { id: string | null; at: number; role: 'user' | 'assistant'; text?: string; tools: MutableTool[] }
// One native record, normalized: a turn, or a batch of tool results addressed to earlier calls. `at: null`
// marks a record that carries no clock — it counts as seen, never as inside an interval.
type ParsedEvent = { at: number | null; turn: MutableTurn | null; toolOutputs?: readonly { id: string; text: string }[] }
type Parse = (value: unknown) => ParsedEvent | null

// --- the four native shapes --------------------------------------------------------------------------------

function claudeEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const message = object(entry?.message)
  if (!entry || !message) return null
  const eventAt = at(entry) ?? at(message)
  if (eventAt === null) return { at: null, turn: null }
  if (entry.type === 'user' && message.role === 'user') {
    const blocks = items(message.content)
    const text = typeof message.content === 'string'
      ? string(message.content)
      : blocks.map((block) => string(object(block)?.text)).filter(Boolean).join('\n') || null
    const outputs = blocks.flatMap((block) => {
      const b = object(block)
      const id = string(b?.tool_use_id)
      return b?.type === 'tool_result' && id ? [{ id, text: compact(b?.content ?? '') }] : []
    })
    if (outputs.length) return { at: eventAt, turn: null, toolOutputs: outputs }
    if (text) return { at: eventAt, turn: { id: idOf(entry) ?? idOf(message), at: eventAt, role: 'user', text, tools: [] } }
  }
  if (entry.type === 'assistant' && message.role === 'assistant') {
    const turn: MutableTurn = { id: idOf(entry) ?? idOf(message), at: eventAt, role: 'assistant', tools: [] }
    for (const blockValue of items(message.content)) {
      const block = object(blockValue)
      if (block?.type === 'text') turn.text = [turn.text, string(block.text)].filter(Boolean).join('\n') || undefined
      if (block?.type === 'tool_use') {
        const id = string(block.id) ?? `tool-${turn.tools.length}`
        turn.tools.push({ id, name: string(block.name) ?? 'tool', input: block.input === undefined ? undefined : compact(block.input), outputLines: 0, outputBytes: 0 })
      }
    }
    return { at: eventAt, turn }
  }
  return null
}

function codexEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const payload = object(entry?.payload)
  if (!entry || !payload) return null
  const eventAt = at(payload) ?? at(entry)
  if (eventAt === null) return { at: null, turn: null }
  const type = string(payload.type)
  if ((entry.type === 'event_msg' && type === 'user_message')
    || (entry.type === 'response_item' && (type === 'message' || type === 'input_message') && payload.role === 'user')) {
    const text = typeof payload.message === 'string' ? payload.message : compact(payload.message ?? payload.content ?? '')
    return text ? { at: eventAt, turn: { id: idOf(payload) ?? idOf(entry), at: eventAt, role: 'user', text, tools: [] } } : null
  }
  // commentary AND the final answer are both what the agent said; only structured reasoning stays private
  if (entry.type === 'event_msg' && type === 'agent_message') {
    const text = string(payload.message ?? payload.text)
    return text ? { at: eventAt, turn: { id: idOf(payload) ?? idOf(entry), at: eventAt, role: 'assistant', text, tools: [] } } : null
  }
  if (entry.type === 'response_item' && (type === 'custom_tool_call' || type === 'function_call')) {
    const id = string(payload.call_id ?? payload.id) ?? 'tool'
    return { at: eventAt, turn: { id: idOf(payload) ?? idOf(entry), at: eventAt, role: 'assistant', tools: [{ id, name: string(payload.name ?? payload.tool_name) ?? 'tool', input: payload.input === undefined && payload.arguments === undefined ? undefined : compact(payload.input ?? payload.arguments), outputLines: 0, outputBytes: 0 }] } }
  }
  if (entry.type === 'response_item' && (type === 'custom_tool_call_output' || type === 'function_call_output')) {
    const id = string(payload.call_id ?? payload.id)
    const output = payload.output ?? payload.result ?? ''
    return id ? { at: eventAt, turn: null, toolOutputs: [{ id, text: compact(output) }] } : null
  }
  return null
}

const blockText = (content: unknown): string | null => typeof content === 'string'
  ? string(content)
  : items(content).map((block) => string(object(block)?.text)).filter(Boolean).join('\n') || null

function piEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const message = object(entry?.message)
  if (!entry || entry.type !== 'message' || !message) return null
  const eventAt = at(entry) ?? at(message)
  if (eventAt === null) return { at: null, turn: null }
  if (message.role === 'user') {
    const text = blockText(message.content)
    return text ? { at: eventAt, turn: { id: idOf(entry) ?? idOf(message), at: eventAt, role: 'user', text, tools: [] } } : null
  }
  if (message.role === 'assistant') {
    const turn: MutableTurn = { id: idOf(entry) ?? idOf(message), at: eventAt, role: 'assistant', tools: [] }
    for (const blockValue of items(message.content)) {
      const block = object(blockValue)
      if (block?.type === 'text') turn.text = [turn.text, string(block.text)].filter(Boolean).join('\n') || undefined
      if (block?.type === 'toolCall') {
        const id = string(block.id) ?? `tool-${turn.tools.length}`
        turn.tools.push({ id, name: string(block.name) ?? 'tool', input: block.arguments === undefined ? undefined : compact(block.arguments), outputLines: 0, outputBytes: 0 })
      }
    }
    return { at: eventAt, turn }
  }
  if (message.role === 'toolResult') {
    const id = string(message.toolCallId)
    return id ? { at: eventAt, turn: null, toolOutputs: [{ id, text: blockText(message.content) ?? compact(message.content ?? '') }] } : null
  }
  return null
}

// OpenCode's export is one JSON document, not a line stream: every message arrives with its parts, and a tool
// part already carries its own result — so its turn is complete on arrival, and a part still running simply has
// no output yet.
function opencodeEvents(value: unknown): ParsedEvent[] {
  const events: ParsedEvent[] = []
  for (const messageValue of items(object(value)?.messages)) {
    const message = object(messageValue)
    const info = object(message?.info)
    if (!message || !info) continue
    const eventAt = at(object(info.time)) ?? at(info)
    if (eventAt === null) { events.push({ at: null, turn: null }); continue }
    const role = info.role === 'user' ? 'user' : info.role === 'assistant' ? 'assistant' : null
    if (!role) continue
    const turn: MutableTurn = { id: idOf(info) ?? idOf(message), at: eventAt, role, tools: [] }
    for (const partValue of items(message.parts)) {
      const part = object(partValue)
      if (part?.type === 'text') turn.text = [turn.text, string(part.text)].filter(Boolean).join('\n') || undefined
      if (part?.type === 'tool' && role === 'assistant') {
        const state = object(part.state)
        const status = (string(state?.status) ?? '').toLowerCase()
        const tool: MutableTool = { id: string(part.callID ?? part.id) ?? `tool-${turn.tools.length}`, name: string(part.tool) ?? 'tool', input: state?.input === undefined ? undefined : compact(state.input), outputLines: 0, outputBytes: 0 }
        if (/completed|error|cancelled/.test(status)) {
          const output = compact(state?.output ?? state?.error ?? '')
          tool.output = output.slice(0, MAX_OUTPUT_BYTES)
          tool.outputBytes = Buffer.byteLength(output)
          tool.outputLines = lineCount(output)
        }
        turn.tools.push(tool)
      }
    }
    if (role === 'user' && !turn.text) continue
    events.push({ at: eventAt, turn })
  }
  return events
}

// --- where each harness keeps the thread ------------------------------------------------------------------

const projectTranscriptRoot = () => join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
export function claudeTranscriptPath(threadId: string, root = projectTranscriptRoot()): string | null {
  for (const project of children(root)) {
    const path = join(root, project, `${threadId}.jsonl`)
    try { if (statSync(path).isFile()) return path } catch { /* try next */ }
  }
  return null
}

const codexSessionsDir = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
// Walk newest day first and return on the first hit; the walk is exhaustive rather than capped, because
// future-dated junk under sessions/ sorts above every real day and a cap once masked every real rollout.
export function codexRolloutPath(threadId: string, root = codexSessionsDir()): string | null {
  for (const year of children(root)) for (const month of children(join(root, year))) for (const day of children(join(root, year, month))) {
    const dir = join(root, year, month, day)
    const file = children(dir).find((name) => name.includes(threadId))
    if (file) return join(dir, file)
  }
  return null
}

const piSessionsRoot = () => join(process.env.SPEXCODE_PI_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'sessions')
const piSessionPaths = new Map<string, string>()
export function piSessionPath(threadId: string, root = piSessionsRoot()): string | null {
  const key = `${root}:${threadId}`
  const cached = piSessionPaths.get(key)
  if (cached) {
    try { if (statSync(cached).isFile()) return cached } catch { piSessionPaths.delete(key) }
  }
  for (const directory of children(root)) for (const file of children(join(root, directory))) {
    if (!file.endsWith('.jsonl')) continue
    const path = join(root, directory, file)
    try {
      const header = object(JSON.parse(readFileSync(path, 'utf8').split('\n', 1)[0]))
      if (header?.type === 'session' && header.id === threadId) {
        piSessionPaths.set(key, path)
        return path
      }
    } catch { /* unreadable entries are not a match */ }
  }
  return null
}

const opencodeStoreRoot = () => process.env.SPEXCODE_OPENCODE_DATA_DIR
  || join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'opencode')
function opencodeStoreRevision(root: string): string | null {
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
// The export is read RAW: `--sanitize` replaces every prose and tool-output part with a `[redacted:…]` token,
// which made the whole conversation unreadable; the reader hands over the same local bytes the other harnesses'
// files hold, and nothing here leaves the machine that ran the thread.
function opencodeExport(threadId: string): string {
  return execFileSync(process.env.SPEXCODE_OPENCODE_CMD || 'opencode', ['export', threadId], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  })
}

// --- reading an interval ------------------------------------------------------------------------------------

// Collects the interval's turns from any event source. Caps keep the NEWEST turns, because a live tail and a
// closed stretch are both read for what happened last; every dropped turn or byte is counted, never hidden.
class IntervalCollector {
  readonly turns: MutableTurn[] = []
  private readonly byTool = new Map<string, MutableTool>()
  private readonly evicted = new Set<string>()
  sawTimestamp = false
  omittedTurns = 0
  omittedBytes = 0
  outOfOrderEvents = 0
  private pastRange = false
  constructor(private readonly range: TranscriptRange) {}

  // returns true once the source has moved past `to` (the caller may then bound its lookahead)
  add(event: ParsedEvent): boolean {
    const eventAt = event.at
    if (eventAt === null) return this.pastRange
    this.sawTimestamp = true
    if (!this.pastRange && eventAt > this.range.to) this.pastRange = true
    else if (this.pastRange && eventAt <= this.range.to) this.outOfOrderEvents++
    if (eventAt < this.range.from || eventAt > this.range.to) return this.pastRange
    if (event.toolOutputs) {
      for (const output of event.toolOutputs) {
        const bytes = Buffer.byteLength(output.text)
        const tool = this.byTool.get(output.id)
        if (!tool || this.evicted.has(output.id)) { this.omittedBytes += bytes; continue }
        tool.outputBytes += bytes
        tool.outputLines += lineCount(output.text)
        if (tool.output === undefined) tool.output = ''
        const remaining = Math.max(0, MAX_OUTPUT_BYTES - Buffer.byteLength(tool.output))
        tool.output += output.text.slice(0, remaining)
        if (bytes > remaining) this.omittedBytes += bytes - remaining
      }
    } else if (event.turn) {
      this.turns.push(event.turn)
      for (const tool of event.turn.tools) this.byTool.set(tool.id, tool)
      if (this.turns.length > MAX_TURNS) {
        const dropped = this.turns.shift()!
        for (const tool of dropped.tools) this.evicted.add(tool.id)
        this.omittedTurns++
      }
    }
    return this.pastRange
  }

  finish(revision: string, harness: string): TranscriptRead {
    if (!this.sawTimestamp) throw new TranscriptReadError('invalid', `${harness} transcript has no reliable timestamps; interval reads are unavailable`)
    return {
      revision,
      from: this.range.from,
      to: this.range.to,
      turns: this.turns.map((turn) => ({ ...turn, tools: turn.tools.length ? turn.tools.map((tool) => ({ ...tool })) : undefined })),
      truncated: this.omittedTurns > 0 || this.omittedBytes > 0 || this.outOfOrderEvents > 0,
      omittedTurns: this.omittedTurns,
      omittedBytes: this.omittedBytes,
      outOfOrderEvents: this.outOfOrderEvents,
    }
  }
}

const fileRevision = (path: string): string | null => {
  try { const stat = statSync(path); return `${stat.size}:${Math.floor(stat.mtimeMs)}` } catch { return null }
}

// @@@interval-seek - a native file is append-only, so the byte where an interval's first event sits never
// moves. The open tail re-reads its interval on every change; remembering that offset per (file, from) turns
// each re-read into "parse the current stretch" instead of "parse the whole thread again".
const intervalOffsets = new Map<string, number>()

async function readLineFile(harness: string, path: string, parse: Parse, range: TranscriptRange): Promise<TranscriptRead> {
  let size = 0
  try { size = statSync(path).size } catch (error) { throw new TranscriptReadError('unreadable', `${harness} transcript is unreadable: ${error instanceof Error ? error.message : String(error)}`) }
  if (size <= 0) throw new TranscriptReadError('unreadable', `${harness} transcript is unreadable: file is empty`)
  const seekKey = `${path}\n${range.from}`
  const seek = intervalOffsets.get(seekKey) ?? 0
  const start = seek > 0 && seek < size ? seek : 0
  const collector = new IntervalCollector(range)
  // a seek lands on the interval's first event, so the timestamps before it are known to exist
  if (start > 0) collector.sawTimestamp = true
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const chunk = Buffer.allocUnsafe(64 * 1024)
    let carry = Buffer.alloc(0)
    let position = start
    let lineStart = start
    let postRangeLines = 0
    let stop = false
    while (!stop) {
      const read = readSync(fd, chunk, 0, chunk.length, position)
      if (read <= 0) break
      position += read
      let buffer = carry.length ? Buffer.concat([carry, chunk.subarray(0, read)]) : Buffer.from(chunk.subarray(0, read))
      let cut = 0
      for (let index = 0; index < buffer.length; index++) {
        if (buffer[index] !== 10) continue
        const line = buffer.subarray(cut, index).toString('utf8')
        const lineOffset = lineStart
        lineStart += index - cut + 1
        cut = index + 1
        if (!line.trim()) continue
        let value: unknown
        try { value = JSON.parse(line) } catch (error) { throw new TranscriptReadError('invalid', `${harness} transcript cannot be parsed: ${error instanceof Error ? error.message : String(error)}`) }
        const event = parse(value)
        if (!event) continue
        const inRange = event.at !== null && event.at >= range.from && event.at <= range.to
        if (inRange && !intervalOffsets.has(seekKey)) intervalOffsets.set(seekKey, lineOffset)
        const pastRange = collector.add(event)
        if (pastRange && ++postRangeLines >= POST_RANGE_LOOKAHEAD_LINES) { stop = true; break }
      }
      // a trailing line without its newline is still being written by the harness; it joins the next read
      carry = Buffer.from(buffer.subarray(cut))
    }
  } catch (error) {
    if (error instanceof TranscriptReadError) throw error
    throw new TranscriptReadError('unreadable', `${harness} transcript could not be read: ${error instanceof Error ? error.message : String(error)}`)
  } finally { if (fd !== null) closeSync(fd) }
  return collector.finish(fileRevision(path) ?? `${size}`, harness)
}

function lineFileReader(harness: string, locate: (threadId: string) => string | null, parse: Parse): TranscriptReader {
  return {
    revision: (threadId) => { const path = locate(threadId); return path ? fileRevision(path) : null },
    read: async (threadId, range) => {
      const path = locate(threadId)
      if (!path) throw new TranscriptReadError('missing', `${harness} transcript for ${threadId} is unavailable: file was not found`)
      return readLineFile(harness, path, parse, range)
    },
  }
}

export const claudeTranscript: TranscriptReader = lineFileReader('claude', (threadId) => claudeTranscriptPath(threadId), claudeEvent)
export const codexTranscript: TranscriptReader = lineFileReader('codex', (threadId) => codexRolloutPath(threadId), codexEvent)
export const piTranscript: TranscriptReader = lineFileReader('pi', (threadId) => piSessionPath(threadId), piEvent)

// OpenCode has no per-thread file: the store's revision is the change token, and one export per
// revision is parsed and kept, so repeated interval reads of a quiet thread cost nothing new.
const opencodeExports = new Map<string, { revision: string; events: ParsedEvent[] }>()
export function opencodeTranscriptReader(root = opencodeStoreRoot(), load: (threadId: string) => string = opencodeExport): TranscriptReader {
  return {
    revision: () => opencodeStoreRevision(root),
    read: async (threadId, range) => {
      const revision = opencodeStoreRevision(root)
      if (!revision) throw new TranscriptReadError('missing', `opencode transcript for ${threadId} is unavailable: store was not found`)
      const key = `${root}:${threadId}`
      let cached = opencodeExports.get(key)
      if (!cached || cached.revision !== revision) {
        let exported: string
        try { exported = load(threadId) } catch (error) { throw new TranscriptReadError('unreadable', `opencode transcript could not be exported: ${error instanceof Error ? error.message : String(error)}`) }
        let value: unknown
        try { value = JSON.parse(exported) } catch (error) { throw new TranscriptReadError('invalid', `opencode transcript cannot be parsed: ${error instanceof Error ? error.message : String(error)}`) }
        cached = { revision, events: opencodeEvents(value) }
        opencodeExports.set(key, cached)
      }
      const collector = new IntervalCollector(range)
      for (const event of cached.events) collector.add(event)
      return collector.finish(revision, 'opencode')
    },
  }
}
export const opencodeTranscript: TranscriptReader = opencodeTranscriptReader()

export function unsupportedTranscript(harness: string): TranscriptReader {
  return {
    revision: () => null,
    read: async () => { throw new TranscriptReadError('unsupported', `${harness} does not support transcript access`) },
  }
}
