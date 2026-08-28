import { useCallback, useRef, useState } from 'react'
import { mergeTranscriptFrame, type HeldTranscript, type MergedFrame, type TranscriptFrame } from '@spexcode/transcript/frames'

// THE SUBSCRIBER'S HOOK. Hand it every frame a transport delivers (SSE, IPC, a socket — the hook does not
// care) and read one complete payload back: the frame protocol's own merge keeps the held turns, so a host
// writes no merging code and cannot drift from the producer. `reset` is for a stream that starts over.
export function useTranscriptFrames(): { payload: MergedFrame['payload'] | null; receive: (frame: TranscriptFrame) => void; reset: () => void } {
  const held = useRef<HeldTranscript>({ turns: [] })
  const [payload, setPayload] = useState<MergedFrame['payload'] | null>(null)
  const receive = useCallback((frame: TranscriptFrame) => {
    const merged = mergeTranscriptFrame(held.current, frame)
    held.current = merged.state
    setPayload(merged.payload)
  }, [])
  const reset = useCallback(() => { held.current = { turns: [] }; setPayload(null) }, [])
  return { payload, receive, reset }
}
