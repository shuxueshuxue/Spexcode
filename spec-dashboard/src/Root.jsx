import { Suspense, lazy, useEffect, useState } from 'react'
import SideBar from './SideBar.jsx'
import TooltipLayer from './Tooltip.jsx'
import { TransientNoticeProvider } from './TransientNotice.jsx'
import { navigate, useRoute } from './route.js'
import { useT } from './i18n/index.jsx'
import { useIsMobile } from './useIsMobile.js'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'

const App = lazy(() => import('./App.jsx'))
const EvalsPage = lazy(() => import('./EvalsPage.jsx'))
const IssuesPage = lazy(() => import('./IssuesPage.jsx'))
const MobileApp = lazy(() => import('./MobileApp.jsx'))

const openSession = (id) => navigate('sessions', id)

function ReviewEntry({ page }) {
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
    <div className="app">
      <TooltipLayer />
      <SideBar page={page} identity={null} catalog={null} />
      <div className="app-main">
        <div className={`page-pane page-${page}`}>
          <Suspense fallback={loading}>
            {page === 'evals'
              ? <EvalsPage onOpenSession={openSession} />
              : <IssuesPage onOpenSession={openSession} />}
          </Suspense>
        </div>
      </div>
    </div>
  )
}

export default function Root() {
  const t = useT()
  const { page, param } = useRoute()
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
      <TransientNoticeProvider>
        <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}><App /></Suspense>
      </TransientNoticeProvider>
    )
  }

  return (
    <TransientNoticeProvider>
      <Suspense fallback={<div className="loading">{t('hud.loading')}</div>}>
        {lightweight ? <ReviewEntry page={page} /> : <App />}
      </Suspense>
    </TransientNoticeProvider>
  )
}
