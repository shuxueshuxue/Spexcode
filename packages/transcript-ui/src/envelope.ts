// WHO A QUOTED TURN CAME FROM IS DATA, NOT A RENDERER'S GUESS. A message delivered into an agent by a host
// arrives wrapped in that host's envelope — addressing for the agent (who sent it, how to reply) that is not
// what the sender said. The transcript keeps the envelope verbatim, so a surface that quotes the turn must
// strip it, and each host's envelope is its own shape. So an envelope is one parser ROW: given the turn's
// text, either the sender and the bare body, or null when the text is not this host's envelope. The parsers
// are tried in order and the first match wins; an unmatched turn is quoted whole, from nobody in particular.
// SpexCode's own row — the footer `spex session send` appends — ships as the default; a host adds its own
// (an XML wrapper, a bracketed header) beside it, without the renderer learning either format.
export type Envelope = Readonly<{
  who: string | null        // the sender as the host names them; null when the envelope carries no name
  id?: string | null        // the sender's address in the host's own key space, when the envelope has one
  at?: number | null        // when the host says the message was sent, epoch ms; absent when it does not
  body: string              // what was said, envelope removed
}>
export type EnvelopeParser = (text: string) => Envelope | null

// `— from session "label" (id) on machine m. To reply: spex session send [--ssh addr] id "<your reply>"`
const SPEX_FOOTER = /\n*— from session (?:"(.*?)" \(([^\s)]+)\)|(\S+))(?: on machine \S+)?\. To reply: spex session send (?:--ssh \S+ )?\S+ "<your reply>"\s*$/
export const spexEnvelope: EnvelopeParser = (text) => {
  const m = SPEX_FOOTER.exec(text || '')
  if (!m) return null
  const id = m[2] || m[3] || null
  return { who: m[1] || id, id, body: text.slice(0, m.index) }
}

export const defaultEnvelopes: readonly EnvelopeParser[] = [spexEnvelope]

export function parseEnvelope(text: string, parsers: readonly EnvelopeParser[] = defaultEnvelopes): Envelope {
  for (const parse of parsers) {
    const envelope = parse(text)
    if (envelope) return envelope
  }
  return { who: null, body: text }
}
