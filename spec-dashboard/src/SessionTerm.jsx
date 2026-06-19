import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// @@@ SessionTerm - a live view of a session's tmux pane, wired to a REAL tmux client over one
// WebSocket (/api/sessions/:id/socket). Server→client = raw pane bytes (binary) which we write straight
// to xterm; client→server = raw terminal input (binary: keystrokes AND mouse) plus a text control frame
// {t:'resize',cols,rows}. Because the backend bridge is a genuine tmux client, the mouse wheel forwards
// to tmux and drives copy-mode — you scroll the actual pane history like real tmux. No base64, no
// snapshot/delta splice (the old scramble source): a fresh attach repaints the screen coherently at once.
// xterm is SCALED to its panel by the FitAddon; each fit sends cols×rows so tmux renders at that size.
export default function SessionTerm({ sessionId }) {
  const hostRef = useRef(null)
  useEffect(() => {
    const term = new Terminal({
      fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, scrollback: 0,   // tmux owns scrollback now (wheel → copy-mode)
      theme: {
        background: '#fdf6e3', foreground: '#586e75', cursor: '#268bd2', selectionBackground: '#eee8d5',
        black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
        blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        brightBlack: '#93a1a1', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
        brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#2aa198', brightWhite: '#fdf6e3',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

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
    // raw terminal input (keystrokes + mouse sequences) → straight into the shared tmux client.
    const inputDisp = term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(enc.encode(d)) })

    const raf = requestAnimationFrame(fitAndSync) // re-fit once layout settles
    const ro = new ResizeObserver(fitAndSync)
    ro.observe(hostRef.current)
    window.addEventListener('resize', fitAndSync)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', fitAndSync)
      inputDisp.dispose()
      try { ws.close() } catch { /* already closed */ }
      term.dispose()
    }
  }, [sessionId])
  return <div className="st-host" ref={hostRef} />
}
