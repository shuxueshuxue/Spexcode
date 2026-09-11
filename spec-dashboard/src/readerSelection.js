// A reading surface asks this only to distinguish a click from a drag that left a real browser selection.
// Selection is native now; the old Custom Highlight path made the composer caret and the reader's words two
// competing truths, so the controller owns one DOM Range instead (see [[selection-controller]]).
export function readerIsSelecting() {
  const native = typeof window !== 'undefined' && window.getSelection ? window.getSelection() : null
  return !!native && !native.isCollapsed && String(native).trim().length > 0
}
