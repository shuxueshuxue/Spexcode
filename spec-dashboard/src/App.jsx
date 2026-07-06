import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { loadBoard, subscribeBoardLive, loadIssues, projectTitle, projectIcon, faviconHref } from './data.js'
import { useIsMobile } from './useIsMobile.js'
import { useT } from './i18n/index.jsx'

// the two faces are code-split so each downloads only its own world: the desktop tree carries xyflow (and,
// via its own lazy leaves, xterm + the annotator); the phone face ([[mobile-ui]]) carries none of them.
// Which chunk loads is the same viewport-width pick as ever — the split only moves bytes, never behaviour.
const Dashboard = lazy(() => import('./Dashboard.jsx'))
const MobileApp = lazy(() => import('./MobileApp.jsx'))

export default function App() {
  const t = useT()
  const isMobile = useIsMobile()
  const [board, setBoard] = useState(null)
  // fail loudly at boot: a board that never arrives (backend down / proxy dead) shows an error + retry
  // panel, never an eternal spinner. Only the pre-first-board window reads this — once a board has landed,
  // a failed refetch keeps the last good board and the poll/stream keep retrying on their own.
  const [loadFailed, setLoadFailed] = useState(false)
  // the issues list is RESIDENT beside the board (one data path — the issues page renders instantly from
  // app-held state instead of cold-fetching per mount). Freshness inherits the board's own pattern: a
  // push/change signal triggers a throttled refetch, the 15s cold lane backstops (forge-cache updates
  // arrive nowhere else), and the route answers 304 via ETag so a no-change refetch costs headers only.
  const [issuesData, setIssuesData] = useState(null)
  const issuesSeq = useRef(0)
  const issuesLast = useRef(0)
  const reloadIssues = useCallback((force = false) => {
    const now = Date.now()
    if (!force && now - issuesLast.current < 5000) return Promise.resolve()
    issuesLast.current = now
    const mine = ++issuesSeq.current
    return loadIssues().then((d) => { if (mine === issuesSeq.current) setIssuesData(d) }).catch(() => {})
  }, [])
  // freshest-issued wins: stamp each load with a monotonic seq and apply only the latest, so a stale in-flight poll can't resurrect removed state
  const reqSeq = useRef(0)
  const reload = useCallback(() => {
    const mine = ++reqSeq.current
    return loadBoard()
      .then((b) => { if (mine === reqSeq.current) { setLoadFailed(false); setBoard(b) } })
      .catch(() => { if (mine === reqSeq.current) setLoadFailed(true) })
  }, [])
  // push-first freshness ([[board-stream]]/[[board-delta]]): the delta stream carries whole boards (a full on
  // connect, then applied patches) straight into setBoard — no refetch per change. A pushed board is the
  // freshest by channel order, so it bumps the seq to invalidate any older in-flight fetch. The interval is
  // the cold FALLBACK: it stands down while push is proven alive (the server cold-ticks for us then) and
  // stands back up the moment the stream errors or an old backend downgrades us to legacy board-changed.
  const pushLive = useRef(false)
  useEffect(() => {
    reload()
    reloadIssues(true)
    const unsub = subscribeBoardLive({
      onBoard: (b) => { reqSeq.current++; setLoadFailed(false); setBoard(b); reloadIssues() },
      onLegacyChange: () => { reload(); reloadIssues() },
      onLive: (v) => { pushLive.current = v },
    })
    const id = setInterval(() => { if (!pushLive.current) reload(); reloadIssues() }, 15000)
    return () => { unsub(); clearInterval(id) }
  }, [reload, reloadIssues])
  useEffect(() => {
    const name = projectTitle(board)
    if (name) document.title = `${name} · SpexCode`
  }, [board?.project])
  useEffect(() => {
    // [[tab-icon]] - a configured dashboard.icon sets the tab favicon at runtime; empty keeps the html default.
    const href = faviconHref(projectIcon(board))
    if (!href) return
    let link = document.querySelector("link[rel~='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    link.setAttribute('href', href)
  }, [board?.projectIcon])
  if (!board) {
    if (loadFailed) return (
      <div className="loading load-error">
        <span>{t('hud.loadError')}</span>
        <button className="load-retry" onClick={() => { setLoadFailed(false); reload() }}>{t('hud.retry')}</button>
      </div>
    )
    return <div className="loading">{t('hud.loading')}</div>
  }
  return (
    <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
      {isMobile
        ? <MobileApp specs={board.nodes} sessions={board.sessions} project={projectTitle(board)} />
        : <Dashboard specs={board.nodes} sessions={board.sessions} reload={reload} project={projectTitle(board)} issuesData={issuesData} reloadIssues={reloadIssues} />}
    </Suspense>
  )
}
