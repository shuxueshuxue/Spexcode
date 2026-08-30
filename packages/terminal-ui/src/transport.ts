export type TerminalConnection = {
  send: (data: string) => boolean | void
  resize: (cols: number, rows: number) => boolean | void
  onData: (listener: (data: string | ArrayBuffer | Uint8Array) => void) => (() => void) | { dispose?: () => void }
  close: () => void
  isOpen?: () => boolean
  onState?: (listener: (state: 'connecting' | 'open' | 'reconnecting') => void) => (() => void) | { dispose?: () => void }
  onOpen?: (listener: () => void) => (() => void) | { dispose?: () => void }
}

export type TerminalTransport = { connect: (id: string) => TerminalConnection }

// One link the HOST recognized in a rendered line: `start`/`end` are indices into the line's TEXT (end
// exclusive) and `text` is what activation receives. The package owns the xterm plumbing — which buffer
// line, which cells, how wide cells map to columns; the host owns what counts as a link and where it goes.
export type TerminalLink = { start: number; end: number; text: string }

export type SessionTerminalProps = {
  sessionId: string
  transport: TerminalTransport
  active?: boolean
  focused?: boolean
  writable?: boolean
  resumeRequired?: boolean
  focusRequest?: number
  labels?: { resumeInputTitle?: string; resumeInputMessage?: string; cancel?: string; resumeInputConfirm?: string }
  getFontSize?: () => number
  subscribeFontSize?: (listener: (size: number) => void) => (() => void)
  findLinks?: (lineText: string) => TerminalLink[]
  onOpenLink?: (text: string, event: MouseEvent) => void
}
