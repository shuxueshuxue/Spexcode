import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { acceptSessionEvalBoard, loadGraph, loadPublicGraph, subscribeBoardLive, projectIdentity } from './data.js'
import { PROJECT_ID } from './project.js'
import { CATALOG_POLL_MS, applyCatalogResult, loadProjects, selectGatewayIdentity, selectProjectIdentity, tabTitle } from './projects.js'
import CredentialGate from './CredentialGate.jsx'
import { useIsMobile } from './useIsMobile.js'
import { useT } from './i18n/index.jsx'
import {
  DEFAULT_GATEWAY_ICON, DEFAULT_PROJECT_ICON, identityFaviconHref,
} from './IdentityIcon.jsx'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'
import { BoardProvider, WorkspaceProvider } from './workspace.jsx'
import { KeyboardServiceProvider } from './KeyboardService.jsx'
import { useBackendHealth } from './BackendStatus.jsx'

// the two faces are code-split so each downloads only its own world: the desktop tree carries xyflow (and,
// via its own lazy leaves, xterm + the annotator); the phone face ([[mobile-ui]]) carries none of them.
// Which chunk loads is the same viewport-width pick as ever — the split only moves bytes, never behaviour.
// The projects hub ([[projects-hub]]) is a third lazy face: the catalog page standalone, no board behind it.
const Shell = lazy(() => import('./Shell.jsx'))
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
  const backendHealth = useBackendHealth()
  const isMobile = useIsMobile()
  const [board, setBoard] = useState(null)
  const [boardLive, setBoardLive] = useState(false)
  const summarySeen = useRef(new Map())
  const applyBoard = useCallback((next, authoritative) => {
    setBoard(acceptSessionEvalBoard(next, summarySeen.current, authoritative))
  }, [])
  // fail loudly at boot: a board that never arrives (backend down / proxy dead) shows an error + retry
  // panel, never an eternal spinner. Only the pre-first-board window reads this — once a board has landed,
  // a failed refetch keeps the last good board and the poll/stream keep retrying on their own.
  const [loadFailed, setLoadFailed] = useState(false)
  // a gated scope's 401 ([[projects-hub]]): the reason string when the board is behind a credential —
  // renders the shared CredentialGate instead of the load-error panel; cleared the moment a board lands.
  const [authNeeded, setAuthNeeded] = useState(null)
  const [catalogRetry, setCatalogRetry] = useState(0)
  // the shared catalog projection ([[projects-hub]]): null before the first read, then refreshed on the
  // same cadence as ProjectsPage. It picks the global face and feeds scoped rail/title/favicon identity,
  // so an admin edit in another tab arrives live without an icon-specific cache.
  const [projAccess, setProjAccess] = useState(null)
  useEffect(() => {
    if (PUBLIC_GRAPH_ONLY) return undefined
    let live = true
    // applyCatalogResult keeps last-good: the catalog is identity-bearing, so one blipped poll (a
    // gateway restart answers 'absent' for a beat) must not regress a resolved identity to the
    // anonymous default and re-teach the browser a default favicon ([[side-nav]]); ok/denied always
    // apply — denied is an answer, a mid-session lock must re-gate.
    const refresh = () => loadProjects()
      .then((result) => {
        if (live) setProjAccess((prev) => applyCatalogResult(prev, result))
        return result
      })
      .catch(() => {
        const result = { state: 'absent' }
        if (live) setProjAccess((prev) => applyCatalogResult(prev, result))
        return result
      })
    let id
    const poll = async () => {
      const result = await refresh()
      if (result?.state === 'denied') {
        if (id) { clearInterval(id); id = undefined }
      }
      return result
    }
    const start = async () => {
      const result = await poll()
      // A denial is an answer. Stop the noisy retry loop until the credential gate explicitly retries.
      if (live && result?.state !== 'denied') id = setInterval(poll, CATALOG_POLL_MS)
    }
    start()
    return () => { live = false; if (id) clearInterval(id) }
  }, [catalogRetry])
  // freshest-issued wins: stamp each load with a monotonic seq and apply only the latest, so a stale in-flight poll can't resurrect removed state.
  // seal() only after the body actually paints — a superseded response's ETag must never become the poll's conditional key (issue #70).
  const reqSeq = useRef(0)
  const reload = useCallback(() => {
    const mine = ++reqSeq.current
    if (PUBLIC_GRAPH_ONLY) {
      return loadPublicGraph()
        .then((graph) => {
          if (mine !== reqSeq.current) return
          setLoadFailed(false)
          applyBoard(graph, true)
        })
        .catch(() => { if (mine === reqSeq.current) setLoadFailed(true) })
    }
    return loadGraph()
      .then((r) => {
        if (mine !== reqSeq.current || !r) return
        if (r.authRequired) { setAuthNeeded(r.authRequired); return }
        setAuthNeeded(null); setLoadFailed(false); applyBoard(r.board, true); r.seal()
      })
      .catch(() => { if (mine === reqSeq.current) setLoadFailed(true) })
  }, [applyBoard])
  useEffect(() => {
    if (backendHealth.retryKey) reload()
  }, [backendHealth.retryKey, reload])
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
  // Public graph boot is deliberately its own lifecycle. Its board landing flips `facePending` below,
  // which is meaningful for the live hub but must not cause a second static-index transfer.
  useEffect(() => {
    if (!PUBLIC_GRAPH_ONLY) return undefined
    reload()
    return undefined
  }, [reload])

  useEffect(() => {
    if (PUBLIC_GRAPH_ONLY) return undefined
    if (hub || facePending) return
    reload()
    const unsub = subscribeBoardLive({
      onBoard: (b, frame) => { reqSeq.current++; setLoadFailed(false); applyBoard(b, !!frame?.authoritative) },
      onLegacyChange: () => { reload() },
      onStatus: setBoardLive,
    })
    const id = setInterval(() => { reload() }, 15000)
    return () => { unsub(); clearInterval(id) }
  }, [reload, applyBoard, hub, facePending])
  // the route-selected identity, or null while it is still UNRESOLVED (no catalog row, no board yet).
  // The head effects below skip the null window ([[side-nav]]): the browser remembers a favicon per page
  // URL and re-resolves it on every hash navigation, so a placeholder default written during one boot
  // keeps flashing back on later navigations (the session board's per-tab addresses foremost). Until the
  // real identity is known the static boot document stands — never the default mark, never the raw id.
  const boardIdentity = board ? projectIdentity(board) : null
  const identity = PROJECT_ID
    ? selectProjectIdentity(PROJECT_ID, projAccess, boardIdentity)
    : hub
      ? selectGatewayIdentity(projAccess)
      : boardIdentity
  // the WORKSPACE face names its own place ([[workspace-shell]] reads the address; nothing above it does),
  // so this writes the plain project title only for the faces that have no address to report — the hub, the
  // phone, and every pre-board state. Both writing it would race, and a parent effect runs last.
  const shellFace = !!board && !isMobile
  useEffect(() => {
    if (!identity || shellFace) return
    document.title = tabTitle(identity)
  }, [identity?.title, shellFace]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!identity) return
    const fallback = hub ? DEFAULT_GATEWAY_ICON : DEFAULT_PROJECT_ICON
    const href = identityFaviconHref(identity.icon, fallback)
    let link = document.querySelector("link[rel~='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    if (link.getAttribute('href') !== href) link.setAttribute('href', href)
  }, [identity?.icon, hub]) // eslint-disable-line react-hooks/exhaustive-deps
  // a 401'd scope shows the unified credential card, wherever it strikes: pre-board it is the whole
  // face; a mid-session lock (an admin just set a password) also re-gates — a 401 means every surface
  // (poll, stream, terminal socket) is dead until the unlock, so keeping a stale board up would lie.
  if (authNeeded && PROJECT_ID) {
    return <CredentialGate scope={{ projectId: PROJECT_ID }} projectLabel={identity?.title || PROJECT_ID} onUnlocked={() => { setAuthNeeded(null); setCatalogRetry((n) => n + 1); reload() }} />
  }
  if (!board) {
    // the hub face: the catalog page IS the app (see the `hub` pick above). A single-project serve /
    // vite dev answers no catalog (its SPA fallback is not JSON), keeps state 'absent', and boots
    // exactly as before.
    if (hub) {
      if (projAccess.state === 'denied') {
        return <CredentialGate scope="admin" locked={projAccess.reason === 'locked'} onUnlocked={() => { setCatalogRetry((n) => n + 1); reload() }} />
      }
      return (
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
          <ProjectsPage />
        </Suspense>
      )
    }
    if (authNeeded) {
      // 401 at the root address (a gateway gating everything behind the admin scope) — same card, admin face.
      return <CredentialGate scope="admin" locked={authNeeded === 'locked'} onUnlocked={() => { setAuthNeeded(null); setCatalogRetry((n) => n + 1); reload() }} />
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
      {PUBLIC_GRAPH_ONLY
      ? <BoardProvider reload={reload} value={{ specs: board.nodes, sessions: [], issuesStamp: null, identity, catalog: null, boardLive: false, graphOnly: true }}><KeyboardServiceProvider><WorkspaceProvider><Shell /></WorkspaceProvider></KeyboardServiceProvider></BoardProvider>
        : isMobile
        ? <MobileApp specs={board.nodes} sessions={board.sessions} issuesStamp={board.issuesStamp} reloadBoard={reload} />
        : <BoardProvider reload={reload} value={{ specs: board.nodes, sessions: board.sessions, issuesStamp: board.issuesStamp, identity, catalog: projAccess, boardLive, graphOnly: false }}><KeyboardServiceProvider><WorkspaceProvider><Shell /></WorkspaceProvider></KeyboardServiceProvider></BoardProvider>}
    </Suspense>
  )
}
