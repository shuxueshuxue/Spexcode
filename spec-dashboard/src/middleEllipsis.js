// Keep both ends of long identities visible. Bias the fixed budget toward the suffix because sibling
// labels commonly share a long path-like prefix.
export function middleEllipsis(value, maxChars = 14) {
  const text = String(value ?? '')
  if (text.length <= maxChars) return text
  if (maxChars <= 1) return '…'.slice(0, maxChars)
  const available = maxChars - 1
  const head = Math.max(1, Math.floor(available / 2) - 1)
  const tail = available - head
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}
