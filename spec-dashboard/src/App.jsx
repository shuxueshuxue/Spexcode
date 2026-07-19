import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { loadGraph, subscribeBoardLive, loadIssues, projectIdentity } from './data.js'
import { PROJECT_ID } from './project.js'
import { CATALOG_POLL_MS, loadProjects, selectGatewayIdentity, selectProjectIdentity } from './projects.js'
import CredentialGate from './CredentialGate.jsx'
import { useIsMobile } from './useIsMobile.js'
import { useT } from './i18n/index.jsx'
import {
  DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, identityFaviconHref,
} from './IdentityIcon.jsx'

// the two faces are code-split so each downloads only its own world: the desktop tree carries xyflow (and,
// via its own lazy leaves, xterm + the annotator); the phone face ([[mobile-ui]]) carries none of them.
// Which chunk loads is the same viewport-width pick as ever — the split only moves bytes, never behaviour.
// The projects hub ([[projects-hub]]) is a third lazy face: the catalog page standalone, no board behind it.
const Dashboard = lazy(() => import('./Dashboard.jsx'))
const MobileApp = lazy(() => import('./MobileApp.jsx'))
const ProjectsPage = lazy(() => import('./ProjectsPage.jsx'))

// stale-chunk recovery: after a dist rebuild, a page loaded pre-rebuild still asks for the OLD hashed
// chunks, which the server no longer has (it answers 404) — without this the failed lazy import blanks
// the whole app. Vite surfaces every failed chunk load as `vite:preloadError`; reload once to pick up
// the fresh index.html. The latch is the failure itself (its message carries the chunk URL): the SAME
// failure recurring right after the reload is a real outage and surfaces as the normal error instead of
// a reload loop, while a future stale chunk is a new hash → a new key, so no clock and nothing to clear.
window.addEventListener('vite:preloadError', (e) => {
  const key = String(e.payload)
  if (sessionStorage.getItem('spexcode.chunkReload') === key) return
  sessionStorage.setItem('spexcode.chunkReload', key)
  e.preventDefault()
  location.reload()
})

export default function App() {
  const t = useT()
  const isMobile = useIsMobile()
  const [board, setBoard] = useState(null)
  // fail loudly at boot: a board that never arrives (backend down / proxy dead) shows an error + retry
  // panel, never an eternal spinner. Only the pre-first-board window reads this — once a board has landed,
  // a failed refetch keeps the last good board and the poll/stream keep retrying on their own.
  const [loadFailed, setLoadFailed] = useState(false)
  // a gated scope's 401 ([[projects-hub]]): the reason string when the board is behind a credential —
  // renders the shared CredentialGate instead of the load-error panel; cleared the moment a board lands.
  const [authNeeded, setAuthNeeded] = useState(null)
  // the shared catalog projection ([[projects-hub]]): null before the first read, then refreshed on the
  // same cadence as ProjectsPage. It picks the global face and feeds scoped rail/title/favicon identity,
  // so an admin edit in another tab arrives live without an icon-specific cache.
  const [projAccess, setProjAccess] = useState(null)
  useEffect(() => {
    let live = true
    const refresh = () => loadProjects()
      .then((result) => { if (live) setProjAccess(result) })
      .catch(() => { if (live) setProjAccess({ state: 'absent' }) })
    refresh()
    const id = setInterval(refresh, CATALOG_POLL_MS)
    return () => { live = false; clearInterval(id) }
  }, [])
  // the issues list is RESIDENT beside the board (one data path — the issues page renders instantly from
  // app-held state instead of cold-fetching per mount). Freshness inherits the board's own pattern: a
  // push/change signal triggers a throttled refetch, the 15s cold lane backstops (forge-cache updates
  // arrive nowhere else), and the route answers 304 via ETag so a no-change refetch costs headers only.
  // The throttle DEFERS, never drops ([[issues-view]]): a change signal landing inside the 5s window
  // schedules one trailing refetch for the window's edge — dropping it would leave an external write
  // (a second remark in quick succession) invisible until the 15s lane, exactly the staleness the
  // push exists to kill.
  const [issuesData, setIssuesData] = useState(null)
  const issuesSeq = useRef(0)
  const issuesLast = useRef(0)
  const issuesTrail = useRef(null)
  const reloadIssues = useCallback(function load(force = false) {
    const now = Date.now()
    const wait = issuesLast.current + 5000 - now
    if (!force && wait > 0) {
      if (!issuesTrail.current) issuesTrail.current = setTimeout(() => { issuesTrail.current = null; load(true) }, wait)
      return Promise.resolve()
    }
    issuesLast.current = now
    const mine = ++issuesSeq.current
    return loadIssues().then((d) => { if (mine === issuesSeq.current) setIssuesData(d) }).catch(() => {})
  }, [])
  // freshest-issued wins: stamp each load with a monotonic seq and apply only the latest, so a stale in-flight poll can't resurrect removed state.
  // seal() only after the body actually paints — a superseded response's ETag must never become the poll's conditional key (issue #70).
  const reqSeq = useRef(0)
  const reload = useCallback(() => {
    const mine = ++reqSeq.current
    return loadGraph()
      .then((r) => {
        if (mine !== reqSeq.current || !r) return
        if (r.authRequired) { setAuthNeeded(r.authRequired); return }
        setAuthNeeded(null); setLoadFailed(false); setBoard(r.board); r.seal()
      })
      .catch(() => { if (mine === reqSeq.current) setLoadFailed(true) })
  }, [])
  // push-first freshness ([[graph-stream]]/[[graph-delta]]): the delta stream carries whole boards (a full on
  // connect, then applied patches) straight into setBoard — no refetch per change. A pushed board is the
  // freshest by channel order, so it bumps the seq to invalidate any older in-flight fetch. The interval is
  // the cold FALLBACK and it ALWAYS runs — the client keeps no push-liveness detector, because a silently
  // dead stream (half-open tunnel, sleep-resume) looks exactly like a healthy quiet one and a detector that
  // trusts it freezes the board. The poll's cost is zeroed instead: loadGraph sends If-None-Match and an
  // unchanged board answers 304 → null → no repaint. Push dead in ANY mode = at most one poll period stale.
  // the hub face ([[projects-hub]]): the global /projects address with no board but a live catalog. Once
  // it resolves, the board machinery below stands down — the hub has no board, so its stream/poll would
  // only hammer a surface that answers HTML.
  const hub = !PROJECT_ID && !board && !!projAccess && projAccess.state !== 'absent'
  const facePending = !PROJECT_ID && !board && projAccess === null
  useEffect(() => {
    if (hub || facePending) return
    reload()
    reloadIssues(true)
    const unsub = subscribeBoardLive({
      onBoard: (b) => { reqSeq.current++; setLoadFailed(false); setBoard(b); reloadIssues() },
      onLegacyChange: () => { reload(); reloadIssues() },
    })
    const id = setInterval(() => { reload(); reloadIssues() }, 15000)
    return () => { unsub(); clearInterval(id); clearTimeout(issuesTrail.current); issuesTrail.current = null }
  }, [reload, reloadIssues, hub, facePending])
  const boardIdentity = projectIdentity(board)
  const identity = PROJECT_ID
    ? selectProjectIdentity(PROJECT_ID, projAccess, boardIdentity)
    : hub
      ? selectGatewayIdentity(projAccess)
      : boardIdentity
  useEffect(() => {
    document.title = identity.title ? `${identity.title} · SpexCode` : 'SpexCode'
  }, [identity.title])
  useEffect(() => {
    const fallback = hub ? DEFAULT_GATEWAY_ICON : DEFAULT_PROJECT_ICON
    const href = identityFaviconHref(identity.icon, fallback)
    let link = document.querySelector("link[rel~='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    link.setAttribute('href', href)
  }, [identity.icon, hub])
  // a 401'd scope shows the unified credential card, wherever it strikes: pre-board it is the whole
  // face; a mid-session lock (an admin just set a password) also re-gates — a 401 means every surface
  // (poll, stream, terminal socket) is dead until the unlock, so keeping a stale board up would lie.
  if (authNeeded && PROJECT_ID) {
    return <CredentialGate scope={{ projectId: PROJECT_ID }} projectLabel={identity.title || PROJECT_ID} onUnlocked={() => { setAuthNeeded(null); reload() }} />
  }
  if (!board) {
    // the hub face: the catalog page IS the app (see the `hub` pick above). A single-project serve /
    // vite dev answers no catalog (its SPA fallback is not JSON), keeps state 'absent', and boots
    // exactly as before.
    if (hub) {
      return (
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
          <ProjectsPage />
        </Suspense>
      )
    }
    if (authNeeded) {
      // 401 at the root address (a gateway gating everything behind the admin scope) — same card, admin face.
      return <CredentialGate scope="admin" locked={authNeeded === 'locked'} onUnlocked={() => { setAuthNeeded(null); reload() }} />
    }
    // fail loudly only once both probes have had their say — while the catalog probe is still in flight a
    // failed board fetch may yet resolve into the hub face, so hold the spinner instead of flashing the panel.
    if (loadFailed && (PROJECT_ID || (projAccess && projAccess.state === 'absent'))) return (
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
        ? <MobileApp specs={board.nodes} sessions={board.sessions} issuesData={issuesData} reloadIssues={reloadIssues} reloadBoard={reload} />
        : <Dashboard specs={board.nodes} sessions={board.sessions} reload={reload} identity={identity} issuesData={issuesData} reloadIssues={reloadIssues} catalog={projAccess} />}
    </Suspense>
  )
}
