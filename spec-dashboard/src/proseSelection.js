// [[prose-selection]]: turn a text selection in the rendered spec prose back into a LINE RANGE of the
// node's spec.md body.
//
// The prose renderer re-flows what it renders — a paragraph's source lines are joined with spaces, list
// and heading markers are eaten, blank lines vanish. So the DOM cannot be read backwards into a line
// number by measuring text. Instead the renderer STAMPS each block it emits with the body lines that
// block came from (`data-l0`/`data-l1`, 1-based inclusive), and this module reads those stamps back.
// The stamp is the only bridge: no string searching in the rendered text, no second tokenizer.
//
// Everything downstream — the prompt token, the region a manual edit replaces — is sliced out of the
// BODY TEXT by those line numbers, never out of the DOM. That is what keeps a selection lossless: the
// bytes that travel are the bytes in the file.

// A rendered part (`## raw source` / `## expanded spec`) is a contiguous run of body lines with its
// heading removed and its blank edges trimmed. Locate it so the blocks inside it can be numbered against
// the WHOLE body rather than against the part.
//
// The result is VERIFIED, not assumed: the located line range must reproduce the part text (allowing only
// for the edge whitespace the parser trimmed). A part that cannot be placed returns null and the prose
// selection layer simply stays off for it — a wrong line number would be worse than no action at all.
export function locatePart(body, partText) {
  const source = typeof body === 'string' ? body : ''
  const part = typeof partText === 'string' ? partText : ''
  if (!source || !part) return null
  const at = source.indexOf(part)
  if (at < 0) return null
  const startLine = source.slice(0, at).split('\n').length
  const endLine = startLine + part.split('\n').length - 1
  const back = regionText(source, startLine, endLine)
  return back.trim() === part.trim() ? { startLine, endLine } : null
}

// the verbatim body lines a range names — 1-based, inclusive, exactly what a writer must put back.
export function regionText(body, startLine, endLine) {
  const lines = (typeof body === 'string' ? body : '').split('\n')
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return ''
  if (startLine < 1 || endLine < startLine || endLine > lines.length) return ''
  return lines.slice(startLine - 1, endLine).join('\n')
}

// DOM Range → body line range, read off the renderer's stamps.
//
// Only the DEEPEST stamped elements the range touches count. A list stamps both the `<ul>` and each
// `<li>`; taking the union of every hit would round a one-bullet selection up to the whole list, so a
// stamped element that contains another hit yields to it. That is what makes the addressable unit as
// small as the renderer can describe.
export function stampedRange(range, host) {
  if (!range || !host || range.collapsed) return null
  const hits = [...host.querySelectorAll('[data-l0]')].filter((el) => {
    try {
      return range.intersectsNode(el)
    } catch {
      return false      // a detached node mid-rerender is simply not part of this selection
    }
  })
  const leaves = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)))
  let startLine = Infinity
  let endLine = -Infinity
  for (const el of leaves) {
    const a = Number(el.dataset.l0)
    const b = Number(el.dataset.l1)
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) continue
    if (a < startLine) startLine = a
    if (b > endLine) endLine = b
  }
  return endLine >= startLine ? { startLine, endLine } : null
}

// the payload a prose selection travels as ([[code-selection]]): the SAME four fields a source selection
// carries, plus the node id — because a spec body is addressed by node, and the reader on the other end
// resolves `[[id]]`, not a repo path. The path rides along so the token stays resolvable without the board.
export function proseSelection(node, body, lines) {
  if (!node?.id || !node?.path || !lines) return null
  const text = regionText(body, lines.startLine, lines.endLine)
  if (!text.trim()) return null
  return { node: node.id, path: node.path, startLine: lines.startLine, endLine: lines.endLine, text }
}

// the three preset intents the popover offers. `explain` is deliberately answer-only: it asks the target
// session to reply in the conversation and NOT to touch the spec, so reading a passage out loud never
// becomes an unrequested edit.
export const PROSE_PRESETS = ['edit', 'polish', 'explain']
