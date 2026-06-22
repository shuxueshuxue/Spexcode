import { useEffect, useMemo, useState } from 'react'
import { Avatar } from './avatar.jsx'
import { STATUS, GLYPH } from './SpecNode.jsx'
import { SpecPane, HistoryPane, IssuesPane, EditPane, useHistory, panesFor } from './NodeView.jsx'
import { SessionRow } from './SessionWindow.jsx'
import { sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

// @@@ MobileApp - the touch-first face of the SAME board the desktop renders. The desktop's spec GRAPH
// (a zoomable React Flow canvas walked with hjkl) and its xterm console are mouse/keyboard instruments a
// thumb can't play; here the tree becomes a native drill-DOWN (breadcrumb + tap-to-descend rows) and the
// node's reading panes (spec/history/issues/edit) are the EXACT same components NodeView renders — no
// second markdown/diff renderer, one source of truth for content. It is read-first: it shows what the
// tree and the live sessions are doing. Launching work and streaming a session's console (xterm sizing +
// input on a phone) are a deliberately separate, heavier scope, not folded in here.

// the desktop pane keys → their localized tab labels (panesFor hands back English labels; we relabel so
// the mobile tabs read in the active language like the rest of the UI).
const PANE_T = { spec: 'nodeView.paneSpec', history: 'nodeView.paneHistory', issues: 'nodeView.paneIssues', edit: 'nodeView.paneEdit' }

// live sessions whose pending ops touch this node = its live editors (mirror of App.jsx's liveEditorsOf —
// a node never "belongs" to a session; the live link is the overlay, the set currently changing it).
const editorsOf = (node, sessions) => sessions.filter((s) => s.ops?.some((op) => op.nodeId === node.id))

function StatusDot({ status }) {
  const s = STATUS[status] || STATUS.pending
  return <span className="m-dot" style={{ background: s.color }} />
}

// @@@ NodeRow - one tappable spec-tree row in the drill-down list. The mobile parallel of a graph node's
// first line: status dot · title · live-editor faces · version · a ▸N count when it has a hidden subtree.
// Every row drills (tapping opens THAT node's detail), so a leaf and a branch tap the same way — the ▸N is
// the only thing that says "there's more below".
function NodeRow({ node, kids, editors, onTap }) {
  return (
    <button className="m-row" onClick={onTap}>
      <StatusDot status={node.status} />
      <span className="m-row-title">{node.title}</span>
      {editors.length > 0 && (
        <span className="m-row-faces">
          {editors.slice(0, 3).map((e) => <Avatar key={e.id} seed={e.id} status={e.status} title={sessionName(e)} />)}
        </span>
      )}
      {node.version ? <span className="m-row-ver">v{node.version}</span> : null}
      {kids > 0 && <span className="m-row-kids">▸{kids}</span>}
      <span className="m-row-chev">›</span>
    </button>
  )
}

// @@@ MobileNode - the per-node detail screen: a compact sticky header (dot · title · status · version ·
// live faces) over a segmented control. `children` leads when the node has any (a branch opens to its
// subtree, the drill-down's core gesture); the rest are the SAME panes the desktop popup shows. The pane
// is the single scroller — except `history`, whose own .pane-hist owns the scroll for its progressive
// version reveal (so the host steps aside via `.fixed`). Keyed by node id from MobileApp, so useHistory
// re-fetches per node and `pane` resets to the first tab on every fresh screen.
function MobileNode({ node, childrenOf, sessions, onOpenChild }) {
  const t = useT()
  const rows = useHistory(node.id)
  const kids = childrenOf(node.id)
  const base = panesFor(node)   // [edit?, spec, history, issues] — edit leads only when a change is in flight
  const tabs = [
    ...(kids.length ? [{ key: 'children', label: t('mobile.childrenTab', { n: kids.length }) }] : []),
    ...base.map((p) => ({ key: p.key, label: t(PANE_T[p.key]) })),
  ]
  const [pane, setPane] = useState(null)
  useEffect(() => { setPane(null) }, [node.id])   // a fresh screen always opens on its first tab
  const active = pane && tabs.some((p) => p.key === pane) ? pane : tabs[0].key
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
            {editors.map((e) => <Avatar key={e.id} seed={e.id} status={e.status} title={sessionName(e)} />)}
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

// @@@ MobileSessions - the Sessions tab: the list reuses the SAME SessionRow face the desktop window/board
// draw, so a session reads identically across surfaces. Tapping one opens its detail — status, the worker's
// rolling activity line, and the nodes it is CHANGING (its overlay ops). Each changing-node row crosses back
// into the Specs tab focused on that node (goToNode), the touch parallel of the desktop's lock→cycle.
function MobileSessions({ sessions, openId, setOpenId, byId, goToNode }) {
  const t = useT()
  const open = openId ? sessions.find((s) => s.id === openId) : null
  if (open) {
    const ops = open.ops || []
    return (
      <div className="m-sessdetail">
        <div className="m-sess-card">
          <Avatar seed={open.id} status={open.status} />
          <div className="m-sess-meta">
            <span className="m-sess-name">{sessionName(open)}</span>
            <span className="m-sess-status">{t(`status.${open.status}`)}</span>
          </div>
        </div>
        {open.activity && <div className="m-sess-activity">{open.activity}</div>}
        <div className="m-sess-section">{t('mobile.changing', { n: ops.length })}</div>
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
    )
  }
  if (!sessions.length) return <div className="m-empty big">{t('mobile.noSessions')}</div>
  return (
    <div className="m-sesslist">
      {sessions.map((s) => (
        <button key={s.id} className="m-sess-row" onClick={() => setOpenId(s.id)}>
          <SessionRow s={s} locked={false} />
        </button>
      ))}
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
