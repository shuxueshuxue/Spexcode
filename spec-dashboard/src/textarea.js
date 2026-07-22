// the ONE textarea auto-grow routine, shared by every authored composer — the console's New prompt,
// ❯ inbox ([[session-console]]) and the thread composer ([[issues-view]]'s ReplyComposer): reset to `auto`
// (so it can shrink), then height = scrollHeight clamped BETWEEN `minH` and `maxH`. `minH` is the usable
// IDLE FLOOR — the box lands at a real writing height with no click-to-expand, autogrow lives ABOVE it
// (the thread composer passes ~3 lines; the console boxes default to 0 and stay single-line). overflow-y
// stays HIDDEN below the cap so a scrollbar never appears from the height transition lagging or from
// scrollHeight's sub-pixel rounding; only past the cap does it flip to `auto`. `minH`/`maxH` are the only
// per-surface differences. Growth is CONTENT-driven: an EMPTY box is measured with its placeholder blanked
// (restored before return, same frame — no paint between), because Chrome folds a WRAPPED placeholder into
// scrollHeight and that would grow a resting box past the strip its host reserved for it; a placeholder
// that doesn't fit clips instead.
export function fitTextarea(ta, maxH, minH = 0) {
  if (!ta) return
  const placeholder = ta.placeholder
  if (!ta.value && placeholder) ta.placeholder = ''
  ta.style.height = 'auto'
  ta.style.overflowY = ta.scrollHeight > maxH ? 'auto' : 'hidden'
  ta.style.height = `${Math.min(Math.max(ta.scrollHeight, minH), maxH)}px`
  if (ta.placeholder !== placeholder) ta.placeholder = placeholder
}
