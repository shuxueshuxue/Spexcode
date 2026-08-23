import { Suspense, lazy, useEffect, useState } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import { TransientNoticeProvider } from './TransientNotice.jsx'
import StatusBar, { StatusBarProvider } from './StatusBar.jsx'
import { DocumentActionProvider } from './documentActions.jsx'
import { navigate, useRoute } from './route.js'
import { useT } from './i18n/index.jsx'
import { useIsMobile } from './useIsMobile.js'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'
import { BackendStatusFrame } from './BackendStatus.jsx'

const App = lazy(() => import('./App.jsx'))
const EvalsPage = lazy(() => import('./EvalsPage.jsx'))
const IssuesPage = lazy(() => import('./IssuesPage.jsx'))
const MobileApp = lazy(() => import('./MobileApp.jsx'))

const openSession = (id) => navigate('sessions', id)

function ReviewEntry({ page, param, query }) {
  const isMobile = useIsMobile()
  const t = useT()
  const loading = <div className="loading">{t('hud.loading')}</div>

  if (isMobile) {
    return (
      <Suspense fallback={loading}>
        <MobileApp specs={[]} sessions={[]} />
      </Suspense>
    )
  }

  return (
    <div className="app-shell">
      <div className="app">
        <TooltipLayer />
        <SideBar page={page} />
        <div className="app-content-column">
          <div className="app-content-row">
            <div className="app-main">
              <div className={`page-pane page-${page}`}>
                <Suspense fallback={loading}>
                  {/* the cold entry hands the route down like the shell does: the boards read their route
                      from props, never from the global address ([[view-registry]]). */}
                  {page === 'evals'
                    ? <EvalsPage param={param} query={query} onOpenSession={openSession} />
                    : <IssuesPage param={param} query={query} onOpenSession={openSession} />}
                </Suspense>
              </div>
            </div>
          </div>
          <StatusBar />
        </div>
      </div>
    </div>
  )
}

function RootContent() {
  const t = useT()
  const { page, param, query } = useRoute()
  const coldReviewRoute = page === 'evals' || (page === 'issues' && !param)

  const [boardStarted, setBoardStarted] = useState(() => !coldReviewRoute)
  useEffect(() => {
    if (!coldReviewRoute) setBoardStarted(true)
  }, [coldReviewRoute])
  const lightweight = coldReviewRoute && !boardStarted

  // The public artifact has one face only. It must bypass the live review fast-path as well as the
  // normal App router, otherwise a direct #/issues or #/evals URL would wake a review transport before
  // App can normalize it back to the graph.
  if (PUBLIC_GRAPH_ONLY) {
    return (
      <TransientNoticeProvider><StatusBarProvider><DocumentActionProvider>
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}><App /></Suspense>
      </DocumentActionProvider></StatusBarProvider></TransientNoticeProvider>
    )
  }

  return (
    <TransientNoticeProvider><StatusBarProvider><DocumentActionProvider>
      <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
        {lightweight ? <ReviewEntry page={page} param={param} query={query} /> : <App />}
      </Suspense>
    </DocumentActionProvider></StatusBarProvider></TransientNoticeProvider>
  )
}

export default function Root() {
  return <BackendStatusFrame><RootContent /></BackendStatusFrame>
}
