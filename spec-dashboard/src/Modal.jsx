// CSS classes are named `legend-*` for history (the legend was the first such modal); shared verbatim by every popup.
// Backdrop click closes; the inner panel stops propagation so a click inside doesn't.
export default function Modal({ title, closeLabel, onClose, className, children }) {
  return (
    <div className="legend-backdrop" data-focus-overlay onClick={onClose}>
      <div
        className={className ? `legend ${className}` : 'legend'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="legend-head">
          <span className="legend-title">{title}</span>
          <button className="legend-close" onClick={onClose} title={closeLabel}>×</button>
        </div>
        <div className="legend-body">{children}</div>
      </div>
    </div>
  )
}
