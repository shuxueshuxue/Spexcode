import { useMemo } from 'react'
import { alreadySaid, isRunning, liveSlice, type AnyTurn } from './segments.js'
import type { AnyTool } from './vocabulary.js'
import { TranscriptTurns } from './TranscriptView.js'
import { useDisclosure } from './useDisclosure.js'

// THE OPEN INTERVAL'S COLLAPSED FACE: the current turn — the newest prose and every call after it — drawn in
// the transcript's own grammar from the same merged payload the expanded view renders in full. `lastSaid` is
// what the host's own record already shows (a declared note); the tail elides the prose that repeats it. The
// caret marks words still being said: it sits at the end of the newest prose only while that prose is the
// newest thing in the turn — once a call follows, the words are finished and the running call is the mark.
export function LiveTail({ turns, lastSaid = null, revision, className = '' }: { turns: readonly AnyTurn[] | null | undefined; lastSaid?: string | null; revision?: string; className?: string }) {
  const [openIds, toggle] = useDisclosure()
  const slice = useMemo(() => (turns ? liveSlice(turns) : []), [turns])
  if (!slice.length) return null
  const repeated = alreadySaid(slice[0].text, lastSaid)
  const running = slice.some((turn) => (turn.tools || []).some((tool: AnyTool) => isRunning(tool, true)))
  if (repeated && !running) return null
  const shown: AnyTurn[] = repeated ? [{ ...slice[0], text: undefined }, ...slice.slice(1)] : slice
  if (!shown.some((turn) => turn.text || turn.tools?.length)) return null
  const last = shown[shown.length - 1]
  const speaking = !!last.text && !last.tools?.length
  return (
    <div className={`tx tx-live${speaking ? ' is-speaking' : ''}${className ? ` ${className}` : ''}`} data-revision={revision}>
      <TranscriptTurns turns={shown} openIds={openIds} onToggle={toggle} live />
    </div>
  )
}
