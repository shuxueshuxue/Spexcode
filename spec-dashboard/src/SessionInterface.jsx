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

export default function SessionInterface({ sessions, focusNode, sel, setSel, onClose, onCreated }) {
  const [prompt, setPrompt] = useState('')
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

  // launch a real session, then SWITCH to it (onCreated reloads the board, then App sets sel to the id).
  const submit = async () => {
    const text = prompt.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, node: focusNode?.id || null }),
      })
      const data = await res.json().catch(() => null)
      setPrompt(focusNode ? `@${focusNode.id} ` : '')
      await onCreated?.(data?.id)
    } finally {
      setSending(false)
    }
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
  stateRef.current = { order, active, submit }
  useEffect(() => {
    const onKey = (e) => {
      const { order, active, submit } = stateRef.current
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
              <span className="si-name">{s.node || s.branch || s.id}</span>
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
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="describe the work · ⏎ to launch · ⇧⏎ newline"
                  spellCheck={false}
                  disabled={sending}
                />
              </div>
              <div className="si-hint">
                {focusNode
                  ? <>prefixed with <code>@{focusNode.id}</code> — delete it for a node-agnostic prompt · launches <code>claude --dangerously-skip-permissions</code></>
                  : 'no node focused — this prompt is node-agnostic'}
              </div>
            </div>
          ) : (
            <>
              <div className="si-term">
                <div className="si-term-head">
                  <span className="si-dot" style={{ background: STATUS_DOT[selSession?.status] || '#93a1a1' }} />
                  <span className="si-th-name">{selSession?.node || selSession?.branch || active}</span>
                  <span className="si-th-st">{selSession?.status}</span>
                  {selSession?.merges > 0 && <span className="si-merges" title="times merged to main">merged ×{selSession.merges}</span>}
                  <div className="si-actions">
                    {selSession?.status === 'offline' && <button className="si-act go" onClick={() => act('resume')}>relaunch</button>}
                    {(selSession?.status === 'working' || selSession?.status === 'idle') && <button className="si-act" onClick={() => act('review')}>request review</button>}
                    {/* proposals (review/done/close-pending) resolve to merge / back-to-working / close */}
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
