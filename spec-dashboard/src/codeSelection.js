// A source selection travels through the ordinary prompt as one readable token. JSON keeps arbitrary source
// text lossless (including marker-looking lines), while the surrounding HTML comment keeps the transport
// inert in markdown and makes the path/line metadata visible to a human reading the prompt.
const TOKEN_RE = /<!-- spexcode-selection (\{.*?\}) -->/g

// `node` is OPTIONAL and names a spec node when the selection came from that node's prose
// ([[prose-selection]]) rather than from a governed source file. It is the only field the two flavours do
// not share, because a spec body is addressed by node id — the address the reader on the other end can
// resolve as `[[id]]` — while a source file is addressed by path. `path` is carried either way, so a token
// stays locatable without the board.
const validSelection = (value) => value && typeof value.path === 'string' && value.path
  && Number.isInteger(value.startLine) && value.startLine > 0
  && Number.isInteger(value.endLine) && value.endLine >= value.startLine
  && typeof value.text === 'string'
  && (value.node === undefined || (typeof value.node === 'string' && !!value.node))

export function encodeCodeSelection(selection) {
  if (!validSelection(selection)) throw new TypeError('invalid code selection')
  return `<!-- spexcode-selection ${JSON.stringify({
    ...(selection.node ? { node: selection.node } : {}),
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

// the chip's one line. A prose selection leads with the NODE, because that is the address its reader
// resolves and the path (…/<node>/spec.md) only repeats it; a source selection leads with the path.
export function selectionLabel(selection) {
  const where = selection.node || selection.path
  return `${where}:${selection.startLine}-${selection.endLine}`
}
