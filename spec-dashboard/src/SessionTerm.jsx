import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

// @@@ SessionTerm - a live view of a session's tmux pane. Subscribes to /api/sessions/:id/stream
// (SSE), which feeds RAW pane bytes incrementally (tmux pipe-pane) — ANSI + cursor moves — that we
// write straight to xterm with NO full-screen clear. xterm is the emulator: it renders the deltas, so
// there's no flicker, keystrokes echo at stream latency (~60ms, not the old 600ms tick), and scrollback
// accumulates client-side. The first frame is a one-time snapshot (current screen) so a fresh connect
// isn't blank; everything after is pure delta. xterm is SCALED to its panel by the FitAddon (no fixed
// size); every fit POSTs the resulting cols×rows to /api/sessions/:id/resize so tmux renders the
// detached pane at exactly that size and the TUI lines up. Frames arrive base64-encoded (raw bytes are
// not SSE/newline-safe); we decode each to a Uint8Array and term.write() it.
export default function SessionTerm({ sessionId }) {
  const hostRef = useRef(null)
  useEffect(() => {
    const term = new Terminal({
      fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, scrollback: 1000,
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

    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    es.onmessage = (e) => {
      // each frame is base64-encoded raw pane bytes; decode to a Uint8Array and write straight to
      // xterm — no clear, so the emulator applies the deltas in place (no flicker).
      let bin
      try { bin = atob(e.data) } catch { return }
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      term.write(bytes)
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
