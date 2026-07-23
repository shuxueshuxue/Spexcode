// Console behavior comes from the adapter capability projection on the session row. Harness ids remain
// backend facts; adding another capable adapter requires no dashboard branch.
export const isHeadlessSession = (session) => session?.capabilities?.headless === true
export const isMessageStreamSession = (session) => session?.capabilities?.messageStream === true

const summaryKeys = ['command', 'file_path', 'path', 'pattern', 'query', 'description', 'prompt', 'url']

function short(value, limit = 180) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (!text) return ''
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine
}

function toolSummary(input) {
  if (!input || typeof input !== 'object') return ''
  for (const key of summaryKeys) if (input[key] != null) return short(input[key])
  return short(input)
}

// Project a native stream-json event at the view boundary. The backend deliberately stays schema-blind; this
// small renderer understands only the user/assistant text and tool_use blocks it can truthfully present.
export function messageRows(envelope) {
  const event = envelope?.event
  if (!event || typeof event !== 'object') return []
  const message = event.message && typeof event.message === 'object' ? event.message : event
  const role = message.role || event.role || event.type
  if (role !== 'user' && role !== 'assistant') return []

  const content = message.content
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
  const rows = []
  for (const [index, block] of blocks.entries()) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      rows.push({ key: `${envelope.cursor}:${index}`, kind: role, text: block.text })
    } else if (role === 'assistant' && block.type === 'tool_use') {
      rows.push({
        key: `${envelope.cursor}:${index}`,
        kind: 'tool',
        name: typeof block.name === 'string' && block.name ? block.name : 'tool',
        summary: toolSummary(block.input),
      })
    }
  }
  return rows
}

export function rowsFromMessages(messages) {
  return (messages || []).flatMap(messageRows)
}
