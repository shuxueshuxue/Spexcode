import { createElement, useMemo } from 'react'
import { parseProseTokens, renderProseTokens } from './proseTokens.js'

// The only React entry to the prose token boundary. Consumers provide semantic handlers; they never
// choose a parser or a rendering dialect. `lineBase` is caller-owned provenance for governed documents.
export default function Prose({ children, className = '', lineBase = 0, renderSpecRef, renderEvidence, renderTimeAnchor }) {
  const tokens = useMemo(() => parseProseTokens(children), [children])
  const content = useMemo(() => renderProseTokens(tokens, {
    h: (() => {
      let key = 0
      return (type, props, ...children) => {
        const hasProps = props !== null && typeof props === 'object' && !Array.isArray(props)
        const attrs = hasProps ? { ...props, key: props.key ?? `prose-${key++}` } : { key: `prose-${key++}` }
        return hasProps ? createElement(type, attrs, ...children) : createElement(type, attrs, props, ...children)
      }
    })(),
    lineBase,
    renderSpecRef,
    renderEvidence,
    renderTimeAnchor,
  }), [tokens, lineBase, renderSpecRef, renderEvidence, renderTimeAnchor])
  return createElement('div', { className }, content)
}

export { parseProseTokens, renderProseTokens }
