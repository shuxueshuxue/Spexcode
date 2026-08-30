import { timeOf } from '@spexcode/transcript-ui'
import { Icon, IconButton } from './icons.jsx'
import { isTimelineSelection } from './codeSelection.js'
import { useT } from './i18n/index.jsx'

// [[code-selection]]'s one attachment face. Prose dispatch, the New Session queue and the Conversation's
// quote are three producers of the same ordinary prompt token, so they share this co-work-shaped row
// instead of growing a page-local chip dialect. The caller owns removal and delivery; this component only
// exposes the readable address and the one optional remove action.
//
// The row LEADS WITH WHAT NAMES THE PASSAGE TO A READER and closes with its extent. For a file that name is
// the path, for a spec body the node — but for a passage quoted out of a conversation it is the passage's own
// opening words. A session id names nothing to a human, and its headline names only the room the words were
// said in, which the reader is already standing in; the words are the only part that says WHICH quote this is.
// The address stays in the row's title and in the token, so nothing is lost by not painting it.
// The extent differs by flavour too: a span of lines for anything that lives in a file, the MOMENT it was said
// for a quote, because a conversation is a time ruler. So does the mark — a diff mark for a passage that lives
// in a file, the reply mark for one quoted out of a conversation.
export default function SelectionAttachment({ selection, onRemove = null, className = '' }) {
  const t = useT()
  if (!selection) return null
  const quoted = isTimelineSelection(selection)
  const address = quoted ? selection.session : (selection.node || selection.path)
  const extent = quoted
    ? timeOf(selection.at)
    : t('proseActions.lines', { a: selection.startLine, b: selection.endLine })
  // one line: a quote's newlines are the transcript's, not this row's, and the row is one line high
  const lead = quoted ? ((selection.text || '').trim().split('\n')[0] || address) : address
  const label = `${lead}:${extent}`
  return (
    <div role="group" className={`selection-attachment${className ? ` ${className}` : ''}`} data-selection-attachment
      title={selection.text || label} aria-label={label}>
      <Icon name={quoted ? 'corner-up-left' : 'file-diff'} size={12} className="selection-attachment-icon" />
      <span className="selection-attachment-address" title={address}>{lead}</span>
      <span className="selection-attachment-range">{extent}</span>
      {onRemove && <IconButton icon="x" size={12} className="icon-btn selection-attachment-remove"
        label={t('session.removeCodeSelection')} onClick={onRemove} />}
    </div>
  )
}
