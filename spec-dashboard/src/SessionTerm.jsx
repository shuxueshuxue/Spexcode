import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { createResilientSocket } from './resilientSocket.js'
import '@xterm/xterm/css/xterm.css'

function terminalTypography() {
  const styles = getComputedStyle(document.documentElement)
  const fontSize = Number.parseFloat(styles.getPropertyValue('--type-terminal'))
  const fontFamily = styles.getPropertyValue('--mono').trim()
  if (!Number.isFinite(fontSize) || !fontFamily) {
    throw new Error('Terminal typography tokens are missing or invalid')
  }
  return { fontSize, fontFamily }
}

// heuristic: a select-caret line (`❯ <option>`) plus a hint line mentioning Esc + Enter/arrows distinguishes
// an interactive menu (e.g. `/model`'s list) from the bare `❯` prompt, which carries no such hint line.
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

// navigator.clipboard is undefined over plain HTTP (non-secure context) — fall back to execCommand; resolve true only on a real copy.
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => execCopyFallback(text))
  }
  return Promise.resolve(execCopyFallback(text))
}

// save/restore activeElement so the off-screen textarea's focus+select never blurs the ❯ box; runs sync inside keydown so the gesture is live.
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
  // first-visible bookkeeping. connectedWithSizeRef: did this socket connect with a measurable size (the
  // pane was visible → server painted at once via the connect-query) or hidden (no size → server DEFERRED
  // its first frame, and a ~250ms safety fallback may have painted a guessed-size frame into the still-hidden
  // buffer)? firstFrameCleanedRef: have we already cleaned the first visible frame? Together they let the
  // active-driven effect wipe-and-resend exactly once, only for a hidden-connected pane, the moment it first
  // becomes visible — so the first frame the user sees is drawn clean at the true size (no undersized→snap).
  const connectedWithSizeRef = useRef(false)
  const firstFrameCleanedRef = useRef(false)
  // set whenever we've just reset xterm (a fresh socket, or the first-visible wipe): its next resize must ask
  // the server for a FULL frame — the mode prelude (alt-screen / mouse) + history seed — since a plain resize
  // re-seeds only the visible screen and a reset xterm would otherwise never re-enter the pane's real modes.
  const needsFullRef = useRef(true)
  // brief "copied ✓" confirmation flashed by the copy chord; drives only the corner caption, not the term.
  const [copied, setCopied] = useState(false)
  // socket health for the corner caption: 'connecting' | 'open' | 'reconnecting' (drives the loud "reconnecting…").
  const [conn, setConn] = useState('connecting')
  // keep the latest onMenu without re-running the terminal effect (it'd tear down the WebSocket every render).
  const onMenuRef = useRef(onMenu)
  onMenuRef.current = onMenu

  useEffect(() => {
    // fresh socket for this session id → it hasn't connected or been shown yet (reset even on a prop-swap
    // reuse of this instance, so a new session doesn't inherit the previous one's first-visible state).
    connectedWithSizeRef.current = false
    firstFrameCleanedRef.current = false
    const term = new Terminal({
      ...terminalTypography(),
      cursorBlink: false, disableStdin: true, scrollback: 0,  // tmux owns history; xterm renders only the pane view
      // stops a held ⌥ mid-drag from flipping into column/block select, so an accidental Option keeps a linewise grab.
      macOptionClickForcesSelection: true,
      // GitHub-Dark NEUTRAL palette, paired with the #0d1117 background so the terminal matches the app's
      // modern dark theme (the old solarized ansi, tuned for a #002b36 bg, looked off on the neutral ground).
      // NOTE: this does NOT fix Claude's pinned previous-message bar — that bar uses 256-colour greys in an
      // alt-screen overlay, which the xterm theme (16 ansi + fg/bg only) can't reach; deferred as issue #25.
      // selection is a GitHub blue; selectionInactive matches it.
      theme: {
        background: '#0d1117', foreground: '#c9d1d9', cursor: '#c9d1d9',
        selectionBackground: '#264f78', selectionForeground: '#f0f6fc', selectionInactiveBackground: '#264f78',
        black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922',
        blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#ffa198', brightGreen: '#56d364', brightYellow: '#e3b341',
        brightBlue: '#79c0ff', brightMagenta: '#d2a8ff', brightCyan: '#56d4dd', brightWhite: '#f0f6fc',
      },
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)

    // xterm has no public "always select"; pin the private selectionService.shouldForceSelection so a plain drag selects under mouse-reporting. Guarded.
    try { term._core._selectionService.shouldForceSelection = () => true } catch { /* fall back to ⌥/⇧-drag */ }

    // neutralise xterm's core focus() so clicking the pane selects without blurring the ❯ box (instance prop shadows the prototype). Guarded.
    try { term._core.focus = () => {} } catch { /* pane may still grab focus on a future xterm */ }

    // the WebGL addon is loaded/disposed by the active-driven effect below (one context for the visible pane only), not here.

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = `${proto}://${location.host}/api/sessions/${sessionId}/socket`
    // size-first handshake: carry the pane's real dimensions on the connect URL so the server draws its
    // first frame at THAT size — no guessed-size full frame to scramble the still-default xterm and need a
    // corrective second frame. Recomputed on every (re)connect (resilientSocket re-resolves it), so a
    // reconnect after a resize hands over the live size. Unmeasurable (host not laid out / mid entrance
    // animation) → no query, and the server falls back to its prewarm size. Same degenerate-measurement
    // guards as fitAndSync, so the two never disagree on the size.
    const socketUrl = () => {
      try {
        const host = hostRef.current
        if (host && host.clientWidth >= 40 && host.clientHeight >= 40) {
          const d = fit.proposeDimensions()
          if (d && d.cols > 0 && d.rows > 0 && !(d.cols < 20 && host.clientWidth > 200)) {
            connectedWithSizeRef.current = true   // visible connect → server paints this frame at once; no first-visible cleanup needed
            return `${base}?cols=${d.cols}&rows=${d.rows}`
          }
        }
      } catch { /* can't measure yet → no query; the server DEFERS its first frame until our first resize (a later fit) */ }
      connectedWithSizeRef.current = false   // hidden connect → first frame is deferred; clean it on first-visible
      return base
    }
    let sock = null   // the resilient socket; assigned below, once the frame machinery its callbacks use exists.

    // fit xterm to the panel, then tell tmux to match — only when the size actually changed and the
    // socket is open (a stream of resize events would otherwise spam the backend).
    const fitAndSync = () => {
      const host = hostRef.current
      if (!host) return
      // never fit against an unsettled/animating or hidden layout (near-0 host) — it would lock tmux to a tiny cols; a later re-fit sends the real size.
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
      // a resize right after a reset carries `full` so the server re-seeds the mode prelude + history, not just
      // the visible screen — otherwise a just-reset xterm never re-enters the pane's alt-screen / mouse modes.
      const full = needsFullRef.current
      needsFullRef.current = false
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'resize', cols, rows, full }))
    }
    fitRef.current = fitAndSync

    // coalesce pane frames landing in the same tick into one term.write per animation frame, in arrival order.
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
    // on (re)open: reset xterm and DROP frames queued from a prior socket (they belong to the old screen) before re-sending the fitted size.
    sock = createResilientSocket({
      url: socketUrl,
      onState: setConn,
      onOpen: () => { pending = []; if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0 } ; term.reset(); needsFullRef.current = true; lastSizeRef.current = { cols: 0, rows: 0 }; fitAndSync() },
      onMessage: (e) => {
        if (!(e.data instanceof ArrayBuffer)) return
        pending.push(new Uint8Array(e.data))
        if (!flushRaf) flushRaf = requestAnimationFrame(flush)
      },
    })

    // All wheel navigation belongs to the tmux bridge, not to xterm's browser scrollback. The backend decides
    // from the pane's real tmux state whether to inject mouse reports into a mouse-owning TUI or to scroll
    // tmux copy-mode for a normal pane. xterm remains the renderer for the tmux view.
    term.attachCustomWheelEventHandler((ev) => {
      const host = hostRef.current
      if (host && term.cols && term.rows) {
        const rect = host.getBoundingClientRect()
        const clamp = (v, max) => Math.min(max, Math.max(1, v))
        const col = clamp(Math.floor((ev.clientX - rect.left) / (rect.width / term.cols)) + 1, term.cols)
        const row = clamp(Math.floor((ev.clientY - rect.top) / (rect.height / term.rows)) + 1, term.rows)
        const ticks = Math.min(5, Math.max(1, Math.round(Math.abs(ev.deltaY) / 40)))
        if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'wheel', up: ev.deltaY < 0, col, row, ticks }))
      }
      ev.preventDefault()
      return false
    })

    // ⌘/Ctrl+C copies the xterm selection: listen on `document` (the pane isn't focused), gated to the visible pane and standing down when a focused field has its own selection.
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

    const raf = requestAnimationFrame(fitAndSync) // re-fit once layout settles
    // the .si-term-body entrance animates via transform/opacity (layout size never moves, so ResizeObserver
    // can't see it) — animationend is the corrective re-fit for a measurement the entrance skipped as
    // degenerate; steady-state size changes belong to the ResizeObserver + window listener below.
    const termEl = hostRef.current.closest('.si-term-body')
    if (termEl) termEl.addEventListener('animationend', fitAndSync)
    const ro = new ResizeObserver(fitAndSync)
    ro.observe(hostRef.current)
    window.addEventListener('resize', fitAndSync)

    return () => {
      cancelAnimationFrame(raf)
      if (flushRaf) cancelAnimationFrame(flushRaf)
      clearTimeout(copiedTimer)
      document.removeEventListener('keydown', onCopyKey)
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

  // menu-sniff, gated on `active`: event-driven, not polled — xterm's onWriteParsed (output actually landed
  // in the buffer) schedules one trailing scan per 150ms burst, so a busy pane scans a few times a second,
  // an idle pane scans ZERO times. Only the VISIBLE pane's nav button can pulse, so hidden warm panes skip
  // the subscription's scan entirely (every live session stays mounted — N sessions would otherwise all
  // scan forever). One scan runs on becoming visible, since a menu may already be on screen from before the
  // pane was shown. Going hidden/unmounting clears the hint so a stale pulse can't stick.
  useEffect(() => {
    const term = termRef.current
    if (!term || !active) return
    let timer = 0
    const scan = () => { timer = 0; try { onMenuRef.current?.(sessionId, looksLikeMenu(term)) } catch { /* */ } }
    scan()
    const sub = term.onWriteParsed(() => { if (!timer) timer = setTimeout(scan, 150) })
    return () => { sub.dispose(); clearTimeout(timer); onMenuRef.current?.(sessionId, false) }
  }, [sessionId, active])

  // active-driven: runs each time this pane crosses the visibility line. Two independent jobs when it
  // becomes visible — (A) hold the GPU renderer for the on-screen pane only, (B) send the real size NOW so
  // the server's deferred first frame lands at the true visible size instead of waiting on the entrance
  // animationend refit.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active) {
      // (A) attach WebGL while visible (contexts are a capped per-page resource the browser force-loses past
      // the cap). Guarded so a missing/lost GL context never blocks the size send below.
      if (!webglRef.current) {
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
        } catch {
          webglRef.current = null  // no GL context available — DOM renderer stays, which renders fine
        }
      }
      // (B) first time a HIDDEN-connected pane is shown: wipe the buffer and force the next fit through the
      // size-unchanged gate. The pane connected at 0×0 so the server deferred its first frame, and a ~250ms
      // safety fallback may have painted a guessed-size frame into the still-hidden buffer — clearing
      // guarantees the first frame the user sees is drawn clean at the real size (no undersized→snap). A pane
      // that connected visible already holds its correct frame (connect-query) — don't wipe it. Re-showing an
      // already-shown pane keeps its live buffer (instant) — only refit.
      if (!firstFrameCleanedRef.current) {
        firstFrameCleanedRef.current = true
        if (!connectedWithSizeRef.current) { term.reset(); needsFullRef.current = true; lastSizeRef.current = { cols: 0, rows: 0 } }
      }
      // re-measure against the now-laid-out host and force a full repaint (the entrance animation is pure
      // transform/opacity, so the host is already at its final height here and proposeDimensions reads true).
      requestAnimationFrame(() => { fitRef.current?.(); try { term.refresh(0, term.rows - 1) } catch { /* */ } })
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
