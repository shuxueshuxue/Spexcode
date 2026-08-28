import { useMemo } from 'react'
import { alreadySaid, isRunning, TranscriptTurns, useDisclosure } from './Transcript.jsx'

// the current turn: everything after the newest human message inside the interval (or the whole interval
// when the stretch was opened by the agent itself and no message sits in it)
export function currentTurn(turns) {
  let start = 0
  turns.forEach((turn, index) => { if (turn.role === 'user') start = index + 1 })
  return turns.slice(start)
}

// the compact view of "now": the newest prose and every call after it — the process that produced earlier
// prose has already folded into history. Before any prose, the calls themselves are the news: a turn that
// opens with tools (Claude's usual shape) is not blank, it is working.
export function liveSlice(turns) {
  const turn = currentTurn(turns)
  let lead = -1
  for (let index = turn.length - 1; index >= 0; index--) if (turn[index].text) { lead = index; break }
  return lead < 0 ? turn : turn.slice(lead)
}

// [[message-stream]]: the open seam's collapsed face — the current turn, drawn IN the conversation in the
// transcript's own grammar (prose as the page, each call as a sentence), fed by the same streamed payload the
// expanded seam renders in full. It knows only normalized turns: no harness id, no transcript path, no envelope.
export default function LiveTail({ data, lastSaid = null }) {
  const [openIds, toggle] = useDisclosure()
  const slice = useMemo(() => (data?.turns ? liveSlice(data.turns) : []), [data])
  if (!slice.length) return null
  // THE LIVE TAIL SAYS NOTHING THE RECORD ALREADY SAID: the moment the agent declares its newest prose as its
  // status note, the durable timeline draws it as a message one row above, so the tail elides it
  const repeated = alreadySaid(slice[0].text, lastSaid)
  const running = slice.some((turn) => (turn.tools || []).some((tool) => isRunning(tool, true)))
  // said, and nothing still running: the record has the words and the seam above keeps the folded history
  if (repeated && !running) return null
  const turns = repeated ? [{ ...slice[0], text: undefined }, ...slice.slice(1)] : slice
  if (!turns.some((turn) => turn.text || turn.tools?.length)) return null
  return (
    <div className="m-live" data-revision={data.revision}>
      <TranscriptTurns turns={turns} openIds={openIds} onToggle={toggle} live />
    </div>
  )
}
