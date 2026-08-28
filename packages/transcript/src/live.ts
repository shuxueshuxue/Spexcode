import { TranscriptReadError, type TranscriptRange, type TranscriptRead, type TranscriptReader, type TranscriptTail } from './turns.js'
import { IntervalCollector, type Parse, type ParsedEvent } from './parsers.js'

// THE IN-MEMORY SOURCE. A headless controller already holds the harness's native events as they stream past —
// Claude's `stream-json` lines, an app-server's notifications — so a transcript need not be re-read from the
// file the harness also writes. Push each native event here, through the same parser the file reader uses, and
// this is a `TranscriptReader` like any other: the frame protocol, the interval read, and every renderer work
// unchanged, and `onChange` lets a producer publish on arrival instead of on a tick. One instance is one thread.
export class LiveTranscript implements TranscriptReader {
  private readonly events: ParsedEvent[] = []
  private writes = 0
  private readonly listeners = new Set<() => void>()
  constructor(private readonly parse: Parse, readonly threadId: string) {}

  // `true` when the record meant something to the parser; an unrecognized record is not an error — a native
  // stream carries plenty the transcript does not show (control replies, usage, the result envelope)
  push(native: unknown): boolean {
    const event = this.parse(native)
    if (!event) return false
    this.events.push(event)
    this.writes++
    for (const listener of this.listeners) listener()
    return true
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private own(threadId: string): void {
    if (threadId !== this.threadId) throw new TranscriptReadError('missing', `live transcript holds thread ${this.threadId}, not ${threadId}`)
  }

  // `null` until the first event lands: the thread has not started, which the frame protocol reads as absent
  revision(threadId: string): string | null {
    this.own(threadId)
    return this.writes ? `${this.writes}` : null
  }

  async read(threadId: string, range: TranscriptRange): Promise<TranscriptRead> {
    this.own(threadId)
    const collector = new IntervalCollector(range)
    for (const event of this.events) collector.add(event)
    return collector.finish(`${this.writes}`, 'live')
  }

  // the cursor is an index into the event list: each advance collects only what was pushed since the last one
  tail(threadId: string, from: number): TranscriptTail {
    this.own(threadId)
    const collector = new IntervalCollector({ from, to: from })
    let consumed = 0
    return {
      advance: async (to) => {
        collector.extend(to)
        for (; consumed < this.events.length; consumed++) collector.add(this.events[consumed])
        return collector.finish(`${this.writes}`, 'live')
      },
      close: () => {},
    }
  }
}
