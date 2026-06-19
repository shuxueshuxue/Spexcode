import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// @@@ SessionTerm - a live view of a session's tmux pane. Subscribes to /api/sessions/:id/stream
// (SSE) and repaints xterm on each snapshot. xterm is SCALED to its panel by the FitAddon (no fixed
// size); every time we fit we POST the resulting cols×rows to /api/sessions/:id/resize so tmux renders
// the detached pane at exactly that size and the TUI lines up with no overflow (one fit, one scrollbar-
// free box). Snapshots arrive as JSON strings (newlines/ANSI safe); we full-repaint (\x1b[H home +
// \x1b[2J clear) rather than reset() to avoid wiping the scrollback flash.
export default function SessionTerm({ sessionId }) {
  const hostRef = useRef(null)
  useEffect(() => {
    const term = new Terminal({
      fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, convertEol: true, scrollback: 0,
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

    // fit xterm to the panel, then tell tmux to match — but only POST when the size actually changed,
    // so a stream of resize events doesn't spam the backend.
    let lastCols = 0, lastRows = 0
    const fitAndSync = () => {
      try { fit.fit() } catch { return }
      const { cols, rows } = term
      if (!cols || !rows || (cols === lastCols && rows === lastRows)) return
      lastCols = cols; lastRows = rows
      fetch(`/api/sessions/${sessionId}/resize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols, rows }),
      }).catch(() => {})
    }
    fitAndSync()
    const raf = requestAnimationFrame(fitAndSync) // re-fit once layout settles

    const ro = new ResizeObserver(fitAndSync)
    ro.observe(hostRef.current)
    window.addEventListener('resize', fitAndSync)

    let last = ''
    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    es.onmessage = (e) => {
      let snap = ''
      try { snap = JSON.parse(e.data) } catch { return }
      if (snap === last) return
      last = snap
      term.write('\x1b[H\x1b[2J' + snap)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', fitAndSync)
      es.close()
      term.dispose()
    }
  }, [sessionId])
  return <div className="st-host" ref={hostRef} />
}
