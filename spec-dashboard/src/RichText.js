import { createElement } from 'react'
import Prose from './Prose.js'

// Timeline and file previews use the same token-to-React renderer as spec bodies and review threads.
// Keep this small compatibility name while callers migrate; it is not a second parser or HTML surface.
// It supplies default semantic handlers and nothing else: `softBreak` passes straight through, because its
// two consumers disagree — a timeline message keeps the newlines its writer typed, a previewed .md file is
// a document whose authoring wraps reflow. Only the surface knows which it is holding.
export default function RichText({ children, className = '', softBreak, renderSpecRef, renderEvidence, renderTimeAnchor }) {
  const specRef = renderSpecRef || ((id, token, provenance) => {
    return createElement('span', { className: 'doc-ref', 'data-spec-id': id, ...provenance }, id)
  })
  const evidence = renderEvidence || ((meta, token, provenance) => createElement('a', {
    className: 'doc-evidence', href: meta.src, 'data-evidence-hash': meta.hash, ...provenance,
  }, meta.alt || meta.hash))
  return createElement(Prose, {
    className: `rich-text${className ? ` ${className}` : ''}`,
    softBreak,
    renderSpecRef: specRef,
    renderEvidence: evidence,
    renderTimeAnchor,
  }, children)
}

const rangeAround = (node) => {
  const nodeRange = document.createRange()
  nodeRange.selectNode(node)
  return nodeRange
}

// KaTeX exposes visual and accessible branches. Copying the browser range directly would duplicate a
// formula, so replace each intersected math token with its authored source while retaining surrounding text.
export function richTextFromRange(range, root) {
  if (!range || range.collapsed || !root) return ''
  const math = [...root.querySelectorAll('[data-math-source]')].filter((node) => range.intersectsNode(node))
  if (!math.length) return range.toString()
  const parts = []
  let startContainer = range.startContainer
  let startOffset = range.startOffset
  for (const [index, node] of math.entries()) {
    const nodeRange = rangeAround(node)
    const startsBeforeNode = range.compareBoundaryPoints(Range.START_TO_START, nodeRange) <= 0
    if (index > 0 || startsBeforeNode) {
      const before = document.createRange()
      before.setStart(startContainer, startOffset)
      before.setEndBefore(node)
      parts.push(before.toString())
    }
    parts.push(node.getAttribute('data-math-source') || '')
    const after = document.createRange()
    after.setStartAfter(node)
    after.collapse(true)
    startContainer = after.startContainer
    startOffset = after.startOffset
  }
  const lastRange = rangeAround(math[math.length - 1])
  if (range.compareBoundaryPoints(Range.END_TO_END, lastRange) >= 0) {
    const tail = document.createRange()
    tail.setStart(startContainer, startOffset)
    tail.setEnd(range.endContainer, range.endOffset)
    parts.push(tail.toString())
  }
  return parts.join('')
}
