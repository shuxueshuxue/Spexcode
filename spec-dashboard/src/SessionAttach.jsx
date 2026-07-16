import { useState } from 'react'
import Modal from './Modal.jsx'
import { sessionHeadline } from './session.js'
import { useEscLayer } from './escStack.js'
import { useT } from './i18n/index.jsx'

// One copyable command row: a caption, a read-only click-to-select field, and a copy button that flips to a
// "copied" ack. Extracted so the two attach forms (spex verb + raw tmux) are identical surfaces, not a copy.
function CmdRow({ label, cmd }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard?.writeText(cmd).then(() => setCopied(true), () => { /* selectable field is the fallback */ }) }
  return (
    <div className="sess-attach-row">
      <span className="sess-attach-label">{label}</span>
      <input className="sess-attach-cmd" readOnly value={cmd} spellCheck={false} onFocus={(e) => e.target.select()} />
      <button type="button" className="sess-rename-btn sess-attach-copy" onClick={copy}>
        {copied ? t('sessionWindow.attachCopied') : t('sessionWindow.attachCopy')}
      </button>
    </div>
  )
}

// The "attach" verb of the session row's right-click menu ([[attach-menu]]). A live session runs inside a
// private tmux server on the HOST, and the console's terminal is only a read-only view over it; when a human
// wants a REAL tmux client (full input, their own scrollback, from a shell on the box) the web page can't run
// the attach for them — it hands over the command to paste. The modal offers TWO forms, each copyable: the
// project's own blessed escape hatch `spex session attach <id>` ([[session-attach]], recommended — it carries
// the detach hint, locality guard, and offline-loud behaviour), and the RAW `tmux -L <socket> attach -t <id>`
// for a shell without `spex` on PATH. The socket is a backend fact (settings), never hardcoded here.
export default function SessionAttach({ session, socket, onClose }) {
  const t = useT()
  useEscLayer(!!session, onClose)
  if (!session) return null

  const spexCmd = `spex session attach ${session.id}`
  const tmuxCmd = `tmux -L ${socket} attach -t ${session.id}`

  return (
    <Modal
      title={t('sessionWindow.attachTitle', { name: sessionHeadline(session) })}
      closeLabel={t('common.close')}
      className="sess-rename-modal sess-attach-modal"
      onClose={onClose}
    >
      <div className="sess-attach">
        <CmdRow label={t('sessionWindow.attachSpex')} cmd={spexCmd} />
        <CmdRow label={t('sessionWindow.attachTmux')} cmd={tmuxCmd} />
      </div>
    </Modal>
  )
}
