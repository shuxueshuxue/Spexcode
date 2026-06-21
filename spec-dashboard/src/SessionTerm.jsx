import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
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
// clipboard (see copyToClipboard above — robust whether the dashboard is served over HTTPS/localhost or plain
// HTTP, the latter lacking navigator.clipboard) and flashes a "copied ✓" confirmation only once the copy lands.
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
// SPEED: the VISIBLE pane renders with the WebGL addon (GPU-composited glyphs — far faster than the default
// DOM renderer for a busy TUI); if no GL context can be had it stays on the DOM renderer. WebGL contexts are
// a capped per-page resource, so ONLY the visible pane holds one — see the active-driven renderer effect for
// why (the "frozen-top / live-bottom after hours" bug). Incoming pane
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

// @@@ copy that survives plain HTTP - the async Clipboard API (navigator.clipboard) exists ONLY in a SECURE
// context (https or localhost). This dashboard is routinely watched over plain http://<host>:<port> from
// another machine (a remote box), where navigator.clipboard is UNDEFINED — so ⌘/Ctrl+C silently copied
// NOTHING (the reported "copy doesn't work"). Prefer the modern API when present, but fall back to the
// legacy execCommand('copy'), which works in insecure contexts under a user gesture (the copy keydown is
// one). Resolves true only when the copy actually landed, so the caller never flashes a false "copied ✓".
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => execCopyFallback(text))
  }
  return Promise.resolve(execCopyFallback(text))
}

// @@@ execCommand fallback - copies via a throwaway off-screen textarea. It must briefly focus+select that
// textarea to run the copy, which would BLUR the ❯ box (breaking the never-steal-focus invariant), so we
// save activeElement first and restore it right after. Off-screen + opacity:0 so it never flashes or scrolls.
// Runs SYNCHRONOUSLY inside the keydown handler (the path taken when navigator.clipboard is absent), so the
// user gesture is still active when execCommand fires.
function execCopyFallback(text) {
  const active = document.activeElement
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  let ok = false
  try { ta.select(); ta.setSelectionRange(0, text.length); ok = document.execCommand('copy') } catch { ok = false }
  ta.remove()
  try { active?.focus?.() } catch { /* nothing to restore focus to */ }
  if (!ok) console.warn('[SessionTerm] clipboard copy failed — selection left intact for manual copy')
  return ok
}

export default function SessionTerm({ sessionId, active = true, onMenu }) {
  const hostRef = useRef(null)
  const termRef = useRef(null)
  // the GPU renderer for the VISIBLE pane only — see the active-driven effect below. Held in a ref so it
  // can be disposed when this terminal goes off-screen and reattached when it comes back.
  const webglRef = useRef(null)
  // last cols/rows we synced to tmux; a ref (not effect locals) so BOTH the fit path and the renderer
  // swap can reset it to force the next fit through the "size changed" gate.
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  // the latest fitAndSync, exposed so the active-driven renderer effect can re-measure after a swap.
  const fitRef = useRef(null)
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

    // @@@ GPU renderer - the WebGL addon is loaded/disposed by the active-driven effect below, NOT here.
    // WebGL contexts are a CAPPED per-page resource (browsers force-lose the oldest past ~16), and we keep
    // every opened session's terminal mounted at once — so one context per terminal exhausts the cap after
    // a few hours of opening sessions, and the browser then evicts contexts out from under live panes. So
    // only the VISIBLE pane holds a context; hidden panes ride xterm's DOM renderer (no GL, and they're
    // display:none so GPU speed is moot). The DOM renderer is what's live until the [active] effect attaches.

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/sessions/${sessionId}/socket`
    let sock = null   // the resilient socket; assigned below, once the frame machinery its callbacks use exists.

    // fit xterm to the panel, then tell tmux to match — only when the size actually changed and the
    // socket is open (a stream of resize events would otherwise spam the backend).
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
      const lastSize = lastSizeRef.current
      if (cols === lastSize.cols && rows === lastSize.rows) return
      lastSizeRef.current = { cols, rows }
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'resize', cols, rows }))
    }
    fitRef.current = fitAndSync

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
      onOpen: () => { pending = []; if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0 } ; term.reset(); lastSizeRef.current = { cols: 0, rows: 0 }; fitAndSync() },
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
      copyToClipboard(sel).then((ok) => {
        if (!ok) return   // copy genuinely failed — don't flash a false "copied ✓"; selection stays for manual copy
        setCopied(true)
        clearTimeout(copiedTimer); copiedTimer = setTimeout(() => setCopied(false), 1200)
      })
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
      term.dispose() // disposes loaded addons too, incl. any live WebGL renderer
      termRef.current = null
      webglRef.current = null  // term.dispose() killed the addon; drop our handle so a remount starts clean
      fitRef.current = null
    }
  }, [sessionId])

  // @@@ one GL context, for the VISIBLE pane only - this is the fix for the "frozen-top / live-bottom split
  // after hours" bug. WebGL contexts are a CAPPED per-page resource: past ~16 live contexts the browser
  // FORCE-LOSES the oldest (webglcontextlost) to make room, with no error — and we mount one terminal per
  // opened session, all kept warm. Giving each its own context means a busy day crosses the cap, the browser
  // evicts a context from a live pane, and the half-recovered renderer strands a stale frame up top with a
  // thin live band below — only a reload (which tears down every context) clears it. So we bound live
  // contexts to ~1: attach WebGL when this pane becomes visible, dispose it (releasing the context) when it
  // hides. Hidden panes render via xterm's DOM renderer — they're display:none, so GPU speed buys nothing.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active) {
      if (webglRef.current) return  // already GPU-accelerated
      try {
        const webgl = new WebglAddon()
        // a GENUINE runtime loss (GPU reset, or the browser still evicting us): drop to the DOM renderer and
        // force a clean re-measure + FULL repaint, so we never strand a half-painted grid. Resetting the size
        // guard is essential — otherwise fitAndSync sees "same cols/rows" and suppresses the corrective fit.
        webgl.onContextLoss(() => {
          try { webgl.dispose() } catch { /* */ }
          webglRef.current = null
          lastSizeRef.current = { cols: 0, rows: 0 }
          requestAnimationFrame(() => { fitRef.current?.(); try { term.refresh(0, term.rows - 1) } catch { /* */ } })
        })
        term.loadAddon(webgl)
        webglRef.current = webgl
        // newly visible: re-measure against the now-laid-out host and force a full repaint so the fresh GL
        // canvas paints the WHOLE grid rather than inheriting a partial frame from the DOM renderer.
        requestAnimationFrame(() => { fitRef.current?.(); try { term.refresh(0, term.rows - 1) } catch { /* */ } })
      } catch {
        webglRef.current = null  // no GL context available — DOM renderer stays, which renders fine
      }
    } else if (webglRef.current) {
      // leaving view: RELEASE the context so it can never accumulate across opened sessions.
      try { webglRef.current.dispose() } catch { /* */ }
      webglRef.current = null
    }
  }, [sessionId, active])

  return (
    <div className="st-wrap">
      <div className="st-host" ref={hostRef} />
      {/* subtle corner caption: the copy confirmation, or a loud "reconnecting…" while the socket re-opens. */}
      {copied && <div className="st-copyhint copied">copied ✓</div>}
      {!copied && conn === 'reconnecting' && <div className="st-copyhint reconnecting">reconnecting…</div>}
    </div>
  )
}
