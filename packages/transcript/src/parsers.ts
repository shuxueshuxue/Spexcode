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
// A RESULT IS WHAT THE TOOL SAID, NOT ITS WIRE SHAPE. Every harness that records a result as content blocks
// (Claude's tool_result content, Codex's input_text output blocks, MCP results everywhere) means the text of
// those blocks, with their line breaks; encoding the block list itself as JSON would show the reader escaped
// newlines inside a JSON shell. A block that is not text — an image, a reference — is named, not dumped.
const resultText = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return compact(value)
  return value.map((blockValue) => {
    const block = object(blockValue)
    if (!block) return compact(blockValue)
    const text = string(block.text)
    if (text !== null) return text
    const type = string(block.type)
    if (type === 'image') return '[image]'
    if (type) return `[${type}]`
    return compact(blockValue)
  }).join('\n')
}


// CODEX CODE-MODE: the `exec` tool's input is a JS program that calls `tools.exec_command({cmd:"…"})`; the shell
// command is what actually ran, the JS around it is transport the model writes to reach the sandbox. Surface the
// command(s) so a GENERIC renderer shows what ran, not the wrapper. This is codex-adapter knowledge and lives
// here at the bottom of the stack — never leak a code-mode literal up into the shared vocabulary or the UI.
const CODEX_EXEC_CMD = /\bcmd\s*:\s*"((?:[^"\\]|\\.)*)"/g
function codexExecCommand(input: string | undefined): string | undefined {
  if (typeof input !== 'string' || !input.includes('exec_command')) return input
  const commands: string[] = []
  for (const match of input.matchAll(CODEX_EXEC_CMD)) {
    try { commands.push(JSON.parse(`"${match[1]}"`)) } catch { commands.push(match[1].replace(/\\(["\\])/g, '$1')) }
  }
  return commands.length ? commands.join('\n') : input
}const lineCount = (value: string): number => value ? value.split(/\r?\n/).length : 0

export type MutableTool = { id: string; name: string; input?: string; output?: string; outputLines: number; outputBytes: number; outcome?: ToolOutcome }
export type MutableTurn = { id: string | null; at: number; role: 'user' | 'assistant'; text?: string; tools: MutableTool[] }
// One native record, normalized: a turn, or a batch of tool results addressed to earlier calls. `at: null`
// marks a record that carries no clock — it counts as seen, never as inside an interval.
export type ToolOutcome = 'failed' | 'rejected'
// A result carries `outcome` only when its native record has a structured failure field — see TranscriptTool.
export type ParsedEvent = { at: number | null; turn: MutableTurn | null; toolOutputs?: readonly { id: string; text: string; outcome?: ToolOutcome }[] }
export type Parse = (value: unknown) => ParsedEvent | null


// --- the seven native shapes -------------------------------------------------------------------------------

export function claudeEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  if (!entry) return null
  // A message steered into a RUNNING turn (stream-json `type:user` on stdin, a queued command in the TUI) is not
  // recorded as a `user` message: Claude writes it as an `attachment` of type `queued_command` carrying the prompt
  // blocks. It is the person's turn all the same, and the one place a steer becomes observable — hooks never fire
  // for it — so the reader draws it as a user turn at the moment it entered the conversation.
  if (entry.type === 'attachment') {
    const attachment = object(entry.attachment)
    const queuedAt = at(entry)
    if (attachment?.type !== 'queued_command' || queuedAt === null) return null
    const text = items(attachment.prompt).map((block) => string(object(block)?.text)).filter(Boolean).join('\n') || null
    return text ? { at: queuedAt, turn: { id: idOf(entry), at: queuedAt, role: 'user', text, tools: [] } } : null
  }
  const message = object(entry.message)
  if (!message) return null
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
      return b?.type === 'tool_result' && id ? [{ id, text: resultText(b?.content ?? ''), ...(b?.is_error === true ? { outcome: 'failed' as const } : {}) }] : []
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

const blockText = (content: unknown): string | null => typeof content === 'string'
  ? string(content)
  : items(content).map((block) => string(object(block)?.text)).filter(Boolean).join('\n') || null

export function codexEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const payload = object(entry?.payload)
  if (!entry || !payload) return null
  const eventAt = at(payload) ?? at(entry)
  if (eventAt === null) return { at: null, turn: null }
  const type = string(payload.type)
  // THE PERSON'S MESSAGE is the `user_message` event. Codex also records it as a `response_item` message (the API
  // form, `input_text` blocks) beside harness injections that no person typed (the AGENTS.md instructions), so
  // that form is not a turn — the event is, once.
  if (entry.type === 'event_msg' && type === 'user_message') {
    const text = typeof payload.message === 'string' ? payload.message : compact(payload.message ?? payload.content ?? '')
    return text ? { at: eventAt, turn: { id: idOf(payload) ?? idOf(entry), at: eventAt, role: 'user', text, tools: [] } } : null
  }
  if (entry.type === 'response_item' && (type === 'message' || type === 'input_message') && payload.role === 'user') return { at: eventAt, turn: null }
  // WHAT THE AGENT SAID is the `agent_message` event — commentary and the final answer alike. Codex 0.146 also
  // records the same prose as a `response_item` message (`output_text` blocks) beside it, so that form is not read:
  // reading both would say every sentence twice. An empty event (a final answer that was a tool call) is a clock,
  // not a turn. Structured reasoning stays private.
  if (entry.type === 'event_msg' && type === 'agent_message') {
    const text = string(payload.message ?? payload.text)
    return text ? { at: eventAt, turn: { id: idOf(payload) ?? idOf(entry), at: eventAt, role: 'assistant', text, tools: [] } } : { at: eventAt, turn: null }
  }
  if (entry.type === 'response_item' && type === 'message' && payload.role === 'assistant') return { at: eventAt, turn: null }
  if (entry.type === 'response_item' && (type === 'custom_tool_call' || type === 'function_call')) {
    const id = string(payload.call_id ?? payload.id) ?? 'tool'
    const rawInput = payload.input === undefined && payload.arguments === undefined ? undefined : compact(payload.input ?? payload.arguments)
    return { at: eventAt, turn: { id: idOf(payload) ?? idOf(entry), at: eventAt, role: 'assistant', tools: [{ id, name: string(payload.name ?? payload.tool_name) ?? 'tool', input: codexExecCommand(rawInput), outputLines: 0, outputBytes: 0 }] } }
  }
  if (entry.type === 'response_item' && (type === 'custom_tool_call_output' || type === 'function_call_output')) {
    const id = string(payload.call_id ?? payload.id)
    const output = payload.output ?? payload.result ?? ''
    return id ? { at: eventAt, turn: null, toolOutputs: [{ id, text: resultText(output) }] } : null
  }
  return null
}

// Codex app-server notifications are a different native stream from rollout lines. Keep this mapping stateless:
// a caller that needs streamed prose uses codexAppServerStream below, while file and in-memory sources still
// share the same one-record parser contract.
export function codexAppServerEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const params = object(entry?.params)
  if (!entry || !params || typeof entry.method !== 'string') return null
  const item = object(params.item)
  const method = entry.method
  const recognized = method === 'item/agentMessage/delta' || method === 'item/started' || method === 'item/completed'
  if (!recognized) return null
  const eventAt = timestamp(params.emittedAtMs) ?? timestamp(params.startedAtMs) ?? timestamp(params.completedAtMs)
  if (eventAt === null) return { at: null, turn: null }

  if (method === 'item/agentMessage/delta') {
    const id = string(params.itemId)
    const delta = string(params.delta)
    return id && delta !== null
      ? { at: eventAt, turn: { id, at: eventAt, role: 'assistant', text: delta, tools: [] } }
      : null
  }
  if ((method !== 'item/started' && method !== 'item/completed') || !item) return null
  const id = string(item.id)
  const type = string(item.type)
  if (!id || !type) return null
  if (type === 'userMessage') {
    const text = blockText(item.content)
    return text ? { at: eventAt, turn: { id, at: eventAt, role: 'user', text, tools: [] } } : null
  }
  if (type === 'agentMessage') {
    const text = string(item.text)
    return { at: eventAt, turn: { id, at: eventAt, role: 'assistant', text: text ?? undefined, tools: [] } }
  }

  const toolTypes = new Set(['commandExecution', 'functionCall', 'customToolCall', 'mcpToolCall', 'dynamicToolCall'])
  if (!toolTypes.has(type)) return null
  if (method === 'item/started') {
    const name = type === 'commandExecution' ? 'command'
      : string(item.name) ?? string(item.tool) ?? (type === 'mcpToolCall' ? 'mcp' : 'tool')
    const input = item.arguments !== undefined ? item.arguments
      : item.input !== undefined ? item.input
        : item.command !== undefined ? item.command
          : undefined
    return { at: eventAt, turn: { id, at: eventAt, role: 'assistant', tools: [{ id, name, input: input === undefined ? undefined : compact(input), outputLines: 0, outputBytes: 0 }] } }
  }

  let output: unknown = undefined
  if (type === 'commandExecution') output = item.aggregatedOutput
  else if (type === 'functionCall' || type === 'customToolCall') output = item.output ?? item.result
  else if (type === 'mcpToolCall') output = item.result ?? item.error
  else if (type === 'dynamicToolCall') output = item.contentItems ?? item.output ?? item.error
  // the item status is the app-server's own verdict: `failed`, or `declined` when the person refused the call —
  // a declined call has no output, so the empty result is what ends its "running"
  const status = string(item.status)
  const outcome: ToolOutcome | undefined = status === 'failed' ? 'failed' : status === 'declined' ? 'rejected' : undefined
  if (output === undefined || output === null) {
    return outcome ? { at: eventAt, turn: null, toolOutputs: [{ id, text: '', outcome }] } : { at: eventAt, turn: null }
  }
  return { at: eventAt, turn: null, toolOutputs: [{ id, text: resultText(output), ...(outcome ? { outcome } : {}) }] }
}

// Agent-message deltas are fragments of one native item. The closure remembers only that item's text and
// re-emits its native id, allowing IntervalCollector to replace the earlier turn in place.
export function codexAppServerStream(): Parse {
  const textByItem = new Map<string, string>()
  return (value) => {
    const parsed = codexAppServerEvent(value)
    if (!parsed) return null
    const entry = object(value)
    const params = object(entry?.params)
    const item = object(params?.item)
    if (entry?.method === 'item/agentMessage/delta') {
      const id = string(params?.itemId)
      if (!id || !parsed.turn) return parsed
      const text = (textByItem.get(id) ?? '') + (parsed.turn.text ?? '')
      textByItem.set(id, text)
      return { ...parsed, turn: { ...parsed.turn, text } }
    }
    if (item && item.type === 'agentMessage') {
      const id = string(item.id)
      if (id) {
        const text = string(item.text)
        if (text !== null || !textByItem.has(id)) textByItem.set(id, text ?? '')
        const turn = parsed.turn
        if (turn) return { ...parsed, turn: { ...turn, text: textByItem.get(id) || undefined } }
      }
    }
    return parsed
  }
}


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
    return id ? { at: eventAt, turn: null, toolOutputs: [{ id, text: blockText(message.content) ?? compact(message.content ?? ''), ...(message.isError === true ? { outcome: 'failed' as const } : {}) }] } : null
  }
  return null
}

export function geminiEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const message = (entry?.type === 'user' || entry?.type === 'gemini')
    ? entry
    : object(items(entry?.messages)[0]) ?? object(items(object(entry?.$set)?.messages)[0])
  if (!entry || !message) return null
  const eventAt = at(message) ?? at(entry)
  if (eventAt === null) return { at: null, turn: null }
  const content = message.content
  const blocks = items(content)
  const outputs = blocks.flatMap((blockValue) => {
    const block = object(blockValue)
    const response = object(block?.functionResponse)
    const id = string(response?.id)
    return id ? [{ id, text: compact(response?.response ?? '') }] : []
  })
  if (outputs.length) return { at: eventAt, turn: null, toolOutputs: outputs }
  if (message.type === 'user') {
    const text = typeof content === 'string' ? string(content) : blocks.map((block) => string(object(block)?.text)).filter(Boolean).join('\n') || null
    return text ? { at: eventAt, turn: { id: idOf(message), at: eventAt, role: 'user', text, tools: [] } } : null
  }
  if (message.type === 'gemini') {
    const turn: MutableTurn = { id: idOf(message), at: eventAt, role: 'assistant', tools: [] }
    if (typeof content === 'string') turn.text = string(content) ?? undefined
    for (const callValue of items(message.toolCalls)) {
      const call = object(callValue)
      const id = string(call?.id) ?? `tool-${turn.tools.length}`
      turn.tools.push({ id, name: string(call?.name) ?? 'tool', input: call?.args === undefined ? undefined : compact(call.args), outputLines: 0, outputBytes: 0, ...(call?.status === 'error' ? { outcome: 'failed' as const } : {}) })
    }
    if (!turn.text && !turn.tools.length) return null
    return { at: eventAt, turn }
  }
  return null
}

export function openclawEvent(value: unknown): ParsedEvent | null {
  const entry = object(value)
  const message = object(entry?.message)
  if (!entry || entry.type !== 'message' || !message) return null
  const eventAt = at(message) ?? at(entry)
  if (eventAt === null) return { at: null, turn: null }
  if (message.role === 'user') {
    const text = blockText(message.content)
    return text ? { at: eventAt, turn: { id: idOf(entry) ?? idOf(message), at: eventAt, role: 'user', text, tools: [] } } : null
  }
  if (message.role === 'toolResult') {
    const id = string(message.toolCallId)
    return id ? { at: eventAt, turn: null, toolOutputs: [{ id, text: blockText(message.content) ?? compact(message.content ?? ''), ...(message.isError === true ? { outcome: 'failed' as const } : {}) }] } : null
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
    return turn.text || turn.tools.length ? { at: eventAt, turn } : null
  }
  return null
}

export function hermesEvents(value: unknown): ParsedEvent[] {
  const root = object(value)
  const events: ParsedEvent[] = []
  for (const messageValue of items(root?.messages)) {
    const message = object(messageValue)
    if (!message) continue
    const eventAt = at(message)
    if (eventAt === null) { events.push({ at: null, turn: null }); continue }
    const role = message.role
    if (role === 'user') {
      const text = string(message.content)
      if (text) events.push({ at: eventAt, turn: { id: idOf(message), at: eventAt, role: 'user', text, tools: [] } })
    } else if (role === 'assistant') {
      const turn: MutableTurn = { id: idOf(message), at: eventAt, role: 'assistant', tools: [] }
      const text = string(message.content)
      if (text) turn.text = text
      for (const callValue of items(message.tool_calls)) {
        const call = object(callValue)
        const fn = object(call?.function)
        const id = string(call?.id) ?? `tool-${turn.tools.length}`
        turn.tools.push({ id, name: string(fn?.name) ?? 'tool', input: fn?.arguments === undefined ? undefined : compact(fn.arguments), outputLines: 0, outputBytes: 0 })
      }
      if (turn.text || turn.tools.length) events.push({ at: eventAt, turn })
    } else if (role === 'tool') {
      const id = string(message.tool_call_id)
      if (id) events.push({ at: eventAt, turn: null, toolOutputs: [{ id, text: compact(message.content ?? '') }] })
    }
  }
  return events
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
        // the terminal states of OpenCode's ToolState union — a call still pending or running has no result yet
        if (/completed|error/.test(status)) {
          const output = compact(state?.output ?? state?.error ?? '')
          tool.output = output.slice(0, MAX_OUTPUT_BYTES)
          tool.outputBytes = Buffer.byteLength(output)
          tool.outputLines = lineCount(output)
          if (status === 'error') tool.outcome = 'failed'
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
        if (output.outcome) tool.outcome = output.outcome
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
      const existingAt = this.turns.findIndex((candidate) => candidate.id === turn.id)
      if (existingAt >= 0) {
        const existing = this.turns[existingAt]
        const incomingTools = new Map(turn.tools.map((tool) => [tool.id, tool]))
        const tools = existing.tools.map((tool) => {
          const incoming = incomingTools.get(tool.id)
          incomingTools.delete(tool.id)
          return incoming ? { ...tool, ...incoming, output: incoming.output ?? tool.output } : tool
        })
        tools.push(...incomingTools.values())
        const replacement: MutableTurn = { ...existing, ...turn, text: turn.text ?? existing.text, tools }
        this.turns[existingAt] = replacement
        for (const tool of replacement.tools) this.byTool.set(tool.id, tool)
      } else {
        this.turns.push(turn)
        for (const tool of turn.tools) this.byTool.set(tool.id, tool)
        if (this.turns.length > MAX_TURNS) {
          const dropped = this.turns.shift()!
          for (const tool of dropped.tools) this.evicted.add(tool.id)
          this.omittedTurns++
        }
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
