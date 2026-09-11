// [[segmented-control]]: a choice among a few values is one trough of segments, the chosen one lifted and the
// rest quiet. Every surface that offers such a choice mounts this; a host may tune the density from its own
// container, never the grammar.
export function Segmented({ label, value, options, onPick }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={option.value === value ? 'seg-option on' : 'seg-option'}
          aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

// One on/off setting is the same segment standing alone: lifted while on.
export function SegmentedToggle({ pressed, onToggle, children }) {
  return (
    <span className="seg">
      <button type="button" className={pressed ? 'seg-option on' : 'seg-option'} aria-pressed={pressed} onClick={onToggle}>
        {children}
      </button>
    </span>
  )
}
