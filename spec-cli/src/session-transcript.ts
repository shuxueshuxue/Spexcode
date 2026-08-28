import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { readAliasedRawRecord } from '@spexcode/spec-core'
import { defaultHarness, harnessById, type Harness } from './harness.js'
import { TranscriptReadError, type TranscriptRead } from './transcript-reader.js'

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

const TICK_MS = 500
const HEARTBEAT_TICKS = 20

export type TranscriptFrame = TranscriptRead | Readonly<{ revision: string; from: number; to: number; error: string; reason: string }>

// GET /api/sessions/:id/transcript/stream?from=<ms> — the open interval [from, now]. The adapter's revision
// probe runs each tick; a changed revision re-reads the interval and pushes the whole normalized payload, so
// a subscriber always holds one consistent read rather than a patch it has to merge. An absent source is an
// empty payload (the thread has not started writing), not an error; a read failure is a frame that says so.
export async function sessionTranscriptStream(c: Context) {
  const id = c.req.param('id') || ''
  const from = epoch(c.req.query('from'))
  if (from === null) return c.json({ error: 'transcript stream needs from as integer epoch milliseconds' }, 400)
  const target = resolveTranscriptTarget(id)
  if (!target.ok) return c.json({ error: target.error }, target.status)
  const { harness, threadId } = target
  return streamSSE(c, async (stream) => {
    let aborted = false
    let last: string | undefined
    let ticks = 0
    const publish = async () => {
      const revision = harness.transcript.revision(threadId) ?? 'absent'
      if (revision === last) return
      const to = Math.max(from + 1, Date.now())
      let frame: TranscriptFrame
      if (revision === 'absent') frame = { revision, from, to, turns: [], truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0 }
      else {
        try { frame = await harness.transcript.read(threadId, { from, to }) }
        catch (error) {
          if (!(error instanceof TranscriptReadError)) throw error
          frame = { revision, from, to, error: error.message, reason: error.reason }
        }
      }
      last = revision
      await stream.writeSSE({ event: 'transcript', data: JSON.stringify(frame) })
    }
    stream.onAbort(() => { aborted = true })
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
    }
  })
}
