import { useState } from 'react'
import Modal from './Modal.jsx'
import { sessionHeadline } from './session.js'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

// The "attach" verb of the session row's right-click menu ([[attach-menu]]). A live session runs inside a
// private tmux server on the HOST, and the console's terminal is only a read-only view over it; when a human
// wants a REAL tmux client (full input, their own scrollback, from a shell on the box) the web page can't run
// the attach for them — it hands over the command to paste. The command is the project's own blessed escape
// hatch, `spex session attach <id>` ([[session-attach]]), NOT the raw `tmux -L … attach` incantation that the
// CLI verb exists precisely to save humans from — so it inherits the detach hint, locality guard, and
// offline-loud behaviour for free. It is copied on click AND shown in a selectable field, so it works even off
// a secure context (no clipboard API).
export default function SessionAttach({ session, onClose }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  useEscLayer(!!session, onClose)
  if (!session) return null

  const cmd = `spex session attach ${session.id}`
  const copy = () => { navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => { /* selectable field is the fallback */ }) }

  return (
    <Modal
      title={t('sessionWindow.attachTitle', { name: sessionHeadline(session) })}
      closeLabel={t('common.close')}
      className="sess-rename-modal"
      onClose={onClose}
    >
      <div className="sess-attach">
        <p className="sess-attach-hint">{t('sessionWindow.attachHint')}</p>
        <div className="sess-attach-row">
          <input
            className="sess-attach-cmd" readOnly value={cmd} spellCheck={false} autoFocus
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="sess-rename-btn sess-attach-copy" onClick={copy}>
            {copied ? t('sessionWindow.attachCopied') : t('sessionWindow.attachCopy')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
