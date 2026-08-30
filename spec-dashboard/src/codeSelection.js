// A selection from any readable surface travels through the ordinary prompt as one readable token. JSON keeps
// arbitrary selected text lossless (including marker-looking lines), while the surrounding HTML comment keeps
// the transport inert in markdown and makes the address metadata visible to a human reading the prompt.
const TOKEN_RE = /<!-- spexcode-selection (\{.*?\}) -->/g

// THREE FLAVOURS, ONE TOKEN, AND THE ONLY DIFFERENCE IS WHAT ADDRESSES THE PASSAGE. A governed source file is
// addressed by `path`; a spec body by its `node` id — the address the reader on the other end resolves as
// `[[id]]` — and carries `path` too, so it stays locatable without the board; a timeline passage
// ([[conversation]]) by the `session` it was read in plus the `at` of the row it started in, because a
// conversation is a time ruler and has no path or line to point at. Everything else is shared: the same
// comment, the same lossless `text`, the same validator, the same attachment row, the same ordinary prompt.
// A token is ONE flavour and never a blend — `session` is the discriminator, and a token carrying both a
// session and a path is refused rather than silently read as either.
const validSource = (value) => typeof value.path === 'string' && !!value.path
  && Number.isInteger(value.startLine) && value.startLine > 0
  && Number.isInteger(value.endLine) && value.endLine >= value.startLine
  && (value.node === undefined || (typeof value.node === 'string' && !!value.node))

const validTimeline = (value) => typeof value.session === 'string' && !!value.session
  && typeof value.at === 'string' && Number.isFinite(Date.parse(value.at))
  && value.path === undefined && value.node === undefined
  && value.startLine === undefined && value.endLine === undefined

export const isTimelineSelection = (value) => !!value && value.session !== undefined

const validSelection = (value) => !!value && typeof value.text === 'string'
  && (isTimelineSelection(value) ? validTimeline(value) : validSource(value))

export function encodeCodeSelection(selection) {
  if (!validSelection(selection)) throw new TypeError('invalid code selection')
  const payload = isTimelineSelection(selection)
    ? { session: selection.session, at: selection.at, text: selection.text }
    : {
      ...(selection.node ? { node: selection.node } : {}),
      path: selection.path,
      startLine: selection.startLine,
      endLine: selection.endLine,
      text: selection.text,
    }
  return `<!-- spexcode-selection ${JSON.stringify(payload)} -->`
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

// the chip's one line: the address, then the extent within it. A prose selection leads with the NODE, because
// that is the address its reader resolves and the path (…/<node>/spec.md) only repeats it; a source selection
// leads with the path; a timeline passage leads with its session, and its extent is a MOMENT rather than a
// span, because a conversation is addressed by when a thing was said.
export function selectionLabel(selection) {
  if (isTimelineSelection(selection)) return `${selection.session}@${selection.at}`
  const where = selection.node || selection.path
  return `${where}:${selection.startLine}-${selection.endLine}`
}
