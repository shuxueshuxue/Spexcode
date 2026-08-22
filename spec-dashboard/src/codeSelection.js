// A source selection travels through the ordinary prompt as one readable token. JSON keeps arbitrary source
// text lossless (including marker-looking lines), while the surrounding HTML comment keeps the transport
// inert in markdown and makes the path/line metadata visible to a human reading the prompt.
const TOKEN_RE = /<!-- spexcode-selection (\{.*?\}) -->/g

const validSelection = (value) => value && typeof value.path === 'string' && value.path
  && Number.isInteger(value.startLine) && value.startLine > 0
  && Number.isInteger(value.endLine) && value.endLine >= value.startLine
  && typeof value.text === 'string'

export function encodeCodeSelection(selection) {
  if (!validSelection(selection)) throw new TypeError('invalid code selection')
  return `<!-- spexcode-selection ${JSON.stringify({
    path: selection.path,
    startLine: selection.startLine,
    endLine: selection.endLine,
    text: selection.text,
  })} -->`
}

export function decodePrompt(value) {
  const source = typeof value === 'string' ? value : ''
  const selections = []
  const text = source.replace(TOKEN_RE, (_token, json) => {
    try {
      const selection = JSON.parse(json)
      if (validSelection(selection)) selections.push(selection)
      else return _token
    } catch {
      return _token
    }
    return ''
  }).replace(/\n{3,}/g, '\n\n').trim()
  return { text, selections }
}

export function encodePrompt(text, selections = []) {
  const body = typeof text === 'string' ? text.trim() : ''
  const tokens = selections.filter(validSelection).map(encodeCodeSelection)
  return [body, ...tokens].filter(Boolean).join('\n\n')
}

export function selectionLabel(selection) {
  return `${selection.path}:${selection.startLine}-${selection.endLine}`
}
