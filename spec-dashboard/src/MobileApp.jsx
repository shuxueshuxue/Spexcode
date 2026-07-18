import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { Avatar } from './avatar.jsx'
import { STATUS } from './specMeta.js'
import { SpecPane, HistoryPane, IssuesPane, EditPane, EvalPane, useHistory, panesFor } from './NodeView.jsx'
import { SessionRow, RowLead, useFold } from './SessionWindow.jsx'
import { sessionHandle, sessionHeadline, sessionForest, STATUS_COLOR } from './session.js'
import TimelineChat from './TimelineChat.jsx'
import { createSession, useLaunchers } from './launch.js'
import { useT } from './i18n/index.jsx'

// the session's evaluation ([[session-eval]]) — the SAME pane the desktop console's Eval tab mounts,
// lazy so a phone that never opens it never downloads the eval component family.
const SessionEvalPane = lazy(() => import('./SessionEval.jsx'))

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
        {active === 'eval' && <EvalPane node={node} />}
        {active === 'edit' && <EditPane node={node} />}
      </div>
    </div>
  )
}

// @@@ the terminal-free conversation ([[session-timeline]]) — the phone's session detail, now a THIN
// wrapper: the chat body (timeline poll + board-push refresh + send-then-refresh, replyVia:'note' fixed)
// is TimelineChat. What stays here is the phone chrome: the identity card with its back control, and the header's one
// extra control that flips the detail to the session's evaluation ([[session-eval]] — the shared
// SessionEvalPane, restacked by CSS).
function MobileSessionDetail({ s, sessions, specs, onOpenSession, onBack }) {
  const t = useT()
  const [showEval, setShowEval] = useState(false)   // header eval entry: conversation ⇄ the session's evaluation
  useEffect(() => { setShowEval(false) }, [s.id])   // a fresh session always opens on its conversation

  return (
    <div className="m-sessdetail chat">
      <div className="m-sess-card">
        <button className="m-sess-back" onClick={onBack} aria-label={t('mobile.back')}>‹</button>
        <div className="m-sess-meta">
          <span className="m-sess-name">{sessionHeadline(s)}</span>
          <span className="m-sess-status" style={{ color: STATUS_COLOR[s.status] }}>
            {t(`status.${s.status}`)}{s.merges ? ` · ×${s.merges}` : ''} · <span className="m-sess-id8">{s.id.slice(0, 8)}</span>
          </span>
        </div>
        <button className={showEval ? 'm-sess-evalbtn on' : 'm-sess-evalbtn'} onClick={() => setShowEval((v) => !v)} title={t('sessionEval.btnTitle')}>
          {t('sessionEval.btn')}
        </button>
      </div>
      {showEval ? (
        <div className="m-eval-host">
          <Suspense fallback={<div className="m-empty">{t('common.loading')}</div>}>
            <SessionEvalPane sessionId={s.id} specs={specs} sessions={sessions} onOpenSession={onOpenSession} />
          </Suspense>
        </div>
      ) : (
        <TimelineChat s={s} sessions={sessions} />
      )}
    </div>
  )
}

// @@@ the phone's create entry — the desktop New Session tab's touch twin, all substance shared: the SAME
// launch path (./launch.js — raw grammar POST, launcher fetch + default resolution + the remembered
// per-browser launcher pick, the one POST /api/sessions; backend newSession invokes command presets for
// every caller). Only the chrome is phone-shaped: a full-screen composer (textarea + native launcher
// <select> + one launch button). Unlike the desktop's fire-in-the-background
// box (type-ready for the next launch at once), the phone AWAITS the create — the button reads busy while
// the backend builds worktree+branch+agent (seconds) — because busy-gating is also the double-tap guard a
// touch surface needs; success returns to the list, where the new session lands on the next board push.
function MobileNewSession({ draft, setDraft, onBack, onLaunched }) {
  const t = useT()
  const { launchers, launcher, pickLauncher } = useLaunchers()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const launch = async () => {
    const raw = draft.trim()
    if (!raw || busy) return
    setBusy(true); setErr(null)
    const r = await createSession(raw, launcher)
    setBusy(false)
    if (r.ok) { setDraft(''); onLaunched() }
    else setErr(r.error || t('mobile.launchFailed'))   // fail loud, keep the draft — same rule as the send composer
  }
  return (
    <div className="m-sessdetail m-new">
      <div className="m-sess-card">
        <button className="m-sess-back" onClick={onBack} aria-label={t('mobile.back')}>‹</button>
        <div className="m-sess-meta">
          <span className="m-sess-name">{t('mobile.newSession')}</span>
        </div>
      </div>
      <div className="m-new-body">
        <textarea
          className="m-input m-new-input"
          rows={5}
          placeholder={t('mobile.newPlaceholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        {launchers.length > 0 && (
          <label className="m-new-launcher">
            <span className="m-new-launcher-label">{t('session.launcherLabel')}</span>
            <select className="m-new-launcher-select" value={launcher} onChange={(e) => pickLauncher(e.target.value)}>
              {launchers.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </label>
        )}
        {err && <div className="m-senderr">{err}</div>}
        <button className="m-send m-new-go" disabled={!draft.trim() || busy} onClick={launch}>
          {busy ? t('mobile.launching') : t('mobile.launch')}
        </button>
      </div>
    </div>
  )
}

// the sessions plane: the SAME list the desktop console sidebar renders — zone grouping, nesting forest
// with fold pods (RowLead), and the one shared avatar-less SessionRow face. Nothing mobile-flavored here
// beyond the touch-sized wrapper row and the create entry above the list (its own screen, MobileNewSession).
function MobileSessions({ specs, sessions, openId, setOpenId, creating, setCreating, newDraft, setNewDraft }) {
  const t = useT()
  const open = openId ? sessions.find((s) => s.id === openId) : null
  const { expanded, toggle } = useFold()
  const forest = useMemo(() => sessionForest(sessions, (id) => expanded.has(id)), [sessions, expanded])
  if (creating) return <MobileNewSession draft={newDraft} setDraft={setNewDraft} onBack={() => setCreating(false)} onLaunched={() => setCreating(false)} />
  if (open) return <MobileSessionDetail s={open} sessions={sessions} specs={specs} onOpenSession={setOpenId} onBack={() => setOpenId(null)} />
  return (
    <div className="m-sesslist">
      <button className="m-new-btn" onClick={() => setCreating(true)}>
        <span className="m-new-btn-plus">＋</span>{t('mobile.newSession')}
      </button>
      {!sessions.length && <div className="m-empty big">{t('mobile.noSessions')}</div>}
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

export default function MobileApp({ specs, sessions }) {
  const t = useT()
  const byId = useMemo(() => Object.fromEntries(specs.map((s) => [s.id, s])), [specs])
  const root = useMemo(() => specs.find((s) => !s.parent) || specs[0], [specs])
  // children index → a stable lookup the drill-down rows and the breadcrumb both read.
  const childrenOf = useMemo(() => {
    const m = {}
    specs.forEach((s) => { if (s.parent) (m[s.parent] ??= []).push(s) })
    return (id) => m[id] || []
  }, [specs])
  const [tab, setTab] = useState('specs')
  const [path, setPath] = useState(() => (root ? [root.id] : []))
  const [openSessionId, setOpenSessionId] = useState(null)
  // the create composer's open flag + draft live HERE, not in the sessions plane — the plane unmounts on a
  // bottom-tab flip, and a half-typed launch prompt must survive a peek at the specs tab (the phone twin of
  // the desktop's per-tab draft cache).
  const [creating, setCreating] = useState(false)
  const [newDraft, setNewDraft] = useState('')

  // the 4s board poll can retire a node out from under us (merged/deleted); drop any breadcrumb id the
  // latest tree no longer has, and fall back to root, so a stale focus never blanks the screen.
  const validPath = path.filter((id) => byId[id])
  const curId = validPath[validPath.length - 1] || root?.id
  const cur = curId ? byId[curId] : null

  const pushChild = (id) => setPath((p) => [...p.filter((x) => byId[x]), id])

  // no top bar: the breadcrumb already navigates the spec drill-down upward, and the session detail
  // carries its own back control — a title row bought nothing but a lost content line.
  return (
    <div className="m-app">
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
          <MobileSessions specs={specs} sessions={sessions} openId={openSessionId} setOpenId={setOpenSessionId}
            creating={creating} setCreating={setCreating} newDraft={newDraft} setNewDraft={setNewDraft} />
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
