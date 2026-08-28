import { TranscriptReadError, type TranscriptRange, type TranscriptRead } from './turns.js'

// ONE PARSER PER HARNESS. Each function turns one native record — a line of Claude's project JSONL (which is
// also exactly what its `--output-format stream-json` prints), a Codex rollout line, a pi session line, an
// OpenCode export — into the normalized event the interval collector consumes. The same parser serves a file
// being tailed ([[transcript-reader]]) and an event stream held in memory ([[live-transcript]]): the source is
// where bytes come from, the parser is what they mean, and neither knows the other.

export const MAX_TURNS = 200
export const MAX_OUTPUT_BYTES = 64 * 1024

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

export type MutableTool = { id: string; name: string; input?: string; output?: string; outputLines: number; outputBytes: number }
export type MutableTurn = { id: string | null; at: number; role: 'user' | 'assistant'; text?: string; tools: MutableTool[] }
// One native record, normalized: a turn, or a batch of tool results addressed to earlier calls. `at: null`
// marks a record that carries no clock — it counts as seen, never as inside an interval.
export type ParsedEvent = { at: number | null; turn: MutableTurn | null; toolOutputs?: readonly { id: string; text: string }[] }
export type Parse = (value: unknown) => ParsedEvent | null


// --- the four native shapes --------------------------------------------------------------------------------

export function claudeEvent(value: unknown): ParsedEvent | null {
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

export function codexEvent(value: unknown): ParsedEvent | null {
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

export function piEvent(value: unknown): ParsedEvent | null {
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
export function opencodeEvents(value: unknown): ParsedEvent[] {
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

// --- reading an interval ------------------------------------------------------------------------------------

// Collects the interval's turns from any event source. Caps keep the NEWEST turns, because a live tail and a
// closed stretch are both read for what happened last; every dropped turn or byte is counted, never hidden.
export class IntervalCollector {
  readonly turns: MutableTurn[] = []
  private readonly byTool = new Map<string, MutableTool>()
  private readonly evicted = new Set<string>()
  private readonly synthesized = new Map<string, number>()   // `<role>@<at>` → how many turns already wore it
  sawTimestamp = false
  omittedTurns = 0
  omittedBytes = 0
  outOfOrderEvents = 0
  private pastRange = false
  private readonly range: { from: number; to: number }
  constructor(range: TranscriptRange) { this.range = { from: range.from, to: range.to } }

  // the open interval's end is "now" and moves; extending it never revisits what was already collected
  extend(to: number): void { if (to > this.range.to) this.range.to = to }

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
      // the parsed event is never written to: an in-memory source ([[live-transcript]]) collects the same
      // event again on every read, so the collector works on its own copy of the turn and its calls
      const turn: MutableTurn = { ...event.turn, tools: event.turn.tools.map((tool) => ({ ...tool })) }
      // a turn without a native id gets one from its place in the thread — deterministic across re-reads of an
      // append-only source, which is what lets a subscriber match it between frames
      if (turn.id === null) {
        const base = `${turn.role}@${turn.at}`
        const seen = this.synthesized.get(base) ?? 0
        this.synthesized.set(base, seen + 1)
        turn.id = seen ? `${base}#${seen}` : base
      }
      this.turns.push(turn)
      for (const tool of turn.tools) this.byTool.set(tool.id, tool)
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
      turns: this.turns.map((turn) => ({ ...turn, id: turn.id as string, tools: turn.tools.length ? turn.tools.map((tool) => ({ ...tool })) : undefined })),
      truncated: this.omittedTurns > 0 || this.omittedBytes > 0 || this.outOfOrderEvents > 0,
      omittedTurns: this.omittedTurns,
      omittedBytes: this.omittedBytes,
      outOfOrderEvents: this.outOfOrderEvents,
    }
  }
}
