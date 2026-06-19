import { useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'

// @@@ SessionInterface - the Enter surface. TWO panes: a left session list and a right content area
// that MORPHS by what's focused in the list:
//   · "New Session" focused -> input box + avatar CENTERED (terminal vibe). Nothing is prefilled — the
//     focused spec node is instead the FIRST @-mention suggestion, so you opt into targeting it by typing
//     `@`. Enter launches a real session, then we SWITCH to it.
//   · an existing session focused -> the content becomes a READ-ONLY live tmux terminal (SessionTerm),
//     with the SINGLE human input docked at the BOTTOM. The terminal never accepts typing; the bottom box
//     is the only input — submitting writes the line + Enter into the pane over the terminal's OWN socket
//     (each SessionTerm registers a `send` writer in `sendersRef`), falling back to POST /keys if the
//     socket isn't open yet.
// "BOARDING SWITCH" not "temporary modal": the surface stays MOUNTED while the board is open AND while
// it's hidden (driven by the `open` prop — App never unmounts it). So the selected tab (`sel`, lifted to
// App) AND any typed-but-unsent input survive a close/reopen — you switch back to exactly where you were.
//
// KEY HANDLING is at the WINDOW level (capture), not the panel's onKeyDown: when you arrow off the
// New Session tab its textarea unmounts and focus would leave the panel, which used to kill further
// nav. A window listener is focus-independent, so ↑/↓ keep walking the list no matter what's focused.

const STATUS_DOT = { working: '#cb4b16', idle: '#93a1a1', offline: '#657b83', review: '#6c71c4', done: '#268bd2', 'close-pending': '#cb4b16', blocked: '#2aa198', error: '#dc322f', 'needs-input': '#b58900' }

// @@@ nav-mode keymap - DOM KeyboardEvent.key → the key NAME our /rawkey backend feeds to tmux send-keys.
// Anything not listed and length-1 (a printable char) is forwarded verbatim. Escape is handled separately
// (it cancels a menu, and a second Esc exits nav mode), so it's intentionally absent here.
const RAWKEY = { ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', ' ': 'Space' }

// @@@ @-mention helpers - the spec path the menu matches against (`.spec/a/b/<id>/spec.md`), shown
// minus the `.spec/` shell and the `/spec.md` leaf, so the row reads like the tree breadcrumb it is.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// rank spec nodes for a partial @query. The focused node always floats to the very top (so just typing
// `@` lists it first — the convenient default target). Otherwise id beats path; a prefix beats a mid-match;
// shorter ids win ties so the most specific node floats up. Empty query (just typed `@`) lists everything.
function matchSpecs(specs, query, focusId) {
  const q = query.toLowerCase()
  const scored = []
  for (const s of specs) {
    const id = s.id.toLowerCase()
    const path = specPath(s.path).toLowerCase()
    let score
    if (!q) score = 3
    else if (id.startsWith(q)) score = 0
    else if (id.includes(q)) score = 1
    else if (path.includes(q)) score = 2
    else continue
    if (s.id === focusId) score = -1   // focused node first whenever it's in the result set
    scored.push({ s, score })
  }
  scored.sort((a, b) => a.score - b.score || a.s.id.length - b.s.id.length || a.s.id.localeCompare(b.s.id))
  return scored.slice(0, 8).map((x) => x.s)
}

// @@@ caretAtEdge - is the <textarea> caret on its FIRST (dir:'up') or LAST (dir:'down') VISUAL line,
// counting WRAPPED lines, not just '\n'? The window-level ↑/↓ owns tab nav, but inside a multi-line
// input the arrows must first walk the caret; only at the visual edge — no line to move to in that
// direction — should they fall through to switching tabs. Browsers expose no caret-line API for a
// textarea, so we mirror it into an off-screen div with the SAME wrapping geometry (width, padding,
// font) and read which line the caret pixel lands on. One reused hidden node, measured synchronously.
let mirror
function caretAtEdge(el, dir) {
  const cs = getComputedStyle(el)
  if (!mirror) { mirror = document.createElement('div'); document.body.appendChild(mirror) }
  const s = mirror.style
  s.position = 'absolute'; s.visibility = 'hidden'; s.top = '0'; s.left = '-9999px'
  s.whiteSpace = 'pre-wrap'; s.wordWrap = 'break-word'; s.overflow = 'hidden'
  s.boxSizing = 'border-box'; s.border = '0'; s.width = `${el.clientWidth}px`
  for (const p of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontFamily', 'fontSize',
    'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textIndent', 'textTransform', 'tabSize']) s[p] = cs[p]
  const caret = el.selectionStart
  mirror.textContent = el.value.slice(0, caret)
  const mark = document.createElement('span')
  mark.textContent = el.value.slice(caret) || '.'   // mark's box top = the caret's visual-line top
  mirror.appendChild(mark)
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2
  const padTop = parseFloat(cs.paddingTop) || 0, padBottom = parseFloat(cs.paddingBottom) || 0
  const top = mark.offsetTop - padTop                          // caret line top from text start; 0 = first line
  const textHeight = mirror.scrollHeight - padTop - padBottom  // height of all (wrapped) lines
  return dir === 'up' ? top < lh : top >= textHeight - lh - 1
}

// bold the first case-insensitive hit of the query inside a label (the part the user has typed so far).
function highlight(text, q) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<b className="mention-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>
}

export default function SessionInterface({ sessions, specs = [], focusNode, open, sel, setSel, seed, onSeedConsumed, onClose, onCreated }) {
  const [prompt, setPrompt] = useState('')    // the New Session tab's own draft (its boarding-switch cache)
  const [menu, setMenu] = useState(null)      // @-mention dropdown: { items, index, start, end, query }
  // bottom-input drafts, keyed by session id — each session tab keeps its OWN typed-but-unsent line, never
  // a single shared box. Survives tab switches and close/reopen (the panel stays mounted, see `open`).
  const [drafts, setDrafts] = useState({})
  const [sending, setSending] = useState(false)
  // @@@ nav mode - when ON, the ❯ box is disabled and every keystroke is forwarded RAW to the active
  // session's pane (POST /rawkey → tmux send-keys) so the human drives the agent's interactive TUI menus.
  // `menuById` is the best-effort, NON-authoritative hint (set by each SessionTerm) that a pane currently
  // looks like a select menu — used only to SUGGEST nav mode (pulse the button), never to seize keys.
  const [navMode, setNavMode] = useState(false)
  const [menuById, setMenuById] = useState({})
  const lastEscRef = useRef(0)
  const taRef = useRef(null)
  const msgRef = useRef(null)
  // each mounted SessionTerm registers its socket writer here, keyed by session id, so the bottom box can
  // push the typed line into the active session's pane over the SAME socket the terminal already holds.
  const sendersRef = useRef({})

  const order = useMemo(() => ['new', ...sessions.map((s) => s.id)], [sessions])
  const active = order.includes(sel) ? sel : 'new'
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)
  // the active session tab's bottom-input draft (per-session, see `drafts`).
  const msg = drafts[active] || ''
  const setMsg = (v) => setDrafts((d) => ({ ...d, [active]: v }))

  // nav mode binds to ONE live session's menu — leaving the tab (or it going offline) exits it, so raw
  // keystrokes can never leak into the wrong pane.
  useEffect(() => { setNavMode(false) }, [active])
  useEffect(() => { if (selSession?.status === 'offline') setNavMode(false) }, [selSession?.status])
  // forward one raw key to the active session's pane (fire-and-forget; the backend tmux send-keys it).
  const sendRawKey = (key) => {
    fetch(`/api/sessions/${active}/rawkey`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    }).catch(() => {})
  }
  // each SessionTerm reports whether its pane currently looks like a select menu (best-effort hint).
  const reportMenu = (id, likely) => setMenuById((m) => (m[id] === likely ? m : { ...m, [id]: likely }))

  // @@@ persistent terminals - keep every session terminal you've opened MOUNTED (hidden when inactive),
  // so its WebSocket + scroll position survive a tab switch and switching back is instant (no remount,
  // no reconnect). The backend already keeps a warm tmux client per live session, so the pair makes both
  // first-open and re-open instant. We only mount sessions you've actually visited (bounded), and drop
  // any that vanish or go offline (offline shows the relaunch panel, not a dead terminal).
  const [opened, setOpened] = useState(() => new Set())
  useEffect(() => {
    if (active !== 'new' && selSession && selSession.status !== 'offline' && !opened.has(active)) {
      setOpened((prev) => new Set(prev).add(active))
    }
  }, [active, selSession?.status])
  useEffect(() => {
    setOpened((prev) => {
      const next = new Set()
      for (const id of prev) { const s = sessions.find((x) => x.id === id); if (s && s.status !== 'offline') next.add(id) }
      return next.size === prev.size ? prev : next
    })
  }, [sessions])

  // @@@ seed - a board chord (nn/dd) opens this surface with a pre-filled @-directive. Apply it to the
  // New Session draft ONCE, land on the New tab, place the caret at the end, then clear it upstream so a
  // later reopen restores the user's own draft instead of re-seeding. Clobbering the draft is intended
  // here (unlike a normal tab switch): the chord is an explicit "start this op".
  useEffect(() => {
    if (seed == null) return
    setSel('new')
    setPrompt(seed)
    setMenu(null)
    onSeedConsumed?.()
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(seed.length, seed.length) } })
  }, [seed])

  // @@@ focus on tab switch - whenever the board is open and you land on a tab, focus that tab's input:
  // the New Session prompt, or a live session's bottom message box. NOTHING is prefilled — the focused
  // node is instead the first @-mention suggestion, so you opt into it by typing `@`. (No setPrompt here:
  // the per-tab drafts must survive a tab switch / reopen, so we never clobber them.)
  useEffect(() => {
    if (!open) return
    const id = setTimeout(() => {
      if (active === 'new') taRef.current?.focus()
      else if (selSession?.status !== 'offline') msgRef.current?.focus()
    }, 0)
    return () => clearTimeout(id)
  }, [open, active, selSession?.status])

  // @@@ auto-grow - the new-session box grows with its content (line wraps + newlines) up to the CSS
  // max-height, then scrolls. Reset to 0/auto first so it can also shrink when text is deleted. Re-runs
  // on `open` too, so a reopen with a cached multi-line draft restores its height instead of collapsing.
  useEffect(() => {
    const ta = taRef.current
    if (!ta || active !== 'new' || !open) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt, active, open])

  // launch a real session, then SWITCH to it (onCreated reloads the board, then App sets sel to the id).
  const submit = async () => {
    const text = prompt.trim()
    if (!text || sending) return
    setSending(true)
    try {
      // send only the prompt: the server derives the node from the @-mention the prompt ACTUALLY carries
      // (you add it by typing `@`, focused node first), and titles a node-agnostic session (no @) by its
      // first words. So the @ you type decides the node — nothing is targeted by default.
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      })
      const data = await res.json().catch(() => null)
      setPrompt('')
      await onCreated?.(data?.id)
    } finally {
      setSending(false)
    }
  }

  // @@@ @-mention menu - while typing the New Session prompt, an `@` that begins a word opens a dropdown
  // of spec nodes filtered by what follows it (matched against id + spec path). Picking one drops a clean
  // `@<id>` token in place. The trigger is purely positional: we scan back from the caret over non-space
  // chars; it's a mention only if we hit an `@` sitting at a word boundary with no space up to the caret.
  const buildMenu = (value, caret) => {
    let i = caret - 1
    while (i >= 0 && value[i] !== '@' && !/\s/.test(value[i])) i--
    if (i < 0 || value[i] !== '@') return null
    if (i > 0 && !/\s/.test(value[i - 1])) return null        // @ must start a word, not be mid-token (email-ish)
    const query = value.slice(i + 1, caret)
    const items = matchSpecs(specs, query, focusId)
    if (!items.length) return null
    return { items, index: 0, start: i, end: caret, query }
  }
  // recompute from the textarea's live value + caret (covers typing, deletes, and bare caret moves).
  const syncMenu = (el) => setMenu(el ? buildMenu(el.value, el.selectionStart) : null)
  const navMenu = (dir) => setMenu((m) => (m ? { ...m, index: (m.index + dir + m.items.length) % m.items.length } : m))
  // replace the `@query` span under the caret with the picked node's `@<id> `, then drop the caret after it.
  const accept = (item) => {
    if (!item || !menu) return
    const insert = `@${item.id} `
    const before = prompt.slice(0, menu.start)
    setPrompt(before + insert + prompt.slice(menu.end))
    setMenu(null)
    const caret = before.length + insert.length
    requestAnimationFrame(() => { const el = taRef.current; if (el) { el.focus(); el.setSelectionRange(caret, caret) } })
  }

  const sendMsg = async () => {
    const text = msg
    if (!text.trim() || active === 'new') return
    setMsg('')
    // prefer the terminal's live socket (text + Enter as raw bytes); fall back to POST /keys if it isn't
    // open yet (e.g. the terminal just mounted and the ws is still connecting).
    if (sendersRef.current[active]?.(text + '\r')) return
    await fetch(`/api/sessions/${active}/keys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, enter: true }),
    }).catch(() => {})
  }

  // lifecycle actions — thin POSTs to the session state machine, then reload the board.
  const act = async (verb, after) => {
    await fetch(`/api/sessions/${active}/${verb}`, { method: 'POST' }).catch(() => {})
    if (after) after()
    await onCreated?.(null)
  }
  // "back to working": clear the proposal (server reopens + relaunches if offline), then focus the input.
  const backToWorking = async () => {
    await act('resume')
    setTimeout(() => msgRef.current?.focus(), 80)
  }

  // @@@ window-level list nav - ↑/↓ move the selection regardless of focus; Enter on New launches.
  const stateRef = useRef({})
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose, open, navMode, setNavMode, sendRawKey } = stateRef.current
      if (!open) return   // panel hidden (board not the active surface): the graph owns the keys
      // @@@ nav-mode toggle chord (⌃/⌘+I) - the dependable keyboard entry/exit, alongside the header button.
      // Handled before everything else so it works whether nav mode is currently on or off.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'i' || e.key === 'I') && active !== 'new') {
        e.preventDefault(); e.stopPropagation(); setNavMode((v) => !v); return
      }
      // @@@ nav mode passthrough - while ON, EVERY key is forwarded raw to the session pane and nothing else
      // fires (no list nav, no page scroll). Esc is forwarded too (it cancels the agent's menu); a SECOND Esc
      // within 600ms exits nav mode. preventDefault/stopPropagation keep keys from leaking anywhere else.
      if (navMode && active !== 'new') {
        e.preventDefault(); e.stopPropagation()
        if (e.key === 'Escape') {
          sendRawKey('Escape')
          const now = Date.now()
          if (now - lastEscRef.current < 600) setNavMode(false)
          lastEscRef.current = now
          return
        }
        const named = RAWKEY[e.key]
        if (named) { sendRawKey(named); return }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) sendRawKey(e.key)
        return
      }
      // the @-mention menu owns navigation/commit/dismiss while it's open (New Session tab only).
      if (active === 'new' && menu) {
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); navMenu(1); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); e.stopPropagation(); navMenu(-1); return }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(menu.items[menu.index]); return }
        if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setMenu(null); return }
      }
      // Esc closes the whole interface (App delegates it here so the menu can claim it first, above).
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // inside a multi-line input, ↑/↓ first walk the caret between (possibly wrapped) lines; only at
        // the visual edge — no line to move to in that direction — do they fall through to tab nav.
        const el = e.target
        if (el?.tagName === 'TEXTAREA' && !caretAtEdge(el, e.key === 'ArrowUp' ? 'up' : 'down')) return
        e.preventDefault(); e.stopPropagation()
        const i = order.indexOf(active)
        const ni = Math.max(0, Math.min(order.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
        setSel(order[ni]); return
      }
      if (e.key === 'Enter' && !e.shiftKey && active === 'new') { e.preventDefault(); e.stopPropagation(); submit() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [setSel])

  return (
    <div className="si-backdrop" onMouseDown={onClose} style={open ? undefined : { display: 'none' }}>
      <div className="si-panel" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="si-list">
          <div className="si-list-head">// sessions</div>
          <button className={active === 'new' ? 'si-item new on' : 'si-item new'} onClick={() => setSel('new')}>
            ＋ New Session
          </button>
          {sessions.map((s) => (
            <button
              key={s.id}
              className={active === s.id ? 'si-item on' : 'si-item'}
              style={{ '--ov': s.color }}
              onClick={() => setSel(s.id)}
            >
              <span className="si-dot" style={{ background: STATUS_DOT[s.status] || '#93a1a1' }} />
              <span className="si-name">{s.node || s.title || s.branch || s.id}</span>
              <span className="si-st">{s.status}</span>
            </button>
          ))}
        </aside>

        <section className={active === 'new' ? 'si-content is-new' : 'si-content is-session'}>
          {active === 'new' ? (
            <div className="si-new-center">
              <div className="si-avatar">◠‿◠</div>
              <div className="si-ask">What would you like to do?</div>
              <div className="si-inputwrap">
                <textarea
                  ref={taRef}
                  className="si-input"
                  rows={1}
                  value={prompt}
                  onChange={(e) => { setPrompt(e.target.value); syncMenu(e.target) }}
                  onSelect={(e) => syncMenu(e.target)}
                  onBlur={() => setMenu(null)}
                  placeholder="describe the work · @ to reference a spec · ⏎ to launch · ⇧⏎ newline"
                  spellCheck={false}
                  disabled={sending}
                />
                {menu && (
                  <ul className="mention-menu" role="listbox">
                    <li className="mention-head">// {menu.query ? `@${menu.query}` : 'spec nodes'} — ↑↓ pick · ⏎ insert</li>
                    {menu.items.map((it, i) => (
                      <li
                        key={it.id}
                        role="option"
                        aria-selected={i === menu.index}
                        className={i === menu.index ? 'mention-item on' : 'mention-item'}
                        onMouseDown={(e) => { e.preventDefault(); accept(it) }}
                        onMouseEnter={() => setMenu((m) => (m ? { ...m, index: i } : m))}
                      >
                        <span className="mention-dot" style={{ background: STATUS_DOT[it.status] || '#93a1a1' }} />
                        <span className="mention-id">@{highlight(it.id, menu.query)}</span>
                        <span className="mention-path">{specPath(it.path)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="si-hint">
                {focusNode
                  ? <>type <code>@</code> to reference a spec — <code>@{focusNode.id}</code> (focused) is first</>
                  : <>type <code>@</code> to reference a spec — otherwise this prompt is node-agnostic</>}
              </div>
            </div>
          ) : (
            <>
              <div className="si-term">
                <div className="si-term-head">
                  <span className="si-dot" style={{ background: STATUS_DOT[selSession?.status] || '#93a1a1' }} />
                  <span className="si-th-name">{selSession?.node || selSession?.title || selSession?.branch || active}</span>
                  <span className="si-th-st">{selSession?.status}</span>
                  {selSession?.merges > 0 && <span className="si-merges" title="times merged to main">merged ×{selSession.merges}</span>}
                  <div className="si-actions">
                    {selSession?.status !== 'offline' && (
                      <button
                        className={navMode ? 'si-act nav on' : (menuById[active] ? 'si-act nav suggest' : 'si-act nav')}
                        title="nav mode — forward raw keystrokes to drive the agent's interactive menus (⌃/⌘+I)"
                        onClick={() => setNavMode((v) => !v)}
                      >⌨ nav</button>
                    )}
                    {selSession?.status === 'offline' && <button className="si-act go" onClick={() => act('resume')}>relaunch</button>}
                    {/* no manual "request review": agents propose review themselves at the stop-gate
                        (`session done --propose merge`). proposals (review/done/close-pending) resolve to
                        merge / back-to-working / close */}
                    {(selSession?.status === 'review' || selSession?.status === 'done') && <button className="si-act go" onClick={() => act('merge')}>merge</button>}
                    {(selSession?.status === 'review' || selSession?.status === 'done' || selSession?.status === 'close-pending') && <button className="si-act" onClick={backToWorking}>back to working</button>}
                    <button className="si-act kill" onClick={() => act('close', () => setSel('new'))}>close</button>
                  </div>
                </div>
                <div className="si-term-body" style={{ position: 'relative' }}>
                  {/* every opened session's terminal stays mounted; only the active one is shown */}
                  {[...opened].map((id) => (
                    <div key={id} className="si-term-layer" style={{ position: 'absolute', inset: 0, display: id === active ? 'block' : 'none' }}>
                      <SessionTerm sessionId={id} senders={sendersRef} onMenu={reportMenu} />
                    </div>
                  ))}
                  {selSession?.status === 'offline' && (
                    <div className="si-offline">
                      <div className="si-offline-msg">⏻ offline — no live process for this worktree.</div>
                      <div className="si-offline-sub">the worktree and its session <code>{active.slice(0, 8)}…</code> are intact. relaunch to resume the same conversation.</div>
                      <button className="si-act go big" onClick={() => act('resume')}>⏵ relaunch &amp; resume</button>
                    </div>
                  )}
                </div>
              </div>
              {navMode ? (
                // nav mode replaces the prompt box: keys go straight to the pane (handled at the window level).
                <div className="si-bottom nav" onClick={() => setNavMode(false)} title="click to exit nav mode">
                  <span className="si-nav-ind">⌨ nav mode</span>
                  <span className="si-nav-help">keys go to the session · Esc-Esc or click to exit</span>
                </div>
              ) : (
                <div className="si-bottom">
                  <span className="si-prompt">❯</span>
                  <textarea
                    ref={msgRef}
                    className="si-input"
                    rows={1}
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); sendMsg() } }}
                    placeholder={selSession?.status === 'offline' ? 'relaunch to message this session' : 'message this session · ⏎ to send'}
                    spellCheck={false}
                    disabled={selSession?.status === 'offline'}
                  />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
