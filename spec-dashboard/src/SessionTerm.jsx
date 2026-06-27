import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { createResilientSocket } from './resilientSocket.js'
import '@xterm/xterm/css/xterm.css'

// @@@ looksLikeMenu - does the pane currently show an interactive SELECT menu (e.g. `/model`'s list)
// rather than the normal `❯` prompt? Heuristic signature: a select-caret line (`❯ <option>`) together with
// a hint line mentioning Esc plus Enter/arrows/select (menus print "esc to cancel · enter to confirm"); the
// bare prompt has no such hint.
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
      // stops a held ⌥ mid-drag from flipping into column/block select, so an accidental Option keeps a linewise grab.
      macOptionClickForcesSelection: true,
      // solarized-dark on purpose — the Claude Code TUI inside is built for a dark terminal; the bright* grays are its dim-text tones.
      // selection is a bright blue; selectionInactiveBackground matches it so the highlight doesn't grey out when focus sits in the ❯ box.
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

    // xterm has no public "always select"; pin the private selectionService.shouldForceSelection so a plain drag selects under mouse-reporting. Guarded.
    try { term._core._selectionService.shouldForceSelection = () => true } catch { /* fall back to ⌥/⇧-drag */ }

    // neutralise xterm's core focus() so clicking the pane selects without blurring the ❯ box (instance prop shadows the prototype). Guarded.
    try { term._core.focus = () => {} } catch { /* pane may still grab focus on a future xterm */ }

    // the WebGL addon is loaded/disposed by the active-driven effect below (one context for the visible pane only), not here.

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/sessions/${sessionId}/socket`
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
      if (sock?.isOpen()) sock.send(JSON.stringify({ t: 'resize', cols, rows }))
    }
    fitRef.current = fitAndSync

    const enc = new TextEncoder()
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
      url,
      onState: setConn,
      onOpen: () => { pending = []; if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0 } ; term.reset(); lastSizeRef.current = { cols: 0, rows: 0 }; fitAndSync() },
      onMessage: (e) => {
        if (!(e.data instanceof ArrayBuffer)) return
        pending.push(new Uint8Array(e.data))
        if (!flushRaf) flushRaf = requestAnimationFrame(flush)
      },
    })

    const send = (data) => sock.send(enc.encode(data))   // false (a no-op) while mid-reconnect; the wheel just skips

    // forward the wheel as SGR mouse reports (64/65 = up/down at the 1-based cell under the pointer) so tmux scrolls its real pane history.
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

    // poll the pane a few times a second and report via onMenu whether it currently looks like a select menu.
    const sniff = setInterval(() => { try { onMenuRef.current?.(sessionId, looksLikeMenu(term)) } catch { /* */ } }, 700)

    const raf = requestAnimationFrame(fitAndSync) // re-fit once layout settles
    // the .si-term entrance animates via transform (ResizeObserver can't see it), so re-fit at animationend and across its duration to catch the true full width.
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

  // attach WebGL only while this pane is visible and dispose it when it hides — WebGL contexts are a capped per-page resource the browser force-loses past the cap.
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
