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
}
