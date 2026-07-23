// CSS classes are named `legend-*` for history (the legend was the first such modal); shared verbatim by every popup.
// Backdrop click closes; the inner panel stops propagation so a click inside doesn't.
import { useEffect } from 'react'
import { IconButton } from './icons.jsx'
import { returnFocus } from './focus.js'

export default function Modal({ title, closeLabel, onClose, className, children }) {
  // a modal returns the focus it took ([[focus-return]]): whichever way it closes — Esc, backdrop,
  // cancel, submit — unmount hands focus back to the ticket, else the surface's sink. Never <body>.
  useEffect(() => () => returnFocus(), [])
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
          <IconButton icon="x" size={13} className="legend-close" label={closeLabel} onClick={onClose} />
        </div>
        <div className="legend-body">{children}</div>
      </div>
    </div>
  )
}
