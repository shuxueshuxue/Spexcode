import { createReadStream, statSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { claudeTranscriptPath, codexRolloutPath } from './execution-trace.js'

export type TranscriptRange = Readonly<{ from: number; to: number }>
export type TranscriptTool = Readonly<{
  id: string
  name: string
  input?: string
  output?: string
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
  from: number
  to: number
  turns: readonly TranscriptTurn[]
  truncated: boolean
  omittedTurns: number
  omittedBytes: number
  outOfOrderEvents: number
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

type MutableTool = { id: string; name: string; input?: string; output?: string; outputLines: number; outputBytes: number }
type MutableTurn = { id: string | null; at: number; role: 'user' | 'assistant'; text?: string; tools: MutableTool[] }
type ParsedEvent = { at: number | null; turn: MutableTurn | null; toolOutputs?: readonly { id: string; text: string }[] }

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
  if (entry.type === 'event_msg' && type === 'agent_message' && payload.phase === 'commentary') {
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

function sourcePath(harness: string, threadId: string): string | null {
  if (harness === 'claude' || harness === 'claude-headless') return claudeTranscriptPath(threadId)
  if (harness === 'codex' || harness === 'codex-headless') return codexRolloutPath(threadId)
  throw new TranscriptReadError('unsupported', `${harness} does not support transcript access`)
}

export async function readTranscript(harness: string, threadId: string, range: TranscriptRange): Promise<TranscriptRead> {
  const path = sourcePath(harness, threadId)
  if (!path) throw new TranscriptReadError('missing', `${harness} transcript for ${threadId} is unavailable: file was not found`)
  let size = 0
  try { size = statSync(path).size } catch (error) { throw new TranscriptReadError('unreadable', `${harness} transcript is unreadable: ${error instanceof Error ? error.message : String(error)}`) }
  if (size <= 0) throw new TranscriptReadError('unreadable', `${harness} transcript is unreadable: file is empty`)
  const parse = harness === 'claude' || harness === 'claude-headless' ? claudeEvent : codexEvent
  const turns: MutableTurn[] = []
  const byTool = new Map<string, MutableTool>()
  let sawTimestamp = false
  let omittedTurns = 0
  let omittedBytes = 0
  let outOfOrderEvents = 0
  let lookingPastRange = false
  let postRangeLines = 0
  const input = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 })
  const lines = createInterface({ input, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      let value: unknown
      try { value = JSON.parse(line) } catch (error) { throw new TranscriptReadError('invalid', `${harness} transcript cannot be parsed: ${error instanceof Error ? error.message : String(error)}`) }
      const event = parse(value)
      const stopAfterLine = lookingPastRange && ++postRangeLines >= POST_RANGE_LOOKAHEAD_LINES
      if (!event) {
        if (stopAfterLine) break
        continue
      }
      const eventAt = event.at
      const hasTimestamp = eventAt !== null
      if (hasTimestamp) sawTimestamp = true
      if (!lookingPastRange && hasTimestamp && eventAt > range.to) {
        lookingPastRange = true
      } else if (lookingPastRange && hasTimestamp && eventAt <= range.to) {
        outOfOrderEvents++
      }
      if (hasTimestamp && eventAt >= range.from && eventAt <= range.to) {
        if (event.toolOutputs) {
          for (const output of event.toolOutputs) {
            const bytes = Buffer.byteLength(output.text)
            const tool = byTool.get(output.id)
            if (!tool) {
              omittedBytes += bytes
              continue
            }
            tool.outputBytes += bytes
            tool.outputLines += lineCount(output.text)
            if (tool.output === undefined) tool.output = ''
            const remaining = Math.max(0, MAX_OUTPUT_BYTES - Buffer.byteLength(tool.output))
            tool.output += output.text.slice(0, remaining)
            if (bytes > remaining) omittedBytes += bytes - remaining
          }
        } else if (event.turn) {
          if (turns.length >= MAX_TURNS) omittedTurns++
          else {
            turns.push(event.turn)
            for (const tool of event.turn.tools) byTool.set(tool.id, tool)
          }
        }
      }
      if (stopAfterLine) break
    }
  } catch (error) {
    if (error instanceof TranscriptReadError) throw error
    throw new TranscriptReadError('unreadable', `${harness} transcript could not be read: ${error instanceof Error ? error.message : String(error)}`)
  } finally { input.destroy() }
  if (!sawTimestamp) throw new TranscriptReadError('invalid', `${harness} transcript has no reliable timestamps; interval reads are unavailable`)
  const normalized = turns.map((turn) => ({
    ...turn,
    tools: turn.tools.length ? turn.tools.map((tool) => ({ ...tool })) : undefined,
  }))
  return {
    from: range.from,
    to: range.to,
    turns: normalized,
    truncated: omittedTurns > 0 || omittedBytes > 0 || outOfOrderEvents > 0,
    omittedTurns,
    omittedBytes,
    outOfOrderEvents,
  }
}

export async function readClaudeTranscript(threadId: string, range: TranscriptRange): Promise<TranscriptRead> {
  return readTranscript('claude', threadId, range)
}

export async function readCodexTranscript(threadId: string, range: TranscriptRange): Promise<TranscriptRead> {
  return readTranscript('codex', threadId, range)
}

export async function unsupportedTranscriptReader(harness: string, _threadId: string, _range: TranscriptRange): Promise<TranscriptRead> {
  throw new TranscriptReadError('unsupported', `${harness} does not support transcript access`)
}
