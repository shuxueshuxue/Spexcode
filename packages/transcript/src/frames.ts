import { TranscriptReadError, type TranscriptRead, type TranscriptReader, type TranscriptTail, type TranscriptTool, type TranscriptTurn } from './turns.js'

// the browser-safe entry is complete on its own: the normalized shape travels with the frames that carry it
export { TranscriptReadError } from './turns.js'
export type { TranscriptRange, TranscriptRead, TranscriptReader, TranscriptTail, TranscriptTool, TranscriptTurn } from './turns.js'

// THE FRAME PROTOCOL — what an open interval's subscriber receives, and how it merges it. This module is the
// contract's one home and imports nothing from Node, so the producer (a server tick, an Electron main process)
// and the consumer (a browser, a renderer) share the exact same code. Transport is not decided here: SpexCode
// carries frames over SSE, another adopter over IPC; both call `openFrameStream` and forward what it yields.
//
// WHAT A FRAME CARRIES. A live frame's tool has no output body: a recorded result is `null` here (its size
// still told), a missing one stays absent — that absence is what the surface reads as "running" — and a body
// is fetched once, when a person opens the call. Measured on a real 29-minute turn, the whole-payload frame
// was 320 KB of which 74% was tool output and 0.3% prose, re-sent on every native write.
export type StreamTool = Readonly<Omit<TranscriptTool, 'output'> & { output?: null }>
export type StreamTurn = Readonly<Omit<TranscriptTurn, 'tools'> & { tools?: readonly StreamTool[] }>
export type StreamFrame = Readonly<Omit<TranscriptRead, 'turns'> & {
  kind: 'full' | 'delta'     // `full`: the whole interval; `delta`: only turns that are new or changed, plus `removed`
  turns: readonly StreamTurn[]
  removed?: readonly string[]
}>
export type TranscriptErrorFrame = Readonly<{ revision: string; from: number; to: number; error: string; reason: string }>
export type TranscriptFrame = StreamFrame | TranscriptErrorFrame

export const isErrorFrame = (frame: TranscriptFrame): frame is TranscriptErrorFrame => 'error' in frame

// The revision an absent source reports: the thread has not started writing. Not an error.
export const ABSENT_REVISION = 'absent'

export const withheld = (read: TranscriptRead): Omit<StreamFrame, 'kind'> => ({
  ...read,
  turns: read.turns.map((turn) => turn.tools
    ? { ...turn, tools: turn.tools.map((tool) => tool.output === undefined ? tool as StreamTool : { ...tool, output: null }) }
    : turn as StreamTurn),
})

// THE PRODUCER'S HALF. Feed it every read of the open interval; it returns the frame that read is worth — the
// first one is the whole interval (`full`), every later one a `delta` holding only the turns that are new or
// changed since the previous frame (a turn changes when a call in it gains its result) and the ids the turn cap
// evicted; the counters are always absolute — or `null` when the read changed nothing the subscriber holds.
export class FrameProducer {
  private primed = false                       // a `full` frame has been delivered on this stream
  private sent = new Map<string, string>()     // turn id → the serialized turn the subscriber holds
  private counters = ''                        // the absolute counters as last sent

  next(read: TranscriptRead): StreamFrame | null {
    const held = withheld(read)
    const next = new Map(held.turns.map((turn) => [turn.id, JSON.stringify(turn)] as const))
    const changed = held.turns.filter((turn) => this.sent.get(turn.id) !== next.get(turn.id))
    const removed = [...this.sent.keys()].filter((turnId) => !next.has(turnId))
    const counters = `${held.truncated}:${held.omittedTurns}:${held.omittedBytes}:${held.outOfOrderEvents}`
    if (this.primed && !changed.length && !removed.length && counters === this.counters) return null
    const frame: StreamFrame = this.primed ? { ...held, kind: 'delta', turns: changed, removed } : { ...held, kind: 'full' }
    this.sent = next; this.counters = counters; this.primed = true
    return frame
  }

  // the next frame is `full` again — a subscriber that reconnects, or a source that vanished, holds nothing
  reset(): void { this.primed = false; this.sent = new Map(); this.counters = '' }
}

export const absentFrame = (from: number, to: number): StreamFrame =>
  ({ kind: 'full', revision: ABSENT_REVISION, from, to, turns: [], truncated: false, omittedTurns: 0, omittedBytes: 0, outOfOrderEvents: 0 })

// THE OPEN INTERVAL AS A STREAM OF FRAMES, transport-neutral. `publish()` runs the reader's cheap revision probe
// and, only when the revision moved, advances the interval's cursor (the reader parses only what was appended)
// and returns what CHANGED as one frame — or `null` when nothing the subscriber holds changed. An absent source
// is an empty `full` frame; a read failure is a frame that says so, so the surface can say so in place. Call it
// on a tick (a file-backed reader) or on a change notification (an in-memory one); the frames are identical.
export type FrameStream = Readonly<{
  publish(now?: number): Promise<TranscriptFrame | null>
  close(): void
}>

export function openFrameStream(reader: TranscriptReader, threadId: string, from: number, clock: () => number = () => Date.now()): FrameStream {
  let last: string | undefined
  let tail: TranscriptTail | null = null      // opened on the first non-absent revision
  const producer = new FrameProducer()
  return {
    async publish(now = clock()) {
      const revision = reader.revision(threadId) ?? ABSENT_REVISION
      if (revision === last) return null
      last = revision
      const to = Math.max(from + 1, now)
      if (revision === ABSENT_REVISION) { producer.reset(); return absentFrame(from, to) }
      try {
        return producer.next(await (tail ??= reader.tail(threadId, from)).advance(to))
      } catch (error) {
        if (!(error instanceof TranscriptReadError)) throw error
        return { revision, from, to, error: error.message, reason: error.reason }
      }
    },
    close() { tail?.close(); tail = null },
  }
}

// THE SUBSCRIBER'S HALF. Merging by turn id — replace a turn the reader holds, append one it does not, drop the
// removed — hands the renderer the same complete shape a closed-interval read returns, so nothing downstream
// knows the wire is incremental. New turns append in arrival order: the native thread is append-only. An error
// frame passes through untouched and leaves the held turns as they were.
export type HeldTranscript = Readonly<{ turns: readonly StreamTurn[] }>
export type MergedFrame = Readonly<{ state: HeldTranscript; payload: TranscriptErrorFrame | (Omit<StreamFrame, 'kind' | 'removed'>) }>

export function mergeTranscriptFrame(state: HeldTranscript, frame: TranscriptFrame): MergedFrame {
  if (isErrorFrame(frame)) return { state, payload: frame }
  const { kind, removed, turns: incoming, ...rest } = frame
  if (kind !== 'delta') {
    const turns = [...(incoming || [])]
    return { state: { turns }, payload: { ...rest, turns } }
  }
  const gone = new Set(removed || [])
  const turns = state.turns.filter((turn) => !gone.has(turn.id))
  const index = new Map(turns.map((turn, at) => [turn.id, at]))
  for (const turn of incoming || []) {
    const at = index.get(turn.id)
    if (at === undefined) { index.set(turn.id, turns.length); turns.push(turn) } else turns[at] = turn
  }
  return { state: { turns }, payload: { ...rest, turns } }
}
