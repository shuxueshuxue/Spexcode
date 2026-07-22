import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { fitTextarea } from './textarea.js'

export function composingKey(event) {
  return event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229
}

export const ComposerTextarea = forwardRef(function ComposerTextarea({ value, className = '', ...props }, forwardedRef) {
  const innerRef = useRef(null)
  useImperativeHandle(forwardedRef, () => innerRef.current)

  useLayoutEffect(() => {
    const textarea = innerRef.current
    if (!textarea) return
    const styles = getComputedStyle(textarea)
    fitTextarea(textarea, parseFloat(styles.maxHeight) || Infinity, parseFloat(styles.minHeight) || 0)
  }, [value])

  return <textarea ref={innerRef} value={value} className={`composer-textarea ${className}`.trim()} {...props} />
})

export function ComposerSurface({ className = '', preview = null, editor, footer, ...props }) {
  return (
    <div className={`composer-surface ${className}`.trim()} {...props}>
      {preview}
      <div className="composer-editor">{editor}</div>
      <div className="composer-footer">{footer}</div>
    </div>
  )
}
