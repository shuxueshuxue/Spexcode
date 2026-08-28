// The two marks the transcript needs, as inline SVG: a chevron that trails every disclosure and a spinner
// for a running call. Stroke icons, one weight, no emoji — a host's icon set may replace them through CSS.
export function Caret({ open = false, size = 12, className = '' }: { open?: boolean; size?: number; className?: string }) {
  return (
    <svg className={`tx-caret${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

export function Spinner({ size = 11, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={`tx-spin${className ? ` ${className}` : ''}`} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M12 2a10 10 0 1 0 10 10" />
    </svg>
  )
}
