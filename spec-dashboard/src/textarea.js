// the ONE textarea auto-grow routine, shared by every docked input bar — the console's New-tab prompt and
// ❯ inbox ([[session-console]]) and the thread composer ([[issues-view]]'s ReplyComposer): reset to `auto`
// (so it can shrink), then height = scrollHeight clamped at `maxH`. overflow-y stays HIDDEN below the cap
// so a scrollbar never appears from the height transition lagging or from scrollHeight's sub-pixel
// rounding; only past the cap does it flip to `auto`. `maxH` is the only per-surface difference.
export function fitTextarea(ta, maxH) {
  if (!ta) return
  ta.style.height = 'auto'
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`
}
