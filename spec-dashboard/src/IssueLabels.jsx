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

// Platform labels stay opaque display metadata. This is their one visual projection across issue list,
// detail, and node cards; the source color is accepted only as a hex value before it reaches CSS.
export default function IssueLabels({ labels }) {
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
        return <span key={`${name}-${index}`} className="issue-label" style={style} title={name}>{name}</span>
      })}
    </span>
  )
}
