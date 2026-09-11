import { useEffect, useRef, useState } from 'react'
import { Icon } from './icons.jsx'
import { useT } from './i18n/index.jsx'
import { writeClipboard } from './clipboard.js'

const COPIED_MS = 1200

// ONE PRESS TAKES THE WHOLE THING. `text` is what was authored (a message's Markdown, a code block's
// source), never the rendered DOM. The answer shows on the button the reader pressed: a check that
// fades back, or a failure that stays until the next press, because a copy that silently did nothing
// is the one outcome a reader cannot notice by themselves. The press never takes focus from the
// composer, and never reaches the block around it (a clamped note would open under the press).
export function CopyButton({ text, what = 'message', className = '' }) {
  const t = useT()
  const [result, setResult] = useState(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (event) => {
    event.stopPropagation()
    clearTimeout(timer.current)
    const copied = await writeClipboard(text)
    setResult(copied ? 'copied' : 'failed')
    if (copied) timer.current = setTimeout(() => setResult(null), COPIED_MS)
  }
  const label = result === 'copied' ? t('clipboard.copied')
    : result === 'failed' ? t('clipboard.failed')
      : t(what === 'code' ? 'clipboard.copyCode' : 'clipboard.copyMessage')
  return (
    <button type="button" className={`copy-btn${result ? ` is-${result}` : ''}${className ? ` ${className}` : ''}`}
      data-tip={label} aria-label={label} onMouseDown={(event) => event.preventDefault()} onClick={copy}>
      <Icon name={result === 'copied' ? 'check' : result === 'failed' ? 'x' : 'copy'} size={13} />
    </button>
  )
}

// the code block's binding, handed to the prose renderer through `CodeCopyContext`
export function CodeCopy({ text }) {
  return <CopyButton text={text} what="code" />
}
