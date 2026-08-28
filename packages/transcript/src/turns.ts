// THE NORMALIZED TRANSCRIPT. Every harness keeps its conversation in a private shape; this is the one shape
// every surface reads instead: user and assistant prose, tool calls with their input, and each call's output
// once the harness recorded it. Nothing here imports Node, so a browser renderer and a Node reader share it.

export type TranscriptRange = Readonly<{ from: number; to: number }>
export type TranscriptTool = Readonly<{
  id: string
  name: string
  input?: string
  output?: string          // absent until the harness recorded the result — the live tail reads that as "running"
  outputLines: number
  outputBytes: number
}>
export type TranscriptTurn = Readonly<{
  id: string                // the native id, or `<role>@<at>[#n]` synthesized in thread order — never null, so a
                            // subscriber can key the same turn across reads (the frame protocol diffs by it)
  at: number
  role: 'user' | 'assistant'
  text?: string
  tools?: readonly TranscriptTool[]
}>
export type TranscriptRead = Readonly<{
  revision: string          // the source's change token at read time — the stream re-reads only when it moves
  from: number
  to: number
  turns: readonly TranscriptTurn[]
  truncated: boolean
  omittedTurns: number
  omittedBytes: number
  outOfOrderEvents: number
}>

// THE OPEN INTERVAL'S CURSOR. `[from, now]` is re-read on every native change while an agent works, and a native
// source only ever grows: the cursor keeps its position, so each `advance` parses what was appended since the
// last one and returns the same complete snapshot `read` would. A source that shrank was rewritten underneath
// it and is read afresh.
export type TranscriptTail = Readonly<{
  advance(to: number): Promise<TranscriptRead>
  close(): void
}>

// A transcript source. `revision` is the cheap "did anything change" probe (a stat or a counter, never a parse)
// and is `null` while the source does not exist yet; `read` is the bounded interval read; `tail` opens the
// incremental cursor on an open interval. A harness with no reliable native transcript declares the unsupported
// reader, which fails loudly instead of pretending the conversation was empty. A file-backed reader and an
// in-memory one ([[live-transcript]]) are both this — the frame protocol never learns which it is reading.
export type TranscriptReader = Readonly<{
  revision(threadId: string): string | null
  read(threadId: string, range: TranscriptRange): Promise<TranscriptRead>
  tail(threadId: string, from: number): TranscriptTail
}>

export class TranscriptReadError extends Error {
  constructor(readonly reason: 'unsupported' | 'missing' | 'unreadable' | 'invalid', message: string) {
    super(message)
    this.name = 'TranscriptReadError'
  }
}
