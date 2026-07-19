import {
  DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, IDENTITY_PRESETS, identityFaviconHref as faviconHref,
  identityPreset,
} from '../../spec-cli/src/identity-presets.js'

export { DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, IDENTITY_PRESETS }
export const identityFaviconHref = faviconHref

export function IdentityIcon({ icon, fallback = DEFAULT_PROJECT_ICON, size = 24, className, label }) {
  const preset = identityPreset(icon)
  if (!preset) {
    return <img width={size} height={size} src={faviconHref(icon, fallback)} className={className} alt={label || ''} aria-hidden={label ? undefined : true} />
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <rect x="1" y="1" width="22" height="22" rx="5" fill={preset.bg} />
      <g fill="none" stroke={preset.fg} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {preset.shapes.map(({ tag: Shape, ...props }, i) => <Shape key={i} {...props} />)}
      </g>
    </svg>
  )
}

export function IdentityPicker({ value, onChange, label, name, disabled = false }) {
  return (
    <fieldset className="identity-picker" disabled={disabled}>
      <legend>{label}</legend>
      <div className="identity-options">
        {IDENTITY_PRESETS.map((preset) => (
          <label key={preset.id} className="identity-choice">
            <input
              type="radio"
              name={name}
              value={preset.id}
              checked={value === preset.id}
              onChange={() => onChange(preset.id)}
            />
            <IdentityIcon icon={preset.id} size={28} />
            <span>{preset.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
