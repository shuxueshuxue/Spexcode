import { streamSSE } from 'hono/streaming'
import type { Context } from 'hono'
import { harnessById } from './harness.js'
import { readAliasedRawRecord } from '@spexcode/spec-core'
import { currentHumanTurn } from './session-timeline.js'
import type { ExecutionStep, ExecutionTurn } from './execution-trace.js'

export type SessionExecution = Readonly<{
  revision: string
  turnId: string | null
  workingNote: string | null
  steps: readonly ExecutionStep[]
}>

const absentExecution = (turn: ExecutionTurn | null = null): SessionExecution => ({ revision: `turn:${turn?.token ?? '0'}`, turnId: turn?.token ?? null, workingNote: null, steps: [] })

// This is deliberately a read projection. Native transcript bytes stay within the adapter, while the API owns
// only enough information for the frontend's fixed renderer to paint the current execution slice.
export function readSessionExecution(id: string): SessionExecution | null {
  let record: ReturnType<typeof readAliasedRawRecord>
  try { record = readAliasedRawRecord(id) } catch { return null }
  if (!record?.governed) return null
  const turn = currentHumanTurn(id)
  const threadId = typeof record.harness_session_id === 'string' ? record.harness_session_id : ''
  if (!threadId) return absentExecution(turn)
  try {
    const trace = harnessById(typeof record.harness === 'string' && record.harness ? record.harness : 'claude')
      .executionTrace(threadId, turn)
    return trace || absentExecution(turn)
  } catch {
    // A missing/unreadable native source is an absent transient trace, not a synthetic conversation failure.
    return absentExecution(turn)
  }
}

const TRACE_TICK_MS = 500
const HEARTBEAT_TICKS = 20

export async function sessionExecutionStream(c: Context) {
  const id = c.req.param('id') || ''
  if (!readSessionExecution(id)) return c.json({ error: 'no such session' }, 404)
  return streamSSE(c, async (stream) => {
    let aborted = false
    let lastRevision = ''
    let ticks = 0
    const publish = async (): Promise<boolean> => {
      const execution = readSessionExecution(id)
      if (!execution) return false
      if (execution.revision === lastRevision) return true
      lastRevision = execution.revision
      await stream.writeSSE({ event: 'execution', data: JSON.stringify(execution) })
      return true
    }

    stream.onAbort(() => { aborted = true })
    try {
      if (!await publish()) return
      while (!aborted) {
        await stream.sleep(TRACE_TICK_MS)
        if (aborted) break
        if (!await publish()) break
        if (++ticks % HEARTBEAT_TICKS === 0) await stream.writeSSE({ event: 'ping', data: 'x' })
      }
    } catch {
      // EventSource reconnects a dropped stream. A native trace read must never take down the session server.
    }
  })
}
