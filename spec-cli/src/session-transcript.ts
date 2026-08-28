import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { readAliasedRawRecord } from '@spexcode/spec-core'
import { defaultHarness, harnessById, type Harness } from './harness.js'
import { TranscriptReadError, openFrameStream } from '@spexcode/transcript'

// The session-addressed face of [[transcript-reader]]: one resolver from a governed session to its adapter and
// native thread, one bounded GET for a closed interval, and one SSE for the OPEN interval — the stretch the
// agent is working in right now, whose end is "now" and moves. Native bytes never cross here; the adapter's
// reader hands back normalized turns and this module only addresses them.

type Target = { ok: true; harness: Harness; threadId: string } | { ok: false; status: 404 | 409 | 500; error: string }

export function resolveTranscriptTarget(id: string): Target {
  let raw: ReturnType<typeof readAliasedRawRecord>
  try { raw = readAliasedRawRecord(id) } catch (error) { return { ok: false, status: 500, error: `session ${id} record is unreadable: ${error instanceof Error ? error.message : String(error)}` } }
  if (!raw || !raw.governed) return { ok: false, status: 404, error: `session ${id} does not exist` }
  let harness: Harness
  try { harness = harnessById(typeof raw.harness === 'string' && raw.harness ? raw.harness : defaultHarness.id) }
  catch (error) { return { ok: false, status: 500, error: error instanceof Error ? error.message : String(error) } }
  const threadId = harness.exactNativeTargetId({
    session: raw.session_id,
    harnessSessionId: typeof raw.harness_session_id === 'string' ? raw.harness_session_id : null,
    stopped: !!raw.stopped,
    archived: !!raw.archived,
  })
  if (!threadId) return { ok: false, status: 409, error: `session ${id} transcript is unavailable: native harness identity is missing` }
  return { ok: true, harness, threadId }
}

const epoch = (value: string | undefined): number | null => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && Number.isInteger(number) ? number : null
}

const failure = (error: unknown): { body: { error: string; reason: string }; status: 409 | 422 | 501 } => {
  if (!(error instanceof TranscriptReadError)) throw error
  return { body: { error: error.message, reason: error.reason }, status: error.reason === 'unsupported' ? 501 : error.reason === 'invalid' ? 422 : 409 }
}

// GET /api/sessions/:id/transcript?from=<ms>&to=<ms> — a closed interval, both bounds explicit so the route
// never guesses which stretch the caller meant.
export async function readSessionTranscript(c: Context) {
  const id = c.req.param('id') || ''
  const fromRaw = c.req.query('from')
  const toRaw = c.req.query('to')
  if (fromRaw == null || toRaw == null || fromRaw === '' || toRaw === '')
    return c.json({ error: 'transcript needs both from and to epoch milliseconds' }, 400)
  const from = epoch(fromRaw)
  const to = epoch(toRaw)
  if (from === null || to === null || from >= to)
    return c.json({ error: 'transcript interval is invalid: from and to must be integer epoch milliseconds with from < to' }, 400)
  const target = resolveTranscriptTarget(id)
  if (!target.ok) return c.json({ error: target.error }, target.status)
  try {
    return c.json(await target.harness.transcript.read(target.threadId, { from, to }))
  } catch (error) {
    const { body, status } = failure(error)
    return c.json(body, status)
  }
}

// GET /api/sessions/:id/transcript/tool/:toolId?from=<ms> — one call's recorded output, read when a person
// opens it. The live stream withholds output bodies (below), so this is where a body comes from; the interval
// is `[from, now]`, the same stretch the stream reads, and a call outside it is a 404.
export async function readSessionTranscriptTool(c: Context) {
  const id = c.req.param('id') || ''
  const toolId = c.req.param('toolId') || ''
  const from = epoch(c.req.query('from'))
  if (from === null || !toolId) return c.json({ error: 'transcript tool needs a tool id and from as integer epoch milliseconds' }, 400)
  const target = resolveTranscriptTarget(id)
  if (!target.ok) return c.json({ error: target.error }, target.status)
  try {
    const read = await target.harness.transcript.read(target.threadId, { from, to: Math.max(from + 1, Date.now()) })
    for (const turn of read.turns) for (const tool of turn.tools ?? []) {
      if (tool.id !== toolId) continue
      return c.json({ id: tool.id, output: tool.output ?? null, outputLines: tool.outputLines, outputBytes: tool.outputBytes })
    }
    return c.json({ error: `tool ${toolId} is not in this interval` }, 404)
  } catch (error) {
    const { body, status } = failure(error)
    return c.json(body, status)
  }
}

const TICK_MS = 500
const HEARTBEAT_TICKS = 20

// GET /api/sessions/:id/transcript/stream?from=<ms> — the open interval [from, now], carried over SSE. What a
// frame holds, when one is worth sending, and how a subscriber merges it are [[transcript-frames]]'
// `openFrameStream`, shared with every other transport; this route owns only the carriage: a tick that asks
// the stream to publish, one `transcript` SSE event per frame it yields, and periodic `ping` heartbeats so the
// browser's dead-man can reopen a silent stream. Reading happens only while a client is subscribed and stops
// on abort, closing the cursor.
export async function sessionTranscriptStream(c: Context) {
  const id = c.req.param('id') || ''
  const from = epoch(c.req.query('from'))
  if (from === null) return c.json({ error: 'transcript stream needs from as integer epoch milliseconds' }, 400)
  const target = resolveTranscriptTarget(id)
  if (!target.ok) return c.json({ error: target.error }, target.status)
  const frames = openFrameStream(target.harness.transcript, target.threadId, from)
  return streamSSE(c, async (stream) => {
    let aborted = false
    let ticks = 0
    const publish = async () => {
      const frame = await frames.publish()
      if (frame) await stream.writeSSE({ event: 'transcript', data: JSON.stringify(frame) })
    }
    stream.onAbort(() => { aborted = true; frames.close() })
    try {
      await publish()
      while (!aborted) {
        await stream.sleep(TICK_MS)
        if (aborted) break
        await publish()
        if (++ticks % HEARTBEAT_TICKS === 0) await stream.writeSSE({ event: 'ping', data: 'x' })
      }
    } catch {
      // EventSource reconnects a dropped stream; a native read must never take the session server down.
    } finally { frames.close() }
  })
}
