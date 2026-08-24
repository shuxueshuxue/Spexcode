import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { createResilientSocket } from './resilientSocket.js'
import '@xterm/xterm/css/xterm.css'
import { apiUrl } from './project.js'
import { getTerminalFontSize, subscribeTerminalFontSize } from './terminalFont.js'
import { useT } from './i18n/index.jsx'

const SYNC_BEGIN = '\x1b[?2026h'
const SYNC_END = '\x1b[?2026l'
// Motion-tracking and legacy mouse modes never reach xterm. A human pointer drifts constantly, and
// all-motion tracking (1003) would stream a report per hover pixel into the agent TUI — mouse input
// is what stalls claude's status-line repaint (measured: 48s frozen while the pointer kept moving).
// Button mode 1000 + SGR 1006 pass through: they are what makes xterm emit wheel reports at all.
const MOTION_TRACKING_MODES = new Set([9, 1002, 1003, 1005, 1015])

// xterm can emit SGR, X10, or URXVT mouse reports depending on the TUI's negotiated mode.
// All are pointer traffic, never a user's resume key. Keeping this at the input boundary
// prevents a click from opening the resume confirmation dialog for an asking session.
export function isTerminalPointerReport(data) {
  return data.startsWith('\x1b[<') || data.startsWith('\x1b[M') || /^\x1b\[[0-9;]+[Mm]$/.test(data)
}

// Wheel reports carry the high bit in the button code and remain native tmux navigation. Button/motion
// reports are browser chrome: forwarding them can make a focus click look like an agent input event.
export function isTerminalButtonReport(data) {
  if (!isTerminalPointerReport(data)) return false
  if (data.startsWith('\x1b[<')) {
    const code = Number(data.slice(3).match(/^\d+/)?.[0])
    return Number.isFinite(code) && (code & 64) === 0
  }
  if (data.startsWith('\x1b[M')) return (data.charCodeAt(3) & 64) === 0
  const code = Number(data.match(/^\x1b\[([0-9]+)/)?.[1])
  return Number.isFinite(code) && (code & 64) === 0
}

// xterm focus reporting (CSI I/O) is terminal control traffic emitted when browser focus moves. It is
// never a user's command byte; forwarding it lets a session click look like activity to the native TUI.
export function isTerminalFocusReport(data) {
  return data === '\x1b[I' || data === '\x1b[O'
}

// xterm may coalesce a focus report with the first byte of a real key event.  Matching the whole
// payload therefore lets browser focus traffic escape whenever the frame boundary changes.  Remove
// only the control reports here; the remaining bytes still follow the ordinary visible-terminal path.
export function stripTerminalFocusReports(data) {
  return data.replace(/\x1b\[(?:I|O)/g, '')
}

// Mouse button reports are browser pointer traffic.  SGR/X10/URXVT are all variable-width and can be
// embedded beside another report, so remove only non-wheel reports and keep wheel reports for tmux's
// native copy-mode/navigation contract.
export function stripTerminalButtonReports(data) {
  return data
    .replace(/\x1b\[<([0-9]+);[0-9]+;[0-9]+[Mm]/g, (whole, code) => (Number(code) & 64) ? whole : '')
    .replace(/\x1b\[M([\x20-\x3f]{3})/g, (whole, payload) => (payload.charCodeAt(0) & 64) ? whole : '')
    .replace(/\x1b\[([0-9]+);[0-9]+;[0-9]+[Mm]/g, (whole, code) => (Number(code) & 64) ? whole : '')
}

function onlyMotionTrackingModes(params) {
  return params.length > 0 && params.every((param) => typeof param === 'number' && MOTION_TRACKING_MODES.has(param))
}

function onlySynchronizedOutput(params) {
  return params.length > 0 && params.every((param) => param === 2026)
}

function terminalTypography() {
  const styles = getComputedStyle(document.documentElement)
  const fontFamily = styles.getPropertyValue('--mono').trim()
  if (!fontFamily) {
    throw new Error('Terminal typography tokens are missing or invalid')
  }
  return { fontSize: getTerminalFontSize(), fontFamily }
}

// navigator.clipboard is undefined over plain HTTP (non-secure context) — fall back to execCommand; resolve true only on a real copy.
function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => execCopyFallback(text))
  }
  return Promise.resolve(execCopyFallback(text))
}

// Save/restore activeElement so the off-screen textarea used by the clipboard fallback does not steal focus.
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

export default function SessionTerm({ sessionId, active = true, focused = active, writable = true, resumeRequired = false, focusRequest = 0 }) {
  const t = useT()
  const hostRef = useRef(null)
  const termRef = useRef(null)
  // Last locally fitted or backend-requested grid. Visible measurement waits for the native transaction;
  // hidden measurement can fit immediately because that reflow cannot paint.
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  // The latest geometry request, exposed so activation can re-measure without recreating the terminal.
  const measureRef = useRef(null)
  // Session identity owns the browser terminal and socket. A pooled document can remain mounted while
  // inactive; visibility is a protocol claim (visible=false/true), not a resource lifetime. Refs expose
  // focus/visibility changes without recreating the terminal when a workspace tab changes.
  const activeRef = useRef(active)
  const focusedRef = useRef(focused)
  const writableRef = useRef(writable)
  const resumeRequiredRef = useRef(resumeRequired)
  const resumeConfirmedRef = useRef(!resumeRequired)
  const sendInputRef = useRef(null)
  const hideRef = useRef(null)
  activeRef.current = active
  focusedRef.current = focused
  writableRef.current = writable
  resumeRequiredRef.current = resumeRequired
  // brief "copied ✓" confirmation flashed by the copy chord; drives only the corner caption, not the term.
  const [copied, setCopied] = useState(false)
  const [inputConfirmOpen, setInputConfirmOpen] = useState(false)
  const [pendingInput, setPendingInput] = useState('')
  const [resumeConfirmed, setResumeConfirmed] = useState(!resumeRequired)
  resumeConfirmedRef.current = resumeConfirmed
  // socket health for the corner caption: 'connecting' | 'open' | 'reconnecting' (drives the loud "reconnecting…").
  const [conn, setConn] = useState('connecting')
  useEffect(() => {
    const term = new Terminal({
      ...terminalTypography(),
      cursorBlink: true, disableStdin: !writable, scrollback: 0,  // tmux owns history; xterm owns native keyboard + IME input on a live pane
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
    const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
    const clearCommittedText = (event) => {
      if (event.inputType === 'insertText' && !event.isComposing) helper.value = ''
    }
    helper?.addEventListener('input', clearCommittedText)
    // Printable text must come from the browser's text event, not xterm's physical-key mapping on keydown:
    // under a Chinese IME the Comma key is physical `,` while the browser commits `，` through keypress/input.
    // Returning false here stops xterm's eager keydown handling without cancelling that native DOM event.
    // Browsers do not expose Shift+Enter as a distinct terminal byte by default, so encode that one modified
    // Enter sequence while leaving IME confirmation alone.
    term.attachCustomKeyEventHandler((event) => {
      const browserTextKey = event.type === 'keydown' && event.key.length === 1
        && !event.ctrlKey && !event.altKey && !event.metaKey
      if (browserTextKey) return false
      const shiftEnter = event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      if (!shiftEnter || event.isComposing || event.keyCode === 229) return true
      event.preventDefault()
      event.stopPropagation()
      if (event.type === 'keydown') term.input('\x1b\r', true)
      return false
    })
    const viewerIsVisible = () => activeRef.current && document.visibilityState !== 'hidden'
    const initialFocusFrame = requestAnimationFrame(() => {
      const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
      if (writableRef.current && focusedRef.current && viewerIsVisible()) {
        helper?.setAttribute('data-focus-sink', '')
        if (document.activeElement !== helper) term.focus()
      }
    })

    // Pointer belongs to the browser: motion-tracking DECSETs are consumed here (a drifting pointer
    // emits nothing — hover reports are what armed claude's status-line stall indefinitely), and the
    // patched selection predicate (patch-xterm-sync-resize.mjs) turns every plain drag into a LOCAL
    // browser selection (no button reports, modifier-free copy). Only wheel reports leave, under
    // tmux's native routing.
    const motionModeHandlers = ['h', 'l'].map((final) => term.parser.registerCsiHandler(
      { prefix: '?', final },
      (params) => onlyMotionTrackingModes(params),
    ))
    // A bridge-owned geometry frame already has one outer synchronized hold. tmux's native bytes contain
    // their own 2026 pairs; treating those as nested would close the outer hold early because DEC mode 2026
    // is boolean, not a counter. Consume only those inner markers while that exact frame is parsed.
    let frameOwnsSync = false
    const frameSyncHandlers = ['h', 'l'].map((final) => term.parser.registerCsiHandler(
      { prefix: '?', final },
      (params) => frameOwnsSync && onlySynchronizedOutput(params),
    ))

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const base = `${proto}://${location.host}${apiUrl(`/api/sessions/${sessionId}/socket`)}`
    let sock = null   // the resilient socket; assigned below, once the frame machinery its callbacks use exists.
    // True once native bytes arrive while this pane is hidden — the backend's bounded linger is still
    // streaming into this buffer, so its grid belongs to that stream, not to a local reflow.
    let hiddenStreamFlowing = false

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
      if (!viewerIsVisible()) {
        // A lingering stream still writes into this hidden buffer at the shared grid; reflowing it locally
        // would corrupt those frames. The buffer keeps its grid — the visible claim reconciles divergence.
        if (!hiddenStreamFlowing) {
          try { term.resize(cols, rows) } catch { /* a later layout pass retries */ }
        }
        return
      }
      if (sock?.isOpen()) {
        sock.send(JSON.stringify({ t: 'resize', cols, rows }))
      }
    }
    measureRef.current = measureAndRequest
    hideRef.current = () => {
      hiddenStreamFlowing = false
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'visible', visible: false }))
    }

    let fontRaf = 0
    const unsubscribeFont = subscribeTerminalFontSize((fontSize) => {
      term.options.fontSize = fontSize
      lastSizeRef.current = { cols: 0, rows: 0 }
      cancelAnimationFrame(fontRaf)
      fontRaf = requestAnimationFrame(() => measureRef.current?.())
    })

    // A resize commit and its following binary frame are one browser transaction. Serialize every frame so
    // raw output cannot enter between an atomic frame and its closing marker; ordinary frames still retain
    // tmux's own synchronized-output semantics unchanged.
    let committedSize = null
    const frameQueue = []
    let writingFrame = false
    const drainFrames = () => {
      if (writingFrame || !frameQueue.length) return
      writingFrame = true
      const { frame, size } = frameQueue.shift()
      const done = () => { writingFrame = false; drainFrames() }
      if (!size) {
        term.write(frame, done)
        return
      }
      term.write(SYNC_BEGIN, () => {
        frameOwnsSync = true
        try { term.resize(size.cols, size.rows) } catch { /* final bytes still restore the visible pane */ }
        term.write(frame, () => {
          frameOwnsSync = false
          term.write(SYNC_END, done)
        })
      })
    }
    const enqueueFrame = (frame, size) => { frameQueue.push({ frame, size }); drainFrames() }
    sock = createResilientSocket({
      url: base,
      onState: setConn,
      onOpen: () => {
        committedSize = null
        hiddenStreamFlowing = false
        frameQueue.length = 0
        term.reset()
        lastSizeRef.current = { cols: 0, rows: 0 }
        if (viewerIsVisible()) measureAndRequest()
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
        if (!viewerIsVisible()) {
          // Resident panes keep their browser identity, but hidden native output must not spend CPU parsing
          // and painting into an invisible xterm. The next visible geometry request asks the bridge for a
          // fresh repaint, so there is no hidden backlog to fast-forward.
          hiddenStreamFlowing = true
          committedSize = null
          frameQueue.length = 0
          return
        }
        const frame = new Uint8Array(e.data)
        const size = committedSize
        committedSize = null
        enqueueFrame(frame, size)
      },
    })
    // Page destruction does not wait for React teardown. Close proactively so the WebSocket and its exact
    // native tmux client share the browser tab's lifetime even before the server heartbeat backstop fires.
    const onPageHide = () => sock?.close()
    window.addEventListener('pagehide', onPageHide)
    const sendInput = (data) => {
      if (!data || !writableRef.current || !focusedRef.current || !viewerIsVisible() || !sock?.isOpen()) return false
      sock.send(JSON.stringify({ t: 'input', data }))
      return true
    }
    sendInputRef.current = sendInput
    const inputSub = term.onData((data) => {
      if (!writableRef.current || !focusedRef.current || !viewerIsVisible() || !sock?.isOpen()) return
      // A suspended TUI may put a token-consuming resume prompt under the cursor. The first real key is
      // the user's intent boundary; keep it out of tmux until the separate confirmation is answered.
      const pointerReport = isTerminalPointerReport(data)
      // Mouse traffic is browser chrome, not a conversational turn. xterm emits button/wheel reports
      // through the same onData callback as typed bytes; forwarding those reports lets a tab click or
      // focus reactivation reach the native TUI and is exactly the wrong lifecycle boundary.
      const filtered = stripTerminalButtonReports(stripTerminalFocusReports(data))
      if (!filtered) return
      if (resumeRequiredRef.current && !resumeConfirmedRef.current && !pointerReport) {
        setPendingInput(filtered)
        setInputConfirmOpen(true)
        term.blur()
        return
      }
      sendInput(filtered)
    })

    // Wheel navigation is xterm-native: reports ride the ordinary onData→input path to this viewer's
    // real tmux client, and tmux's default routing decides — copy-mode for a plain pane, pass-through
    // for a mouse-owning TUI (claude virtual-scrolls its own transcript, as under iTerm). No custom
    // wheel handler, quantizer, tick ledger, or synthetic bottoming exists in the browser. Claude's
    // residual status-line stall after wheeling is its documented upstream TUI defect (see live-view).

    // ⌘/Ctrl+C copies the xterm selection: CAPTURE-phase on `document`, because the pane's helper
    // textarea holds focus after a drag — xterm's own target-phase keydown would otherwise win and
    // emit \x03 (SIGINT) into the app. Gated to the visible pane, only while a terminal selection
    // exists, and standing down when a focused field has its own selection (its native copy wins).
    let copiedTimer
    const host = hostRef.current
    const onCopyKey = (ev) => {
      if (!(ev.metaKey || ev.ctrlKey) || (ev.key !== 'c' && ev.key !== 'C')) return
      if (!host || !activeRef.current) return                 // not the visible terminal — let it pass
      const sel = term.getSelection()
      if (!sel) return
      const el = document.activeElement
      // the helper textarea mirrors the terminal selection (xterm selects it there for native copy),
      // so its "own selection" IS the terminal's — only a real composer field stands this chord down.
      if (el && !el.classList.contains('xterm-helper-textarea')
        && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.selectionStart !== el.selectionEnd) return
      ev.preventDefault(); ev.stopPropagation()
      copyToClipboard(sel).then((ok) => {
        if (!ok) return   // copy genuinely failed — don't flash a false "copied ✓"; selection stays for manual copy
        setCopied(true)
        clearTimeout(copiedTimer); copiedTimer = setTimeout(() => setCopied(false), 1200)
      })
    }
    document.addEventListener('keydown', onCopyKey, true)

    const raf = requestAnimationFrame(measureAndRequest)
    const ro = new ResizeObserver(measureAndRequest)
    ro.observe(hostRef.current)
    window.addEventListener('resize', measureAndRequest)
    let visibilityFocusFrame = 0
    const onDocumentVisibility = () => {
      if (!viewerIsVisible()) {
        hideRef.current?.()
        return
      }
      lastSizeRef.current = { cols: 0, rows: 0 }
      measureAndRequest()
      try { term.refresh(0, term.rows - 1) } catch { /* native attach still supplies the current screen */ }
      cancelAnimationFrame(visibilityFocusFrame)
      if (writableRef.current && focusedRef.current) visibilityFocusFrame = requestAnimationFrame(() => {
        const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
        if (writableRef.current && focusedRef.current && viewerIsVisible() && document.activeElement !== helper) term.focus()
      })
    }
    document.addEventListener('visibilitychange', onDocumentVisibility)

    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(fontRaf)
      cancelAnimationFrame(initialFocusFrame)
      cancelAnimationFrame(visibilityFocusFrame)
      clearTimeout(copiedTimer)
      document.removeEventListener('keydown', onCopyKey, true)
      document.removeEventListener('visibilitychange', onDocumentVisibility)
      window.removeEventListener('pagehide', onPageHide)
      ro.disconnect()
      window.removeEventListener('resize', measureAndRequest)
      for (const handler of motionModeHandlers) handler.dispose()
      for (const handler of frameSyncHandlers) handler.dispose()
      helper?.removeEventListener('input', clearCommittedText)
      inputSub.dispose()
      unsubscribeFont()
      sock.close()   // intentional close → the resilient socket stops reopening for good
      term.dispose()
      termRef.current = null
      sendInputRef.current = null
      measureRef.current = null
      hideRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    const confirmed = !resumeRequired
    setResumeConfirmed(confirmed)
    resumeConfirmedRef.current = confirmed
    setPendingInput('')
    setInputConfirmOpen(false)
  }, [sessionId, resumeRequired])

  const confirmPendingInput = () => {
    const data = pendingInput
    setInputConfirmOpen(false)
    setPendingInput('')
    setResumeConfirmed(true)
    resumeConfirmedRef.current = true
    sendInputRef.current?.(data)
    requestAnimationFrame(() => {
      if (writableRef.current && focusedRef.current && activeRef.current && document.visibilityState !== 'hidden') termRef.current?.focus()
    })
  }
  const cancelPendingInput = () => {
    setInputConfirmOpen(false)
    setPendingInput('')
  }

  // Keep the stable cached renderer as the first visible paint. The resize message is also the single helper
  // activation path; there is no separate raw-terminal prewarm or size-ownership transition.
  useLayoutEffect(() => {
    const term = termRef.current
    if (!term) return
    // The resident terminal is constructed while its document may be hidden. Keep xterm's input gate in
    // sync with the active surface instead of relying on construction-time `writable`; reactivation must
    // restore both the bridge visibility claim and the browser input sink without remounting.
    term.options.disableStdin = !writable
    let focusFrame = 0
    const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
    if (writable && focused) helper?.setAttribute('data-focus-sink', '')
    else helper?.removeAttribute('data-focus-sink')
    if (active && document.visibilityState !== 'hidden') {
      lastSizeRef.current = { cols: 0, rows: 0 }
      measureRef.current?.()
      try { term.refresh(0, term.rows - 1) } catch { /* */ }
      if (writableRef.current && focused) focusFrame = requestAnimationFrame(() => {
        const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
        if (writableRef.current && focusedRef.current && activeRef.current && document.visibilityState !== 'hidden' && document.activeElement !== helper) termRef.current?.focus()
      })
      else term.blur()
    } else {
      term.blur()
      hideRef.current?.()
    }
    return () => {
      cancelAnimationFrame(focusFrame)
      helper?.removeAttribute('data-focus-sink')
    }
  }, [sessionId, active, focused])

  useLayoutEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.disableStdin = !writable
    const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
    if (!writable) {
      helper?.removeAttribute('data-focus-sink')
      term.blur()
    }
  }, [writable])

  // An already-active row or Terminal tab can be activated repeatedly without changing `active`/`focused`.
  // Keep that intent separate from geometry so refocusing never causes a redundant resize/repaint transaction.
  useLayoutEffect(() => {
    if (!focusRequest || !active || !focused || !writable || document.visibilityState === 'hidden') return
    const focusFrame = requestAnimationFrame(() => {
      const helper = hostRef.current?.querySelector('.xterm-helper-textarea')
      if (activeRef.current && focusedRef.current && writableRef.current && document.activeElement !== helper) termRef.current?.focus()
    })
    return () => cancelAnimationFrame(focusFrame)
  }, [sessionId, active, focused, focusRequest]) // writable intentionally does not replay an earlier focus request

  return (
    <div className="st-wrap">
      <div className="st-host" ref={hostRef} />
      {inputConfirmOpen && (
        <div className="st-input-confirm-backdrop" role="presentation">
          <div className="st-input-confirm" role="dialog" aria-modal="true" aria-labelledby="st-input-confirm-title">
            <h2 id="st-input-confirm-title">{t('session.resumeInputTitle')}</h2>
            <p>{t('session.resumeInputMessage')}</p>
            <div className="st-input-confirm-actions">
              <button type="button" onClick={cancelPendingInput}>{t('common.cancel')}</button>
              <button type="button" onClick={confirmPendingInput}>{t('session.resumeInputConfirm')}</button>
            </div>
          </div>
        </div>
      )}
      {/* subtle corner caption: the copy confirmation, or a loud "reconnecting…" while the socket re-opens. */}
      {copied && <div className="st-copyhint copied">copied ✓</div>}
      {!copied && conn === 'reconnecting' && <div className="st-copyhint reconnecting">reconnecting…</div>}
    </div>
  )
}
