import { closeSync, fstatSync, openSync, readSync, watch, type FSWatcher } from 'node:fs'
import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'

import { readAliasedRawRecord, sessionArtifactPath, sessionStoreDir } from './layout.js'

export type NativeMessageEvent = Record<string, unknown>
export type MessageEnvelope = { cursor: number; event: NativeMessageEvent }
export type MessageBatch = { messages: MessageEnvelope[]; cursor: number }

function fileBytes(path: string, cursor: number): Buffer {
  let fd: number
  try { fd = openSync(path, 'r') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && cursor === 0) return Buffer.alloc(0)
    throw error
  }
  try {
    const size = fstatSync(fd).size
    if (cursor > size) throw new Error(`messages.ndjson cursor ${cursor} is past file size ${size}`)
    const bytes = Buffer.alloc(size - cursor)
    let read = 0
    while (read < bytes.length) {
      const count = readSync(fd, bytes, read, bytes.length - read, cursor + read)
      if (count === 0) break
      read += count
    }
    return read === bytes.length ? bytes : bytes.subarray(0, read)
  } finally { closeSync(fd) }
}

// Parse only newline-terminated records. The cursor is a byte offset, not a character count, so an SSE
// reconnect resumes correctly even when a native event contains non-ASCII text.
export function readMessageBatchFile(path: string, requestedCursor = 0): MessageBatch {
  const cursor = Number.isSafeInteger(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0
  const bytes = fileBytes(path, cursor)

  const messages: MessageEnvelope[] = []
  let lineStart = 0
  while (lineStart < bytes.length) {
    const newline = bytes.indexOf(0x0a, lineStart)
    if (newline < 0) break
    const nextCursor = cursor + newline + 1
    const text = bytes.subarray(lineStart, newline).toString('utf8')
    let event: unknown
    try { event = JSON.parse(text) }
    catch (error) {
      throw new Error(`invalid messages.ndjson event at byte ${cursor + lineStart}: ${(error as Error).message}`)
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`invalid messages.ndjson event at byte ${cursor + lineStart}: expected a JSON object`)
    }
    messages.push({ cursor: nextCursor, event: event as NativeMessageEvent })
    lineStart = newline + 1
  }
  return { messages, cursor: cursor + lineStart }
}

// null means the id is unknown or is not a governed session. A known session with no adapter output yet is
// an ordinary empty stream: the adapter may create messages.ndjson after the browser has connected.
export function readSessionMessages(id: string, cursor = 0): MessageBatch | null {
  const record = readAliasedRawRecord(id)
  if (!record?.governed) return null
  return readMessageBatchFile(sessionArtifactPath(record.session_id, 'messages.ndjson'), cursor)
}

type StreamSignal = 'append' | 'ping' | 'abort' | 'watch-error'

function signalQueue() {
  const queued: StreamSignal[] = []
  let waiter: ((signal: StreamSignal) => void) | null = null
  const push = (signal: StreamSignal) => {
    if (signal === 'append' && queued.includes('append')) return
    if (waiter) {
      const resolve = waiter
      waiter = null
      resolve(signal)
    } else queued.push(signal)
  }
  const next = (): Promise<StreamSignal> => {
    const ready = queued.shift()
    return ready ? Promise.resolve(ready) : new Promise((resolve) => { waiter = resolve })
  }
  return { push, next }
}

function cursorParam(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const cursor = Number(value)
  return Number.isSafeInteger(cursor) ? cursor : null
}

// GET /api/sessions/:id/messages/stream — the append-follow half of [[message-stream]]. REST establishes a
// complete snapshot + cursor; this stream starts there. Standard SSE ids let EventSource reconnect through
// Last-Event-ID even though its original URL still carries the older cursor.
export function sessionMessageStream(c: Context): Response {
  const record = readAliasedRawRecord(c.req.param('id') as string)
  if (!record?.governed) return c.json({ error: 'no such session' }, 404)

  const lastEventCursor = cursorParam(c.req.header('Last-Event-ID'))
  const queryCursor = cursorParam(c.req.query('cursor'))
  const startCursor = lastEventCursor ?? queryCursor ?? 0
  const id = record.session_id

  return streamSSE(c, async (stream) => {
    const signals = signalQueue()
    let aborted = false
    let watcher: FSWatcher | null = null
    const ping = setInterval(() => signals.push('ping'), 10_000)
    ping.unref()
    stream.onAbort(() => { aborted = true; signals.push('abort') })

    try {
      watcher = watch(sessionStoreDir(id), { persistent: false }, (_event, filename) => {
        if (filename == null || String(filename) === 'messages.ndjson') signals.push('append')
      })
      watcher.on('error', () => signals.push('watch-error'))

      let cursor = startCursor
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ cursor }) })
      const flush = async () => {
        const batch = readSessionMessages(id, cursor)
        if (!batch) throw new Error('session closed')
        cursor = batch.cursor
        for (const message of batch.messages) {
          await stream.writeSSE({ event: 'message', id: String(message.cursor), data: JSON.stringify(message) })
        }
      }
      await flush()

      while (!aborted) {
        const signal = await signals.next()
        if (signal === 'abort') break
        if (signal === 'watch-error') throw new Error('messages.ndjson watcher failed')
        if (signal === 'ping') await stream.writeSSE({ event: 'ping', data: 'x' })
        else await flush()
      }
    } catch (error) {
      if (!aborted) {
        await stream.writeSSE({ event: 'stream-error', data: JSON.stringify({ error: (error as Error).message }) }).catch(() => {})
      }
    } finally {
      clearInterval(ping)
      watcher?.close()
    }
  })
}
