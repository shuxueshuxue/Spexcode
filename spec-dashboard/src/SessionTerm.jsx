import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

// @@@ SessionTerm - a live view of a session's tmux pane. Subscribes to /api/sessions/:id/stream
// (SSE) and repaints xterm on each snapshot. The pane is a FIXED 120x32 on the backend, so xterm is
// the same size (no fit) and the TUI lines up. Snapshots arrive as JSON strings (newlines/ANSI safe);
// we full-repaint (\x1b[H home + \x1b[2J clear) rather than reset() to avoid wiping the scrollback flash.
const COLS = 120, ROWS = 32

export default function SessionTerm({ sessionId }) {
  const hostRef = useRef(null)
  useEffect(() => {
    const term = new Terminal({
      cols: COLS, rows: ROWS, fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, convertEol: true, scrollback: 0,
      theme: {
        background: '#fdf6e3', foreground: '#586e75', cursor: '#268bd2', selectionBackground: '#eee8d5',
        black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
        blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        brightBlack: '#93a1a1', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
        brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#2aa198', brightWhite: '#fdf6e3',
      },
    })
    term.open(hostRef.current)
    let last = ''
    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    es.onmessage = (e) => {
      let snap = ''
      try { snap = JSON.parse(e.data) } catch { return }
      if (snap === last) return
      last = snap
      term.write('\x1b[H\x1b[2J' + snap)
    }
    return () => { es.close(); term.dispose() }
  }, [sessionId])
  return <div className="st-host" ref={hostRef} />
}
