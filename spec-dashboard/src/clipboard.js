import { createContext } from 'react'

const execCopyFallback = (text) => {
  let eventConfirmed = false
  const onCopy = (event) => {
    if (!event.clipboardData) return
    try {
      event.clipboardData.setData('text/plain', text)
      event.preventDefault()
      eventConfirmed = true
    } catch { /* the result remains an honest failure */ }
  }
  document.addEventListener('copy', onCopy, true)
  let commandConfirmed = false
  try { commandConfirmed = document.execCommand('copy') === true } catch { /* the result remains an honest failure */ }
  document.removeEventListener('copy', onCopy, true)
  return eventConfirmed && commandConfirmed
}

// One clipboard capability seam for every copy a reader asks the conversation or a prose block for. The
// event fallback writes the payload without creating a Selection, temporary textarea, or focus handoff, so
// a copy never disturbs the composer caret or a painted timeline selection.
export async function writeClipboard(text) {
  try {
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* plain HTTP and denied permissions continue through the synchronous browser copy path */ }
  return execCopyFallback(text)
}

// @@@code-copy-context - the prose renderer places a code block's copy control, and the app supplies it:
// the control needs the icon vocabulary and the reader's language, and the renderer must stay loadable
// where JSX is not (node tests render it bare, and get no control). Mounted once at the root.
export const CodeCopyContext = createContext(null)
