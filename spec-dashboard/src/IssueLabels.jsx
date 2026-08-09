const hexColor = (value) => {
  const raw = String(value || '').trim().replace(/^#/, '')
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return null
  const full = raw.length === 3 ? [...raw].map((part) => `${part}${part}`).join('') : raw
  return `#${full.toLowerCase()}`
}

const readableText = (color) => {
  const rgb = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16))
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 150 ? '#1f2328' : '#ffffff'
}

// Platform labels use one rendering path everywhere. The Issues route may supply a filter action; cards
// keep passive chips because their enclosing card remains the one real issue anchor.
export default function IssueLabels({ labels, onSelect = null }) {
  if (!Array.isArray(labels) || !labels.length) return null
  return (
    <span className="issue-labels">
      {labels.map((raw, index) => {
        const label = typeof raw === 'string' ? { name: raw } : raw || {}
        const name = String(label.name || '').trim()
        if (!name) return null
        const color = hexColor(label.color)
        const textColor = hexColor(label.textColor) || (color ? readableText(color) : null)
        const style = color ? { '--issue-label-bg': color, '--issue-label-fg': textColor, '--issue-label-border': color } : undefined
        const props = { key: `${name}-${index}`, className: `issue-label${onSelect ? ' selectable' : ''}`, style, title: name }
        return onSelect
          ? <button type="button" {...props} onClick={() => onSelect(name)}>{name}</button>
          : <span {...props}>{name}</span>
      })}
    </span>
  )
}
