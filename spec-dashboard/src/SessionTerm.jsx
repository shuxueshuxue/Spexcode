import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createResilientSocket } from './resilientSocket.js'
import '@xterm/xterm/css/xterm.css'
import { apiUrl } from './project.js'

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
  // last cols/rows we synced to tmux; a ref (not effect locals) so BOTH the fit path and the renderer
  // swap can reset it to force the next fit through the "size changed" gate.
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  // the latest fitAndSync, exposed so the active-driven renderer effect can re-measure after a swap.
  const fitRef = useRef(null)
  // Visibility is a size-ownership signal: every live pane stays warm, the first unopposed hidden helper may
  // pre-size it, and an active pane always votes. Refs expose changes to the long-lived socket effect.
  const activeRef = useRef(active)
  const visibilityRef = useRef(null)
  activeRef.current = active
  // brief "copied ✓" confirmation flashed by the copy chord; drives only the corner caption, not the term.
  const [copied, setCopied] = useState(false)
  // socket health for the corner caption: 'connecting' | 'open' | 'reconnecting' (drives the loud "reconnecting…").
  const [conn, setConn] = useState('connecting')
  // keep the latest onMenu without re-running the terminal effect (it'd tear down the WebSocket every render).
  const onMenuRef = useRef(onMenu)
  onMenuRef.current = onMenu

  useEffect(() => {
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

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = `${proto}://${location.host}${apiUrl(`/api/sessions/${sessionId}/socket`)}`
    // Every warm layer is measurable and carries its real size. `visible=0` lets the bridge elect it as the
    // hidden owner only when no tmux client already owns geometry.
    const socketUrl = () => {
      try {
        const host = hostRef.current
        if (host && host.clientWidth >= 40 && host.clientHeight >= 40) {
          const d = fit.proposeDimensions()
          if (d && d.cols > 0 && d.rows > 0 && !(d.cols < 20 && host.clientWidth > 200)) {
            return `${base}?cols=${d.cols}&rows=${d.rows}&visible=${activeRef.current ? 1 : 0}`
          }
        }
      } catch { /* activation's fit supplies the first real size */ }
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
      // Hidden layers stay laid out and sent their fitted size in the handshake. Only activation sends later
      // size changes; the bridge may already have elected this helper as the warm owner.
      if (!activeRef.current) return
      const lastSize = lastSizeRef.current
      if (cols === lastSize.cols && rows === lastSize.rows) return
      lastSizeRef.current = { cols, rows }
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'resize', cols, rows }))
    }
    fitRef.current = fitAndSync
    visibilityRef.current = (visible) => {
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'visible', visible }))
    }

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
      onOpen: () => {
        pending = []
        if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0 }
        term.reset()
        lastSizeRef.current = { cols: 0, rows: 0 }
        if (activeRef.current) fitAndSync()
        else visibilityRef.current?.(false)
      },
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
      if (!host || !activeRef.current) return                 // not the visible terminal — let it pass
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
    const ro = new ResizeObserver(fitAndSync)
    ro.observe(hostRef.current)
    window.addEventListener('resize', fitAndSync)

    return () => {
      cancelAnimationFrame(raf)
      if (flushRaf) cancelAnimationFrame(flushRaf)
      clearTimeout(copiedTimer)
      document.removeEventListener('keydown', onCopyKey)
      ro.disconnect()
      window.removeEventListener('resize', fitAndSync)
      sock.close()   // intentional close → the resilient socket stops reopening for good
      term.dispose()
      termRef.current = null
      fitRef.current = null
      visibilityRef.current = null
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

  // Fit the stable warm renderer before the browser can paint a newly-visible layer. Swapping renderers here
  // exposed an empty canvas for one frame, then an undersized canvas, even though the terminal buffer was hot.
  useLayoutEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active) {
      // Force activation through the size gate even when this pane previously used the same geometry: that
      // message makes its already-warm helper the size voter without resetting or reattaching the terminal.
      lastSizeRef.current = { cols: 0, rows: 0 }
      fitRef.current?.()
      try { term.refresh(0, term.rows - 1) } catch { /* */ }
    } else {
      visibilityRef.current?.(false)
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
