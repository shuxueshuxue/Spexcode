import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from './avatar.jsx'
import { STATUS, GLYPH } from './specMeta.js'
import { SpecPane, HistoryPane, IssuesPane, EditPane, useHistory, panesFor } from './NodeView.jsx'
import { SessionRow, RowLead, useFold } from './SessionWindow.jsx'
import { sessionHandle, sessionHeadline, sessionForest, STATUS_COLOR, STATUS_GLYPH } from './session.js'
import { loadSessionTimeline, loadSessionDetail, sendSessionText } from './data.js'
import { useT } from './i18n/index.jsx'

// the desktop pane keys → their localized tab labels (panesFor hands back English labels; we relabel so
// the mobile tabs read in the active language like the rest of the UI).
// one i18n-key per pane key panesFor() can return — MUST cover every key in NodeView's PANES (+ 'edit'),
// or t(undefined) below would throw and blank the whole mobile screen. ('eval' was added to PANES later.)
const PANE_T = { spec: 'nodeView.paneSpec', history: 'nodeView.paneHistory', issues: 'nodeView.paneIssues', eval: 'nodeView.paneEval', edit: 'nodeView.paneEdit' }

// live sessions whose pending ops touch this node = its live editors (mirror of App.jsx's liveEditorsOf —
// a node never "belongs" to a session; the live link is the overlay, the set currently changing it).
const editorsOf = (node, sessions) => sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id))

function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.pending
  return <span className="m-dot" style={{ background: s.color }} />
}

function NodeRow({ node, kids, editors, onTap }) {
  return (
    <button className="m-row" onClick={onTap}>
      <StatusDot status={node.status} />
      <span className="m-row-title">{node.title}</span>
      {editors.length > 0 && (
        <span className="m-row-faces">
          {editors.slice(0, 3).map((e) => <Avatar key={e.id} seed={e.id} status={e.status} title={sessionHandle(e)} />)}
        </span>
      )}
      {node.version ? <span className="m-row-ver">v{node.version}</span> : null}
      {kids > 0 && <span className="m-row-kids">▸{kids}</span>}
      <span className="m-row-chev">›</span>
    </button>
  )
}

// `history`'s own .pane-hist owns the scroll (the host steps aside via `.fixed`); keyed by node id so
// useHistory re-fetches and the tab resets per node.
function MobileNode({ node, childrenOf, sessions, onOpenChild }) {
  const t = useT()
  const kids = childrenOf(node.id)
  const base = panesFor(node)   // [edit?, spec, history, issues] — edit leads only when a change is in flight
  const tabs = [
    ...(kids.length ? [{ key: 'children', label: t('mobile.childrenTab', { n: kids.length }) }] : []),
    ...base.map((p) => ({ key: p.key, label: t(PANE_T[p.key]) })),
  ]
  const [pane, setPane] = useState(null)
  useEffect(() => { setPane(null) }, [node.id])   // a fresh screen always opens on its first tab
  const active = pane && tabs.some((p) => p.key === pane) ? pane : tabs[0].key
  // fetch the version log only when the history tab is actually up (same gate as the desktop popup)
  const rows = useHistory(node.id, active === 'history')
  const editors = editorsOf(node, sessions)
  return (
    <div className="m-node">
      <div className="m-node-head">
        <StatusDot status={node.status} />
        <span className="m-node-title">{node.title}</span>
        {node.version ? <span className="m-node-ver">v{node.version}</span> : null}
        <span className="m-node-status">{t(`status.${node.status}`)}</span>
        {editors.length > 0 && (
          <span className="m-node-faces" title={t('mobile.liveEditors', { n: editors.length })}>
            {editors.map((e) => <Avatar key={e.id} seed={e.id} status={e.status} title={sessionHandle(e)} />)}
          </span>
        )}
      </div>
      {node.desc && <div className="m-node-desc">{node.desc}</div>}
      <div className="m-tabs">
        {tabs.map((p) => (
          <button key={p.key} className={p.key === active ? 'm-tab on' : 'm-tab'} onClick={() => setPane(p.key)}>
            {p.label}
          </button>
        ))}
      </div>
      <div className={active === 'history' ? 'm-pane-host fixed' : 'm-pane-host'}>
        {active === 'children' && (
          <div className="m-children">
            {kids.map((c) => (
              <NodeRow key={c.id} node={c} kids={childrenOf(c.id).length} editors={editorsOf(c, sessions)} onTap={() => onOpenChild(c.id)} />
            ))}
          </div>
        )}
        {active === 'spec' && <SpecPane node={node} />}
        {active === 'history' && <HistoryPane node={node} rows={rows} />}
        {active === 'issues' && <IssuesPane node={node} />}
        {active === 'edit' && <EditPane node={node} />}
      </div>
    </div>
  )
}

// hour:minute for an event row; a short date for the day separators the timeline inserts when the
// calendar day flips between neighbouring events.
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })
const dayKey = (ts) => new Date(ts).toDateString()

// @@@ the terminal-free conversation ([[session-timeline]]) — the phone's session detail. Without a pane to
// read, the persisted timeline IS the interaction record: every authored status transition (with the full
// declaration note — the agent's reply) and every delivered prompt, timestamped, oldest first, with the
// composer docked below. Freshness: an 8s poll while open, plus an immediate refetch whenever the board push
// moves this session's status/note (the board stream is already live in App), plus one after every send.
function MobileSessionDetail({ s, sessions, byId, goToNode }) {
  const t = useT()
  const ops = s.ops || []
  const [tab, setTab] = useState('chat')   // 'chat' | 'changes'
  useEffect(() => { setTab('chat') }, [s.id])
  const [events, setEvents] = useState(null)
  const [detail, setDetail] = useState(null)   // the record detail — carries the full originating prompt
  const [draft, setDraft] = useState('')
  const [noteReply, setNoteReply] = useState(true)   // the terminal-free default: ask for the reply in the note
  const [sending, setSending] = useState(false)
  const [sendErr, setSendErr] = useState(null)
  const scrollRef = useRef(null)

  const load = useCallback(() => loadSessionTimeline(s.id).then((d) => { if (d) setEvents(d.events) }), [s.id])
  useEffect(() => { setEvents(null); setDetail(null); load(); loadSessionDetail(s.id).then((d) => { if (d) setDetail(d) }) }, [s.id, load])
  useEffect(() => { const iv = setInterval(load, 8000); return () => clearInterval(iv) }, [load])
  useEffect(() => { load() }, [s.status, s.note, load])
  // keep the conversation pinned to its newest entry, like any chat surface
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }, [events, tab])

  const send = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true); setSendErr(null)
    const r = await sendSessionText(s.id, text, { replyVia: noteReply ? 'note' : undefined })
    setSending(false)
    if (r.ok) { setDraft(''); load() }
    else setSendErr(r.error || t('mobile.sendFailed'))
  }

  // who a `sent` event came from: null = the human; a session id resolves to its live headline when the
  // sender is still on the board, else its short id.
  const fromLabel = (from) => {
    if (!from) return t('mobile.you')
    const peer = sessions.find((x) => x.id === from)
    return peer ? sessionHeadline(peer) : from.slice(0, 8)
  }

  // day-separated render list, oldest first (the wire order)
  const rows = []
  let lastDay = null
  for (const [i, e] of (events || []).entries()) {
    if (dayKey(e.ts) !== lastDay) { lastDay = dayKey(e.ts); rows.push(<div className="m-day" key={`d${i}`}>{dayOf(e.ts)}</div>) }
    if (e.kind === 'status') {
      const d = e.display || e.status
      rows.push(
        <div className="m-ev" key={i}>
          <div className="m-ev-head">
            <span className="m-ev-glyph" style={{ color: STATUS_COLOR[d] }}>{STATUS_GLYPH[d] || '·'}</span>
            <span className="m-ev-word" style={{ color: STATUS_COLOR[d] }}>{t(`status.${d}`)}</span>
            <span className="m-ev-time">{timeOf(e.ts)}</span>
          </div>
          {e.note && <div className="m-ev-note">{e.note}</div>}
        </div>,
      )
    } else {
      rows.push(
        <div className="m-ev m-ev-sent" key={i}>
          <div className="m-ev-head">
            <span className="m-ev-from">{fromLabel(e.from)}</span>
            <span className="m-ev-time">{timeOf(e.ts)}</span>
          </div>
          <div className="m-ev-text">{e.text}</div>
        </div>,
      )
    }
  }

  const offline = s.liveness === 'offline' || s.status === 'offline'
  return (
    <div className="m-sessdetail chat">
      <div className="m-sess-card">
        <div className="m-sess-meta">
          <span className="m-sess-name">{sessionHeadline(s)}</span>
          <span className="m-sess-status" style={{ color: STATUS_COLOR[s.status] }}>
            {t(`status.${s.status}`)}{s.merges ? ` · ×${s.merges}` : ''} · <span className="m-sess-id8">{s.id.slice(0, 8)}</span>
          </span>
        </div>
      </div>
      <div className="m-tabs">
        <button className={tab === 'chat' ? 'm-tab on' : 'm-tab'} onClick={() => setTab('chat')}>{t('mobile.timelineTab')}</button>
        <button className={tab === 'changes' ? 'm-tab on' : 'm-tab'} onClick={() => setTab('changes')}>{t('mobile.changing', { n: ops.length })}</button>
      </div>

      {tab === 'changes' ? (
        <div className="m-sess-changes">
          {ops.length === 0
            ? <div className="m-empty">{t('mobile.noChanges')}</div>
            : ops.map((op, i) => {
                const n = byId[op.nodeId]
                return (
                  <button key={i} className="m-row" disabled={!n} onClick={() => n && goToNode(op.nodeId)}>
                    <span className={`ov-mark ov-${op.op}`}>{GLYPH[op.op] || '•'}</span>
                    <span className="m-row-title">{n ? n.title : op.nodeId}</span>
                    {n && <span className="m-row-chev">›</span>}
                  </button>
                )
              })}
        </div>
      ) : (
        <>
          <div className="m-timeline" ref={scrollRef}>
            {detail?.prompt && (
              <details className="m-ev m-ev-prompt">
                <summary>{t('mobile.asked')}{s.created ? ` · ${dayOf(s.created)} ${timeOf(s.created)}` : ''}</summary>
                <div className="m-ev-text">{detail.prompt}</div>
              </details>
            )}
            {events === null
              ? <div className="m-empty">{t('hud.loading')}</div>
              : rows.length === 0 ? <div className="m-empty">{t('mobile.noEvents')}</div> : rows}
          </div>
          {offline && <div className="m-offline">{t('mobile.offlineHint')}</div>}
          {sendErr && <div className="m-senderr">{sendErr}</div>}
          <div className="m-composer">
            <button
              className={noteReply ? 'm-chip on' : 'm-chip'}
              onClick={() => setNoteReply((v) => !v)}
              title={t('mobile.noteReplyHint')}
            >{t('mobile.noteReply')}</button>
            <div className="m-composer-line">
              <textarea
                className="m-input"
                rows={1}
                placeholder={t('mobile.inputPlaceholder')}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <button className="m-send" disabled={!draft.trim() || sending} onClick={send}>{t('mobile.send')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// the sessions plane: the SAME list the desktop console sidebar renders — zone grouping, nesting forest
// with fold pods (RowLead), and the one shared avatar-less SessionRow face. Nothing mobile-flavored here
// beyond the touch-sized wrapper row.
function MobileSessions({ sessions, openId, setOpenId, byId, goToNode }) {
  const t = useT()
  const open = openId ? sessions.find((s) => s.id === openId) : null
  const { expanded, toggle } = useFold()
  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id)), [sessions, expanded])
  if (open) return <MobileSessionDetail s={open} sessions={sessions} byId={byId} goToNode={goToNode} />
  if (!sessions.length) return <div className="m-empty big">{t('mobile.noSessions')}</div>
  return (
    <div className="m-sesslist">
      {forest.map((it) => {
        if (it.type === 'zone') return <div className="m-zone" key={`z-${it.zone}`}>{t(`sessionZone.${it.zone}`)}</div>
        const s = it.s
        const lead = (it.expandable || it.depth)
          ? <RowLead guides={it.guides} expandable={it.expandable} expanded={it.expanded} rollup={it.rollup} kin={it.kin} onToggle={() => toggle(s.id)} />
          : null
        return (
          <button key={s.id} className="m-sess-row" onClick={() => setOpenId(s.id)}>
            <SessionRow s={s} locked={false} showAvatar={false} lead={lead} />
          </button>
        )
      })}
    </div>
  )
}

export default function MobileApp({ specs, sessions, project }) {
  const t = useT()
  const byId = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  const root = useMemo(() => specs.find((s) => !s.parent) || specs[0], [specs])
  // children index → a stable lookup the drill-down rows and the breadcrumb both read.
  const childrenOf = useMemo(() => {
    const m = {}
    specs.forEach((s) => { if (s.parent) (m[s.parent] ??= []).push(s) })
    return (id) => m[id] || []
  }, [specs])
  // the spine root→id, used to set the breadcrumb when jumping to an arbitrary node (a session's changed node).
  const spineOf = useMemo(() => (id) => {
    const out = []
    for (let cur = byId[id]; cur; cur = cur.parent ? byId[cur.parent] : null) out.unshift(cur.id)
    return out
  }, [byId])

  const [tab, setTab] = useState('specs')
  const [path, setPath] = useState(() => (root ? [root.id] : []))
  const [openSessionId, setOpenSessionId] = useState(null)

  // the 4s board poll can retire a node out from under us (merged/deleted); drop any breadcrumb id the
  // latest tree no longer has, and fall back to root, so a stale focus never blanks the screen.
  const validPath = path.filter((id) => byId[id])
  const curId = validPath[validPath.length - 1] || root?.id
  const cur = curId ? byId[curId] : null

  const pushChild = (id) => setPath((p) => [...p.filter((x) => byId[x]), id])
  const goToNode = (id) => { setPath(spineOf(id)); setOpenSessionId(null); setTab('specs') }
  const canBack = tab === 'specs' ? validPath.length > 1 : !!openSessionId
  const onBack = () => { if (tab === 'specs') setPath((p) => p.slice(0, -1)); else setOpenSessionId(null) }

  return (
    <div className="m-app">
      <header className="m-topbar">
        {canBack
          ? <button className="m-back" onClick={onBack} aria-label={t('mobile.back')}>‹</button>
          : <span className="m-back ghost" aria-hidden="true" />}
        <span className="m-brand">{project || 'SpexCode'}</span>
      </header>

      <main className="m-main">
        {tab === 'specs' ? (
          <div className="m-specs">
            <nav className="m-crumbs">
              {validPath.map((id, i) => (
                <span key={id} className="m-crumb">
                  {i > 0 && <span className="m-crumb-sep">›</span>}
                  <button
                    className={i === validPath.length - 1 ? 'm-crumb-btn cur' : 'm-crumb-btn'}
                    onClick={() => setPath(validPath.slice(0, i + 1))}
                  >
                    {byId[id].title}
                  </button>
                </span>
              ))}
            </nav>
            {cur && <MobileNode key={cur.id} node={cur} childrenOf={childrenOf} sessions={sessions} onOpenChild={pushChild} />}
          </div>
        ) : (
          <MobileSessions sessions={sessions} openId={openSessionId} setOpenId={setOpenSessionId} byId={byId} goToNode={goToNode} />
        )}
      </main>

      <nav className="m-tabbar">
        <button className={tab === 'specs' ? 'm-tabbar-btn on' : 'm-tabbar-btn'} onClick={() => setTab('specs')}>
          <span className="m-tabbar-ico">❯_</span>{t('mobile.specsTab')}
        </button>
        <button className={tab === 'sessions' ? 'm-tabbar-btn on' : 'm-tabbar-btn'} onClick={() => setTab('sessions')}>
          <span className="m-tabbar-ico">◐</span>{t('mobile.sessionsTab')}
          {sessions.length > 0 && <span className="m-tabbar-badge">{sessions.length}</span>}
        </button>
      </nav>
    </div>
  )
}
