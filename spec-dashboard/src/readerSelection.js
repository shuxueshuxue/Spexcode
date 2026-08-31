// IS THE READER HOLDING A SELECTION RIGHT NOW? A clamped block opens on a press anywhere in it, and the
// press that ENDS a drag over its words is the same event — so before opening, whoever asks needs to know
// whether words are held. Two answers count, because this conversation paints its own selection as a Custom
// Highlight to keep the composer's caret ([[conversation]]) and the browser knows nothing about that one:
// the painted range, and any ordinary document Selection. Live selection only — never mere capability,
// which is always true in a browser that supports the API and would wedge every clamped block shut.
export function readerIsSelecting() {
  try {
    const painted = typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.get('timeline-sel') : null
    if (painted && painted.size > 0) return true
  } catch { /* no Highlight API here; the native answer below still stands */ }
  const native = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null
  return !!native && !native.isCollapsed && String(native).trim().length > 0
}
