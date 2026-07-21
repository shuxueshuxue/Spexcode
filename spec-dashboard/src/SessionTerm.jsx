import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createResilientSocket } from './resilientSocket.js'
import '@xterm/xterm/css/xterm.css'
import { apiUrl } from './project.js'

const SYNC_BEGIN = '\x1b[?2026h'
const MOUSE_REPORT_MODES = new Set([9, 1000, 1002, 1003, 1005, 1006, 1015, 1016])

function onlyMouseReportModes(params) {
  return params.length > 0 && params.every((param) => typeof param === 'number' && MOUSE_REPORT_MODES.has(param))
}

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
  // Last locally fitted or backend-requested grid. Visible measurement waits for the native transaction;
  // hidden measurement can fit immediately because that reflow cannot paint.
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  // The latest geometry request, exposed so activation can re-measure without recreating the terminal.
  const measureRef = useRef(null)
  // The browser terminal and socket stay warm, while visibility alone owns the native helper lifecycle.
  // Refs expose prop changes to the long-lived socket effect without recreating either browser resource.
  const activeRef = useRef(active)
  const hideRef = useRef(null)
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
    try { fit.fit() } catch { /* the first measurable layout pass retries below */ }

    // This is a read-only renderer: pointer reports never travel to the application and wheel uses the
    // bridge's explicit tmux-client control. Keep xterm out of mouse-report mode so a TUI redundantly
    // reasserting DECSET cannot clear an in-progress local selection. Public parser handlers leave every
    // visual terminal mode untouched and consume only pure mouse-report mode lists.
    const mouseModeHandlers = ['h', 'l'].map((final) => term.parser.registerCsiHandler(
      { prefix: '?', final },
      (params) => onlyMouseReportModes(params),
    ))

    // neutralise xterm's core focus() so clicking the pane selects without blurring the ❯ box (instance prop shadows the prototype). Guarded.
    try { term._core.focus = () => {} } catch { /* pane may still grab focus on a future xterm */ }

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = `${proto}://${location.host}${apiUrl(`/api/sessions/${sessionId}/socket`)}`
    let sock = null   // the resilient socket; assigned below, once the frame machinery its callbacks use exists.

    // Hidden panes fit their browser-only grid while invisible. A visible pane leaves its painted buffer alone
    // until the backend commits the grid with one final native transaction.
    const measureAndRequest = () => {
      const host = hostRef.current
      if (!host) return
      // Never measure an unsettled/animating layout (near-0 host): a later settled pass sends the real size.
      if (host.clientWidth < 40 || host.clientHeight < 40) return
      let dimensions
      try { dimensions = fit.proposeDimensions() } catch { return }
      const cols = dimensions?.cols, rows = dimensions?.rows
      if (!cols || !rows) return
      // a tiny col count while the host is plainly wide is a degenerate mid-animation measurement — skip it;
      // A settled full-size measurement follows with the right number.
      if (cols < 20 && host.clientWidth > 200) return
      const lastSize = lastSizeRef.current
      if (cols === lastSize.cols && rows === lastSize.rows) return
      lastSizeRef.current = { cols, rows }
      if (!activeRef.current) {
        try { term.resize(cols, rows) } catch { /* a later layout pass retries */ }
        return
      }
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'resize', cols, rows }))
    }
    measureRef.current = measureAndRequest
    hideRef.current = () => {
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'visible', visible: false }))
    }

    // A resize commit and its following binary frame are one browser transaction. Open an xterm synchronized
    // hold before changing its grid, then feed the complete native tmux transaction which closes that hold.
    // xterm's own write buffer batches ordinary chunks; a second animation-frame queue only adds latency.
    let committedSize = null
    sock = createResilientSocket({
      url: base,
      onState: setConn,
      onOpen: () => {
        committedSize = null
        term.reset()
        lastSizeRef.current = { cols: 0, rows: 0 }
        if (activeRef.current) measureAndRequest()
        else hideRef.current?.()
      },
      onMessage: (e) => {
        if (typeof e.data === 'string') {
          try {
            const message = JSON.parse(e.data)
            if (message?.t === 'resize-commit' && message.cols > 0 && message.rows > 0) {
              committedSize = { cols: Math.floor(message.cols), rows: Math.floor(message.rows) }
            }
          } catch { /* heartbeat and malformed control text are not terminal output */ }
          return
        }
        if (!(e.data instanceof ArrayBuffer)) return
        const frame = new Uint8Array(e.data)
        const size = committedSize
        if (!size) { term.write(frame); return }
        committedSize = null
        term.write(SYNC_BEGIN, () => {
          try { term.resize(size.cols, size.rows) } catch { /* final bytes still restore the visible pane */ }
          term.write(frame)
        })
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

    const raf = requestAnimationFrame(measureAndRequest)
    const ro = new ResizeObserver(measureAndRequest)
    ro.observe(hostRef.current)
    window.addEventListener('resize', measureAndRequest)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(copiedTimer)
      document.removeEventListener('keydown', onCopyKey)
      ro.disconnect()
      window.removeEventListener('resize', measureAndRequest)
      for (const handler of mouseModeHandlers) handler.dispose()
      sock.close()   // intentional close → the resilient socket stops reopening for good
      term.dispose()
      termRef.current = null
      measureRef.current = null
      hideRef.current = null
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

  // Keep the stable cached renderer as the first visible paint. The resize message is also the single helper
  // activation path; there is no separate raw-terminal prewarm or size-ownership transition.
  useLayoutEffect(() => {
    const term = termRef.current
    if (!term) return
    if (active) {
      lastSizeRef.current = { cols: 0, rows: 0 }
      measureRef.current?.()
      try { term.refresh(0, term.rows - 1) } catch { /* */ }
    } else {
      hideRef.current?.()
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
