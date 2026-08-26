import { useEffect, useRef, useState } from 'react'

// Every foldable panel in the frame folds the SAME way ([[dock-modes]]): opening animates from nothing, and
// closing keeps the element on screen for exactly one panel duration so the reverse is visible too. A panel
// that simply unmounts blinks out, which reads as a bug rather than as a fold.
//
// The linger is the whole difficulty, and it is why this is a hook and not three copies. It has to be a real
// mount that outlives the state hiding it, and it must never be able to outlive its own timeout — a flag that
// could survive would leave a ghost panel the reader cannot dismiss. So the timer is cleared on reopen and on
// unmount, and the flag is only ever set by the same transition that arms it.
//
// The duration lives in BOTH layers by necessity: the keyframe is CSS (`--dur-panel`) and the unmount is JS.
// They are the same number, and DOCK_FOLD_MS is the one place the JS half says it.
export const DOCK_FOLD_MS = 170

// → [mounted, closing, opening]. Render while `mounted`; put the closing class on while `closing`.
//
// `opening` is the half that keeps a FOLD from being confused with a HANDOVER. A panel can appear for two
// unrelated reasons: the reader unfolded it, or the route changed and this component is now the one drawing
// a band that was already there. Only the first is a width movement. Animating both as a fold is what made
// switching between a session and a spec look like the sidebar was torn down and rebuilt — the band
// collapsed to nothing and grew back while the document column slid 200px and back with it.
export function useFold(open, ms = DOCK_FOLD_MS) {
  const [closing, setClosing] = useState(false)
  const [opening, setOpening] = useState(false)
  const was = useRef(open)
  useEffect(() => {
    if (was.current === open) return undefined
    was.current = open
    if (open) {
      setClosing(false)
      setOpening(true)
      const timer = setTimeout(() => setOpening(false), ms)
      return () => clearTimeout(timer)
    }
    setOpening(false)
    setClosing(true)
    const timer = setTimeout(() => setClosing(false), ms)
    return () => clearTimeout(timer)
  }, [open, ms])
  return [open || closing, closing, opening]
}
