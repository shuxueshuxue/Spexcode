import { useEffect, useRef } from 'react'
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
//
// SCROLL: the live feed is a tmux client that REPAINTS in place at a fixed cols×rows, so xterm's own
// scrollback is just repaint noise — useless to scroll. The real history lives in tmux (mouse on, 50k
// lines, see pty-bridge). So when the wheel turns over the pane we synthesize SGR mouse-wheel reports
// (ESC[<64/65;col;rowM) and send them down the SAME socket the message box uses; tmux reads them, enters
// copy-mode and scrolls its actual pane history. We preventDefault + return false so neither the page nor
// xterm's empty viewport moves — only tmux scrolls.
export default function SessionTerm({ sessionId, senders }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)

  useEffect(() => {
    const term = new Terminal({
      fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, disableStdin: true, scrollback: 5000,  // read-only view; xterm owns scrollback
      // @@@ DARK theme on purpose - the Claude Code TUI running inside this pane is designed for a dark
      // terminal (green diff-add backgrounds, dim/faint context text, dark code blocks). A light bg would
      // clash with all of it, so we give xterm solarized-DARK. The bright* grays (brightBlack/Green/Yellow/
      // Blue/Cyan) are the base00–base1 tones the TUI uses for dimmed text — they read clearly on #002b36.
      theme: {
        background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', selectionBackground: '#073642',
        black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
        blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
        brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
        brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
      },
    })
    termRef.current = term
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
      const host = hostRef.current
      if (!host) return
      // @@@ the shrink guard - never fit against an unsettled/animating layout. The panel opens behind a
      // .22s entrance, fonts settle a frame late, and an inactive layer is display:none — a fit measured
      // then would lock tmux to a tiny cols (the "narrow strip" bug) that the lastCols / bridge.cols guards
      // would then suppress ever correcting. A near-0 host means hidden or not laid out yet: bail and let a
      // later re-fit (animationend / scheduled / ResizeObserver / window-resize) send the real size.
      if (host.clientWidth < 40 || host.clientHeight < 40) return
      try { fit.fit() } catch { return }
      const { cols, rows } = term
      if (!cols || !rows) return
      // a tiny col count while the host is plainly wide is a degenerate mid-animation measurement — skip it;
      // a re-fit at full size will follow with the right number.
      if (cols < 20 && host.clientWidth > 200) return
      if (cols === lastCols && rows === lastRows) return
      lastCols = cols; lastRows = rows
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'resize', cols, rows }))
    }

    const enc = new TextEncoder()
    // @@@ clean (re)connect - reset xterm to a blank slate so the bridge's coherent full repaint (tmux
    // refresh-client, triggered on attach) lands on an empty screen instead of splicing onto stale cells.
    // This is what kills the tab-switch scramble: no snapshot is merged into the mid-flight live stream;
    // we clear, then a single in-band repaint paints the whole pane. Then send our fitted size first thing.
    ws.onopen = () => { term.reset(); lastCols = 0; lastRows = 0; fitAndSync() }
    ws.onmessage = (e) => { if (e.data instanceof ArrayBuffer) term.write(new Uint8Array(e.data)) }

    // @@@ the single human input - the external message box writes into THIS pane over the SAME socket.
    // Returns false when the socket isn't open yet so the caller can fall back to POST /keys.
    const send = (data) => { if (ws.readyState !== WebSocket.OPEN) return false; ws.send(enc.encode(data)); return true }
    if (senders) senders.current[sessionId] = send

    // @@@ wheel → tmux copy-mode - forward the wheel as SGR mouse reports so tmux scrolls its real pane
    // history (xterm's own scrollback is just repaint noise here). 64/65 = wheel up/down; col,row is the
    // 1-based cell under the pointer so tmux scrolls the pane the cursor is over. We send a few reports per
    // notch (scaled by deltaY) for a natural pace, then swallow the event so the page/viewport stay put.
    term.attachCustomWheelEventHandler((ev) => {
      const host = hostRef.current
      if (!host || !term.cols || !term.rows) return false
      const rect = host.getBoundingClientRect()
      const clamp = (v, max) => Math.min(max, Math.max(1, v))
      const col = clamp(Math.floor((ev.clientX - rect.left) / (rect.width / term.cols)) + 1, term.cols)
      const row = clamp(Math.floor((ev.clientY - rect.top) / (rect.height / term.rows)) + 1, term.rows)
      const btn = ev.deltaY < 0 ? 64 : 65  // wheel up / down
      const ticks = Math.min(5, Math.max(1, Math.round(Math.abs(ev.deltaY) / 40)))
      for (let i = 0; i < ticks; i++) send(`\x1b[<${btn};${col};${row}M`)
      ev.preventDefault()
      return false  // never let xterm's empty viewport (or the page) scroll instead
    })

    const raf = requestAnimationFrame(fitAndSync) // re-fit once layout settles
    // @@@ post-entrance re-fits - the .si-term entrance (si-expand, .22s) animates via transform, which
    // ResizeObserver can't observe, so the panel can reach full size without RO ever firing to correct an
    // early too-small fit. Re-fit explicitly when the entrance ends, and at a few points across its
    // duration, so the FINAL fit measures the true full width regardless of how the first fits landed.
    const termEl = hostRef.current.closest('.si-term')
    if (termEl) termEl.addEventListener('animationend', fitAndSync)
    const refitTimers = [60, 180, 320].map((ms) => setTimeout(fitAndSync, ms))
    const ro = new ResizeObserver(fitAndSync)
    ro.observe(hostRef.current)
    window.addEventListener('resize', fitAndSync)

    return () => {
      cancelAnimationFrame(raf)
      refitTimers.forEach(clearTimeout)
      if (termEl) termEl.removeEventListener('animationend', fitAndSync)
      ro.disconnect()
      window.removeEventListener('resize', fitAndSync)
      if (senders && senders.current[sessionId] === send) delete senders.current[sessionId]
      try { ws.close() } catch { /* already closed */ }
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  return (
    <div className="st-wrap">
      <div className="st-host" ref={hostRef} />
    </div>
  )
}
