import { useEffect, useMemo, useRef, useState } from 'react'
import SessionTerm from './SessionTerm.jsx'

// @@@ SessionInterface - the Enter surface. TWO panes: a left session list and a right content area
// that MORPHS by what's focused in the list:
//   · "New Session" focused -> input box + avatar CENTERED (terminal vibe), prefilled with the focused
//     spec node as an editable @prefix (a CONVENIENCE — a session can reference any/all nodes, so the
//     prefix is deletable); Enter launches a real session, then we SWITCH to it.
//   · an existing session focused -> the content becomes a READ-ONLY live tmux terminal (SessionTerm),
//     with the SINGLE human input docked at the BOTTOM. The terminal never accepts typing; the bottom box
//     is the only input — submitting writes the line + Enter into the pane over the terminal's OWN socket
//     (each SessionTerm registers a `send` writer in `sendersRef`), falling back to POST /keys if the
//     socket isn't open yet.
// `sel` is LIFTED to App so the surface reopens on the SAME tab the user left.
//
// KEY HANDLING is at the WINDOW level (capture), not the panel's onKeyDown: when you arrow off the
// New Session tab its textarea unmounts and focus would leave the panel, which used to kill further
// nav. A window listener is focus-independent, so ↑/↓ keep walking the list no matter what's focused.

const STATUS_DOT = { working: '#cb4b16', idle: '#93a1a1', offline: '#657b83', review: '#6c71c4', done: '#268bd2', 'close-pending': '#cb4b16', blocked: '#2aa198', error: '#dc322f', 'needs-input': '#b58900' }

// @@@ @-mention helpers - the spec path the menu matches against (`.spec/a/b/<id>/spec.md`), shown
// minus the `.spec/` shell and the `/spec.md` leaf, so the row reads like the tree breadcrumb it is.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// rank spec nodes for a partial @query. id beats path; a prefix beats a mid-match; shorter ids win
// ties so the most specific node floats up. Empty query (just typed `@`) lists everything, shortest-first.
function matchSpecs(specs, query) {
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
    scored.push({ s, score })
  }
  scored.sort((a, b) => a.score - b.score || a.s.id.length - b.s.id.length || a.s.id.localeCompare(b.s.id))
  return scored.slice(0, 8).map((x) => x.s)
}

// bold the first case-insensitive hit of the query inside a label (the part the user has typed so far).
function highlight(text, q) {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  return <>{text.slice(0, i)}<b className="mention-hit">{text.slice(i, i + q.length)}</b>{text.slice(i + q.length)}</>
}

export default function SessionInterface({ sessions, specs = [], focusNode, sel, setSel, onClose, onCreated }) {
  const [prompt, setPrompt] = useState('')
  const [menu, setMenu] = useState(null)      // @-mention dropdown: { items, index, start, end, query }
  const [msg, setMsg] = useState('')          // bottom input for talking to an active session
  const [sending, setSending] = useState(false)
  const taRef = useRef(null)
  const msgRef = useRef(null)
  // each mounted SessionTerm registers its socket writer here, keyed by session id, so the bottom box can
  // push the typed line into the active session's pane over the SAME socket the terminal already holds.
  const sendersRef = useRef({})

  const order = useMemo(() => ['new', ...sessions.map((s) => s.id)], [sessions])
  const active = order.includes(sel) ? sel : 'new'
  const focusId = focusNode?.id || null
  const selSession = sessions.find((s) => s.id === active)

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

  // on the New Session tab: prefill the focused-node @prefix and focus the box. Keyed on focusId (a
  // string), NOT the focus object — polling rebuilds that object every 4s and would wipe your typing.
  useEffect(() => {
    if (active !== 'new') return
    setPrompt(focusId ? `@${focusId} ` : '')
    const id = setTimeout(() => taRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [active, focusId])

  // @@@ auto-grow - the new-session box grows with its content (line wraps + newlines) up to the CSS
  // max-height, then scrolls. Reset to 0/auto first so it can also shrink when text is deleted.
  useEffect(() => {
    const ta = taRef.current
    if (!ta || active !== 'new') return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [prompt, active])

  // launch a real session, then SWITCH to it (onCreated reloads the board, then App sets sel to the id).
  const submit = async () => {
    const text = prompt.trim()
    if (!text || sending) return
    setSending(true)
    try {
      // send only the prompt: the server derives the node from the @-mention the prompt ACTUALLY carries
      // (the prefilled `@<focused>` is a deletable/editable default), and titles a node-agnostic session
      // (no @) by its first words. So changing or deleting the @ here decides the node, not the focus.
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      })
      const data = await res.json().catch(() => null)
      setPrompt(focusNode ? `@${focusNode.id} ` : '')
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
    const items = matchSpecs(specs, query)
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
  stateRef.current = { order, active, submit, menu, navMenu, accept, setMenu, onClose }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit, menu, navMenu, accept, setMenu, onClose } = stateRef.current
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
    <div className="si-backdrop" onMouseDown={onClose}>
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
                  ? <>prefixed with <code>@{focusNode.id}</code> — delete it for a node-agnostic prompt</>
                  : 'no node focused — this prompt is node-agnostic'}
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
                      <SessionTerm sessionId={id} senders={sendersRef} />
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
            </>
          )}
        </section>
      </div>
    </div>
  )
}
