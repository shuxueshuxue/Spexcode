import { timeOf } from '@spexcode/transcript-ui'
import { Icon, IconButton } from './icons.jsx'
import { isTimelineSelection } from './codeSelection.js'
import { useT } from './i18n/index.jsx'

// [[code-selection]]'s one attachment face. Prose dispatch, the New Session queue and the Conversation's
// quote are three producers of the same ordinary prompt token, so they share this co-work-shaped row
// instead of growing a page-local chip dialect. The caller owns removal and delivery; this component only
// exposes the readable address and the one optional remove action.
//
// The row's two halves are ADDRESS and EXTENT, and only the extent differs by flavour: a file or a spec body
// is a span of lines, a timeline passage is the MOMENT it was said, because a conversation is a time ruler.
// The mark follows the same rule — a diff mark for a passage that lives in a file, the reply mark for one
// quoted out of a conversation. `addressLabel` lets a caller that knows a human name for the address (a
// session's headline, where the token can only carry its id) supply it; the address itself stays in the title.
export default function SelectionAttachment({ selection, onRemove = null, className = '', addressLabel = null }) {
  const t = useT()
  if (!selection) return null
  const quoted = isTimelineSelection(selection)
  const address = quoted ? selection.session : (selection.node || selection.path)
  const extent = quoted
    ? timeOf(selection.at)
    : t('proseActions.lines', { a: selection.startLine, b: selection.endLine })
  const shown = addressLabel || address
  const label = `${shown}:${extent}`
  return (
    <div role="group" className={`selection-attachment${className ? ` ${className}` : ''}`} data-selection-attachment
      title={selection.text || label} aria-label={label}>
      <Icon name={quoted ? 'corner-up-left' : 'file-diff'} size={12} className="selection-attachment-icon" />
      <span className="selection-attachment-address" title={address}>{shown}</span>
      <span className="selection-attachment-range">{extent}</span>
      {onRemove && <IconButton icon="x" size={12} className="icon-btn selection-attachment-remove"
        label={t('session.removeCodeSelection')} onClick={onRemove} />}
    </div>
  )
}
