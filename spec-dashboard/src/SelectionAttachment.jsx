import { Icon, IconButton } from './icons.jsx'
import { useT } from './i18n/index.jsx'

// [[code-selection]]'s one attachment face. Prose dispatch and the New Session queue are two
// producers of the same ordinary prompt token, so they share this co-work-shaped row instead of
// growing a page-local chip dialect. The caller owns removal and delivery; this component only
// exposes the readable address and the one optional remove action.
export default function SelectionAttachment({ selection, onRemove = null, className = '' }) {
  const t = useT()
  if (!selection) return null
  const address = selection.node || selection.path
  const range = t('proseActions.lines', { a: selection.startLine, b: selection.endLine })
  const label = `${address}:${range}`
  return (
    <div role="group" className={`selection-attachment${className ? ` ${className}` : ''}`} data-selection-attachment
      title={selection.text || label} aria-label={label}>
      <Icon name="file-diff" size={12} className="selection-attachment-icon" />
      <span className="selection-attachment-address" title={address}>{address}</span>
      <span className="selection-attachment-range">{range}</span>
      {onRemove && <IconButton icon="x" size={12} className="icon-btn selection-attachment-remove"
        label={t('session.removeCodeSelection')} onClick={onRemove} />}
    </div>
  )
}
