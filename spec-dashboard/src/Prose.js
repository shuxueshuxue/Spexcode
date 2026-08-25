import { createElement, useMemo } from 'react'
import { parseProseTokens, renderProseTokens } from './proseTokens.js'

// The only React entry to the prose token boundary. Consumers provide semantic handlers; they never
// choose a parser or a rendering dialect beyond `softBreak`. `lineBase` is caller-owned provenance for
// governed documents.
export default function Prose({ children, className = '', lineBase = 0, softBreak, renderSpecRef, renderEvidence, renderTimeAnchor }) {
  const tokens = useMemo(() => {
    try { return parseProseTokens(children) } catch { return null }
  }, [children])
  // @@@parse is memoised, mapping is not - parsing is a pure function of the source, so it caches cleanly.
  // Mapping is not: the semantic handlers are caller closures over live state (timeline events, seek
  // targets) and are rebuilt every render, so a memo keyed on them never hit — it only looked optimised.
  // Pinning them in a ref would hit, and render stale anchors. Mapping itself is object construction;
  // KaTeX, the one expensive step, is cached at the parser boundary instead.
  const content = tokens ? renderProseTokens(tokens, {
    h: (() => {
      let key = 0
      return (type, props, ...children) => {
        const hasProps = props !== null && typeof props === 'object' && !Array.isArray(props)
        const attrs = hasProps ? { ...props, key: props.key ?? `prose-${key++}` } : { key: `prose-${key++}` }
        return hasProps ? createElement(type, attrs, ...children) : createElement(type, attrs, props, ...children)
      }
    })(),
    lineBase,
    softBreak,
    renderSpecRef,
    renderEvidence,
    renderTimeAnchor,
  }) : createElement('p', null, children == null ? '' : String(children))
  return createElement('div', { className }, content)
}

export { parseProseTokens, renderProseTokens }
