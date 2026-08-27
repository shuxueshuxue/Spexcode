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
    fitTextarea(textarea, parseFloat(styles.maxHeight) || Infinity, parseFloat(styles.minHeight) || 0, styles)
  }, [value])

  return <textarea ref={innerRef} value={value} className={`composer-textarea ${className}`.trim()} {...props} />
})

// forwardRef so a host that FLOATS the shell (the prose send card) can measure and clamp it into the
// viewport; a docked host simply ignores the ref.
export const ComposerSurface = forwardRef(function ComposerSurface({ as: Surface = 'div', className = '', preview = null, editor, footer, ...props }, ref) {
  return (
    <Surface ref={ref} className={`composer-surface ${className}`.trim()} {...props}>
      {preview}
      <div className="composer-editor">{editor}</div>
      <div className="composer-footer">{footer}</div>
    </Surface>
  )
})
