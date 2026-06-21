import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { CanvasAddon } from '@xterm/addon-canvas'
import { createResilientSocket } from './resilientSocket.js'
import '@xterm/xterm/css/xterm.css'

// @@@ SessionTerm - a READ-ONLY live view of a session's tmux pane, wired to a REAL tmux client over one
// WebSocket (/api/sessions/:id/socket). The human never types INTO the terminal — it is a pure scrollable
// view. Server→client = raw pane bytes (binary) written straight to xterm. We do NOT forward keystrokes
// back (disableStdin). Human prompts do NOT travel over this socket either: the external message box
// (SessionInterface's ❯ line) dispatches them out-of-band through the control socket (POST /keys) so they
// survive tmux copy-mode. The ONLY thing this socket writes back is the synthetic wheel→copy-mode scroll
// (below). Because nothing types into the view, scrolling it can never block input — the wheel scrolls
// tmux's real history (we return false from the wheel handler so tmux's mouse mode never steals the
// wheel). xterm is SCALED to its panel by the FitAddon; each fit sends cols×rows so tmux renders at that size.
//
// SCROLL: the live feed is a tmux client that REPAINTS in place at a fixed cols×rows, so xterm's own
// scrollback is just repaint noise — useless to scroll. The real history lives in tmux (mouse on, 50k
// lines, see pty-bridge). So when the wheel turns over the pane we synthesize SGR mouse-wheel reports
// (ESC[<64/65;col;rowM) and send them down the SAME socket the message box uses; tmux reads them, enters
// copy-mode and scrolls its actual pane history. We preventDefault + return false so neither the page nor
// xterm's empty viewport moves — only tmux scrolls.
//
// SELECT + COPY: the pane stays read-only, but the human can still pull text OUT of it. The Claude TUI
// inside turns ON mouse tracking, so xterm would normally hand plain click-drags to the app and disable its
// OWN selection unless a force-selection modifier (Shift on Linux/Windows, ⌥ on macOS) were held. But this
// view NEVER forwards mouse reports to tmux, so respecting the app's mouse mode buys nothing and only costs
// text selection — so we force selection ALWAYS ON (see the shouldForceSelection override after open()):
// every plain left-drag selects locally, no modifier needed. Plain drags stay LINEWISE rather than column/
// block (column-select keys off altKey directly), so a multi-row drag copies as readable lines. The
// selection MUST be VISIBLE so the human sees exactly what they grabbed: the theme uses a
// bright opaque selectionBackground + a near-white selectionForeground (and the SAME colour when the term
// is unfocused, via selectionInactiveBackground — focus never sits on the pane, so the highlight must read
// fully bright while focus stays in the bottom box). ⌘/Ctrl+C then writes term.getSelection() to the system
// clipboard and flashes a "copied ✓" confirmation.
//
// NEVER STEAL FOCUS (terminal-like select+copy): a real terminal lets you click-drag to select without
// yanking your keyboard focus elsewhere. xterm breaks that — on every mousedown its core does
// `e.preventDefault(); this.focus()`, focusing a hidden helper <textarea>, which BLURS the ❯ box the human
// is typing into. (A capture-phase preventDefault can't stop a programmatic .focus().) Since stdin is
// disabled and the copy chord listens at document level (below), the pane needs focus for NOTHING — so we
// neutralise the core focus() (after open(), below) and a click now SELECTS without moving activeElement.
// The copy chord therefore can't rely on a focused helper textarea bubbling keydown to the host; instead it
// listens on `document`, gated to the VISIBLE pane (offsetParent !== null) so the active terminal alone
// answers, and it stands down when the focused field has its OWN non-empty selection (so ⌘C in the ❯ box
// copies the box, not the pane). stdin stays disabled throughout — we never forward keystrokes to the pty.
//
// SPEED: render with the WebGL addon (GPU-composited glyphs — far faster than the default DOM renderer for
// a busy TUI), falling back to the canvas addon, then to DOM, if a GL context can't be had. Incoming pane
// bytes are BATCHED: frames that arrive in the same tick are concatenated into ONE term.write per
// animation frame instead of one write per WebSocket message, so a burst (e.g. the full repaint) parses in
// a single pass. The single ordered repaint is preserved — batching only COALESCES in arrival order, never
// reorders, and the reset-then-one-repaint reconnect path (the no-scramble guarantee) is untouched.
// @@@ best-effort menu sniff - does the pane currently show an interactive SELECT menu (e.g. `/model`'s
// list) rather than the normal `❯` prompt? Heuristic only and NON-authoritative — the manual nav toggle is
// the dependable path, so this NEVER seizes keys; it only lets the interface SUGGEST nav mode (pulse the
// button). Signature: a select-caret line (`❯ <option>`) together with a hint line mentioning Esc plus
// Enter/arrows/select (menus print "esc to cancel · enter to confirm"); the bare prompt has no such hint.
function looksLikeMenu(term) {
  const buf = term.buffer.active
  let caret = false, hint = false
  for (let y = buf.baseY; y < buf.baseY + term.rows; y++) {
    const line = buf.getLine(y)?.translateToString(true) || ''
    if (/^\s{0,6}❯\s+\S/.test(line)) caret = true
    if (/esc/i.test(line) && /(enter|↵|↑|↓|select|confirm)/i.test(line)) hint = true
  }
  return caret && hint
}

export default function SessionTerm({ sessionId, onMenu }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  // brief "copied ✓" confirmation flashed by the copy chord; drives only the corner caption, not the term.
  const [copied, setCopied] = useState(false)
  // socket health for the corner caption: 'connecting' | 'open' | 'reconnecting' (drives the loud "reconnecting…").
  const [conn, setConn] = useState('connecting')
  // keep the latest onMenu without re-running the terminal effect (it'd tear down the WebSocket every render).
  const onMenuRef = useRef(onMenu)
  onMenuRef.current = onMenu

  useEffect(() => {
    const term = new Terminal({
      fontSize: 11, fontFamily: 'Menlo, monospace',
      cursorBlink: false, disableStdin: true, scrollback: 5000,  // read-only view; xterm owns scrollback
      // @@@ keep ⌥-drag linewise on mac - selection is forced always-on below regardless of modifier, but
      // this still matters: it stops a held ⌥ during a drag from flipping into column/block select, so an
      // accidental Option keeps the same readable linewise grab as a plain drag.
      macOptionClickForcesSelection: true,
      // @@@ DARK theme on purpose - the Claude Code TUI running inside this pane is designed for a dark
      // terminal (green diff-add backgrounds, dim/faint context text, dark code blocks). A light bg would
      // clash with all of it, so we give xterm solarized-DARK. The bright* grays (brightBlack/Green/Yellow/
      // Blue/Cyan) are the base00–base1 tones the TUI uses for dimmed text — they read clearly on #002b36.
      // @@@ VISIBLE selection - the old selectionBackground (#073642, base02) was a hair off the #002b36 bg,
      // so a drag-selection was effectively invisible. Use a BRIGHT blue highlight + near-white foreground
      // so the human sees the exact span they grabbed; selectionInactiveBackground matches it so the
      // highlight stays put when focus moves to the bottom box for the copy chord (it doesn't grey out).
      theme: {
        background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1',
        selectionBackground: '#268bd2', selectionForeground: '#fdf6e3', selectionInactiveBackground: '#268bd2',
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

    // @@@ always-on drag select - the Claude TUI inside enables mouse tracking, so by default xterm routes a
    // plain drag to the app and only selects locally when its force-selection modifier (⌥/⇧) is held. But
    // this pane NEVER forwards mouse reports to tmux (the socket is read-only + the synthetic wheel), so
    // honouring the app's mouse mode buys nothing and just blocks selection. xterm has no public "always
    // select" option; its one gate is the selection service's shouldForceSelection(), so we pin it true —
    // every plain left-drag now selects with NO modifier. Plain drags stay linewise (column-select keys off
    // altKey, not this). Guarded: a future xterm could rename the private path — then modifier-drag still works.
    try { term._core._selectionService.shouldForceSelection = () => true } catch { /* fall back to ⌥/⇧-drag */ }

    // @@@ never steal focus - xterm focuses its hidden helper <textarea> on every mousedown (its core runs
    // `e.preventDefault(); this.focus()`), which would blur the ❯ box the human is typing into the instant
    // they click the pane to select text. This view is read-only (stdin disabled) and the copy chord lives
    // at document level (below), so the pane needs keyboard focus for NOTHING — neutralise the core focus()
    // so a click SELECTS without ever moving activeElement, exactly like selecting static text in a div.
    // Instance prop shadows the prototype method, so xterm's own `this.focus()` call hits this no-op.
    // Guarded: a renamed private path just falls back to the old focus-stealing behaviour, never a crash.
    try { term._core.focus = () => {} } catch { /* pane may still grab focus on a future xterm */ }

    // @@@ GPU renderer - load AFTER open() (the renderer needs the live DOM/canvas). WebGL composites
    // glyphs on the GPU — much faster repaints for a busy TUI than xterm's default DOM renderer. If a GL
    // context can't be created (or it's lost at runtime), dispose and drop to the canvas addon; if that
    // also throws we silently keep the DOM renderer. FitAddon measures the core, not the renderer, so the
    // fit guards are unaffected.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => { try { webgl.dispose() } catch { /* */ } ; try { term.loadAddon(new CanvasAddon()) } catch { /* DOM fallback */ } })
      term.loadAddon(webgl)
    } catch {
      try { term.loadAddon(new CanvasAddon()) } catch { /* DOM renderer stays */ }
    }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/sessions/${sessionId}/socket`
    let sock = null   // the resilient socket; assigned below, once the frame machinery its callbacks use exists.

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
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'resize', cols, rows }))
    }

    const enc = new TextEncoder()
    // @@@ clean (re)connect - reset xterm to a blank slate so the bridge's coherent full repaint (tmux
    // refresh-client, triggered on attach) lands on an empty screen instead of splicing onto stale cells.
    // This is what kills the tab-switch scramble: no snapshot is merged into the mid-flight live stream;
    // we clear, then a single in-band repaint paints the whole pane. Then send our fitted size first thing.
    // @@@ batched writes - coalesce pane frames that land in the same tick into ONE term.write per
    // animation frame (concatenated IN ARRIVAL ORDER), so a burst — the full repaint, a fast scroll —
    // parses in a single pass instead of one parser invocation per WebSocket message. Order is preserved,
    // so this never disturbs the single coherent repaint; the reset-then-repaint reconnect path is untouched.
    let pending = []
    let flushRaf = 0
    const flush = () => {
      flushRaf = 0
      if (!pending.length) return
      let total = 0
      for (const c of pending) total += c.length
      const merged = new Uint8Array(total)
      let off = 0
      for (const c of pending) { merged.set(c, off); off += c.length }
      pending = []
      term.write(merged)
    }
    // @@@ resilient socket - reopen on a genuine socket drop. After the [[live-view]] fix, bridge churn no
    // longer closes the socket, so the ONLY thing that does is a backend PROCESS restart (the zero-downtime
    // reload); resilientSocket.js reopens with backoff and surfaces a visible "reconnecting…" so that case
    // self-heals loudly instead of leaving a frozen pane. On every (re)open we reset xterm to a blank slate
    // (so the backend's coherent in-band repaint lands clean), DROP any frames still queued from a prior
    // socket (they belong to the old screen and would splice onto the reset one), then re-send the fitted size.
    sock = createResilientSocket({
      url,
      onState: setConn,
      onOpen: () => { pending = []; if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0 } ; term.reset(); lastCols = 0; lastRows = 0; fitAndSync() },
      onMessage: (e) => {
        if (!(e.data instanceof ArrayBuffer)) return
        pending.push(new Uint8Array(e.data))
        if (!flushRaf) flushRaf = requestAnimationFrame(flush)
      },
    })

    // @@@ scroll-only writer - the ONLY thing written back over this socket is synthetic wheel→copy-mode
    // mouse reports (below). Human prompts do NOT go through here: they dispatch out-of-band via the control
    // socket (POST /keys in SessionInterface) so they survive tmux copy-mode, which scrolling enters and
    // which would otherwise eat pane bytes as navigation. This socket stays read-only display + scroll.
    const send = (data) => sock.send(enc.encode(data))   // false (a no-op) while mid-reconnect; the wheel just skips

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

    // @@@ copy chord - ⌘/Ctrl+C copies the current xterm selection to the system clipboard. Because clicking
    // the pane no longer focuses it (the focus no-op above), the chord can't ride a focused helper textarea
    // up to the host — focus is sitting in the ❯ box. So we listen on `document` and act ONLY when there's a
    // pane selection. Two gates keep it from misfiring across the always-mounted sibling terminals and the
    // input box: (1) VISIBLE pane only — inactive layers are display:none, so offsetParent is null; (2) the
    // human's OWN field selection wins — if a focused input/textarea has a non-empty selection, that's what
    // ⌘C should copy, so we stand down and let the browser handle it. xterm's selection isn't a DOM
    // Selection, so the browser's native copy would grab nothing — we preventDefault + writeText ourselves.
    let copiedTimer
    const host = hostRef.current
    const onCopyKey = (ev) => {
      if (!(ev.metaKey || ev.ctrlKey) || (ev.key !== 'c' && ev.key !== 'C')) return
      if (!host || host.offsetParent === null) return        // not the visible terminal — let it pass
      const sel = term.getSelection()
      if (!sel) return
      const el = document.activeElement
      if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.selectionStart !== el.selectionEnd) return
      ev.preventDefault(); ev.stopPropagation()
      navigator.clipboard?.writeText(sel).then(() => {
        setCopied(true)
        clearTimeout(copiedTimer); copiedTimer = setTimeout(() => setCopied(false), 1200)
      }).catch(() => { /* clipboard denied (e.g. insecure context) — selection still stands for manual copy */ })
    }
    document.addEventListener('keydown', onCopyKey)

    // @@@ menu sniff loop - poll the pane a few times a second and report whether it looks like a select
    // menu, so the interface can SUGGEST nav mode. Best-effort and cheap; the manual toggle never needs it.
    const sniff = setInterval(() => { try { onMenuRef.current?.(sessionId, looksLikeMenu(term)) } catch { /* */ } }, 700)

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
      if (flushRaf) cancelAnimationFrame(flushRaf)
      clearInterval(sniff)
      clearTimeout(copiedTimer)
      document.removeEventListener('keydown', onCopyKey)
      onMenuRef.current?.(sessionId, false)   // clear the hint so a closed terminal can't leave the button pulsing
      refitTimers.forEach(clearTimeout)
      if (termEl) termEl.removeEventListener('animationend', fitAndSync)
      ro.disconnect()
      window.removeEventListener('resize', fitAndSync)
      sock.close()   // intentional close → the resilient socket stops reopening for good
      term.dispose()
      termRef.current = null
    }
  }, [sessionId])

  return (
    <div className="st-wrap">
      <div className="st-host" ref={hostRef} />
      {/* subtle corner caption: the copy confirmation, or a loud "reconnecting…" while the socket re-opens. */}
      {copied && <div className="st-copyhint copied">copied ✓</div>}
      {!copied && conn === 'reconnecting' && <div className="st-copyhint reconnecting">reconnecting…</div>}
    </div>
  )
}
