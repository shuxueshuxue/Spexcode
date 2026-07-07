// the ONE textarea auto-grow routine, shared by every docked input bar — the console's New-tab prompt and
// ❯ inbox ([[session-console]]) and the thread composer ([[issues-view]]'s ReplyComposer): reset to `auto`
// (so it can shrink), then height = scrollHeight clamped BETWEEN `minH` and `maxH`. `minH` is the usable
// IDLE FLOOR — the box lands at a real writing height with no click-to-expand, autogrow lives ABOVE it
// (the thread composer passes ~3 lines; the console boxes default to 0 and stay single-line). overflow-y
// stays HIDDEN below the cap so a scrollbar never appears from the height transition lagging or from
// scrollHeight's sub-pixel rounding; only past the cap does it flip to `auto`. `minH`/`maxH` are the only
// per-surface differences.
export function fitTextarea(ta, maxH, minH = 0) {
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  ta.style.height = `${Math.min(Math.max(ta.scrollHeight, minH), maxH)}px`
}
