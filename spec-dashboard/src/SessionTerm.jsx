import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// @@@ SessionTerm - a READ-ONLY live view of a session's tmux pane, wired to a REAL tmux client over one
// WebSocket (/api/sessions/:id/socket). The human never types INTO the terminal — it is a pure scrollable
// view. Server→client = raw pane bytes (binary) written straight to xterm. We do NOT forward keystrokes or
// mouse back (disableStdin); the ONLY human input is the external message box (SessionInterface's ❯ line),
// which writes into this pane via the `send` writer we register in `senders`. Because nothing types into
// the view, scrolling it can never block input — xterm owns its own scrollback and the wheel scrolls it
// natively (we return false from the wheel handler so tmux's mouse mode never steals the wheel). xterm is
// SCALED to its panel by the FitAddon; each fit sends cols×rows so tmux renders at that size.
export default function SessionTerm({ sessionId, senders }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const term = new Terminal({
      fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, disableStdin: true, scrollback: 5000,  // read-only view; xterm owns scrollback
      theme: {
        background: '#fdf6e3', foreground: '#586e75', cursor: '#268bd2', selectionBackground: '#eee8d5',
        black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
        blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        brightBlack: '#93a1a1', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
        brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#2aa198', brightWhite: '#fdf6e3',
      },
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    // let the wheel scroll xterm's own viewport instead of being captured as a tmux mouse report — since
    // we send nothing back, an un-handled wheel must fall through to the viewport's native scroll.
    term.attachCustomWheelEventHandler(() => false)

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/api/sessions/${sessionId}/socket`)
    ws.binaryType = 'arraybuffer'

    // fit xterm to the panel, then tell tmux to match — only when the size actually changed and the
    // socket is open (a stream of resize events would otherwise spam the backend).
    let lastCols = 0, lastRows = 0
    const fitAndSync = () => {
      try { fit.fit() } catch { return }
      const { cols, rows } = term
      if (!cols || !rows || (cols === lastCols && rows === lastRows)) return
      lastCols = cols; lastRows = rows
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'resize', cols, rows }))
    }

    const enc = new TextEncoder()
    ws.onopen = () => { lastCols = 0; lastRows = 0; fitAndSync() }  // send our fitted size first thing
    ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data)) }

    // @@@ the single human input - the external message box writes into THIS pane over the SAME socket.
    // Returns false when the socket isn't open yet so the caller can fall back to POST /keys.
    const send = (data) => { if (ws.readyState !== WebSocket.OPEN) return false; ws.send(enc.encode(data)); return true }
    if (senders) senders.current[sessionId] = send

    const raf = requestAnimationFrame(fitAndSync) // re-fit once layout settles
    const ro = new ResizeObserver(fitAndSync)
    ro.observe(hostRef.current)
    window.addEventListener('resize', fitAndSync)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', fitAndSync)
      if (senders && senders.current[sessionId] === send) delete senders.current[sessionId]
      try { ws.close() } catch { /* already closed */ }
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  // copy the terminal's whole text — visible screen plus all retained scrollback — to the clipboard.
  const copyAll = async () => {
    const term = termRef.current
    if (!term) return
    const buf = term.buffer.active
    const lines = []
    for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? '')
    const text = lines.join('\n').replace(/\s+$/, '') + '\n'
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch { /* clipboard unavailable (insecure context / denied) */ }
  }

  return (
    <div className="st-wrap">
      <button type="button" className="st-copy" onClick={copyAll} title="copy terminal contents">
        {copied ? '✓ copied' : '⧉ copy'}
      </button>
      <div className="st-host" ref={hostRef} />
    </div>
  )
}
