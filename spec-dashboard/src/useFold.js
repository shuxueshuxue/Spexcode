import { useEffect, useState } from 'react'

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

// → [mounted, closing, folding]. Render while `mounted`; put the closing class on while `closing`; hand
// `folding` to `useArrival` below, which is what the panel publishes as `data-fold`.
//
// This hook owns the band's OPEN/CLOSED state and nothing else. `folding` is true for exactly one duration
// after the reader worked the fold control, which is the only arrival that is a width movement.
//
// The transition is read DURING the render that changes `open`, never from an effect, for the same reason
// `useFoldOut` below is: an effect runs after paint, so the first committed frame would carry the wrong
// animation and be replaced by the right one one frame later — a twitch at the start of the gesture.
export function useFold(open, ms = DOCK_FOLD_MS) {
  const [closing, setClosing] = useState(false)
  const [folding, setFolding] = useState(false)
  const [was, setWas] = useState(open)
  if (was !== open) {
    setWas(open)
    setFolding(open)
    setClosing(!open)
  }
  useEffect(() => {
    if (!folding) return undefined
    const timer = setTimeout(() => setFolding(false), ms)
    return () => clearTimeout(timer)
  }, [folding, ms])
  useEffect(() => {
    if (!closing) return undefined
    const timer = setTimeout(() => setClosing(false), ms)
    return () => clearTimeout(timer)
  }, [closing, ms])
  return [open || closing, closing, folding]
}

// → the panel's `data-fold`: `'in'` a fold, `'swap'` a route handover, `null` at rest. Every foldable panel
// calls this with its `useFold` folding flag and publishes the result.
//
// A panel can appear for two unrelated reasons and only one of them is a width movement: the reader unfolded
// it, or the route changed and this component is now the one drawing a band that was already there. Animating
// the second as the first is what made switching between a session and a spec look like the sidebar was torn
// down and rebuilt — the band collapsed to nothing and grew back while the document column slid 200px with it.
//
// The two answers come from two places, which is why this is a second hook rather than another `useFold`
// return value. A FOLD is a state change, and the state lives in whoever owns the open/closed flag — the
// shell, for its dock. A HANDOVER is a MOUNT, and only the panel element knows it appeared: the shell stays
// mounted across the route switch that replaces its dock, so its own hook sees no transition at all. Reading
// the handover here, where the mount happens, is what lets both directions of the swap dissolve.
//
// Rest is the third answer and it is spelled out, because leaving it as the missing case is what made the
// fold twitch. While `data-fold` was a boolean, "no attribute" meant both "at rest" and "just handed over",
// so the handover rule had to be CSS's unconditional fallback — and a panel LEAVING its fold passes straight
// through that fallback. Measured: 170ms after the reader opened the dock it blinked to opacity 0, jumped
// 6px left and dissolved back in, because dropping the flag swapped the running animation-name and started a
// second animation on top of the first. Three movements over 350ms for one click.
export function useArrival(folding, ms = DOCK_FOLD_MS) {
  // mounting with no fold under way is the handover case: nothing transitioned, this component simply took
  // the band over. A panel that mounted mid-fold is that fold, so it never claims the swap.
  const [swap, setSwap] = useState(!folding)
  useEffect(() => {
    if (!swap) return undefined
    const timer = setTimeout(() => setSwap(false), ms)
    return () => clearTimeout(timer)
  }, [swap, ms])
  if (folding) return 'in'
  return swap ? 'swap' : null
}


// → `{ key, value }` for the thing the current `key` replaced, held for exactly one fold, else null.
//
// `useFold` above holds a MOUNT: what folds away is still in the tree, only hidden, so keeping it rendered
// is enough. The conversation's live tail is not. When the person's message closes a working stretch, the
// stretch on the other side of it takes over the stream and the payload the outgoing tail was drawing is
// replaced with the new one's — so what has to outlive the change is the CONTENT, and the caller draws the
// collapse from what this hands back. It is also why this is a value and not three hooks: the seams are a
// list, and a hook cannot be called once per row of a list.
//
// The transition is read during the render that changes `key`, never from an effect: an effect runs after
// paint, so the reader would see the tail already gone and then watch it fold. `value` is read at that same
// moment, while it still belongs to the outgoing key. And the held value can never outlive its timer — one
// that survived would leave a second tail standing under a row that has already closed.
export function useFoldOut(key, value, ms = DOCK_FOLD_MS) {
  const [out, setOut] = useState(null)
  const [was, setWas] = useState(key)
  if (was !== key) { setWas(key); setOut(was == null ? null : { key: was, value }) }
  useEffect(() => {
    if (!out) return undefined
    const timer = setTimeout(() => setOut(null), ms)
    return () => clearTimeout(timer)
  }, [out, ms])
  return out
}
