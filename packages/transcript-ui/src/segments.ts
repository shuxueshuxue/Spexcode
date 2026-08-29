import type { StreamTurn, TranscriptTurn } from '@spexcode/transcript/frames'
import type { AnyTool } from './vocabulary.js'

export type AnyTurn = TranscriptTurn | StreamTurn

// a call is running until the harness recorded its result; only a LIVE reading may say so — a closed
// interval that ends before the result was written is history, not something still happening
export const isRunning = (tool: AnyTool, live: boolean): boolean => live && tool.output === undefined

// THE TRANSCRIPT SAYS NOTHING THE RECORD ALREADY SAID. An adopter whose record draws a message or a declared
// note as a row of its own elides the same sentence inside the transcript. Either side may be the other's
// prefix (a note is often clipped), so the test is a prefix match over squashed whitespace.
const squash = (text: string | null | undefined): string => (text || '').replace(/\s+/g, ' ').trim()
export const alreadySaid = (text: string | null | undefined, said: string | null | undefined): boolean => {
  const a = squash(text).replace(/(\.\.\.|…)$/, '')
  const b = squash(said)
  return !!a && !!b && (b.startsWith(a) || a.startsWith(b))
}

export type WorkSegment = Readonly<{
  kind: 'work'
  work: readonly AnyTurn[]        // the process: assistant turns before the answer
  answer: AnyTurn | null          // the last turn of the run that actually says something
  after: readonly AnyTurn[]       // calls made after the answer — they follow it, in the open
  calls: number
  folded: boolean
  now: boolean                    // the last segment of a live payload: what is happening right now
}>
export type QuoteSegment = Readonly<{ kind: 'quote'; turn: AnyTurn }>
export type Segment = WorkSegment | QuoteSegment

export type FoldPolicy = 'segments' | 'runs' | 'none'
export type UserTurnPolicy = 'quote' | 'boundary'

// WHERE THE FOLD BELONGS, decided by what a real transcript looks like. Measured against a real session: 39
// calls spread across 21 assistant turns, one or two each — the repetition is BETWEEN turns, not within
// them. So the unit is the work SEGMENT: a consecutive run of assistant turns, ending at the last one that
// actually says something. Everything before that is how the answer was produced; the last turn is the
// answer. Collapse the process, keep the result.
//
// THE WORK IN PROGRESS NEVER FOLDS. The last segment of a LIVE payload is what is happening now: its calls
// after the newest prose — or all of them, while there is no prose yet — draw as sentences whatever their
// number. They fold the moment the agent speaks.
//
// A user turn is a BOUNDARY: it ends the current run of agent work. Whether it is also DRAWN is the adopter's
// call — a host whose own record already shows every message (SpexCode's conversation) hides it; a host for
// which the transcript is the whole conversation quotes it.
export function segments(turns: readonly AnyTurn[], options: { live?: boolean; fold?: FoldPolicy; runMin?: number; userTurns?: UserTurnPolicy } = {}): Segment[] {
  const { live = false, fold = 'segments', runMin = 3, userTurns = 'boundary' } = options
  const out: Segment[] = []
  let run: AnyTurn[] = []
  const flush = () => {
    if (!run.length) return
    const calls = run.reduce((n, turn) => n + (turn.tools?.length || 0), 0)
    let lead = run.length - 1
    while (lead > 0 && !run[lead].text) lead -= 1
    const answer = run[lead]?.text ? run[lead] : null
    const work = answer ? run.slice(0, lead) : run
    const after = answer ? run.slice(lead + 1) : []
    // HOW BUSY THE STRETCH WAS decides whether to collapse it; WHAT THE COLLAPSE HIDES is what the row counts.
    // Those are two different quantities and both belong: `calls` is the whole run, answer included, and it is
    // the honest measure of "was this worth folding". But a run whose calls ALL sit on its answer turn hides
    // none of them, and folding it anyway drew a row reading "0 tool uses" over prose — a control naming
    // something it did not stand for. So the threshold stays on the run, and the fold requires that there be
    // something to hide.
    const hidden = work.reduce((n, turn) => n + (turn.tools?.length || 0), 0)
    out.push({ kind: 'work', work, answer, after, calls, folded: fold === 'segments' && calls >= runMin && hidden > 0, now: false })
    run = []
  }
  for (const turn of turns) {
    if (turn.role === 'user') {
      flush()
      if (userTurns === 'quote' && turn.text) out.push({ kind: 'quote', turn })
      continue
    }
    run.push(turn)
  }
  flush()
  const last = out[out.length - 1]
  if (live && last?.kind === 'work') {
    const now: WorkSegment = { ...last, now: true, folded: last.folded && !!last.answer }
    out[out.length - 1] = now
  }
  return out
}

// the current turn: everything after the newest human message (or the whole payload when the stretch was
// opened by the agent itself and no message sits in it)
export function currentTurn(turns: readonly AnyTurn[]): AnyTurn[] {
  let start = 0
  turns.forEach((turn, index) => { if (turn.role === 'user') start = index + 1 })
  return turns.slice(start)
}

// the compact view of "now": the newest prose and every call after it — the process that produced earlier
// prose has already folded into history. Before any prose, the calls themselves are the news.
export function liveSlice(turns: readonly AnyTurn[]): AnyTurn[] {
  const turn = currentTurn(turns)
  let lead = -1
  for (let index = turn.length - 1; index >= 0; index--) if (turn[index].text) { lead = index; break }
  return lead < 0 ? turn : turn.slice(lead)
}
