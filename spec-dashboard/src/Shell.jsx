import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import StatusBar, { useStatusItem } from './StatusBar.jsx'
import TabStrip, { placeLabel } from './TabStrip.jsx'
import Dock from './Dock.jsx'
import SpecSearch from './SpecSearch.jsx'
import ViewErrorBoundary from './ViewErrorBoundary.jsx'
import { useRoute, navigate, routeHash } from './route.js'
import { navigateAddress, routeAddress } from './address.js'
import { useT } from './i18n/index.jsx'
import { PaneProvider, useBoard, useWorkspace, useWorkspaceApi } from './workspace.jsx'
import { viewFor, viewRouteContract } from './views.jsx'
import { useResizable } from './useResizable.js'
import { Icon } from './icons.jsx'
import { IdentityIcon } from './IdentityIcon.jsx'
import { PROJECT_ID, hubHref, projectHref } from './project.js'
import { STATUS, STATUS_ORDER, summarizeBoard } from './specMeta.js'
import { ScoreBadge } from './score.jsx'
import { nextGraphStatNode } from './GraphStats.jsx'
import { sessionHeadline, sessionZone } from './session.js'
import ContextDock from './ContextDock.jsx'
import { useKeyboardScope } from './KeyboardService.jsx'
import { useEscLayer } from './escStack.js'
import { firesEvent, firesKey, withShortcut } from './bindings.js'
import { pinTab, runTabCommand } from './tabs.js'
import { useDocumentNames } from './documentActions.jsx'
import { useBackendHealth } from './BackendStatus.jsx'
import { useTransientNotice } from './TransientNotice.jsx'
import { useLaunchers } from './launch.js'
import { HARNESS_BY_ID } from './harness.jsx'
import Legend from './Legend.jsx'
import { ViewScopeProvider } from './ViewScope.jsx'
import { createViewScope } from './viewScope.js'

// [[workspace-shell]]: the frame. Rail, dock, tab strip, content area, status bar — and nothing else.
//
// It is deliberately ignorant: it does not know what a spec is, what a session is, or what any view needs.
// It knows there is an address, that an address names a view, and where on the screen that view goes. Every
// piece of knowledge it does not have is a piece a view could not previously own, because the component
// that held the frame also held every page's state.
//
// The shell is the ONLY component that reads the global address. A view receives its route as props, which
// is the rule that makes two-up possible later and that keeps a view from coupling to whichever address
// happens to be current.

// THE SIDEBAR IS A PROPERTY OF THE FOCUSED TAB ([[dock-modes]]) — which projection it shows, and whether
// it exists at all. Session documents derive sessions; nodes and governed files derive explorer. Review and
// settings surfaces have no sidebar, including their detail routes. `keep` is the third answer — graph,
// empty, and the bare sessions board have no opinion and preserve the current projection.
const dockFor = (page, param) => {
  // Review surfaces are full-width throughout their address family. A detail route must not inherit the
  // previous Spec/Explorer projection from workspace state; that state belongs only to document routes.
  if (page === 'issues' || page === 'evals') return 'none'
  if (page === 'settings') return 'none'
  // Sessions is a complete document surface: SessionInterface owns its forest/list and console. Keeping a
  // finding dock here (even with rows suppressed) leaves an empty dock header beside the same list.
  // Explorer is reached through the Spec/File/Graph surfaces, where it has an actual document to describe.
  if (page === 'sessions') return 'none'
  if (page === 'spec' || page === 'file') return 'explorer'
  return 'keep'
}

// WHAT COUNTS AS "THE SAME MOUNTED DOCUMENT". Most views are one per address. Two are one per PAGE,
// because they hold their object internally and re-mounting them per object throws away the very thing
// they exist to keep warm: the graph's camera and expansion are the workspace's state rather than one
// address's, and the session console holds every live terminal's socket and scrollback behind its own
// layers ([[session-console]]) — keying it per session id is what made every session switch a cold boot.
const POOL_PAGES = new Set(['graph', 'sessions'])
const poolKey = (page, param) => (POOL_PAGES.has(page) ? page : `${page}/${param ?? ''}`)
// How many documents stay mounted. Small enough that an idle workspace is idle, large enough that the tab
// strip's usual working set is entirely warm — a bound that fits the strip, not a guess about memory.
const POOL_LIMIT = 6
// mirrors --dur-panel in the stylesheet: the shell has to outlive the CSS animation by the same amount it
// lasts, and one of the two has to name the number.
const DOCK_ANIMATION_MS = 170

// Every mounted view gets one route scope. The shell is the only dispatcher: views can request an address,
// explicitly hold one in the second pane, or update their own query, but they cannot receive the raw navigate
// callback or write another host's route. Pooled panes keep the scope object and only update its route/active
// snapshot as they move between visible and hidden states.
function ViewScopeHost({ page, param, query, active, children }) {
  const { splitTo } = useWorkspaceApi()
  const dispatch = useCallback((intent) => {
    const { page: targetPage, param: targetParam, query: targetQuery } = intent.address
    if (intent.type === 'hold') {
      splitTo(intent.address)
      return { accepted: true, intent }
    }
    navigate(targetPage, targetParam, { query: targetQuery, replace: intent.replace === true })
    return { accepted: true, intent }
  }, [splitTo])
  const holder = useMemo(() => createViewScope({
    route: { page, param, query }, dispatch, active, contract: viewRouteContract,
    owner: { kind: 'view', page, param: param ?? null },
  }), []) // the shell updates this holder below; the public scope identity remains stable for the view
  useEffect(() => {
    holder.update({ route: { page, param, query }, active })
  }, [holder, page, param, query, active])
  return <ViewScopeProvider scope={holder.scope}>{children}</ViewScopeProvider>
}

// [[workspace-shell]]'s MOUNTED-DOCUMENT POOL. Switching tabs used to remount the document from scratch —
// every switch re-ran a view's whole boot, which is what "why does clicking a tab reload it" was naming.
// A pool keeps the recent documents mounted and shows one; the others are display-hidden, exactly as the
// session console has always kept its terminals ([[session-console]]'s warm layers). Nothing is unmounted
// until the pool is over its limit, and then the least recently shown one goes.
//
// RENDER ORDER IS INSERTION ORDER, never recency. Reordering keyed children moves real DOM nodes, and a
// moved node re-attaches its iframes and canvases — which is a reload wearing a different name. Recency
// lives in a counter used only to pick the victim.
function ViewPool({ page, param, query, inactive = false }) {
  const key = poolKey(page, param)
  const address = routeHash(page, param, query)
  const seq = useRef(0)
  const [pool, setPool] = useState(() => [{ key, address, page, param, query, seq: 0 }])
  useEffect(() => {
    setPool((prev) => {
      const stamp = ++seq.current
      const held = prev.find((entry) => entry.key === key)
      // an entry that is shown again takes the CURRENT route: a pool keyed by page (the console) is one
      // instance being handed a new object, which is the whole point of keying it that way.
      let next = held
        ? prev.map((entry) => (entry.key === key ? { ...entry, address, page, param, query, seq: stamp } : entry))
        : [...prev, { key, address, page, param, query, seq: stamp }]
      if (next.length > POOL_LIMIT) {
        const victim = next.reduce((oldest, entry) => (entry.seq < oldest.seq ? entry : oldest))
        next = next.filter((entry) => entry !== victim)
      }
      return next
    })
  }, [key, address])
  return pool.map((entry) => <PoolPane key={entry.key} entry={entry} showing={!inactive && entry.key === key} />)
}

// One mounted document. It is MEMOISED, and that is not a micro-optimization: the shell re-renders on
// every board push, and without this each push would re-render every document in the pool — the idle cost
// of a workspace would scale with how many tabs the reader keeps, which is the one thing a pool must not
// do. Pane props are stable between route changes, so a hidden pane re-renders only when it is shown or
// its address moves. Its other half is the frozen board a hidden pane reads ([[workspace-shell]]).
const PoolPane = memo(function PoolPane({ entry, showing }) {
  const t = useT()
  const { component: View, className } = viewFor(entry.page)
  const pane = useMemo(() => ({ address: entry.address, active: showing }), [entry.address, showing])
  return (
    <div className={`viewhost ${className}`} aria-hidden={showing ? undefined : 'true'}
      style={showing ? undefined : { display: 'none' }}>
      {/* the boundary wraps the whole host, Suspense included, so a lazy chunk that will not load is
          contained the same way a render that throws is. The address resets it: leaving a broken
          document is the reader's own recovery, and it must not need a reload. */}
      <ViewErrorBoundary resetKey={entry.address}>
        <PaneProvider value={pane}>
          <ViewScopeHost page={entry.page} param={entry.param} query={entry.query} active={showing}>
            <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
              <View param={entry.param} query={entry.query} />
            </Suspense>
          </ViewScopeHost>
        </PaneProvider>
      </ViewErrorBoundary>
    </div>
  )
})

// The SECOND pane is not a pool. It holds one document the reader deliberately sent there, so it is the
// one place where keying on the address is the whole contract — there is no browsing history to keep warm.
function ViewHost({ page, param, query, inactive = false }) {
  const t = useT()
  const { component: View, className } = viewFor(page)
  const address = routeHash(page, param, query)
  return (
    <div className={`viewhost ${className}`} aria-hidden={inactive ? 'true' : undefined}
      style={inactive ? { display: 'none' } : undefined}>
      <ViewErrorBoundary resetKey={address}>
        <PaneProvider value={{ address, active: !inactive }}>
          <ViewScopeHost page={page} param={param} query={query} active={!inactive}>
            <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
              <View key={poolKey(page, param)} param={param} query={query} />
            </Suspense>
          </ViewScopeHost>
        </PaneProvider>
      </ViewErrorBoundary>
    </div>
  )
}

// The shell's own status contribution: one project identity button and its existing catalog switcher.
// Project identity is ambient window state, so its one persistent door lives beside the other ambient
// facts. The rail is route/finding chrome and deliberately carries no duplicate project chip.
function ShellStatus() {
  const t = useT()
  const { identity, catalog } = useBoard()
  const [open, setOpen] = useState(false)
  useEscLayer(open, () => setOpen(false))
  const catalogOk = catalog?.state === 'ok'
  const denied = catalog?.state === 'denied'
  const projects = catalogOk ? catalog.projects : null
  const label = identity?.title || PROJECT_ID || 'spexcode'
  const triggerLabel = denied ? t('nav.projectChipLogin', { name: label }) : t('nav.projectChip', { name: label })

  useEffect(() => {
    if (!open) return
    const onDown = (event) => {
      if (!event.target.closest?.('[data-status-project], .status-project-menu')) setOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
    }
  }, [open])

  const triggerBody = (
    <>
      <IdentityIcon icon={identity?.icon} size={14} className="sb-project-mark" />
      <span className="sb-project-name">{label}</span>
    </>
  )
  const trigger = projects ? (
    <button type="button" className={open ? 'sb-project-trigger open' : 'sb-project-trigger'}
      data-status-project="" data-tip={triggerLabel} aria-label={triggerLabel}
      aria-haspopup="menu" aria-expanded={open}
      aria-controls={open ? 'status-project-menu' : undefined}
      onClick={() => setOpen((value) => !value)}>
      {triggerBody}
    </button>
  ) : (
    <a className="sb-project-trigger" data-status-project="" data-tip={triggerLabel}
      aria-label={triggerLabel} href={hubHref()}>{triggerBody}</a>
  )

  const menu = open && projects ? (
    <div id="status-project-menu" className="proj-menu status-project-menu" role="menu"
      onContextMenu={(event) => event.stopPropagation()}>
      {projects.map((project) => {
        const offline = project.online === false
        const current = project.id === PROJECT_ID
        const state = offline ? t('nav.projectOffline') : project.online === true ? t('nav.projectOnline') : null
        const className = `proj-menu-item${current ? ' current' : ''}${offline ? ' offline' : ''}`
        const content = (
          <>
            <IdentityIcon icon={project.identity.icon} size={16} className="proj-menu-mark" />
            {project.gated && <Icon name="lock" size={11} />}
            <span className="proj-menu-name">{project.identity.title}</span>
            {state && <span className={`proj-menu-status ${offline ? 'offline' : 'online'}`} aria-hidden="true">{state}</span>}
            {current && <Icon name="check" size={12} />}
          </>
        )
        return offline
          ? <div key={project.id} role="menuitem" aria-disabled="true" className={className}>{content}</div>
          : <a key={project.id} role="menuitem" className={className} href={projectHref(project.id)}>{content}</a>
      })}
      <a role="menuitem" className="proj-menu-item all" href={hubHref()}>
        <IdentityIcon icon={catalog.gateway.identity?.icon} fallback="gateway" size={16} className="proj-menu-mark" />
        <span className="proj-menu-name">{t('nav.allProjects')}</span>
      </a>
    </div>
  ) : null

  // The menu is part of the registered slot so its absolute position is relative to the trigger itself.
  useStatusItem({
    id: 'project', side: 'left', priority: 1000, kind: 'prominent', overflow: open,
    node: <span className="sb-project-slot">{trigger}{menu}</span>,
  })
  return null
}

const SCORE_VIEW = [
  { state: 'pass', always: true, titleKey: 'scorePass' },
  { state: 'fail', always: true, titleKey: 'scoreFail' },
  { state: 'stalePass', titleKey: 'scoreStalePass' },
  { state: 'staleFail', titleKey: 'scoreStaleFail' },
  { state: 'empty', titleKey: 'scoreEmpty' },
]

function BoardStat({ name, count, title, onClick, children }) {
  return (
    <button type="button" className="sb-tally-button" data-board-stat={name} data-tip={title}
      aria-label={title} disabled={!onClick} onClick={onClick}>
      {children}{count}
    </button>
  )
}

const storedGraphFocus = () => {
  try { return sessionStorage.getItem('spex.focus') } catch { return null }
}

// The BOARD's own numbers, as ambient state.
//
// They used to hang off the graph, so the moment the graph stopped being where a reader lands, the window
// stopped saying how the work was doing at all — a status bar with one item on it, which is a band that
// says nothing. These four are true of the WORKSPACE rather than of whichever document is open, and each
// one is a door to the board that can act on it: nodes → the graph, the eval verdicts → the evals list,
// open issues → the issues list, the live sessions → the sessions console.
//
// Restraint is the point: the resting state is muted text and the board's own status dots, and an item
// spends a `kind` colour ONLY where a number is asking for something — a failing eval, a session waiting
// on a human. A count that is merely large stays quiet.
//
// This is the only ledger on every route, graph included. On the graph its category buttons reuse
// [[graph-stats]]'s walk; elsewhere issue/eval buttons keep opening their boards, while node categories
// enter the graph already focused on the first node they count.
function LauncherSessionTally({ launcher, sessions, onOpen, tooltip }) {
  const harnessId = launcher.harness?.replace(/-headless$/, '') || 'claude'
  const harness = HARNESS_BY_ID[launcher.harness] || HARNESS_BY_ID[harnessId] || HARNESS_BY_ID.claude
  const Glyph = harness.Glyph
  const counts = sessions.reduce((result, session) => {
    const zone = sessionZone(session)
    if (zone === 'run') result.running += 1
    else if (zone === 'need') result.needsYou += 1
    else result.other += 1
    return result
  }, { running: 0, needsYou: 0, other: 0 })
  return (
    <button type="button" className="sb-launcher-group" data-launcher={launcher.name}
      data-tip={tooltip} aria-label={tooltip} onClick={onOpen}>
      <span className="sb-launcher-glyph" aria-hidden="true">
        <Glyph />
      </span>
      <span className="sb-launcher-name">{launcher.name}</span>
      <span className="sb-launcher-counts" aria-hidden="true">
        <span className="sb-launcher-running">{counts.running}</span>
        <span className="sb-launcher-slash">/</span>
        <span className="sb-launcher-needs">{counts.needsYou}</span>
        <span className="sb-launcher-slash">/</span>
        <span className="sb-launcher-other">{counts.other}</span>
      </span>
    </button>
  )
}

function LauncherSessionSummary({ launchers, sessions, onOpen, tooltip }) {
  if (!sessions.length) return null
  const counts = sessions.reduce((result, session) => {
    const zone = sessionZone(session)
    if (zone === 'run') result.running += 1
    else if (zone === 'need') result.needsYou += 1
    else result.other += 1
    return result
  }, { running: 0, needsYou: 0, other: 0 })
  return (
    <button type="button" className="sb-launcher-summary" data-launcher-summary={launchers.map((l) => l.name).join(',')}
      data-tip={tooltip} aria-label={tooltip} onClick={onOpen}>
      <span className="sb-launcher-summary-mark" aria-hidden="true">{launchers.length}</span>
      <span className="sb-launcher-counts" aria-hidden="true">
        <span className="sb-launcher-running">{counts.running}</span>
        <span className="sb-launcher-slash">/</span>
        <span className="sb-launcher-needs">{counts.needsYou}</span>
        <span className="sb-launcher-slash">/</span>
        <span className="sb-launcher-other">{counts.other}</span>
      </span>
    </button>
  )
}

function launcherSessionGroups(launchers, sessions) {
  const configured = (launchers || []).filter((launcher) =>
    (sessions || []).some((session) => session.launcher === launcher.name))
    .map((launcher) => ({ ...launcher, sessions: sessions.filter((session) => session.launcher === launcher.name) }))
  const known = new Set((launchers || []).map((launcher) => launcher.name))
  const unmatched = (sessions || []).filter((session) => !known.has(session.launcher))
  return unmatched.length ? [...configured, { name: 'other', harness: 'claude', sessions: unmatched }] : configured
}

function BoardStatus({ specs, sessions, page }) {
  const t = useT()
  const { offline } = useBackendHealth()
  const { launchers } = useLaunchers()
  const launcherGroups = useMemo(() => launcherSessionGroups(launchers, sessions || []), [launchers, sessions])
  const needsYou = useMemo(() => (sessions || []).filter((session) => sessionZone(session) === 'need').length, [sessions])
  const stale = offline ? <span className="sb-stale" aria-label={t('backend.stale')} data-tip={t('backend.stale')} /> : null
  const tally = useMemo(() => summarizeBoard(specs || []), [specs])
  // whose turn is it — the same `need`/`run` partition the finding dock groups its rows by, not a second
  // idea of "live" invented for the bar.
  const { fail } = tally.scoreCount
  const walkGraph = (ids) => {
    const id = nextGraphStatNode(ids, storedGraphFocus())
    if (id) navigate('graph', id, { replace: page === 'graph' })
  }
  const graphOrBoard = (ids, board) => (ids.length
    ? (page === 'graph' ? () => walkGraph(ids) : () => navigate(board))
    : null)

  useStatusItem({
    id: 'ledger-nodes', side: 'right', priority: 41,
    tooltip: t('statusBar.nodes', { n: tally.total }),
    node: (
      <span className="sb-tally">
        <button type="button" className="sb-tally-button sb-tally-lead" data-board-stat="nodes-total"
          data-tip={t('stats.totalTitle', { n: tally.total })} aria-label={t('stats.totalTitle', { n: tally.total })}
          onClick={() => navigate('graph')}>{tally.total}</button>
        {STATUS_ORDER.map((k) => (
          <BoardStat key={k} name={`status-${k}`} count={tally.status[k].length}
            onClick={tally.status[k].length ? () => walkGraph(tally.status[k]) : null}
            title={t('stats.statusTitle', { n: tally.status[k].length, status: t(`status.${k}`) })}>
            <i className="sb-status-dot" style={{ background: STATUS[k].color }} />
          </BoardStat>
        ))}
        <span className="sb-tally-sep" />
        <BoardStat name="drift" count={tally.driftIds.length}
          onClick={tally.driftIds.length ? () => walkGraph(tally.driftIds) : null}
          title={t('stats.driftTitle', { n: tally.driftIds.length })}><Icon name="triangle-alert" size={13} /></BoardStat>
        {stale}
      </span>
    ),
  })
  useStatusItem({
    id: 'ledger-evals', side: 'right', priority: 42,
    kind: fail > 0 ? 'error' : undefined,
    tooltip: t('statusBar.evals', tally.scoreCount),
    node: (
      <span className="sb-tally">
        {SCORE_VIEW.map(({ state, always, titleKey }) => {
          const count = tally.scoreCount[state]
          if (!count && !always) return null
          return (
            <BoardStat key={state} name={`eval-${state}`} count={count}
              onClick={graphOrBoard(tally.scoreNodes[state], 'evals')}
              title={page === 'graph'
                ? t(`stats.${titleKey}`, { n: count })
                : `${t(`score.${state}`)} · ${t('statusBar.openEvals')}`}>
              <ScoreBadge state={state} />
            </BoardStat>
          )
        })}
        {stale}
      </span>
    ),
  })
  useStatusItem({
    id: 'ledger-issues', side: 'right', priority: 43,
    tooltip: t('statusBar.issues', { n: tally.issueCount }),
    node: <span className="sb-tally"><BoardStat name="issues" count={tally.issueCount}
      onClick={graphOrBoard(tally.issueIds, 'issues')}
      title={page === 'graph'
        ? t('stats.issueTitle', { n: tally.issueCount })
        : t('statusBar.issues', { n: tally.issueCount })}><Icon name="issue-opened" size={13} /></BoardStat>{stale}</span>,
  })
  useStatusItem({
    id: 'ledger-sessions', side: 'right', priority: 44,
    kind: needsYou > 0 ? 'warning' : undefined,
    tooltip: t('statusBar.sessions'),
    node: (
      <span className="sb-launcher-groups">
        <span className="sb-launcher-list">
          {launcherGroups.map((launcher) => {
            return <LauncherSessionTally key={launcher.name} launcher={launcher} sessions={launcher.sessions}
              tooltip={t('statusBar.launcher', { name: launcher.name })} onOpen={() => navigate('sessions')} />
          })}
        </span>
        <LauncherSessionSummary launchers={launcherGroups} sessions={sessions || []} onOpen={() => navigate('sessions')}
          tooltip={t('statusBar.launcherSummary', { n: launcherGroups.length })} />
        {stale}
      </span>
    ),
  })
  return null
}

// One view, or two. The second is a second route and a place to put it — nothing in any view changes,
// because a view was already receiving its route rather than reading it. That is the whole return on the
// hinge: two-up stopped being a rewrite and became a layout.
function Content({ page, param, query, inactive = false }) {
  const t = useT()
  const { split } = useWorkspace()
  const { closeSplit } = useWorkspaceApi()
  const [width, onDrag, reset] = useResizable('spex.splitWidth', 620, { min: 320, max: 1400, dir: -1 })
  if (!split) return <ViewPool page={page} param={param} query={query} inactive={inactive} />
  return (
    <div className="content-split">
      <ViewHost page={page} param={param} query={query} inactive={inactive} />
      <div className="content-divider" onMouseDown={onDrag} onDoubleClick={reset}
        role="separator" aria-orientation="vertical" />
      <div className="content-second" style={{ width }}>
        <button type="button" className="content-close" onClick={closeSplit} aria-label={t('tabs.close')}>
          <Icon name="x" size={12} />
        </button>
        <ViewHost page={split.page} param={split.param} query={split.query} inactive={inactive} />
      </div>
    </div>
  )
}

function ContextToggle({ visible, onToggle }) {
  const t = useT()
  const label = withShortcut(t(visible ? 'contextDock.close' : 'contextDock.open'), 'shell.contextToggle')
  return <button type="button" className={`context-toggle${visible ? ' on' : ''}`} onClick={onToggle}
    aria-label={label} data-tip={label}>
    <Icon name="list-checks" size={14} />
  </button>
}

export default function Shell({ routeOverride = null, inactive = false }) {
  const t = useT()
  const route = useRoute()
  const { page, param, query } = routeOverride || route
  const { specs, sessions, identity, graphOnly } = useBoard()
  const { notify } = useTransientNotice()
  const previousSessionStatus = useRef(null)
  const needsYou = useMemo(() => (sessions || []).filter((session) => sessionZone(session) === 'need').length, [sessions])
  useEffect(() => {
    const previous = previousSessionStatus.current
    previousSessionStatus.current = new Map((sessions || []).map((session) => [session.id, session.status]))
    if (!previous) return
    for (const session of sessions || []) {
      if (session.status !== 'asking' || previous.get(session.id) === 'asking') continue
      notify(`${sessionHeadline(session)} · ${t('status.asking')}`, {
        kind: 'info',
        onClick: () => navigate('sessions', session.id),
      })
    }
  }, [sessions, notify, t])
  const documentNames = useDocumentNames()
  const { dock, dockMode, palette, helpOpen } = useWorkspace()
  const { closePalette, openPalette, toggleHelp, closeHelp, setDock, setDockMode, splitTo } = useWorkspaceApi()
  useStatusItem({ id: 'help', side: 'left', priority: -Infinity, text: '?',
    tooltip: withShortcut(t('hud.helpTitle'), 'graph.help'), onClick: toggleHelp })
  // THE CONTEXT DOCK STARTS CLOSED, and that is a measurement rather than a taste. At 1440 with the
  // explorer docked, opening it leaves the spec prose 383px — under a readable measure, and it takes the
  // width out of the one column that was already scarce (the code column gives up 84px too). Closed, the
  // same document reads at 575px. Context is a question the reader ASKS about the node they are reading; it
  // is not the reading itself, so it does not get to spend the reading's width until it is asked for. The
  // toggle is one click away in the strip and the choice persists, so a reader who wants it always open has
  // it always open — what changed is only what an unopinionated window looks like ([[context-dock]]).
  const [contextOpen, setContextOpen] = useState(() => {
    try { return localStorage.getItem('spexcode.ctxOpen') === '1' } catch { return false }
  })
  const toggleContext = () => setContextOpen((value) => {
    const next = !value
    try { localStorage.setItem('spexcode.ctxOpen', next ? '1' : '0') } catch {}
    return next
  })

  // THE DOCK FOLLOWS THE FOCUSED TAB. The projection is derived from what the reader is holding, not
  // chosen once and left behind: moving to a session tab brings the session list, moving to a node or a
  // governed file brings the explorer, and a sidebar-less board renders no dock at all. A rail click still
  // selects a projection by hand — that override simply lasts until the reader moves to another DOCUMENT,
  // which is what makes it an override rather than a second setting. The effect is keyed on the document,
  // not the address, so switching a session's own face is not a focus change.
  const dockKind = dockFor(page, param)
  // THE RAIL'S FOLD CONTROL EXISTS WHEREVER THERE IS A SIDEBAR TO FOLD ([[side-nav]]). The shell's dock is
  // one such sidebar; the Sessions document's own forest is the other and follows the same open/closed
  // state — so the bare review and settings boards, which have neither, are the only frames without it.
  const foldable = dockKind !== 'none' || page === 'sessions'
  const documentKey = `${page}/${param ?? ''}`
  // Closing is a MOVEMENT, so the dock outlives the state that hides it by exactly one panel duration and
  // slides out ([[dock-modes]]). One timer, cleared on reopen; the reader can never end up with a ghost
  // panel, because the flag only ever survives its own timeout.
  const [closingDock, setClosingDock] = useState(false)
  const wasDocked = useRef(dock)
  useEffect(() => {
    if (wasDocked.current === dock) return undefined
    wasDocked.current = dock
    if (dock) { setClosingDock(false); return undefined }
    setClosingDock(true)
    const timer = setTimeout(() => setClosingDock(false), DOCK_ANIMATION_MS)
    return () => clearTimeout(timer)
  }, [dock])
  useEffect(() => {
    if (dockKind === 'sessions' || dockKind === 'explorer') setDockMode(dockKind)
  }, [documentKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // The browser tab is a positioning signal, not a brand plate. The shell is the only component that reads
  // the address, so it is the only one that can say WHERE the reader is; the project keeps the suffix, so a
  // window still says which workspace it belongs to when several are open side by side.
  const place = placeLabel({ page, param, query }, { specs, sessions, names: documentNames, t })
  useEffect(() => {
    document.title = `${needsYou > 0 ? `(${needsYou}) ` : ''}${place} · ${identity?.title || 'spexcode'}`
  }, [place, identity?.title, needsYou])

  const onShellKey = useCallback((event) => {
    if (inactive) return false
    // A palette is a true overlay. Escape closes it here; all other keys remain available to its input.
    if (palette) {
      if (event.key === 'Escape') { event.preventDefault(); closePalette(); return true }
      return false
    }
    if (helpOpen) {
      if (event.key === 'Escape' || (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.help', event.key))) {
        event.preventDefault(); closeHelp(); return true
      }
      if (event.key === 'j' || event.key === 'k' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const body = document.querySelector('.legend-body')
        if (body) body.scrollTop += (event.key === 'j' || event.key === 'ArrowDown' ? 120 : -120)
        return true
      }
      return true
    }
    if ((event.key === 'Enter' || event.key === ' ') && event.target?.closest?.('button, a[href], input, select, textarea, summary')) return false
    // Help is shell chrome, not a graph-only action. Native typing contexts still own a literal '?'.
    if (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.help', event.key)) {
      event.preventDefault(); closePalette(); toggleHelp(); return true
    }
    if (event.altKey && !event.metaKey && !event.ctrlKey) {
      if (!graphOnly && firesEvent('shell.newSession', event)) { event.preventDefault(); navigate('sessions', 'new'); return true }
      if (!graphOnly && firesEvent('shell.evals', event)) { event.preventDefault(); closePalette(); navigate('evals'); return true }
      // the ⌥ chord is the door that survives a TYPING context, and in this workspace a typing context is a
      // session console: `/` above is swallowed by the composer and xterm's helper, exactly as the
      // native-control restraint requires. So it stays session-scoped — that is where it is reachable from.
      if (!graphOnly && firesEvent('shell.search', event)) { event.preventDefault(); openPalette('sessions'); return true }
    }
    if (firesEvent('shell.dockToggle', event)) { event.preventDefault(); setDock((value) => !value); return true }
    if (firesEvent('shell.dockMode', event)) { event.preventDefault(); setDockMode(dockMode === 'explorer' ? 'sessions' : 'explorer'); return true }
    if (!graphOnly && firesEvent('shell.contextToggle', event)) { event.preventDefault(); toggleContext(); return true }
    if (!graphOnly && firesEvent('shell.tabClose', event)) { event.preventDefault(); runTabCommand('closeActive'); return true }
    if (!graphOnly && firesEvent('shell.tabNext', event)) { event.preventDefault(); runTabCommand('move', 1); return true }
    if (!graphOnly && firesEvent('shell.tabPrevious', event)) { event.preventDefault(); runTabCommand('move', -1); return true }
    if (!graphOnly && firesEvent('shell.tabHold', event)) { event.preventDefault(); runTabCommand('hold'); return true }
    if (!graphOnly && firesEvent('shell.tabSplit', event)) {
      event.preventDefault(); const active = runTabCommand('active'); if (active) splitTo(active); return true
    }
    // Settings is a shell destination even when the graph view is not mounted. The graph keeps its own
    // rebindable slash/info verbs; this global fallback is what restores comma on every routed surface.
    // Leaving settings lands on sessions — the workspace's daily face, and the same place an unknown
    // address resolves to now that the graph is only an address ([[node-graph]]).
    if (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.settings', event.key)) {
      event.preventDefault()
      if (page === 'settings') navigate('sessions'); else navigate('settings')
      return true
    }
    // `/` IS THE KEYBOARD TWIN OF THE DOCK HEAD'S SEARCH BUTTON, so it opens the palette on the same plane
    // that head would: the projection in force decides. A document that names its own projection (a session,
    // a node, a governed file) answers for itself; a board that has no dock defers to the projection last in
    // force, which is the same thing the dock does when it stops following ([[dock-modes]]).
    if (!event.altKey && !event.ctrlKey && !event.metaKey && firesKey('graph.search', event.key)) {
      event.preventDefault()
      const scope = dockKind === 'sessions' || dockKind === 'explorer' ? dockKind : dockMode
      openPalette(scope === 'sessions' ? 'sessions' : 'nodes')
      return true
    }
    return false
  }, [closeHelp, closePalette, dockKind, dockMode, graphOnly, helpOpen, inactive, openPalette, page, palette, setDock, setDockMode, splitTo, toggleHelp, contextOpen])
  useKeyboardScope(onShellKey, inactive ? -1000 : -100)

  // A review surface keeps the workspace document pool warm, but its chrome must not exist in the review
  // tree at all. Keep only the inactive content pool and the ambient ledger registrations; this prevents
  // DOM queries and accessibility trees from seeing a second rail, dock, or tab strip.
  if (inactive) {
    return (
      <div style={{ display: 'none' }} aria-hidden="true">
        <Content page={page} param={param} query={query} inactive />
        <ShellStatus />
        <BoardStatus specs={specs} sessions={sessions} page={page} />
      </div>
    )
  }

  // The public artifact is one sealed reading surface: no dock, no tabs, no palette, one view.
  if (graphOnly) {
    return (
      <div className="app-shell">
        <div className="app">
          <TooltipLayer />
          <SideBar page="graph" graphOnly />
          <div className="app-main"><ViewHost page="graph" param={param} query={query} /></div>
        </div>
        <StatusBar />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="app">
        <TooltipLayer />
        {helpOpen && <Legend onClose={closeHelp} />}
        <SideBar page={page} needsYou={needsYou} hideDockToggle={!foldable} />
        {(dock || closingDock) && dockKind !== 'none' && (
          <ViewErrorBoundary resetKey="dock">
            <Dock closing={closingDock} mode={dockMode} specs={specs} sessions={sessions}
              focusId={page === 'spec' ? param : null} activeSessionId={page === 'sessions' ? param : null}
              suppressSessionRows={page === 'sessions'} />
          </ViewErrorBoundary>
        )}
        <div className="app-content-column">
          <div className="app-content-row">
            <div className="app-main">
              {/* the strip IS the band — it used to be wrapped in a spacer that stood in for it on every route
                  without an open document, which is one band wearing two names. The context toggle is a control
                  on the current document, so it rides the strip's own trailing cluster. */}
              {page !== 'sessions' && <TabStrip specs={specs} sessions={sessions} route={{ page, param, query }}
                trailing={page === 'spec' ? <ContextToggle visible={contextOpen} onToggle={toggleContext} /> : null} />}
              <Content page={page} param={param} query={query} inactive={inactive} />
            </div>
            <ContextDock page={page} param={param} open={contextOpen} onToggle={toggleContext} />
          </div>
          <ShellStatus />
          <BoardStatus specs={specs} sessions={sessions} page={page} />
        </div>
      </div>
      <StatusBar />
      {/* the one shared palette: it floats above whichever view is showing, so it is the shell's. A view
          being hidden must never be able to swallow it — the reason it was hoisted here in the first place. */}
      {palette && (
        <SpecSearch specs={specs} sessions={sessions} boost={palette === 'sessions' ? 'session' : null}
          onClose={closePalette}
          onPick={(hit, options) => {
            closePalette()
            if (!options?.hold) return navigateAddress(hit?.address)
            const held = routeAddress(hit?.address)
            pinTab(held.page, held.param, held.query)
          }} />
      )}
      <span className="sr-only">{t('nav.railLabel')}</span>
    </div>
  )
}
